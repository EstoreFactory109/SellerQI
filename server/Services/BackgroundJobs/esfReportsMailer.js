/**
 * Estore Factory reports mailer.
 *
 * Emails ESF-managed clients their recurring reports as PDFs, grouped so each
 * cadence is ONE message: the three weekly reports arrive together, the two
 * monthly ones together, and so on.
 *
 * SCOPE — ESF CLIENTS ONLY
 * The audience is `User.isEsfClient === true` and nobody else. These reports are
 * a managed-service deliverable, not a platform feature, so an ordinary seller
 * must never receive one. That filter is applied in one place (findEsfClients)
 * and is the thing to check first if the wrong person gets an email.
 *
 * WHAT IS SENT
 * Only reports that are `available` for that marketplace. A report with no data
 * behind it is skipped rather than attached as a blank page, which is the same
 * rule the Reports page follows on screen. A client whose cadence group has no
 * available report gets no email at all — silence is better than an empty one.
 *
 * A client with several marketplaces gets one message per cadence covering all
 * of them, with each PDF named for its marketplace, rather than one message per
 * marketplace.
 *
 * DELIVERY
 * One pooled SMTP transport for the whole run and clients processed one at a
 * time. The existing weekly job opens a connection per recipient and fans every
 * seller out in parallel; production logs show roughly half of those sends
 * failing with ECONNRESET / EPIPE / SES "451 Timeout waiting for data".
 */
const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { getEsfReports, getEsfReportRows } = require('../Calculations/EsfReportsService.js');
const { renderReportPdf, reportPdfFilename, MAX_PDF_ROWS } = require('../Reports/reportPdf.js');
const { sendEsfReportsEmail, createReportsTransport } = require('../Email/SendEsfReportsEmail.js');

/**
 * Which report types belong to which cycle. Keys are the report keys from
 * EsfReportsService; the cadence strings there are the source of this grouping.
 */
const CADENCE_GROUPS = {
    weekly: {
        label: 'Weekly',
        reportKeys: ['account-overview', 'buybox', 'review-requests'],
    },
    biweekly: {
        label: 'Bi-weekly',
        reportKeys: ['inventory-restock'],
    },
    monthly: {
        label: 'Monthly',
        reportKeys: ['fba-aged-inventory', 'monthly-performance'],
    },
    quarterly: {
        label: 'Quarterly',
        reportKeys: ['listings-audit'],
    },
};

/** Marketplaces are processed in series; this spaces out the SP-API-backed reads. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ISO-8601 week number. Used to make "bi-weekly" mean every OTHER week rather
 * than every week — cron cannot express a fortnight, so the job runs weekly and
 * returns early on odd weeks.
 */
const isoWeek = (date = new Date()) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday of this week decides the year, per ISO-8601.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

/** True on the weeks the bi-weekly cycle should actually send. */
const isBiweeklyWeek = (date = new Date()) => isoWeek(date) % 2 === 0;

/** Every ESF-managed client with at least one connected marketplace. */
const findEsfClients = async () => {
    const clients = await User.find({ isEsfClient: true })
        .select('_id firstName email')
        .lean();

    const withMarketplaces = [];
    for (const client of clients) {
        const seller = await Seller.findOne({ User: client._id }).select('sellerAccount').lean();
        const marketplaces = (seller?.sellerAccount || [])
            .filter((account) => account.country && account.region)
            .map((account) => ({ country: account.country, region: account.region }));
        if (marketplaces.length) withMarketplaces.push({ ...client, marketplaces });
    }
    return withMarketplaces;
};

/**
 * Build the attachments for one client and one cadence.
 *
 * Rows are re-fetched at PDF depth: the card payload carries only a preview
 * page, so rendering straight from it would put ten rows in every document.
 */
