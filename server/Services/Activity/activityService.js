/**
 * Activity monitoring: record seller page visits, and read them back for the super admin and
 * the ESF portal.
 *
 *   recordPing   one call per page open and per heartbeat (every ~30 s while the seller is
 *                really there). Upserts the page visit; moves User.lastActiveAt for the
 *                account's own activity only (owner / member), at most once a minute.
 *   getOverview  who is active now, who was active recently — for a set of users.
 *   getTimeline  one user's visits, grouped by sitting, with time on each page.
 *
 * "Active now" means account activity within ACTIVE_WINDOW_MS. Heartbeats come every 30 s and
 * lastActiveAt is written at most every 60 s, so 2 minutes never flickers while someone is there.
 */
const mongoose = require('mongoose');
const User = require('../../models/user-auth/userModel.js');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const UserPageView = require('../../models/system/UserPageViewModel.js');
const { describePage, isSellerPage } = require('./pageLabels.js');
const { isAccountActivity, ACCOUNT_KINDS } = require('./actor.js');

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const LAST_ACTIVE_THROTTLE_MS = 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const isEnabled = () => String(process.env.ACTIVITY_TRACKING_ENABLED || '').toLowerCase() !== 'false';

const isActiveNow = (lastActiveAt, now = Date.now()) =>
    Boolean(lastActiveAt) && now - new Date(lastActiveAt).getTime() <= ACTIVE_WINDOW_MS;

const seconds = (from, to) => Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));

const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || null;

/* ---------------------------------------------------------------- write -- */

/**
 * @returns {Promise<{ recorded: boolean, reason?: string }>}
 */
const recordPing = async ({ userId, actor, visitId, activityId, path, now = new Date() }) => {
    if (!isEnabled()) return { recorded: false, reason: 'disabled' };
    if (!mongoose.Types.ObjectId.isValid(userId)) return { recorded: false, reason: 'user' };
    if (!ID_PATTERN.test(String(visitId || '')) || !ID_PATTERN.test(String(activityId || ''))) {
        return { recorded: false, reason: 'ids' };
    }
    if (!isSellerPage(path)) return { recorded: false, reason: 'page' };

    const page = describePage(path);
    await UserPageView.updateOne(
        { userId, visitId },
        {
            $setOnInsert: {
                activityId,
                path: page.path,
                pageKey: page.pageKey,
                label: page.label,
                startedAt: now,
                actor: { kind: actor.kind, id: actor.id || null },
            },
            $max: { lastSeenAt: now },
        },
        { upsert: true }
    );

    if (isAccountActivity(actor)) {
        await User.updateOne(
            {
                _id: userId,
                $or: [{ lastActiveAt: null }, { lastActiveAt: { $lt: new Date(now.getTime() - LAST_ACTIVE_THROTTLE_MS) } }],
            },
            { $set: { lastActiveAt: now, lastActivePath: page.path } }
        );
    }
    return { recorded: true };
};

/* ----------------------------------------------------------------- read -- */

