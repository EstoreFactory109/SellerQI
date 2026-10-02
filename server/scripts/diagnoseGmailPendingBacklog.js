#!/usr/bin/env node
/**
 * diagnoseGmailPendingBacklog.js
 *
 * Says WHY each message in the Gmail ingest retry backlog is stuck, and writes nothing.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GmailConnection.pendingMessageIds` is a bare list of ids. It records that something
 * failed and nothing about what, so a message can sit in it being re-fetched on every
 * ten-minute sync indefinitely while `/api/gmail/status` reports the connection healthy —
 * `lastError` is only ever set when the backlog passes its 200-entry cap, which a small
 * inbox never reaches. That is exactly what happened: 28 ids, none of them ever stored,
 * retried on every run for a week with no signal anywhere.
 *
 * Before changing the retry logic you have to know what these actually are, because the
 * right fix differs: a message deleted from Gmail can never be ingested and should be
 * retired, while a message failing on a parse bug should be fixed and re-run. Guessing
 * would mean either abandoning real client mail or retrying dead ids forever.
 *
 * WHY A SEPARATE SCRIPT AND NOT A --dry-run FLAG ON ingestMessage
 * ---------------------------------------------------------------
 * `ingestMessage` contains six write calls plus `analyseMessage`, which itself writes
 * TaskRequest rows and can send an automated reply to the client. A dry-run flag would
 * put every one of those behind a boolean, and one missed guard writes to production —
 * or worse, emails somebody. This script reaches none of them: it calls only the pure
 * parser, the pure router, and the read-only client lookup, and the FORBIDDEN_WRITES
 * guard below makes that an assertion rather than a promise.
 *
 * USAGE
 *   node server/scripts/diagnoseGmailPendingBacklog.js
 *   node server/scripts/diagnoseGmailPendingBacklog.js --json
 *   node server/scripts/diagnoseGmailPendingBacklog.js --show-addresses   # see §PRIVACY
 *   node server/scripts/diagnoseGmailPendingBacklog.js --id=<gmailMessageId>
 *
 * PRIVACY
 * -------
 * Output goes to console.log and NEVER to utils/Logger.js. Logger appends unrotated to
 * logs.txt, so logging 28 client addresses there would put them on disk permanently —
 * the ingest path takes the same care, and says so where it counts unmatched senders.
 * Addresses are masked unless --show-addresses. Message bodies and Gmail's `snippet` are
 * never printed at all; `snippet` is explicitly flagged as unredacted in the parser.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const GmailConnection = require('../models/system/GmailConnectionModel.js');
const { EmailMessage, EmailThread } = require('../models/system/EmailThreadModels.js');
const UserModel = require('../models/user-auth/userModel.js');
const GmailClient = require('../Services/Gmail/GmailClient.js');
const { parseMessage } = require('../Services/Gmail/gmailMessageParser.js');
const { routeMessage } = require('../Services/Gmail/inboundRouting.js');
const { resolveClient } = require('../Services/Gmail/GmailIngestService.js');
const { getCredentials } = require('../Services/Gmail/config.js');

const hasFlag = (n) => process.argv.slice(2).includes(`--${n}`);
const argValue = (n) => {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
};
const AS_JSON = hasFlag('json');
const SHOW_ADDRESSES = hasFlag('show-addresses');
const ONLY_ID = argValue('id');

/**
 * Every write method on every model this script can reach, replaced with a thrower.
 *
 * Not defence against a hostile caller — defence against the next person who adds "and
 * while we're here, let's just fix the one bad row". The whole value of this script is
 * that its output describes production BEFORE anything touched it, and that is worth
 * eight lines. In-process only: no file and no document is modified by this.
 *
 * ── WHY THIS IS INSTALLED LATE, NOT AT MODULE LOAD ──
 * `GmailAuth.getAccessToken` legitimately writes `lastRefreshAt` to the connection
 * document when it mints a token. Guarding from the start therefore breaks the very
 * first API call and every message reports `gmail-unavailable` — which looks exactly
 * like a real finding and is not one. So the token is warmed FIRST, then the guard goes
 * on, and a refresh needed mid-run fails loudly rather than being mistaken for a 500.
 */
const FORBIDDEN_WRITES = [
    'updateOne', 'updateMany', 'create', 'insertMany', 'findOneAndUpdate',
    'findOneAndDelete', 'findOneAndReplace', 'findByIdAndUpdate', 'findByIdAndDelete',
    'deleteOne', 'deleteMany', 'bulkWrite', 'replaceOne', 'insertOne', 'save',
];
const installWriteGuard = () => {
    [GmailConnection, EmailMessage, EmailThread, UserModel].forEach((model) => {
        FORBIDDEN_WRITES.forEach((name) => {
            model[name] = () => {
                throw new Error(`[diagnose] ${name}() is forbidden — this script must never write`);
            };
        });
    });
};

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

