/**
 * One seller page visit, for activity monitoring (super admin and ESF portal).
 *
 * Created when a page is opened and kept alive by the browser's heartbeat while the seller is
 * actually there (tab visible, recent input): time on page = lastSeenAt − startedAt. Visits made
 * by staff opening the account (super admin, ESF staff, agency owner) are kept too, labelled by
 * `actor`, but never count as the seller being active.
 *
 * Auto-deleted after the "pageViews" retention window (config/logRetention.js, 90 days).
 */
const mongoose = require('mongoose');
const { LOG_RETENTION, expireAfterSeconds } = require('../../config/logRetention.js');

const userPageViewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    visitId: { type: String, required: true },     // one page visit (browser-generated)
    activityId: { type: String, required: true },  // groups visits made in one sitting
    path: { type: String, required: true },
    pageKey: { type: String, default: null },
    label: { type: String, default: null },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    actor: {
        kind: { type: String, enum: ['owner', 'member', 'super_admin', 'esf_staff', 'agency'], required: true },
        id: { type: String, default: null },
    },
}, { versionKey: false });

userPageViewSchema.index({ userId: 1, visitId: 1 }, { unique: true });
userPageViewSchema.index({ userId: 1, startedAt: -1 });
userPageViewSchema.index(
    { [LOG_RETENTION.pageViews.dateField]: 1 },
    { expireAfterSeconds: expireAfterSeconds('pageViews'), name: LOG_RETENTION.pageViews.indexName }
);

module.exports = mongoose.models.UserPageView || mongoose.model('UserPageView', userPageViewSchema);
