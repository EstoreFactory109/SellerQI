/**
 * Reads for the "User activity" pages (super admin: every seller; ESF portal:
 * ESF clients only). The caller passes `userMatch`, a filter on the User document,
 * which is what scopes each page to its own users.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const { ActivitySession, ActivityEvent, RETENTION_DAYS } = require('../../models/system/ActivityModels.js');
const { ESF_CLIENT_PAGES } = require('../User/esfPages.js');

const DAY_MS = 24 * 60 * 60 * 1000;

const EXTRA_PAGE_LABELS = {
    'product-details': 'Product details',
    'notification-details': 'Notification details',
    notifications: 'Notifications',
    consultation: 'Consultation',
    'analyse-account': 'Analysing account',
    'connect-to-amazon': 'Connect to Amazon',
    'connect-accounts': 'Connect accounts',
    'profile-selection': 'Profile selection',
    'issues-by-product': 'Issues by product',
};
const SETTINGS_TABS = {
    profile: 'User profile',
    members: 'Add member',
    teams: 'Add member',
    'account-integration': 'Account integration',
    'plans-billing': 'Plans & billing',
    support: 'Support',
};
const CATALOGUE_LABELS = Object.fromEntries(ESF_CLIENT_PAGES.map((page) => [page.key, page.label]));

/** "settings:members" -> "Settings · Add member", "dashboard" -> "Dashboard". */
const pageLabel = (key) => {
    if (!key) return 'Unknown';
    const [base, tab] = key.split(':');
    if (base === 'settings') return tab ? `Settings · ${SETTINGS_TABS[tab] || tab}` : 'Settings';
    return CATALOGUE_LABELS[base] || EXTRA_PAGE_LABELS[base] || base.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};

/** Window start for `days` (1..RETENTION_DAYS), counted back from now. */
const windowStart = (days) => {
    const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), RETENTION_DAYS);
    return { span, since: new Date(Date.now() - span * DAY_MS) };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Top page (by views) for each of these users within the window. */
const topPagesFor = async (userIds, since) => {
    if (!userIds.length) return new Map();
    const rows = await ActivitySession.aggregate([
        { $match: { user: { $in: userIds }, startedAt: { $gte: since } } },
        { $project: { user: 1, pages: { $objectToArray: { $ifNull: ['$pages', {}] } } } },
        { $unwind: '$pages' },
        { $group: { _id: { user: '$user', key: '$pages.k' }, views: { $sum: { $ifNull: ['$pages.v.views', 0] } } } },
        { $sort: { views: -1 } },
        { $group: { _id: '$_id.user', key: { $first: '$_id.key' }, views: { $first: '$views' } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), { key: row.key, label: pageLabel(row.key), views: row.views }]));
};

/**
 * Users with activity in the window, most recently active first.
 * @param {object} opts
 * @param {object} opts.userMatch  filter on User fields (e.g. { accessType: 'user' })
 */
const listActivity = async ({ userMatch, days, search, page = 1, limit = 20 }) => {
    const { span, since } = windowStart(days);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const userFilter = Object.fromEntries(Object.entries(userMatch).map(([field, value]) => [`u.${field}`, value]));
    if (search && search.trim()) {
        const re = new RegExp(escapeRegex(search.trim()), 'i');
        userFilter.$or = [{ 'u.firstName': re }, { 'u.lastName': re }, { 'u.email': re }];
    }

    const [result] = await ActivitySession.aggregate([
        { $match: { startedAt: { $gte: since } } },
        {
            $group: {
                _id: '$user',
                sessions: { $sum: 1 },
                memberSessions: { $sum: { $cond: [{ $eq: ['$actor', 'member'] }, 1, 0] } },
                activeSeconds: { $sum: '$activeSeconds' },
                pageViews: { $sum: '$pageViews' },
                actions: { $sum: '$actions' },
                lastSeenAt: { $max: '$lastSeenAt' },
                activeDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } } },
            },
        },
        {
            $lookup: {
                from: 'users',
                let: { uid: '$_id' },
                as: 'u',
                pipeline: [
                    { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
                    { $project: { firstName: 1, lastName: 1, email: 1, accessType: 1, packageType: 1, isEsfClient: 1, isAgencyClient: 1 } },
                ],
            },
        },
        { $unwind: '$u' },
        { $match: userFilter },
        { $sort: { lastSeenAt: -1 } },
        {
            $facet: {
                rows: [{ $skip: (pageNum - 1) * pageSize }, { $limit: pageSize }],
                total: [{ $count: 'count' }],
                totals: [{
                    $group: {
                        _id: null,
                        activeUsers: { $sum: 1 },
                        sessions: { $sum: '$sessions' },
                        activeSeconds: { $sum: '$activeSeconds' },
                        pageViews: { $sum: '$pageViews' },
                        actions: { $sum: '$actions' },
                    },
                }],
            },
        },
    ]);

    const rows = result?.rows || [];
    const topPages = await topPagesFor(rows.map((row) => row._id), since);
    const total = result?.total?.[0]?.count || 0;

    return {
        days: span,
        totals: result?.totals?.[0] ? { ...result.totals[0], _id: undefined } : { activeUsers: 0, sessions: 0, activeSeconds: 0, pageViews: 0, actions: 0 },
        users: rows.map((row) => ({
            userId: row._id,
            name: `${row.u.firstName || ''} ${row.u.lastName || ''}`.trim() || row.u.email,
            email: row.u.email,
            packageType: row.u.packageType,
            sessions: row.sessions,
            memberSessions: row.memberSessions,
            activeSeconds: row.activeSeconds,
            pageViews: row.pageViews,
            actions: row.actions,
            activeDays: row.activeDays.length,
            lastSeenAt: row.lastSeenAt,
            topPage: topPages.get(String(row._id)) || null,
        })),
        pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
};

