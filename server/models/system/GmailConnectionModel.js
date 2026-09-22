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
