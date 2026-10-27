/**
 * Linking a SellerQI account to its Zoho Billing customer by hand.
 *
 * Pinned: the chosen customer is re-checked with Zoho; a customer already linked to another
 * account is refused (both syncs would fight over the same invoices); changing the customer
 * clears the old one's invoices; unlinking stops the nightly email match re-linking it; and
 * the email match itself now tries verified extra emails and never takes a used customer.
 */
jest.mock('../../../models/user-auth/userModel.js', () => ({
  findOne: jest.fn(), find: jest.fn(), findById: jest.fn(), updateOne: jest.fn(), exists: jest.fn(),
}));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/system/EsfBillingModels.js', () => ({
  EsfBillingProfile: { deleteMany: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), find: jest.fn() },
  EsfBillingInvoice: { deleteMany: jest.fn(), bulkWrite: jest.fn(), find: jest.fn() },
}));
jest.mock('../../../Services/Zoho/ZohoBillingService.js', () => ({
  listCustomers: jest.fn(), getCustomer: jest.fn(), findCustomerByEmail: jest.fn(),
}));
jest.mock('../../../config/redisConn.js', () => ({ getRedisClient: () => null }));

const UserModel = require('../../../models/user-auth/userModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { EsfBillingProfile, EsfBillingInvoice } = require('../../../models/system/EsfBillingModels.js');
const ZohoBillingService = require('../../../Services/Zoho/ZohoBillingService.js');
const links = require('../../../Services/Zoho/ZohoBillingLinks.js');
const { resolveCustomerId } = require('../../../Services/Zoho/ZohoBillingSync.js');

const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

const CUSTOMERS = [
  { customerId: '1001', displayName: 'Acme Goods Ltd', companyName: 'Acme Goods Ltd', email: 'accounts@acmegoods.com', currencyCode: 'GBP' },
  { customerId: '1002', displayName: 'Bravo Kitchen', companyName: 'Bravo Kitchen Inc', email: 'billing@bravo.io', currencyCode: 'USD' },
  { customerId: '1003', displayName: 'Charlie Pets', companyName: 'Charlie Pets', email: 'charlie@gmail.com', currencyCode: 'USD' },
];
const CLIENT = { _id: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'ann@acmegoods.com', isEsfClient: true, zohoBilling: {} };

beforeEach(() => {
  jest.clearAllMocks();
  ZohoBillingService.listCustomers.mockResolvedValue(CUSTOMERS);
  UserModel.findOne.mockReturnValue(lean(CLIENT));
  UserModel.find.mockReturnValue(lean([]));
  UserModel.findById.mockReturnValue(lean(null));
  Seller.findOne.mockReturnValue(lean({ brand: 'Acme' }));
  UserModel.updateOne.mockResolvedValue({});
});

describe('finding the customer', () => {
  it('searches name, company and email, every word', () => {
    expect(links.searchCustomers(CUSTOMERS, 'bravo').map((c) => c.customerId)).toEqual(['1002']);
    expect(links.searchCustomers(CUSTOMERS, 'billing@bravo').map((c) => c.customerId)).toEqual(['1002']);
    expect(links.searchCustomers(CUSTOMERS, 'acme ltd').map((c) => c.customerId)).toEqual(['1001']);
    expect(links.searchCustomers(CUSTOMERS, '')).toEqual([]);
  });

  it('suggests customers on the client\'s own email domain or with their brand, not on public mailboxes', () => {
    const out = links.suggestCustomers(CUSTOMERS, { ...CLIENT, brand: 'Acme' });
    expect(out[0].customerId).toBe('1001');
    const gmailClient = { firstName: 'Zed', lastName: 'Q', email: 'zed@gmail.com' };
    expect(links.suggestCustomers(CUSTOMERS, gmailClient)).toEqual([]);
  });

  it('says which results another account already uses', async () => {
    UserModel.find.mockReturnValue(lean([{ _id: 'u2', firstName: 'Bob', lastName: 'K', zohoBilling: { customerId: '1002' } }]));
    const options = await links.getBillingOptions('u1', { search: 'bravo' });
    expect(options.results[0]).toMatchObject({ customerId: '1002', linkedTo: { userId: 'u2', name: 'Bob K' } });
    expect(options.linked).toBeNull();
  });

  it('only ESF clients', async () => {
    UserModel.findOne.mockReturnValue(lean(null));
    await expect(links.getBillingOptions('u9')).rejects.toMatchObject({ statusCode: 404 });
    expect(UserModel.findOne.mock.calls[0][0]).toEqual({ _id: 'u9', isEsfClient: true });
  });
});

describe('linking', () => {
  it('re-checks the customer with Zoho and records a manual link by whom', async () => {
    ZohoBillingService.getCustomer.mockResolvedValue(CUSTOMERS[1]);
    UserModel.findOne.mockReturnValueOnce(lean(CLIENT)).mockReturnValueOnce(lean(null)).mockReturnValue(lean(CLIENT));
    await links.linkBillingCustomer('u1', '1002', { _id: 'staff1' });
    expect(ZohoBillingService.getCustomer).toHaveBeenCalledWith('1002');
    expect(UserModel.updateOne.mock.calls[0][1].$set).toMatchObject({
      'zohoBilling.customerId': '1002',
      'zohoBilling.customerName': 'Bravo Kitchen Inc',
      'zohoBilling.matchedEmail': 'billing@bravo.io',
      'zohoBilling.linkSource': 'manual',
      'zohoBilling.linkedBy': 'staff1',
      'zohoBilling.autoMatchDisabled': false,
    });
    // First link: nothing old to clear.
    expect(EsfBillingInvoice.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a customer another account already has', async () => {
    ZohoBillingService.getCustomer.mockResolvedValue(CUSTOMERS[1]);
    UserModel.findOne.mockReturnValueOnce(lean(CLIENT)).mockReturnValueOnce(lean({ firstName: 'Bob', lastName: 'K' }));
    await expect(links.linkBillingCustomer('u1', '1002', { _id: 's' })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Bob K') });
    expect(UserModel.updateOne).not.toHaveBeenCalled();
  });

  it('refuses an id Zoho does not know, and a malformed one without asking Zoho', async () => {
    ZohoBillingService.getCustomer.mockResolvedValue(null);
    await expect(links.linkBillingCustomer('u1', '1009', {})).rejects.toMatchObject({ statusCode: 404 });
    ZohoBillingService.getCustomer.mockClear();
    await expect(links.linkBillingCustomer('u1', '../x', {})).rejects.toMatchObject({ statusCode: 400 });
    expect(ZohoBillingService.getCustomer).not.toHaveBeenCalled();
  });

  it('changing the customer clears the old customer\'s invoices and card', async () => {
    const linked = { ...CLIENT, zohoBilling: { customerId: '1001' } };
    ZohoBillingService.getCustomer.mockResolvedValue(CUSTOMERS[1]);
    UserModel.findOne.mockReturnValueOnce(lean(linked)).mockReturnValueOnce(lean(null)).mockReturnValue(lean(linked));
    await links.linkBillingCustomer('u1', '1002', { _id: 's' });
    expect(EsfBillingInvoice.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(EsfBillingProfile.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
  });
});

describe('unlinking', () => {
  it('clears the link and what was shown, and stops the nightly email match', async () => {
    await links.unlinkBillingCustomer('u1', { _id: 's' });
    expect(EsfBillingInvoice.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(UserModel.updateOne.mock.calls[0][1].$set).toMatchObject({ 'zohoBilling.customerId': null, 'zohoBilling.autoMatchDisabled': true });
  });
});

describe('the nightly email match (resolveCustomerId)', () => {
  it('keeps a stored link, manual or automatic', async () => {
    expect(await resolveCustomerId({ _id: 'u1', email: 'a@x.com', zohoBilling: { customerId: '1001', linkSource: 'manual' } }))
      .toEqual({ customerId: '1001', newlyLinked: false });
    expect(ZohoBillingService.findCustomerByEmail).not.toHaveBeenCalled();
  });

  it('never re-links a client an admin unlinked', async () => {
    expect(await resolveCustomerId({ _id: 'u1', email: 'a@x.com', zohoBilling: { autoMatchDisabled: true } })).toBeNull();
    expect(ZohoBillingService.findCustomerByEmail).not.toHaveBeenCalled();
  });

  it('tries verified extra emails after the login email', async () => {
    ZohoBillingService.findCustomerByEmail.mockImplementation(async (email) => (email === 'accounts@acmegoods.com' ? CUSTOMERS[0] : null));
    UserModel.exists.mockResolvedValue(null);
    const user = { _id: 'u1', email: 'ann@acmegoods.com', zohoBilling: {}, additionalEmails: [
      { email: 'unverified@acmegoods.com', isVerified: false },
      { email: 'accounts@acmegoods.com', isVerified: true },
    ] };
    expect(await resolveCustomerId(user)).toEqual({ customerId: '1001', newlyLinked: true });
    expect(ZohoBillingService.findCustomerByEmail.mock.calls.map((c) => c[0])).toEqual(['ann@acmegoods.com', 'accounts@acmegoods.com']);
    expect(UserModel.updateOne.mock.calls[0][1].$set).toMatchObject({ 'zohoBilling.matchedEmail': 'accounts@acmegoods.com', 'zohoBilling.linkSource': 'email' });
  });

  it('never auto-links a customer another account already has', async () => {
    ZohoBillingService.findCustomerByEmail.mockResolvedValue(CUSTOMERS[0]);
    UserModel.exists.mockResolvedValue({ _id: 'u2' });
    expect(await resolveCustomerId({ _id: 'u1', email: 'accounts@acmegoods.com', zohoBilling: {} })).toBeNull();
    expect(UserModel.updateOne.mock.calls[0][1].$set).toEqual({ 'zohoBilling.lastLookupAt': expect.any(Date) });
  });
});