/**
 * Everything about one user's use of the app in the window.
 * Returns null when the user does not exist or is outside `userMatch`.
 */
const userActivity = async ({ userId, userMatch, days, timezone = 'UTC' }) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    const user = await UserModel.findOne({ _id: userId, ...userMatch }).select('firstName lastName email packageType createdAt').lean();
    if (!user) return null;

    const { span, since } = windowStart(days);
    const uid = new mongoose.Types.ObjectId(userId);
    let tz = 'UTC';
    try {
        Intl.DateTimeFormat('en-US', { timeZone: timezone });
        tz = timezone;
    } catch (_) { /* unknown zone - stay on UTC */ }

    const [totalsRows, dailyRows, pageRows, actionRows, logins, recentSessions, members] = await Promise.all([
        ActivitySession.aggregate([
            { $match: { user: uid, startedAt: { $gte: since } } },
            {
                $group: {
                    _id: null,
                    sessions: { $sum: 1 },
                    activeSeconds: { $sum: '$activeSeconds' },
                    pageViews: { $sum: '$pageViews' },
                    actions: { $sum: '$actions' },
                    lastSeenAt: { $max: '$lastSeenAt' },
                    firstSeenAt: { $min: '$startedAt' },
                    memberSessions: { $sum: { $cond: [{ $eq: ['$actor', 'member'] }, 1, 0] } },
                },
            },
        ]),
        ActivitySession.aggregate([
            { $match: { user: uid, startedAt: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: tz } },
                    sessions: { $sum: 1 },
                    activeSeconds: { $sum: '$activeSeconds' },
                    pageViews: { $sum: '$pageViews' },
                    actions: { $sum: '$actions' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        ActivitySession.aggregate([
            { $match: { user: uid, startedAt: { $gte: since } } },
            { $project: { pages: { $objectToArray: { $ifNull: ['$pages', {}] } } } },
            { $unwind: '$pages' },
            {
                $group: {
                    _id: '$pages.k',
                    views: { $sum: { $ifNull: ['$pages.v.views', 0] } },
                    seconds: { $sum: { $ifNull: ['$pages.v.seconds', 0] } },
                },
            },
            { $sort: { views: -1, seconds: -1 } },
        ]),
        ActivityEvent.aggregate([
            { $match: { user: uid, type: 'action', at: { $gte: since } } },
            { $group: { _id: '$key', count: { $sum: 1 }, lastAt: { $max: '$at' } } },
            { $sort: { count: -1 } },
            { $limit: 50 },
        ]),
        ActivityEvent.countDocuments({ user: uid, type: 'login', at: { $gte: since } }),
        ActivitySession.find({ user: uid, startedAt: { $gte: since } })
            .sort({ startedAt: -1 })
            .limit(20)
            .select('actor member startedAt lastSeenAt activeSeconds pageViews actions')
            .lean(),
        AccountMember.find({ owner: uid }).select('email name').lean(),
    ]);

    // The pages visited in each recent session, in order.
    const sessionIds = recentSessions.map((session) => session._id);
    const trail = sessionIds.length
        ? await ActivityEvent.find({ session: { $in: sessionIds }, type: { $in: ['page', 'action'] } })
            .sort({ at: 1 })
            .select('session type key at')
            .lean()
        : [];
    const trailBySession = new Map();
    trail.forEach((event) => {
        const list = trailBySession.get(String(event.session)) || [];
        if (list.length < 40) list.push({ type: event.type, label: event.type === 'page' ? pageLabel(event.key) : event.key, at: event.at });
        trailBySession.set(String(event.session), list);
    });
    const memberById = new Map(members.map((member) => [String(member._id), member.name || member.email]));

    const totals = totalsRows[0] || { sessions: 0, activeSeconds: 0, pageViews: 0, actions: 0, lastSeenAt: null, firstSeenAt: null, memberSessions: 0 };
    delete totals._id;

    return {
        days: span,
        timezone: tz,
        user: {
            userId: user._id,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
            email: user.email,
            packageType: user.packageType,
            joinedAt: user.createdAt,
        },
        totals: { ...totals, logins, activeDays: dailyRows.length },
        daily: dailyRows.map((row) => ({ day: row._id, sessions: row.sessions, activeSeconds: row.activeSeconds, pageViews: row.pageViews, actions: row.actions })),
        pages: pageRows.map((row) => ({ key: row._id, label: pageLabel(row._id), views: row.views, seconds: row.seconds })),
        actions: actionRows.map((row) => ({ label: row._id, count: row.count, lastAt: row.lastAt })),
        sessions: recentSessions.map((session) => ({
            id: session._id,
            by: session.actor === 'member' ? `Member · ${memberById.get(String(session.member)) || 'removed member'}` : 'Owner',
            startedAt: session.startedAt,
            lastSeenAt: session.lastSeenAt,
            activeSeconds: session.activeSeconds,
            pageViews: session.pageViews,
            actions: session.actions,
            trail: trailBySession.get(String(session._id)) || [],
        })),
    };
};

module.exports = { listActivity, userActivity, pageLabel };