/**
 * What to do about each class. The drain action is the point of the whole exercise, so
 * it lives beside the verdict rather than in someone's head.
 */
const VERDICTS = {
    'gone-from-gmail': 'Deleted from the mailbox. Unrecoverable — retire it.',
    'gmail-unavailable': 'Transient API failure. Leave pending; it will retry.',
    'already-stored': 'A row exists. Clears itself on the next run.',
    'echo-reconciled': 'Our own message, matched by Message-ID. Clears itself.',
    'routing-skip': 'Deliberately not ingested (draft/spam/auth-fail/etc). Clears itself.',
    'echo-no-local-copy': 'Our own send with no row — the genuine deferral case.',
    'unmatched-sender': 'No linked client for this address. Clears itself.',
    'would-throw-null-thread': 'No gmailThreadId: EmailThread.upsert throws forever. Needs a code fix.',
    'would-throw-parse': 'The parser itself throws. Needs a code fix.',
    'would-ingest': 'Nothing wrong with it — should ingest on the next run.',
};

const maskAddress = (value) => {
    const raw = String(value || '');
    if (!raw) return '';
    if (SHOW_ADDRESSES) return raw;
    const at = raw.lastIndexOf('@');
    if (at < 1) return `${raw.slice(0, 1)}***`;
    const domain = raw.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    return `${raw.slice(0, 1)}***@${domain.slice(0, 1)}***${dot > 0 ? domain.slice(dot) : ''}`;
};

/**
 * Classify one pending id.
 *
 * Mirrors the order of `ingestMessage` exactly — duplicate checks, then routing, then the
 * client lookup — so the verdict is the decision ingest would reach, not an approximation
 * of it. Where ingest would then write, this stops and reports instead.
 */
const classify = async (gmailMessageId, { inboxAddress }) => {
    const row = {
        id: gmailMessageId,
        verdict: null,
        reason: null,
        httpStatus: null,
        originHeader: null,
        direction: null,
        labelIds: [],
        from: null,
        to: [],
        sentAt: null,
        gmailThreadId: null,
        rfc822MessageId: null,
        storedByGmailId: false,
        storedByRfc822Id: false,
        bodyChars: 0,
        hasHtml: false,
        attachmentCount: 0,
    };

    row.storedByGmailId = Boolean(await EmailMessage.exists({ gmailMessageId }));
    if (row.storedByGmailId) {
        row.verdict = 'already-stored';
        return row;
    }

    let raw;
    try {
        raw = await GmailClient.getMessage(gmailMessageId);
    } catch (error) {
        row.httpStatus = error?.statusCode ?? null;
        row.reason = error?.message || 'unknown';
        row.verdict = row.httpStatus === 404 ? 'gone-from-gmail' : 'gmail-unavailable';
        return row;
    }

    let parsed;
    try {
        parsed = parseMessage(raw);
    } catch (error) {
        row.verdict = 'would-throw-parse';
        row.reason = error?.message || 'unknown';
        return row;
    }

    row.originHeader = parsed.originHeader || null;
    row.labelIds = parsed.labelIds || [];
    row.from = parsed.fromEmail || null;
    row.to = parsed.toEmails || [];
    row.sentAt = parsed.sentAt ? new Date(parsed.sentAt).toISOString() : null;
    row.gmailThreadId = parsed.gmailThreadId || null;
    row.rfc822MessageId = parsed.rfc822MessageId || null;
    row.hasHtml = Boolean(parsed.bodyHtml);
    row.bodyChars = String(parsed.bodyHtml || parsed.bodyText || '').length;
    row.attachmentCount = (parsed.attachments || []).length;

    if (parsed.rfc822MessageId) {
        row.storedByRfc822Id = Boolean(await EmailMessage.exists({ rfc822MessageId: parsed.rfc822MessageId }));
        if (row.storedByRfc822Id) {
            row.verdict = 'echo-reconciled';
            return row;
        }
    }

    const decision = routeMessage(parsed, { inboxAddress });
    row.direction = decision.direction || null;
    if (decision.action === 'skip') {
        row.reason = decision.reason;
        row.verdict = decision.reason === 'portal-echo' ? 'echo-no-local-copy' : 'routing-skip';
        return row;
    }

    const match = await resolveClient(decision.lookup);
    if (!match) {
        row.verdict = 'unmatched-sender';
        return row;
    }

    /*
     * The upsert ingest would do next is the one that throws forever on a null thread id:
     * EmailThread.gmailThreadId is `required` AND `unique`, so it is a ValidationError the
     * first time and E11000 on every run after. Checked rather than attempted, because
     * attempting it is a write.
     */
    if (!parsed.gmailThreadId) {
        row.verdict = 'would-throw-null-thread';
        return row;
    }

    row.verdict = 'would-ingest';
    return row;
};

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

