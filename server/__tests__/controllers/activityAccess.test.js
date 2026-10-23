/**
 * Who can see seller activity.
 *   ESF portal: owner and admins only, and only ESF clients (others are a 404).
 *   Super admin: every customer account.
 */

jest.mock('../../Services/Activity/activityService.js', () => ({
  getOverview: jest.fn(async () => ({ activeNow: [], recent: [] })),
  getTimeline: jest.fn(async () => ({ sittings: [] })),
  isActiveNow: jest.fn(() => false),
  recordPing: jest.fn(),
  isEnabled: jest.fn(() => true),
}));
jest.mock('../../models/user-auth/userModel.js', () => ({ exists: jest.fn(), findById: jest.fn() }));
jest.mock('../../controllers/admin/admin.js', () => ({ requireSuperAdmin: jest.fn() }));

const UserModel = require('../../models/user-auth/userModel.js');
const { getOverview, getTimeline } = require('../../Services/Activity/activityService.js');
const { requireSuperAdmin } = require('../../controllers/admin/admin.js');
const { getClientActivityOverview, getClientActivity } = require('../../controllers/esf/esfActivity.js');
const { getActivityOverview, getUserActivity } = require('../../controllers/admin/AdminActivityController.js');

const CLIENT = '64b000000000000000000001';

const run = (handler, req) => new Promise((resolve, reject) => {
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; resolve(this); return this; },
  };
  handler({ query: {}, params: {}, ...req }, res, reject);
});

const owner = { _id: 'o1', accessType: 'esfUser', esfRole: 'owner' };
const admin = { _id: 'a1', accessType: 'esfUser', esfRole: 'admin' };
const member = { _id: 'm1', accessType: 'esfUser', esfRole: 'member', esfAllowedClients: [CLIENT] };

describe('ESF portal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('members are refused', async () => {
    expect((await run(getClientActivityOverview, { esfUser: member })).statusCode).toBe(403);
    expect((await run(getClientActivity, { esfUser: member, params: { clientId: CLIENT } })).statusCode).toBe(403);
    expect(getOverview).not.toHaveBeenCalled();
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('owner and admins see ESF clients only', async () => {
    for (const esfUser of [owner, admin]) {
      const res = await run(getClientActivityOverview, { esfUser, query: { since: '7d' } });
      expect(res.statusCode).toBe(200);
    }
    expect(getOverview.mock.calls[0][0]).toEqual({ isEsfClient: true });
    expect(getOverview.mock.calls[0][1].sinceMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('a client outside the portal is a 404, not someone else\'s activity', async () => {
    UserModel.exists.mockResolvedValue(null);
    const res = await run(getClientActivity, { esfUser: owner, params: { clientId: CLIENT } });
    expect(res.statusCode).toBe(404);
    expect(UserModel.exists.mock.calls[0][0]).toMatchObject({ _id: CLIENT, isEsfClient: true });
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('an ESF client\'s timeline for the owner', async () => {
    UserModel.exists.mockResolvedValue({ _id: CLIENT });
    const res = await run(getClientActivity, { esfUser: owner, params: { clientId: CLIENT }, query: { days: '30' } });
    expect(res.statusCode).toBe(200);
    expect(getTimeline).toHaveBeenCalledWith(CLIENT, { days: '30' });
  });
});

describe('super admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is checked before anything is read', async () => {
    requireSuperAdmin.mockImplementation(async (req, res) => { res.status(403).json({}); return false; });
    expect((await run(getActivityOverview, {})).statusCode).toBe(403);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('sees every customer account, never staff', async () => {
    requireSuperAdmin.mockResolvedValue(true);
    const res = await run(getActivityOverview, { query: { search: 'acme' } });
    expect(res.statusCode).toBe(200);
    expect(getOverview.mock.calls[0][0]).toEqual({ accessType: { $nin: ['superAdmin', 'esfUser'] } });
    expect(getOverview.mock.calls[0][1].search).toBe('acme');
  });

  it('a missing user is a 404', async () => {
    requireSuperAdmin.mockResolvedValue(true);
    getTimeline.mockResolvedValueOnce(null);
    expect((await run(getUserActivity, { params: { userId: CLIENT } })).statusCode).toBe(404);
  });
});
