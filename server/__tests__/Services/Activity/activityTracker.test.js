/**
 * The User activity pages must be accurate: only the seller's own use is counted,
 * and active time is never counted twice (two tabs, retries) or inflated.
 */
let tracker;
let ActivitySession;
let ActivityEvent;

const USER = '64b000000000000000000001';

const sessionDoc = (overrides = {}) => ({
  _id: 'sess-1',
  startedAt: new Date(Date.now() - 10 * 60 * 1000),
  lastHeartbeatAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../models/system/ActivityModels.js', () => ({
    ActivitySession: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) },
    ActivityEvent: { create: jest.fn().mockResolvedValue({}) },
  }));
  ({ ActivitySession, ActivityEvent } = require('../../../models/system/ActivityModels.js'));
  tracker = require('../../../Services/Activity/activityTracker.js');
});

const openSession = (doc) => ActivitySession.findOne.mockReturnValue({ sort: () => Promise.resolve(doc) });
const owner = (extra = {}) => ({ userId: USER, cookies: {}, ...extra });

describe('actorFor — whose use counts', () => {
  it('counts the owner', () => {
    expect(tracker.actorFor(owner())).toEqual({ actor: 'owner', member: null });
  });

  it('counts a member, as a member', () => {
    expect(tracker.actorFor(owner({ memberId: 'm1' }))).toEqual({ actor: 'member', member: 'm1' });
  });

  it('ignores a super admin, an agency or ESF staff acting for the user', () => {
    expect(tracker.actorFor(owner({ isSuperAdminSession: true }))).toBeNull();
    expect(tracker.actorFor(owner({ adminId: 'agency-1' }))).toBeNull();
    expect(tracker.actorFor(owner({ cookies: { ESFToken: 'x' } }))).toBeNull();
  });
});

describe('recordHeartbeat — active time', () => {
  it('credits the claimed seconds when that much time really passed', async () => {
    openSession(sessionDoc({ lastHeartbeatAt: new Date(Date.now() - 31 * 1000) }));
    await tracker.recordHeartbeat(owner(), 'dashboard', 30);
    const update = ActivitySession.updateOne.mock.calls[0][1];
    expect(update.$inc).toEqual({ activeSeconds: 30, 'pages.dashboard.seconds': 30 });
  });

  it('credits nothing for a second tab beating within the interval', async () => {
    openSession(sessionDoc({ lastHeartbeatAt: new Date(Date.now() - 5 * 1000) }));
    await tracker.recordHeartbeat(owner(), 'dashboard', 30);
    const update = ActivitySession.updateOne.mock.calls[0][1];
    expect(update.$inc).toBeUndefined();
  });

  it('never credits more than really passed, nor more than a minute', async () => {
    openSession(sessionDoc({ lastHeartbeatAt: new Date(Date.now() - 25 * 1000) }));
    await tracker.recordHeartbeat(owner(), 'dashboard', 600);
    const credited = ActivitySession.updateOne.mock.calls[0][1].$inc.activeSeconds;
    expect(credited).toBeLessThanOrEqual(26);
    expect(credited).toBeGreaterThanOrEqual(24);
  });

  it('records nothing for a malformed page key', async () => {
    expect(await tracker.recordHeartbeat(owner(), '$where', 30)).toBe(false);
    expect(ActivitySession.updateOne).not.toHaveBeenCalled();
  });
});

describe('sessions', () => {
  it('starts a new session when none was active in the last 30 minutes', async () => {
    openSession(null);
    ActivitySession.create.mockResolvedValue(sessionDoc());
    await tracker.recordPageView(owner(), 'tasks');
    expect(ActivitySession.create).toHaveBeenCalledWith(expect.objectContaining({ user: USER, actor: 'owner' }));
    expect(ActivityEvent.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'page', key: 'tasks' }));
  });

  it('records nothing at all for an admin acting for the user', async () => {
    await tracker.recordPageView(owner({ isSuperAdminSession: true }), 'tasks');
    expect(ActivitySession.findOne).not.toHaveBeenCalled();
    expect(ActivityEvent.create).not.toHaveBeenCalled();
  });
});

describe('action labels', () => {
  const { labelFor } = require('../../../middlewares/activityActionTracker.js');

  it('reads as what the user did, without ids', () => {
    expect(labelFor('POST', '/api/pagewise/tasks/64f0c0ffee0000000000abcd/complete')).toBe('Create · tasks · complete');
    expect(labelFor('DELETE', '/app/members/64f0c0ffee0000000000abcd')).toBe('Delete · members');
    expect(labelFor('GET', '/api/pagewise/your-products/export?x=1')).toBe('Download · your products · export');
    expect(labelFor('POST', '/api/qmate/chat')).toBe('Ask · qmate · chat');
  });
});
