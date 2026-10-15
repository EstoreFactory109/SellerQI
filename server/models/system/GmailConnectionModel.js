/**
 * GmailConnectionModel.js
 *
 * Singleton document holding the ONE shared ESF inbox connection, modelled on
 * ZohoConnectionModel.js — same singleton-by-unique-key trick, same `select: false` on
 * the refresh token, same reasoning for keeping it in Mongo rather than .env (recovery
 * is "an admin re-runs connect", not "someone edits .env and redeploys").
 *
 * ── THE CURSOR IS THE PART THAT NEEDS CARE ──
 * `historyId` is a **String**, not a Number. Gmail's history id is a uint64 and
 * `Number` silently loses precision above 2^53 — which does not fail, it just starts
 * skipping mail. Comparisons are done as BigInt.
 *
 * It is also written only after a page has been *fully* ingested. A cursor advanced
 * optimistically and then interrupted means the messages in between are never fetched
 * again by any mechanism: `history.list` only moves forward, so skipped mail is not
 * "late", it is gone from the portal permanently while sitting perfectly intact in Gmail.
 */

const mongoose = require('mongoose');

const SINGLETON_KEY = 'gmail_inbox';

const GmailConnectionSchema = new mongoose.Schema({
    // `unique: true` builds the index that enforces the singleton. Do NOT also declare
    // schema.index({key:1}) — Mongoose warns about the duplicate.
    key: { type: String, default: SINGLETON_KEY, unique: true, required: true },

    /**
     * Long-lived OAuth refresh token, read only via an explicit `.select('+refreshToken')`.
     *
     * Google expires these after 7 days while the OAuth app's publishing status is
     * "Testing". That is a configuration property, not a code one, and it is the single
     * most likely cause of this integration dying a week after it starts working.
     */
    refreshToken: { type: String, required: false, select: false },

    /**
     * The mailbox this connection actually belongs to, captured from users.getProfile at
     * connect time.
     *
     * Checked against GMAIL_INBOX_ADDRESS before anything is persisted. Without that
     * check, an admin already signed into a personal Google account in the same browser
     * connects their own mailbox with one click, and every private email they have ever
     * received starts flowing onto the staff Messages page.
     */
    emailAddress: { type: String, required: false },

    /**
     * The ingestion cursor. String, deliberately — see the header.
     *
     * Null means "never synced": the next run establishes a baseline from the mailbox's
     * current historyId rather than attempting to walk all history from zero.
     */
    historyId: { type: String, default: null },
    lastSyncAt: { type: Date, default: null },

    /**
     * Messages that failed to ingest, retried on every subsequent run.
     *
     * This exists to resolve a genuine conflict. The cursor must not advance past a
     * message that was never stored, or `history.list` — which only moves forward —
     * loses it permanently. But holding the cursor at the first failure means one
     * unparseable message stops ALL client mail indefinitely, which for a support inbox
     * is its own outage.
     *
     * Tracking the failures durably lets the cursor advance without losing anything:
     * the mailbox keeps flowing and the stragglers are retried until they succeed.
     * Capped, because an unbounded list here would mean a systemic failure quietly
     * growing a document instead of raising an alarm.
     */
    /**
     * LEGACY. Read once by runSync and cleared; see loadBacklog there.
     *
     * Kept in the schema on purpose: removing it in the same deploy that adds
     * pendingMessages would lose whatever backlog existed at the moment of the
     * restart. Delete it in a LATER release, once /status has shown it empty.
     */
    pendingMessageIds: { type: [String], default: [] },

    /**
     * The retry backlog, one entry per message, with enough state to STOP.
     *
     * ── WHY THIS IS NO LONGER A BARE LIST OF IDS ──
     * A set of ids can say "still failing" and nothing else, so nothing in it could ever
     * expire. That is not theoretical: 37 messages sat in the old field for over a week,
     * re-fetched on every ten-minute sync, while `lastError` stayed null and
     * /api/gmail/status reported the connection healthy. The only thing that ever set
     * lastError was the list passing its 200-entry cap, and a small inbox never gets
     * there.
     *
     * Every one of those 37 was a Gmail 404 - deleted from the mailbox while history.list
     * still listed it. Unrecoverable by any mechanism, retried forever.
     *
     * `attempts` and `firstSeenAt` are both needed to retire an entry, and they are ANDed
     * rather than ORed. Attempts alone abandons good mail during a long upstream outage,
     * which at a ten-minute poll is only a few hours of failures. Age alone keeps a
     * permanently-deleted message in the loop for a full day of pointless API calls.
     * Giving up means both: many failures AND hours of wall-clock to recover in.
     *
     * A message Gmail answers 404 for skips both bounds - see PERMANENT_FAILURE in
     * GmailIngestService. There is nothing to wait for.
     */
    pendingMessages: {
        type: [new mongoose.Schema({
            id: { type: String, required: true },
            attempts: { type: Number, default: 0 },
            firstSeenAt: { type: Date, default: Date.now },
            lastAttemptAt: { type: Date, default: null },
            /** 'throw' | 'deferred' — a thrown error and a deferral are different failures. */
            lastOutcome: { type: String, enum: ['throw', 'deferred'], default: 'throw' },
            /** The error message, truncated. NEVER a body, an address or a subject. */
            lastReason: { type: String, default: null },
        }, { _id: false })],
        default: [],
    },

    /**
     * Messages we have STOPPED retrying. Retired, not deleted.
     *
     * ── WHY THIS IS NOT A SILENT DROP, AND MUST NEVER BECOME ONE ──
     * The whole backlog exists so the cursor can advance without losing a client's email.
     * Retiring an entry takes it out of the hot retry loop; it does not remove the ability
     * to recover it. The Gmail id survives here, the count is on /api/gmail/status, and
     * POST /api/gmail/pending/requeue puts one back with its counter reset.
     *
     * If a later change makes retirement quiet - prunes this list, or drops the status
     * field - it has reintroduced exactly the bug this was added to end.
     */
    deadLetterMessages: {
        type: [new mongoose.Schema({
            id: { type: String, required: true },
            attempts: { type: Number, default: 0 },
            firstSeenAt: { type: Date, default: null },
            retiredAt: { type: Date, default: Date.now },
            lastOutcome: { type: String, default: null },
            lastReason: { type: String, default: null },
        }, { _id: false })],
        default: [],
    },

    /** Gmail expires a watch after ~7 days; the renewal cron reads this. */
    watchExpiration: { type: Date, default: null },
    watchTopic: { type: String, default: null },

    scopes: { type: [String], default: [] },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    connectedAt: { type: Date, default: null },
    lastRefreshAt: { type: Date, default: null },

    /**
     * Last failure, so /api/gmail/status can explain a dead connection without a log
     * dive. An expired refresh token should banner in the UI, not stop mail silently —
     * silence is indistinguishable from "no one emailed today".
     */
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
}, { timestamps: true });

const GmailConnection = mongoose.models.GmailConnection
    || mongoose.model('GmailConnection', GmailConnectionSchema);

module.exports = GmailConnection;
module.exports.SINGLETON_KEY = SINGLETON_KEY;