const buildAttachmentsForClient = async (client, group) => {
    const attachments = [];
    const summaries = [];

    for (const marketplace of client.marketplaces) {
        let payload;
        try {
            payload = await getEsfReports(client._id, marketplace.country, marketplace.region);
        } catch (error) {
            logger.error(`[EsfReportsMailer] Could not build reports for ${client._id} ${marketplace.country}: ${error.message}`);
            continue;
        }

        for (const key of group.reportKeys) {
            const report = payload.reports.find((r) => r.key === key);
            if (!report?.available) continue;

            // Deepen the table beyond the preview page before rendering.
            try {
                const paged = await getEsfReportRows(
                    client._id, marketplace.country, marketplace.region, key,
                    { page: 1, limit: MAX_PDF_ROWS }
                );
                if (paged?.available && paged.rows?.length) {
                    report.summary = { ...report.summary, rows: paged.rows, totalRows: paged.totalRows };
                }
            } catch (error) {
                // Not fatal — fall back to the preview rows already in hand.
                logger.warn(`[EsfReportsMailer] Row fetch failed for ${key}, using preview rows: ${error.message}`);
            }

            try {
                const content = await renderReportPdf(report, {
                    marketplace: payload.marketplace,
                    currency: '$',
                    clientName: client.firstName || '',
                });
                attachments.push({ filename: reportPdfFilename(report, payload.marketplace), content });
                summaries.push({
                    name: report.name,
                    date: report.date,
                    insight: report.insight,
                    tone: report.tone,
                    marketplaceLabel: `Amazon ${marketplace.country}`,
                });
            } catch (error) {
                logger.error(`[EsfReportsMailer] PDF render failed for ${key} / ${client._id}: ${error.message}`);
            }
        }

        await sleep(200);
    }

    return { attachments, summaries };
};

/**
 * Run one cadence group for every ESF client.
 *
 * @param {'weekly'|'biweekly'|'monthly'|'quarterly'} cadence
 * @param {object} [options]
 * @param {boolean} [options.force=false] run bi-weekly even on an odd week
 * @param {string}  [options.onlyUserId]  restrict to one client, for testing
 */
const runEsfReportsCadence = async (cadence, options = {}) => {
    const group = CADENCE_GROUPS[cadence];
    if (!group) throw new Error(`Unknown cadence: ${cadence}`);

    if (cadence === 'biweekly' && !options.force && !isBiweeklyWeek()) {
        logger.info(`[EsfReportsMailer] Skipping bi-weekly run — ISO week ${isoWeek()} is an off week`);
        return { cadence, skipped: true, sent: 0, failed: 0, clients: 0 };
    }

    const startedAt = Date.now();
    let clients = await findEsfClients();
    if (options.onlyUserId) {
        clients = clients.filter((c) => String(c._id) === String(options.onlyUserId));
    }

    logger.info(`[EsfReportsMailer] ${group.label} run starting for ${clients.length} ESF clients`);

    const transport = createReportsTransport();
    let sent = 0;
    let failed = 0;
    let nothingToSend = 0;

    try {
        for (const client of clients) {
            if (!client.email) {
                logger.warn(`[EsfReportsMailer] ESF client ${client._id} has no email; skipped`);
                continue;
            }

            const { attachments, summaries } = await buildAttachmentsForClient(client, group);

            // No data behind any report in this group — send nothing rather than
            // an email that says "nothing to report".
            if (!attachments.length) {
                nothingToSend += 1;
                logger.info(`[EsfReportsMailer] ${group.label}: nothing available for ${client._id}`);
                continue;
            }

            const messageId = await sendEsfReportsEmail({
                email: client.email,
                firstName: client.firstName || 'there',
                userId: client._id,
                cadenceLabel: group.label,
                reports: summaries,
                attachments,
                transport,
            });

            if (messageId) sent += 1; else failed += 1;
        }
    } finally {
        // Pooled transports hold sockets open; the run must not leak them.
        transport.close();
    }

    const result = { cadence, clients: clients.length, sent, failed, nothingToSend, ms: Date.now() - startedAt };
    logger.info(`[EsfReportsMailer] ${group.label} run finished: ${JSON.stringify(result)}`);
    return result;
};

/** Entry point for the standalone worker and for manual triggers. */
const runAllDueCadences = async (cadences, options = {}) => {
    const results = [];
    for (const cadence of cadences) {
        results.push(await runEsfReportsCadence(cadence, options));
    }
    return results;
};

module.exports = {
    runEsfReportsCadence,
    runAllDueCadences,
    findEsfClients,
    CADENCE_GROUPS,
    // Exported so a run can be rehearsed — building every PDF and reporting what
    // would be attached — without putting anything on the wire.
    buildAttachmentsForClient,
    // exported for tests
    isoWeek,
    isBiweeklyWeek,
};
