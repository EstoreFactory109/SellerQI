/**
 * A Fix it purchase becomes ONE parent task (per engagement) in the buyer's Zoho project,
 * whose subtasks FixItZohoSync fills from their SellerQI tasks.
 *
 * Pinned: ESF clients and other buyers alike; a linked project is used; an unlinked buyer's
 * brand project is found (AI) and linked; a project another client owns is never offered;
 * no match creates a project named after the brand; the exact brand name is linked rather
 * than duplicated; the parent is filed under "Fix it packages" (reused, created, or unfiled
 * at 25 lists); the work order records the parent and an open status id; a renewal raises
 * the quota once and never makes a second parent; a crash before saving the parent adopts
 * it; a failure is reported (with any project already made), never thrown.
 */
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({ getConnection: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoTaskSync.js', () => ({ syncProject: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
  createProject: jest.fn(), createTask: jest.fn(), listTasklists: jest.fn(), createTasklist: jest.fn(), listProjectTasks: jest.fn(),
}));
const mockWorkOrders = [];
jest.mock('../../../models/system/FixItWorkOrderModel.js', () => {
  const q = (v) => ({ lean: async () => (v ? { ...v } : null) });
  return {
    findOne: ({ key }) => q(mockWorkOrders.find((w) => w.key === key)),
    findById: (id) => q(mockWorkOrders.find((w) => w._id === id)),
    findOneAndUpdate: ({ key }, update) => {
      let w = mockWorkOrders.find((x) => x.key === key);
      if (!w) { w = { _id: `wo${mockWorkOrders.length + 1}`, key, zohoParentTaskId: null, status: 'active', ...update.$setOnInsert }; mockWorkOrders.push(w); }
      return q(w);
    },
    updateOne: async (filter, update) => {
      const w = mockWorkOrders.find((x) => x._id === filter._id && (filter.monthsPaid ? x.monthsPaid < filter.monthsPaid.$lt : true));
      if (w) { Object.assign(w, update.$set || {}); for (const [k, v] of Object.entries(update.$inc || {})) w[k] = (w[k] || 0) + v; }
      return {};
    },
  };
});
const mockReleased = [];
jest.mock('../../../Services/Stripe/FixItEsfClient.js', () => ({ release: async (id) => { mockReleased.push(id); } }));
const mockSync = { calls: [] };
jest.mock('../../../Services/Stripe/FixItZohoSync.js', () => ({
  syncWorkOrderById: async (id) => { mockSync.calls.push(id); return { total: 2, done: 0 }; },
}));
jest.mock('../../../Services/Zoho/ZohoProjectLinks.js', () => {
  const actual = jest.requireActual('../../../Services/Zoho/ZohoProjectLinks.js');
  return { scoreProject: actual.scoreProject, getProjects: jest.fn(), linkProject: jest.fn(), invalidateProjectCache: jest.fn() };
});
jest.mock('../../../Services/AI/FixItProjectMatcher.js', () => {
  const actual = jest.requireActual('../../../Services/AI/FixItProjectMatcher.js');
  return { ...actual, matchProject: jest.fn() };
});

