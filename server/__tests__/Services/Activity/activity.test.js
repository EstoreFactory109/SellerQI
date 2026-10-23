/**
 * Activity monitoring: what is recorded, and whose activity counts.
 *
 * The rule that matters most: staff opening a seller's account (super admin, ESF staff, agency
 * owner) are recorded but never make the seller "active". Members of the seller's own account
 * do count. Background calls are not counted at all — only explicit pings reach this code.
 */

jest.mock('../../../models/user-auth/userModel.js', () => ({ updateOne: jest.fn(), findById: jest.fn(), find: jest.fn() }));
jest.mock('../../../models/user-auth/AccountMemberModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/system/UserPageViewModel.js', () => ({ updateOne: jest.fn(), find: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../utils/Tokens.js', () => ({ verifyAccessToken: jest.fn() }));

const User = require('../../../models/user-auth/userModel.js');
const UserPageView = require('../../../models/system/UserPageViewModel.js');
const AccountMember = require('../../../models/user-auth/AccountMemberModel.js');
const { verifyAccessToken } = require('../../../utils/Tokens.js');
const { describePage, isSellerPage } = require('../../../Services/Activity/pageLabels.js');
const { classifyActor, isAccountActivity } = require('../../../Services/Activity/actor.js');
const activity = require('../../../Services/Activity/activityService.js');
const { LOG_RETENTION } = require('../../../config/logRetention.js');

const USER = '64b000000000000000000001';
const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

describe('page names', () => {
  it('names seller pages from the in-account catalogue and the extras', () => {
    expect(describePage('/seller-central-checker/dashboard').label).toBe('Dashboard');
    expect(describePage('/seller-central-checker/ppc-dashboard?x=1').label).toBe('Campaign Audit');
    expect(describePage('/seller-central-checker/issues-by-product/').label).toBe('Issues by Product');
    expect(describePage('/seller-central-checker/estore-factory/report-history/buybox').label).toBe('Report History');
    expect(describePage('/seller-central-checker/your-products/B0ABC').label).toBe('Product Details');
    expect(describePage('/connect-marketplaces').label).toBe('Your Marketplaces');
  });

  it('records seller pages only', () => {
    expect(isSellerPage('/seller-central-checker/tasks')).toBe(true);
    expect(isSellerPage('/analyse-account')).toBe(true);
    expect(isSellerPage('/esf/clients')).toBe(false);
    expect(isSellerPage('/manage-accounts')).toBe(false);
    expect(isSellerPage('/pricing')).toBe(false);
  });

  it('keeps unknown pages readable and paths bounded', () => {
    expect(describePage('/seller-central-checker/brand-new-page').label).toBe('brand-new-page');
    expect(describePage(`/seller-central-checker/${'x'.repeat(500)}`).path.length).toBe(200);
  });
});

describe('who is driving', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockReturnValue(lean(null));
    verifyAccessToken.mockResolvedValue(false);
  });

  it('the seller themself', async () => {
    expect(await classifyActor({ userId: USER, cookies: {} })).toEqual({ kind: 'owner', id: null });
  });

  it('a member of the account counts as account activity', async () => {
    const actor = await classifyActor({ userId: USER, memberId: 'm1', cookies: {} });
    expect(actor).toEqual({ kind: 'member', id: 'm1' });
    expect(isAccountActivity(actor)).toBe(true);
  });

  it('super admin via the admin portal', async () => {
    const actor = await classifyActor({ userId: USER, isSuperAdminSession: true, superAdminId: 'sa1', cookies: {} });
    expect(actor).toEqual({ kind: 'super_admin', id: 'sa1' });
    expect(isAccountActivity(actor)).toBe(false);
  });

  it('super admin through the seller login page (AdminToken)', async () => {
    User.findById.mockReturnValue(lean({ accessType: 'superAdmin' }));
    expect(await classifyActor({ userId: USER, adminId: 'sa2', cookies: {} })).toEqual({ kind: 'super_admin', id: 'sa2' });
  });

  it('ESF staff logged in as the client', async () => {
    verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'staff1' });
    const actor = await classifyActor({ userId: USER, cookies: { ESFToken: 't' } });
    expect(actor).toEqual({ kind: 'esf_staff', id: 'staff1' });
    expect(isAccountActivity(actor)).toBe(false);
  });

  it('an expired ESF cookie does not make the seller staff', async () => {
    verifyAccessToken.mockResolvedValue(false);
    expect((await classifyActor({ userId: USER, cookies: { ESFToken: 'old' } })).kind).toBe('owner');
  });

  it('agency owner on a client', async () => {
    User.findById.mockReturnValue(lean({ accessType: 'enterpriseAdmin' }));
    expect(await classifyActor({ userId: USER, adminId: 'ag1', cookies: {} })).toEqual({ kind: 'agency', id: 'ag1' });
  });
});

