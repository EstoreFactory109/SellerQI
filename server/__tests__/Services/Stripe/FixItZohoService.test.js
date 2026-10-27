/**
 * An ESF client's Fix it purchase becomes a task in their Zoho project.
 *
 * Pinned: non-ESF buyers are skipped; a linked project gets the task; an unlinked client's
 * brand project is found (AI), linked, then gets the task; a project another client owns is
 * never offered; no match creates a project named after the brand; the exact brand name is
 * linked rather than duplicated; the task is filed under "Fix it packages" (reused, created,
 * or skipped at 25 lists); a purchase that already has its task creates nothing; a failure
 * is reported (with any project already made), never thrown.
 */
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({ getConnection: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoTaskSync.js', () => ({ syncProject: jest.fn() }));
jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
  createProject: jest.fn(), createTask: jest.fn(), listTasklists: jest.fn(), createTasklist: jest.fn(),
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
const { addFixItTaskToZoho } = require('../../../Services/Stripe/FixItZohoService.js');

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
  UserModel.findById.mockReturnValue(lean(client()));
  UserModel.find.mockReturnValue(lean([]));
  Seller.findOne.mockReturnValue(lean({ brand: 'Acme Goods' }));
  ZohoAuth.getConnection.mockResolvedValue({ portalId: '851273093' });
  Links.getProjects.mockResolvedValue(PROJECTS);
  Links.linkProject.mockImplementation(async ({ projectId }) => ({ projectId, projectName: [...PROJECTS, { id: '900', name: 'Acme Goods' }].find((p) => p.id === projectId)?.name, portalId: '851273093' }));
  Matcher.matchProject.mockResolvedValue({ project: null, matchedBy: 'none' });
  Zoho.listTasklists.mockResolvedValue([{ id: 'L1', name: 'General' }]);
  Zoho.createTasklist.mockResolvedValue({ id: 'L9', name: 'Fix it packages' });
  Zoho.createTask.mockResolvedValue({ id: 'T1' });
  Zoho.createProject.mockResolvedValue({ id: '900', name: 'Acme Goods' });
  ZohoTaskSync.syncProject.mockResolvedValue({});
});

it('skips sellers who are not ESF clients', async () => {
  UserModel.findById.mockReturnValue(lean(client({ isEsfClient: false })));
  expect(await addFixItTaskToZoho(purchase)).toEqual({ status: 'skipped' });
  expect(Zoho.createTask).not.toHaveBeenCalled();
});

it('adds the task to an already linked project', async () => {
  UserModel.findById.mockReturnValue(lean(client({ zohoProject: { projectId: '100', projectName: 'Acme Goods - Seller Central', portalId: '851273093' } })));
  const out = await addFixItTaskToZoho(purchase);
  expect(out).toMatchObject({ status: 'done', projectId: '100', projectSource: 'linked', taskId: 'T1' });
  expect(Links.linkProject).not.toHaveBeenCalled();
  expect(Matcher.matchProject).not.toHaveBeenCalled();
  const task = Zoho.createTask.mock.calls[0][0];
  expect(task).toMatchObject({ projectId: '100', tasklistId: 'L9', name: 'Fix it – Standard package: fix 30 tasks (paid $299)' });
  expect(task.description).toMatch(/9 open tasks in SellerQI, worth ~A\$1,007\/mo/);
  expect(task.description).toMatch(/ann@acmegoods\.com/);
  expect(task.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(ZohoTaskSync.syncProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: '100' }));
});

it('finds the brand\'s project, links it to the account, then adds the task', async () => {
  Matcher.matchProject.mockResolvedValue({ project: PROJECTS[0], matchedBy: 'ai' });
  const out = await addFixItTaskToZoho(purchase);
  // Shortlist: projects that share the brand's words, best first.
  const [seller, shortlist] = Matcher.matchProject.mock.calls[0];
  expect(seller).toMatchObject({ brand: 'Acme Goods', clientName: 'Ann Lee' });
  expect(shortlist.map((p) => p.id)).toEqual(['100', '300']);
  expect(Links.linkProject).toHaveBeenCalledWith({ clientId: 'u1', projectId: '100', staffUserId: null });
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
  expect(Links.linkProject).toHaveBeenCalledWith({ clientId: 'u1', projectId: '900', staffUserId: null });
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
  await addFixItTaskToZoho(purchase);
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