const UserModel = require('../../../models/user-auth/userModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const ZohoAuth = require('../../../Services/Zoho/ZohoAuth.js');
const ZohoTaskSync = require('../../../Services/Zoho/ZohoTaskSync.js');
const Zoho = require('../../../Services/Zoho/ZohoProjectsService.js');
const Links = require('../../../Services/Zoho/ZohoProjectLinks.js');
const Matcher = require('../../../Services/AI/FixItProjectMatcher.js');
const { addFixItTaskToZoho, onSubscriptionChanged } = require('../../../Services/Stripe/FixItZohoService.js');

const lean = (value) => ({ select: () => ({ lean: async () => value }) });
const purchase = {
  _id: 'p1', userId: 'u1', packageId: 'standard', packageName: 'Standard', tasks: 30, amount: 299, currency: 'USD',
  paidAt: '2026-10-27T10:00:00Z', openTasks: 9, monthlyRecoverable: 1007.03, atStakeCurrency: 'A$', stripePaymentIntentId: 'pi_1',
};
const client = (over = {}) => ({ _id: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'ann@acmegoods.com', phone: '+61400', isEsfClient: true, zohoProject: null, ...over });
const PROJECTS = [
  { id: '100', name: 'Acme Goods - Seller Central' },
  { id: '200', name: 'Bravo Kitchen' },
  { id: '300', name: 'Acme Pets' },
];

beforeEach(() => {
  mockWorkOrders.length = 0;
  mockSync.calls.length = 0;
  Zoho.listProjectTasks.mockResolvedValue([]);
  UserModel.findById.mockReturnValue(lean(client()));
  UserModel.find.mockReturnValue(lean([]));
  Seller.findOne.mockReturnValue(lean({ brand: 'Acme Goods' }));
  ZohoAuth.getConnection.mockResolvedValue({ portalId: '851273093' });
  Links.getProjects.mockResolvedValue(PROJECTS);
  Links.linkProject.mockImplementation(async ({ projectId }) => ({ projectId, projectName: [...PROJECTS, { id: '900', name: 'Acme Goods' }].find((p) => p.id === projectId)?.name, portalId: '851273093' }));
  Matcher.matchProject.mockResolvedValue({ project: null, matchedBy: 'none' });
  Zoho.listTasklists.mockResolvedValue([{ id: 'L1', name: 'General' }]);
  Zoho.createTasklist.mockResolvedValue({ id: 'L9', name: 'Fix it packages' });
  Zoho.createTask.mockResolvedValue({ id: 'T1', statusId: 'S_OPEN' });
  Zoho.createProject.mockResolvedValue({ id: '900', name: 'Acme Goods' });
  ZohoTaskSync.syncProject.mockResolvedValue({});
});

it('buyers who are not ESF clients get it too', async () => {
  UserModel.findById.mockReturnValue(lean(client({ isEsfClient: false })));
  const out = await addFixItTaskToZoho(purchase);
  expect(out).toMatchObject({ status: 'done', projectId: '900', projectSource: 'created', taskId: 'T1' });
  expect(Links.linkProject).toHaveBeenCalledWith({ clientId: 'u1', projectId: '900', staffUserId: null, allowNonEsfClient: true });
});

it('one parent task in an already linked project, a work order, then the subtask sync', async () => {
  UserModel.findById.mockReturnValue(lean(client({ zohoProject: { projectId: '100', projectName: 'Acme Goods - Seller Central', portalId: '851273093' } })));
  const out = await addFixItTaskToZoho({ ...purchase, country: 'US', region: 'NA' });
  expect(out).toMatchObject({ status: 'done', projectId: '100', projectSource: 'linked', taskId: 'T1', taskName: 'Fix it – Standard (30 tasks) — 2 subtasks' });
  expect(Links.linkProject).not.toHaveBeenCalled();
  expect(Matcher.matchProject).not.toHaveBeenCalled();
  const task = Zoho.createTask.mock.calls[0][0];
  expect(task).toMatchObject({ projectId: '100', tasklistId: 'L9', name: 'Fix it – Standard (30 tasks)' });
  expect(task.description).toMatch(/subtasks below/);
  expect(task.description).toMatch(/ann@acmegoods\.com/);
  expect(mockWorkOrders[0]).toMatchObject({ key: 'purchase:p1', kind: 'trial', quota: 30, country: 'US', region: 'NA', zohoProjectId: '100', zohoParentTaskId: 'T1', zohoOpenStatusId: 'S_OPEN' });
  expect(mockSync.calls).toEqual(['wo1']);
  expect(ZohoTaskSync.syncProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: '100' }));
});

it('a subscription has one parent for its whole life: each renewal raises the quota once', async () => {
  const month1 = { ...purchase, _id: 'p1', billing: 'monthly', period: 1, stripeSubscriptionId: 'sub_1' };
  const first = await addFixItTaskToZoho(month1);
  expect(first.taskId).toBe('T1');
  expect(Zoho.createTask.mock.calls[0][0].name).toBe('Fix it – Standard subscription (30 tasks a month)');
  expect(Zoho.createTask.mock.calls[0][0]).not.toHaveProperty('endDate');
  expect(mockWorkOrders[0]).toMatchObject({ key: 'sub_1', kind: 'subscription', quota: 30, monthsPaid: 1 });

  const month2 = { ...month1, _id: 'p2', period: 2 };
  const second = await addFixItTaskToZoho(month2);
  await addFixItTaskToZoho({ ...month2, _id: 'p2b' }); // a repeated renewal webhook
  expect(Zoho.createTask).toHaveBeenCalledTimes(1);
  expect(mockWorkOrders[0]).toMatchObject({ quota: 60, monthsPaid: 2 });
  expect(second).toMatchObject({ taskId: 'T1', projectSource: 'linked' });
});

it('a crash before the parent was saved adopts that parent instead of making another', async () => {
  mockWorkOrders.push({ _id: 'wo1', key: 'purchase:p1', zohoParentTaskId: null, zohoProjectId: '900', portalId: '851273093', zohoParentTaskName: 'Fix it – Standard (30 tasks)', updatedAt: new Date(0) });
  Zoho.listProjectTasks.mockResolvedValue([{ id: 'T_OLD', name: 'Fix it – Standard (30 tasks)', parentTaskId: null, statusId: 'S_OPEN' }]);
  const out = await addFixItTaskToZoho(purchase);
  expect(Zoho.createTask).not.toHaveBeenCalled();
  expect(out.taskId).toBe('T_OLD');
});

