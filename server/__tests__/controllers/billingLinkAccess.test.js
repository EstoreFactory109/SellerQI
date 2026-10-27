/**
 * Who may link a client to a Zoho Billing customer: ESF owner/admins (and super admins in the
 * ESF portal), and the super admin's own endpoints. Never ESF members, never unallocated clients.
 */
jest.mock('../../Services/Zoho/ZohoBillingLinks.js', () => ({
  getBillingOptions: jest.fn(async () => ({ linked: null, results: [] })),
  linkBillingCustomer: jest.fn(async () => ({ linked: { customerId: '1' } })),
  unlinkBillingCustomer: jest.fn(async () => ({ linked: null })),
}));
jest.mock('../../controllers/admin/admin.js', () => ({ requireSuperAdmin: jest.fn() }));

const links = require('../../Services/Zoho/ZohoBillingLinks.js');
const { requireSuperAdmin } = require('../../controllers/admin/admin.js');
const { getClientBillingOptions, linkClientBilling, unlinkClientBilling } = require('../../controllers/esf/esfBilling.js');
const { linkAccountBilling, unlinkAccountBilling } = require('../../controllers/admin/AdminBillingLinkController.js');
const { ApiError } = require('../../utils/ApiError.js');

const CLIENT = '64b000000000000000000001';
const run = (handler, req) => new Promise((resolve, reject) => {
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; resolve(this); return this; },
  };
  handler({ params: {}, query: {}, body: {}, ...req }, res, reject);
});

const owner = { _id: 'o1', accessType: 'esfUser', esfRole: 'owner' };
const admin = { _id: 'a1', accessType: 'esfUser', esfRole: 'admin' };
const member = { _id: 'm1', accessType: 'esfUser', esfRole: 'member', esfAllowedClients: [CLIENT] };
const superAdmin = { _id: 's1', accessType: 'superAdmin' };

beforeEach(() => jest.clearAllMocks());

describe('ESF portal', () => {
  it('members are refused, even for their own clients', async () => {
    for (const handler of [getClientBillingOptions, linkClientBilling, unlinkClientBilling]) {
      expect((await run(handler, { esfUser: member, params: { clientId: CLIENT } })).statusCode).toBe(403);
    }
    expect(links.linkBillingCustomer).not.toHaveBeenCalled();
  });

  it('owner, admins and super admins can link and unlink', async () => {
    for (const esfUser of [owner, admin, superAdmin]) {
      expect((await run(linkClientBilling, { esfUser, params: { clientId: CLIENT }, body: { customerId: '1' } })).statusCode).toBe(200);
    }
    expect(links.linkBillingCustomer).toHaveBeenCalledWith(CLIENT, '1', owner);
    expect((await run(unlinkClientBilling, { esfUser: admin, params: { clientId: CLIENT } })).statusCode).toBe(200);
  });

  it('a bad client id is a 404', async () => {
    expect((await run(getClientBillingOptions, { esfUser: owner, params: { clientId: 'nope' } })).statusCode).toBe(404);
  });

  it('service refusals pass through with their message', async () => {
    links.linkBillingCustomer.mockRejectedValueOnce(new ApiError(409, 'This Zoho Billing customer is already linked to Bob K.'));
    const res = await run(linkClientBilling, { esfUser: owner, params: { clientId: CLIENT }, body: { customerId: '2' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Bob K/);
  });
});

describe('super admin', () => {
  it('is checked before anything happens, and recorded as the linker', async () => {
    requireSuperAdmin.mockImplementation(async (req, res) => { res.status(403).json({}); return false; });
    expect((await run(linkAccountBilling, { params: { userId: CLIENT }, body: { customerId: '1' } })).statusCode).toBe(403);
    expect(links.linkBillingCustomer).not.toHaveBeenCalled();

    requireSuperAdmin.mockResolvedValue(true);
    await run(linkAccountBilling, { SuperAdminId: 'sa1', params: { userId: CLIENT }, body: { customerId: '1' } });
    expect(links.linkBillingCustomer).toHaveBeenCalledWith(CLIENT, '1', { _id: 'sa1' });
    expect((await run(unlinkAccountBilling, { SuperAdminId: 'sa1', params: { userId: CLIENT } })).statusCode).toBe(200);
  });
});
