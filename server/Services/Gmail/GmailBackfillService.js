/**
 * GmailBackfillService.js — recovery when the history cursor is no longer usable.
 *
 * Gmail keeps roughly a week of history. Past that, `history.list` answers 404 for our
 * stored cursor and keeps answering 404 forever: the integration stops delivering mail
 * and, because no request is failing from the outside, nothing looks broken. The staff
 * inbox simply goes quiet, which is indistinguishable from a quiet week.
 *
 * Backfill walks recent messages by DATE instead of by history, ingests what is missing,
 * and re-baselines the cursor at the mailbox's current historyId.
 *
 * ── WHY THIS IS NOT AUTOMATIC ──
 * It is deliberately a separate, explicitly-invoked operation rather than something
 * runSync falls into. The window is a guess, so the only safe wide guess is a large one,
 * and a large one means re-ingesting hundreds of messages — each an AI redaction call,
 * each potentially resurfacing conversations the client considers closed. That is a
 * decision for a person, and the /status endpoint is what tells them it is needed.
 */

const logger = require('../../utils/Logger.js');
const GmailConnection = require('../../models/system/GmailConnectionModel.js');
const GmailClient = require('./GmailClient.js');
const { ingestMessage } = require('./GmailIngestService.js');

const SINGLETON_KEY = GmailConnection.SINGLETON_KEY;

/** Hard ceiling regardless of the window asked for. */
const MAX_MESSAGES = 500;
const PAGE_SIZE = 100;

/**
 * Ingest recent mail and re-baseline the cursor.
 *
 * @param {object} [options]
 * @param {number} [options.days=7]  how far back to walk
 * @param {number} [options.limit]   cap on messages, below MAX_MESSAGES
 * @returns {object} summary
 */
const runBackfill = async ({ days = 7, limit = MAX_MESSAGES } = {}) => {
    const connection = await GmailConnection.findOne({ key: SINGLETON_KEY }).lean();
    if (!connection) return { skipped: 'not-connected' };

    const cap = Math.min(limit, MAX_MESSAGES);
    const summary = { days, seen: 0, ingested: 0, duplicate: 0, skipped: 0, unmatched: 0, failed: 0 };

    /**
     * Read the profile BEFORE ingesting, not after.
     *
     * This historyId becomes the new cursor. Taken afterwards, it would sit past
     * anything that arrived while the backfill ran, and those messages would never be
     * seen by any later run — re-creating, in the recovery path, exactly the gap the
     * recovery exists to close.
     */
    const profile = await GmailClient.getProfile();
    const baseline = profile?.historyId ? String(profile.historyId) : null;

    let pageToken;
    do {
        // eslint-disable-next-line no-await-in-loop
        const page = await GmailClient.listMessages({
            // Both directions: an admin reply sent from Gmail is as much a part of the
            // record as the client's message, and `in:anywhere` is what reaches SENT.
            q: `newer_than:${days}d in:anywhere`,
            maxResults: Math.min(PAGE_SIZE, cap - summary.seen),
            pageToken,
        });

        const ids = (page.messages || []).map((message) => message.id).filter(Boolean);

        // Sequential: each ingest may call the AI, and a burst of parallel redactions is
        // how the OpenAI rate limit gets tripped.
        for (const id of ids) {
            if (summary.seen >= cap) break;
            summary.seen += 1;
            try {
                // eslint-disable-next-line no-await-in-loop
                const result = await ingestMessage(id);
                summary[result.status === 'ingested' ? 'ingested' : result.status] += 1;
            } catch (error) {
                summary.failed += 1;
                logger.error(`[GmailBackfill] message ${id} failed: ${error.message}`);
            }
        }

        pageToken = page.nextPageToken;
    } while (pageToken && summary.seen < cap);

    if (baseline) {
        await GmailConnection.updateOne({ key: SINGLETON_KEY }, {
            $set: {
                historyId: baseline,
                lastSyncAt: new Date(),
                lastError: null,
                lastErrorAt: null,
                // The old backlog refers to a window that no longer exists; anything
                // still missing from it has just been re-walked by date.
                pendingMessageIds: [],
            },
        });
    }

    logger.info(`[GmailBackfill] ${JSON.stringify(summary)}`);
    return summary;
};

module.exports = { runBackfill, MAX_MESSAGES };