it('finds the brand\'s project, links it to the account, then adds the task', async () => {
  Matcher.matchProject.mockResolvedValue({ project: PROJECTS[0], matchedBy: 'ai' });
  const out = await addFixItTaskToZoho(purchase);
  // Shortlist: projects that share the brand's words, best first.
  const [seller, shortlist] = Matcher.matchProject.mock.calls[0];
  expect(seller).toMatchObject({ brand: 'Acme Goods', clientName: 'Ann Lee' });
  expect(shortlist.map((p) => p.id)).toEqual(['100', '300']);
  expect(Links.linkProject).toHaveBeenCalledWith({ clientId: 'u1', projectId: '100', staffUserId: null, allowNonEsfClient: true });
  expect(out).toMatchObject({ status: 'done', projectId: '100', projectSource: 'matched' });
  expect(Zoho.createProject).not.toHaveBeenCalled();
});

it('never offers a project another client already owns', async () => {
  UserModel.find.mockReturnValue(lean([{ zohoProject: { projectId: '100' } }]));
  await addFixItTaskToZoho(purchase);
  expect(Matcher.matchProject.mock.calls[0][1].map((p) => p.id)).toEqual(['300']);
});

it('creates a project named after the brand when none matches, links it and adds the task', async () => {
  const out = await addFixItTaskToZoho(purchase);
  expect(Zoho.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Goods' }));
  expect(Links.invalidateProjectCache).toHaveBeenCalled();
  expect(Links.linkProject).toHaveBeenCalledWith({ clientId: 'u1', projectId: '900', staffUserId: null, allowNonEsfClient: true });
  expect(out).toMatchObject({ status: 'done', projectId: '900', projectName: 'Acme Goods', projectSource: 'created', taskId: 'T1' });
});

it('links a project with exactly the brand\'s name instead of making a duplicate', async () => {
  Links.getProjects.mockImplementation(async ({ refresh } = {}) => (refresh ? [...PROJECTS, { id: '900', name: 'ACME goods' }] : PROJECTS));
  const out = await addFixItTaskToZoho(purchase);
  expect(Zoho.createProject).not.toHaveBeenCalled();
  expect(out).toMatchObject({ projectId: '900', projectSource: 'matched' });
});

it('falls back to the seller\'s name when there is no brand', async () => {
  Seller.findOne.mockReturnValue(lean(null));
  await addFixItTaskToZoho(purchase);
  expect(Zoho.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ann Lee' }));
});

it('files under an existing "Fix it packages" list, and leaves it unfiled at 25 lists', async () => {
  UserModel.findById.mockReturnValue(lean(client({ zohoProject: { projectId: '100', projectName: 'x' } })));
  Zoho.listTasklists.mockResolvedValue([{ id: 'L5', name: 'fix it PACKAGES' }]);
  await addFixItTaskToZoho(purchase);
  expect(Zoho.createTask.mock.calls[0][0].tasklistId).toBe('L5');
  expect(Zoho.createTasklist).not.toHaveBeenCalled();

  Zoho.listTasklists.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `L${i}`, name: `List ${i}` })));
  await addFixItTaskToZoho({ ...purchase, _id: 'p_other' });
  expect(Zoho.createTask.mock.calls[1][0].tasklistId).toBeNull();
  expect(Zoho.createTasklist).not.toHaveBeenCalled();
});

it('creates nothing when the purchase already has its task', async () => {
  const out = await addFixItTaskToZoho({ ...purchase, zohoTaskId: 'T1', zohoProjectId: '100', zohoProjectName: 'x', zohoProjectSource: 'linked' });
  expect(out).toMatchObject({ status: 'done', taskId: 'T1' });
  expect(Zoho.createTask).not.toHaveBeenCalled();
});

it('reports Zoho not being connected', async () => {
  ZohoAuth.getConnection.mockResolvedValue(null);
  expect(await addFixItTaskToZoho(purchase)).toMatchObject({ status: 'failed', error: 'Zoho Projects is not connected' });
});

it('a failed task still reports the project it made', async () => {
  Zoho.createTask.mockRejectedValue(new Error('INVALID_PARAMETER_VALUE'));
  const out = await addFixItTaskToZoho(purchase);
  expect(out).toMatchObject({ status: 'failed', error: 'INVALID_PARAMETER_VALUE', projectId: '900', projectName: 'Acme Goods', projectSource: 'created' });
});

it('when another client owns a project with the brand\'s exact name, the new one says whose it is', async () => {
  const taken = { id: '700', name: 'Acme Goods' };
  Links.getProjects.mockResolvedValue([...PROJECTS, taken]);
  UserModel.find.mockReturnValue(lean([{ zohoProject: { projectId: '700' } }]));
  await addFixItTaskToZoho(purchase);
  expect(Zoho.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Goods – Ann Lee' }));
});

it('the work order follows the subscription, and an ended one sends the seller back to normal', async () => {
  mockReleased.length = 0;
  mockWorkOrders.push({ _id: 'wo9', key: 'sub_9', status: 'active', userId: 'u1' });
  await onSubscriptionChanged({ stripeSubscriptionId: 'sub_9', userId: 'u1', status: 'active', cancelAtPeriodEnd: true });
  expect(mockReleased).toEqual([]);
  await onSubscriptionChanged({ stripeSubscriptionId: 'sub_9', userId: 'u1', status: 'canceled', cancelAtPeriodEnd: true });
  expect(mockReleased).toEqual(['u1']);
});
