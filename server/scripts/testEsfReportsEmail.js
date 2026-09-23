/**
 * TEMPORARY TEST SCRIPT — Estore Factory report emails.
 *
 * Sends the ESF report emails to a fixed pair of test inboxes, built from one
 * named account's real data, so the PDFs and the email body can be eyeballed
 * before the cron cycles go live.
 *
 * DELETE THIS FILE once the reports have been signed off. It exists only to
 * take a look at the output; nothing in the app calls it.
 *
 * SAFETY
 *   - Recipients are HARDCODED below. The script never reads a client's own
 *     address and never loops over the client list, so it cannot mail a real
 *     customer however it is invoked.
 *   - It is a DRY RUN unless you pass --send. A bare run builds every PDF and
 *     prints what would go out, without opening an SMTP connection.
 *
 * USAGE
 *   # dry run: build everything, send nothing
 *   node server/scripts/testEsfReportsEmail.js
 *
 *   # actually send all four cadences to the test inboxes
 *   node server/scripts/testEsfReportsEmail.js --send
 *
 *   # just one cycle
 *   node server/scripts/testEsfReportsEmail.js --send --cadence=weekly
 *
 *   # use a different account's data as the source
 *   node server/scripts/testEsfReportsEmail.js --send --source=someone@example.com
 *
 *   # write the PDFs to disk as well, to open them locally
 *   node server/scripts/testEsfReportsEmail.js --out=./tmp-report-pdfs
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const logger = require('../utils/Logger.js');
const dbConnect = require('../config/dbConn.js');
const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const {
    buildAttachmentsForClient,
    CADENCE_GROUPS,
} = require('../Services/BackgroundJobs/esfReportsMailer.js');
const {
    sendEsfReportsEmail,
    createReportsTransport,
} = require('../Services/Email/SendEsfReportsEmail.js');

/** Every message this script sends goes here, and nowhere else. */
const TEST_RECIPIENTS = [
    'ankanmandal2001@gmail.com',
    'ayanm102435@gmail.com',
].join(', ');

/** Whose data the reports are built from. */
const DEFAULT_SOURCE_ACCOUNT = 'ankanmandal2001@gmail.com';

const arg = (name, fallback = null) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const main = async () => {
    const send = flag('send');
    const sourceEmail = arg('source', DEFAULT_SOURCE_ACCOUNT);
    const only = arg('cadence');
    const outDir = arg('out');

    const cadences = only ? [only] : Object.keys(CADENCE_GROUPS);
    for (const cadence of cadences) {
        if (!CADENCE_GROUPS[cadence]) {
            console.error(`Unknown cadence "${cadence}". Expected one of: ${Object.keys(CADENCE_GROUPS).join(', ')}`);
            process.exit(1);
        }
    }

    console.log('='.repeat(72));
    console.log('ESF REPORT EMAIL TEST');
    console.log(`  source account : ${sourceEmail}`);
    console.log(`  recipients     : ${TEST_RECIPIENTS}`);
    console.log(`  cadences       : ${cadences.join(', ')}`);
    console.log(`  mode           : ${send ? '*** SENDING REAL EMAIL ***' : 'dry run (pass --send to actually send)'}`);
    if (outDir) console.log(`  writing PDFs   : ${outDir}`);
    console.log('='.repeat(72));

    await dbConnect();

    const user = await User.findOne({ email: new RegExp(`^${sourceEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
        .select('_id firstName email isEsfClient')
        .lean();

    if (!user) {
        console.error(`\nNo user found with email ${sourceEmail}`);
        process.exit(1);
    }

    const seller = await Seller.findOne({ User: user._id }).select('sellerAccount').lean();
    const marketplaces = (seller?.sellerAccount || [])
        .filter((a) => a.country && a.region)
        .map((a) => ({ country: a.country, region: a.region }));

    if (!marketplaces.length) {
        console.error(`\n${sourceEmail} has no connected marketplace, so there is nothing to report on.`);
        process.exit(1);
    }

    console.log(`\nsource user ${user._id}  esfClient=${user.isEsfClient === true}  marketplaces: ${marketplaces.map((m) => m.country).join(', ')}\n`);

    if (outDir) fs.mkdirSync(outDir, { recursive: true });

    const client = { ...user, marketplaces };
    const transport = send ? createReportsTransport() : null;
    const results = [];

    try {
        for (const cadence of cadences) {
            const group = CADENCE_GROUPS[cadence];
            process.stdout.write(`${group.label.padEnd(11)} building... `);

            const { attachments, summaries } = await buildAttachmentsForClient(client, group);

            if (!attachments.length) {
                console.log('nothing available for this account — no email');
                results.push({ cadence, sent: false, reason: 'no data' });
                continue;
            }

            const kb = (attachments.reduce((n, a) => n + a.content.length, 0) / 1024).toFixed(1);
            console.log(`${attachments.length} PDF(s), ${kb} KB`);
            for (const a of attachments) {
                console.log(`              ${a.filename} (${(a.content.length / 1024).toFixed(1)} KB)`);
                if (outDir) fs.writeFileSync(path.join(outDir, a.filename), a.content);
            }

            if (!send) {
                results.push({ cadence, sent: false, reason: 'dry run' });
                continue;
            }

            const messageId = await sendEsfReportsEmail({
                email: user.email,
                firstName: user.firstName || 'there',
                userId: user._id,
                cadenceLabel: `${group.label} (TEST)`,
                reports: summaries,
                attachments,
                transport,
                // The whole point of this script: never the client's own address.
                recipientOverride: TEST_RECIPIENTS,
            });

            console.log(`              ${messageId ? `SENT  messageId ${messageId}` : 'FAILED — see logs'}`);
            results.push({ cadence, sent: Boolean(messageId) });
        }
    } finally {
        if (transport) transport.close();
    }

    console.log(`\n${'='.repeat(72)}`);
    for (const r of results) {
        console.log(`  ${r.cadence.padEnd(11)} ${r.sent ? 'sent' : `not sent (${r.reason})`}`);
    }
    if (!send) console.log('\nDry run only. Re-run with --send to deliver these to the test inboxes.');
    console.log('='.repeat(72));

    await mongoose.disconnect();
};

main().catch(async (error) => {
    logger.error('[testEsfReportsEmail] Failed', { error: error?.message, stack: error?.stack });
    console.error('\nFAILED:', error.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
});