const printRow = (row) => {
    const bits = [
        row.id.padEnd(18),
        (row.verdict || '?').padEnd(24),
        row.direction ? row.direction.padEnd(9) : '—'.padEnd(9),
        row.originHeader ? `origin=${row.originHeader}` : '',
        row.httpStatus ? `http=${row.httpStatus}` : '',
        row.from ? `from=${maskAddress(row.from)}` : '',
        row.sentAt ? `sent=${row.sentAt.slice(0, 16)}` : '',
        // Only meaningful once a message was actually parsed. Printing it for a 404
        // reads as "this message has no thread id", which is a claim about a message
        // we never saw.
        (row.verdict === 'would-throw-null-thread') ? 'NO-THREAD-ID' : '',
        row.reason ? `(${row.reason})` : '',
    ].filter(Boolean);
    console.log('  ' + bits.join('  '));
};

/**
 * Every id currently in the backlog, in either shape, de-duplicated.
 *
 * GmailIngestService.runSync migrates the legacy pendingMessageIds into pendingMessages on
 * its first run after a deploy, clearing the legacy field in the same write. So depending
 * on whether that first sync has happened yet, the live backlog is in one field or the
 * other - and reading only pendingMessageIds (what this script originally did) would
 * report an empty backlog forever once that migration has run. Exactly the kind of silent
 * wrong answer this script exists to prevent, and it would have been one.
 *
 * Pulled out as its own function so this can be tested without mocking main()'s mongoose
 * connection, token warm-up and write guard.
 */
const backlogIds = (connection) => {
    const fromStructured = (connection?.pendingMessages || []).map((entry) => entry.id).filter(Boolean);
    const fromLegacy = connection?.pendingMessageIds || [];
    return [...new Set([...fromStructured, ...fromLegacy])];
};

async function main() {
    if (!MONGODB_URI) throw new Error('No Mongo URI configured');
    await mongoose.connect(MONGODB_URI);

    const { inboxAddress } = getCredentials();
    const connection = await GmailConnection.findOne({ key: GmailConnection.SINGLETON_KEY }).lean();
    if (!connection) {
        console.log('No Gmail connection document — nothing to diagnose.');
        await mongoose.disconnect();
        return;
    }

    const ids = ONLY_ID ? [ONLY_ID] : backlogIds(connection);

    /*
     * Redis FIRST, then warm the token, then install the guard. The order is the whole
     * trick and getting it wrong looks like a finding rather than a mistake.
     *
     * `authCache` fails open when Redis is absent, so without a connection there is no
     * token cache at all and EVERY Gmail call mints a fresh access token — which writes
     * `lastRefreshAt`, which the guard then blocks, which reports all 32 messages as
     * `gmail-unavailable`. That is a convincing-looking wrong answer. It is also the
     * same trap the Zoho scripts carry: no Redis means a token per call, and Google
     * starts refusing refreshes.
     *
     * Redis is an optimisation, not a dependency — if it is unreachable, carry on and
     * let the single warm-up refresh below cover the run.
     */
    try {
        const { connectRedis } = require('../config/redisConn.js');
        await connectRedis();
    } catch (error) {
        console.log(`(no Redis: ${error.message} — continuing, one token will be minted)`);
    }

    const GmailAuth = require('../Services/Gmail/GmailAuth.js');
    await GmailAuth.getAccessToken();
    installWriteGuard();

    console.log('='.repeat(78));
    console.log(`Gmail pending backlog — ${ids.length} message(s)   inbox: ${maskAddress(inboxAddress)}`);
    console.log(`lastSyncAt ${connection.lastSyncAt || 'never'}   lastError ${connection.lastError || 'null'}`);
    console.log('READ ONLY — every model write method is disabled in this process.');
    console.log('='.repeat(78));

    const rows = [];
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const row = await classify(id, { inboxAddress });
        rows.push(row);
        if (!AS_JSON) printRow(row);
    }

    if (AS_JSON) {
        console.log(JSON.stringify(rows, null, 2));
    } else {
        const tally = rows.reduce((acc, r) => {
            acc[r.verdict] = (acc[r.verdict] || 0) + 1;
            return acc;
        }, {});
        console.log('\n' + '-'.repeat(78));
        console.log('TALLY');
        Object.entries(tally)
            .sort((a, b) => b[1] - a[1])
            .forEach(([verdict, n]) => {
                console.log(`  ${String(n).padStart(3)}  ${verdict.padEnd(24)} ${VERDICTS[verdict] || ''}`);
            });
        console.log('-'.repeat(78));
    }

    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch(async (e) => {
        console.error('FATAL:', e.message);
        console.error(e.stack);
        try { await mongoose.disconnect(); } catch { /* already closed */ }
        process.exit(1);
    });
}

module.exports = { classify, maskAddress, VERDICTS, backlogIds };