/** Each user's most recent account visit (the page they are on, or were last on). */
const latestAccountVisits = async (userIds) => {
    if (!userIds.length) return new Map();
    const rows = await UserPageView.aggregate([
        { $match: { userId: { $in: userIds }, 'actor.kind': { $in: ACCOUNT_KINDS } } },
        { $sort: { lastSeenAt: -1 } },
        { $group: { _id: '$userId', label: { $first: '$label' }, path: { $first: '$path' }, startedAt: { $first: '$startedAt' }, lastSeenAt: { $first: '$lastSeenAt' } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r]));
};

/**
 * Who is active now and who was active recently, among the users matching `userMatch`.
 * @param {object} userMatch  Mongo filter the caller is allowed to see
 * @param {{ sinceMs?: number, search?: string, limit?: number, now?: Date }} options
 */
const getOverview = async (userMatch, { sinceMs = DAY_MS, search = '', limit = 200, now = new Date() } = {}) => {
    const match = { ...userMatch, lastActiveAt: { $gte: new Date(now.getTime() - sinceMs) } };
    const term = String(search || '').trim();
    if (term) {
        const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        match.$and = [...(match.$and || []), { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }];
    }

    const users = await User.find(match)
        .select('firstName lastName email lastActiveAt lastActivePath isEsfClient packageType')
        .sort({ lastActiveAt: -1 })
        .limit(Math.min(500, Math.max(1, limit)))
        .lean();

    const ids = users.map((u) => u._id);
    const [visits, sellers] = await Promise.all([
        latestAccountVisits(ids),
        ids.length ? Seller.find({ User: { $in: ids } }).select('User brand').lean() : [],
    ]);
    const brandOf = new Map(sellers.map((s) => [String(s.User), s.brand || null]));

    const rows = users.map((u) => {
        const visit = visits.get(String(u._id));
        const active = isActiveNow(u.lastActiveAt, now.getTime());
        return {
            userId: String(u._id),
            name: fullName(u),
            email: u.email,
            brand: brandOf.get(String(u._id)) || null,
            packageType: u.packageType || null,
            lastActiveAt: u.lastActiveAt,
            isActiveNow: active,
            currentPage: visit
                ? { label: visit.label, path: visit.path, since: visit.startedAt, seconds: seconds(visit.startedAt, visit.lastSeenAt) }
                : (u.lastActivePath ? { label: describePage(u.lastActivePath).label, path: u.lastActivePath } : null),
        };
    });

    return {
        now,
        activeWindowSeconds: ACTIVE_WINDOW_MS / 1000,
        activeNow: rows.filter((r) => r.isActiveNow),
        recent: rows.filter((r) => !r.isActiveNow),
    };
};

/** Display names for the people behind staff and member visits, in two queries. */
const actorNames = async (views) => {
    const staffIds = new Set();
    const memberIds = new Set();
    for (const v of views) {
        if (!v.actor?.id || !mongoose.Types.ObjectId.isValid(v.actor.id)) continue;
        if (v.actor.kind === 'member') memberIds.add(v.actor.id); else if (v.actor.kind !== 'owner') staffIds.add(v.actor.id);
    }
    const [staff, members] = await Promise.all([
        staffIds.size ? User.find({ _id: { $in: [...staffIds] } }).select('firstName lastName email').lean() : [],
        memberIds.size ? AccountMember.find({ _id: { $in: [...memberIds] } }).select('name email').lean() : [],
    ]);
    return new Map([
        ...staff.map((s) => [String(s._id), fullName(s)]),
        ...members.map((m) => [String(m._id), m.name || m.email]),
    ]);
};

/**
 * One user's visits over the last `days` days, newest first, grouped by sitting.
 * @returns {{ user, isActiveNow, totals: { last24hSeconds, last7dSeconds }, sittings: [...] }}
 */
const getTimeline = async (userId, { days = 7, now = new Date() } = {}) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const span = Math.min(90, Math.max(1, Number(days) || 7));
    const [user, views] = await Promise.all([
        User.findById(userId).select('firstName lastName email lastActiveAt lastActivePath').lean(),
        UserPageView.find({ userId, startedAt: { $gte: new Date(now.getTime() - span * DAY_MS) } })
            .sort({ startedAt: -1 })
            .limit(3000)
            .lean(),
    ]);
    if (!user) return null;

    const names = await actorNames(views);
    const sittings = [];
    const byActivity = new Map();
    for (const v of views) {
        const key = `${v.activityId}:${v.actor?.kind}`;
        let sitting = byActivity.get(key);
        if (!sitting) {
            sitting = {
                activityId: v.activityId,
                actor: { kind: v.actor?.kind || 'owner', name: v.actor?.id ? names.get(v.actor.id) || null : null },
                startedAt: v.startedAt,
                endedAt: v.lastSeenAt,
                seconds: 0,
                pages: [],
            };
            byActivity.set(key, sitting);
            sittings.push(sitting);
        }
        const secs = seconds(v.startedAt, v.lastSeenAt);
        sitting.pages.push({ label: v.label, path: v.path, startedAt: v.startedAt, seconds: secs });
        sitting.seconds += secs;
        if (v.startedAt < sitting.startedAt) sitting.startedAt = v.startedAt;
        if (v.lastSeenAt > sitting.endedAt) sitting.endedAt = v.lastSeenAt;
    }
    // Pages oldest-first inside a sitting reads as a path through the app.
    for (const s of sittings) s.pages.reverse();
    sittings.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    const accountSecondsSince = (ms) => views
        .filter((v) => ACCOUNT_KINDS.includes(v.actor?.kind) && new Date(v.startedAt).getTime() >= now.getTime() - ms)
        .reduce((sum, v) => sum + seconds(v.startedAt, v.lastSeenAt), 0);

    return {
        user: { userId: String(user._id), name: fullName(user), email: user.email, lastActiveAt: user.lastActiveAt },
        isActiveNow: isActiveNow(user.lastActiveAt, now.getTime()),
        days: span,
        totals: { last24hSeconds: accountSecondsSince(DAY_MS), last7dSeconds: accountSecondsSince(7 * DAY_MS) },
        sittings,
    };
};

module.exports = {
    recordPing,
    getOverview,
    getTimeline,
    isActiveNow,
    isEnabled,
    ACTIVE_WINDOW_MS,
    LAST_ACTIVE_THROTTLE_MS,
};
