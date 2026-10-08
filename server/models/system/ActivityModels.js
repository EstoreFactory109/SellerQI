const mongoose = require('mongoose');

/**
 * How sellers use the app, for the admin and ESF "User activity" pages.
 *
 * Only the account's own people are recorded: the owner, and members they
 * invited. A super admin, ESF staff or an agency opening the account is not the
 * user using the tool, so Services/Activity/activityTracker.js skips them.
 *
 * Two collections:
 *   ActivitySession - one visit (a new one starts after 30 idle minutes), with
 *                     running totals per page. Cheap to aggregate for the list.
 *   ActivityEvent   - each page view, action and login, for the timeline.
 *
 * Both delete themselves after RETENTION_DAYS (TTL indexes).
 */
const RETENTION_DAYS = 90;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;

const activitySessionSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        actor: { type: String, enum: ['owner', 'member'], default: 'owner' },
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountMember', default: null },
        startedAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
        // When active time was last credited; heartbeats closer together than the
        // interval (a second tab, a retry) add nothing, so time is never counted twice.
        lastHeartbeatAt: { type: Date, default: null },
        activeSeconds: { type: Number, default: 0 },
        pageViews: { type: Number, default: 0 },
        actions: { type: Number, default: 0 },
        // { [pageKey]: { views, seconds } }
        pages: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { minimize: false }
);
activitySessionSchema.index({ user: 1, lastSeenAt: -1 });
activitySessionSchema.index({ startedAt: -1 });
activitySessionSchema.index({ startedAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS, name: 'activity_session_ttl' });

const activityEventSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivitySession', default: null },
    actor: { type: String, enum: ['owner', 'member'], default: 'owner' },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountMember', default: null },
    type: { type: String, enum: ['page', 'action', 'login'], required: true },
    // Page key for 'page', a readable label for 'action', the method for 'login'.
    key: { type: String, required: true },
    at: { type: Date, required: true },
});
activityEventSchema.index({ user: 1, at: -1 });
activityEventSchema.index({ session: 1, at: 1 });
activityEventSchema.index({ at: 1 }, { expireAfterSeconds: RETENTION_SECONDS, name: 'activity_event_ttl' });

const ActivitySession = mongoose.models.ActivitySession || mongoose.model('ActivitySession', activitySessionSchema);
const ActivityEvent = mongoose.models.ActivityEvent || mongoose.model('ActivityEvent', activityEventSchema);

module.exports = { ActivitySession, ActivityEvent, RETENTION_DAYS };
