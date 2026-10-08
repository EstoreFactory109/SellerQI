/**
 * Recording how sellers use the app (see models/system/ActivityModels.js).
 *
 * Accuracy rules, all decided here on the server rather than trusted from the page:
 *   - Who: the account comes from the session cookie (req.userId), never the body.
 *     Someone opening the account on the user's behalf - a super admin, ESF staff,
 *     an agency - is not the user, so nothing is recorded for them.
 *   - Visits: a new session starts after SESSION_GAP_MS without activity.
 *   - Time: credited per heartbeat, capped by the real time since the last credited
 *     heartbeat, so two open tabs or a retried request cannot count time twice.
 */
const { ActivitySession, ActivityEvent } = require('../../models/system/ActivityModels.js');
const logger = require('../../utils/Logger.js');

const SESSION_GAP_MS = 30 * 60 * 1000;
// The page sends a heartbeat every 30s while it is in use; anything much closer
// together is a duplicate (another tab), anything longer is capped at this.
const MIN_HEARTBEAT_GAP_MS = 20 * 1000;
const MAX_HEARTBEAT_SECONDS = 60;

const KEY_PATTERN = /^[a-z0-9][a-z0-9:-]{0,59}$/;
/** Page keys come from the client: accept only the shape the tracker produces. */
const cleanKey = (key) => (typeof key === 'string' && KEY_PATTERN.test(key) ? key : null);

/**
 * Who is using the account, or null when it is someone acting for them.
 * Must run after `auth` (it sets req.userId / req.isSuperAdminSession / req.adminId
 * / req.memberId).
 */
const actorFor = (req) => {
    if (!req.userId) return null;
    if (req.isSuperAdminSession) return null; // super admin impersonating
    if (req.adminId) return null; // agency owner viewing a client (or a super admin's ordinary login)
    if (req.cookies?.ESFToken) return null; // ESF staff inside a client
    return req.memberId
        ? { actor: 'member', member: req.memberId }
        : { actor: 'owner', member: null };
};

/** The current visit for this user/actor, starting a new one after a 30-minute gap. */
const currentSession = async (userId, who, now) => {
    const open = await ActivitySession.findOne({
        user: userId,
        actor: who.actor,
        member: who.member,
        lastSeenAt: { $gte: new Date(now.getTime() - SESSION_GAP_MS) },
    }).sort({ lastSeenAt: -1 });
    if (open) return open;
    return ActivitySession.create({ user: userId, actor: who.actor, member: who.member, startedAt: now, lastSeenAt: now });
};

const recordPageView = async (req, pageKey) => {
    const who = actorFor(req);
    const key = cleanKey(pageKey);
    if (!who || !key) return false;
    const now = new Date();
    const session = await currentSession(req.userId, who, now);
    await Promise.all([
        ActivitySession.updateOne(
            { _id: session._id },
            { $set: { lastSeenAt: now }, $inc: { pageViews: 1, [`pages.${key}.views`]: 1 } }
        ),
        ActivityEvent.create({ user: req.userId, session: session._id, ...who, type: 'page', key, at: now }),
    ]);
    return true;
};

const recordHeartbeat = async (req, pageKey, seconds) => {
    const who = actorFor(req);
    const key = cleanKey(pageKey);
    if (!who || !key) return false;
    const now = new Date();
    const session = await currentSession(req.userId, who, now);

    const since = session.lastHeartbeatAt || session.startedAt;
    const gapMs = now.getTime() - since.getTime();
    // A second tab or a retry inside the interval: the time is already counted.
    if (session.lastHeartbeatAt && gapMs < MIN_HEARTBEAT_GAP_MS) {
        await ActivitySession.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
        return true;
    }
    const claimed = Math.max(0, Math.min(Number(seconds) || 0, MAX_HEARTBEAT_SECONDS));
    const credit = Math.round(Math.min(claimed, gapMs / 1000));

    await ActivitySession.updateOne(
        { _id: session._id },
        {
            $set: { lastSeenAt: now, lastHeartbeatAt: now },
            $inc: { activeSeconds: credit, [`pages.${key}.seconds`]: credit },
        }
    );
    return true;
};

const recordAction = async (req, label) => {
    const who = actorFor(req);
    if (!who || !label) return;
    const now = new Date();
    const session = await currentSession(req.userId, who, now);
    await Promise.all([
        ActivitySession.updateOne({ _id: session._id }, { $set: { lastSeenAt: now }, $inc: { actions: 1 } }),
        ActivityEvent.create({ user: req.userId, session: session._id, ...who, type: 'action', key: label.slice(0, 120), at: now }),
    ]);
};

/**
 * A sign-in, recorded by the login endpoints themselves (there is no session yet,
 * and the person signing in is the user - staff never sign in through these).
 */
const recordLogin = async (userId, { memberId = null, method = 'password' } = {}) => {
    try {
        await ActivityEvent.create({
            user: userId,
            actor: memberId ? 'member' : 'owner',
            member: memberId,
            type: 'login',
            key: method,
            at: new Date(),
        });
    } catch (error) {
        // Never let tracking break a sign-in.
        logger.error(`Failed to record login for ${userId}: ${error.message}`);
    }
};

module.exports = { actorFor, recordPageView, recordHeartbeat, recordAction, recordLogin, cleanKey, SESSION_GAP_MS };