describe('recordPing', () => {
  const ping = (actor, extra = {}) => activity.recordPing({
    userId: USER, actor, visitId: 'visit-0001', activityId: 'act-0001', path: '/seller-central-checker/tasks', now: new Date('2026-10-23T10:00:00Z'), ...extra,
  });
  const env = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    UserPageView.updateOne.mockResolvedValue({});
    User.updateOne.mockResolvedValue({});
  });

  it('upserts the page visit; a heartbeat only moves lastSeenAt forward', async () => {
    await ping({ kind: 'owner' });
    const [filter, update, options] = UserPageView.updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: USER, visitId: 'visit-0001' });
    expect(update.$setOnInsert).toMatchObject({ activityId: 'act-0001', label: 'Tasks', pageKey: 'tasks', actor: { kind: 'owner', id: null } });
    expect(update.$max).toEqual({ lastSeenAt: new Date('2026-10-23T10:00:00Z') });
    expect(options).toEqual({ upsert: true });
  });

  it('moves last active for the seller, at most once a minute', async () => {
    await ping({ kind: 'owner' });
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter.$or[1]).toEqual({ lastActiveAt: { $lt: new Date('2026-10-23T09:59:00Z') } });
    expect(update.$set).toEqual({ lastActiveAt: new Date('2026-10-23T10:00:00Z'), lastActivePath: '/seller-central-checker/tasks' });
  });

  it.each(['super_admin', 'esf_staff', 'agency'])('records %s visits but never moves last active', async (kind) => {
    await ping({ kind, id: 'x' });
    expect(UserPageView.updateOne).toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  it('ignores non-seller pages and malformed ids', async () => {
    expect(await ping({ kind: 'owner' }, { path: '/esf/clients' })).toEqual({ recorded: false, reason: 'page' });
    expect(await ping({ kind: 'owner' }, { visitId: '../$where' })).toEqual({ recorded: false, reason: 'ids' });
    expect(UserPageView.updateOne).not.toHaveBeenCalled();
  });

  it('writes nothing when switched off', async () => {
    process.env.ACTIVITY_TRACKING_ENABLED = 'false';
    expect(await ping({ kind: 'owner' })).toEqual({ recorded: false, reason: 'disabled' });
    expect(UserPageView.updateOne).not.toHaveBeenCalled();
  });
});

describe('getTimeline', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const view = (visitId, activityId, label, start, end, actor = { kind: 'owner', id: null }) => ({
    visitId, activityId, label, path: `/p/${label}`, startedAt: new Date(start), lastSeenAt: new Date(end), actor,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockReturnValue(lean({ _id: USER, firstName: 'Ann', lastName: 'Lee', email: 'a@x.com', lastActiveAt: new Date('2026-10-23T11:59:30Z') }));
    User.find.mockReturnValue(lean([{ _id: '64b0000000000000000000aa', firstName: 'Priya', lastName: 'S' }]));
    AccountMember.find.mockReturnValue(lean([]));
    UserPageView.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [
      // newest first, as the query returns them
      view('v4', 'staff', 'Tasks', '2026-10-23T09:05:00Z', '2026-10-23T09:06:00Z', { kind: 'esf_staff', id: '64b0000000000000000000aa' }),
      view('v3', 'morning', 'Tasks', '2026-10-23T09:02:00Z', '2026-10-23T09:04:00Z'),
      view('v2', 'morning', 'Dashboard', '2026-10-23T09:00:00Z', '2026-10-23T09:02:00Z'),
      view('v1', 'lastweek', 'Issues', '2026-10-18T09:00:00Z', '2026-10-18T09:10:00Z'),
    ] }) }) });
  });

  it('groups visits into sittings, pages in the order they were opened', async () => {
    const t = await activity.getTimeline(USER, { days: 7, now });
    expect(t.isActiveNow).toBe(true);
    expect(t.sittings.map((s) => s.activityId)).toEqual(['staff', 'morning', 'lastweek']);
    const morning = t.sittings[1];
    expect(morning.pages.map((p) => p.label)).toEqual(['Dashboard', 'Tasks']);
    expect(morning.seconds).toBe(240);
  });

  it('names the staff member behind a staff visit', async () => {
    const t = await activity.getTimeline(USER, { now });
    expect(t.sittings[0].actor).toEqual({ kind: 'esf_staff', name: 'Priya S' });
  });

  it('counts only the account\'s own time in the totals', async () => {
    const t = await activity.getTimeline(USER, { now });
    expect(t.totals.last24hSeconds).toBe(240);
    expect(t.totals.last7dSeconds).toBe(240 + 600);
  });

  it('is null for an unknown user', async () => {
    expect(await activity.getTimeline('nope')).toBeNull();
  });
});

describe('retention', () => {
  it('keeps page visits 90 days by default, deleted automatically', () => {
    expect(LOG_RETENTION.pageViews).toMatchObject({ model: 'UserPageView', dateField: 'startedAt', retentionDays: 90 });
  });

  it('"active now" is a 2 minute window', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(activity.isActiveNow(new Date(now - 119 * 1000), now)).toBe(true);
    expect(activity.isActiveNow(new Date(now - 121 * 1000), now)).toBe(false);
    expect(activity.isActiveNow(null, now)).toBe(false);
  });
});
