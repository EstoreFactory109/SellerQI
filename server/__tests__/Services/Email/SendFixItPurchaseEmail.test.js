/**
 * The email the ESF team gets when a seller pays for a Fix it package.
 * Pinned: it goes to support@estorefactory.com unless FIXIT_PURCHASE_NOTIFY_EMAIL is set; it
 * carries the seller's email, phone, WhatsApp, brand and the package; a Google signup's
 * placeholder number is never shown as real; seller-typed values are HTML-escaped; a failed
 * send returns false (the caller retries) instead of throwing.
 */
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: (...a) => mockSendMail(...a) }) }));
jest.mock('../../../models/system/EmailLogsModel.js', () => function EmailLogs() {
  this.save = async () => {};
  this.markAsSent = async () => {};
  this.markAsFailed = async () => {};
});
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));

const User = require('../../../models/user-auth/userModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { sendFixItPurchaseEmail } = require('../../../Services/Email/SendFixItPurchaseEmail.js');

const lean = (value) => ({ select: () => ({ lean: async () => value }) });
const leanCatch = (value) => ({ select: () => ({ lean: () => ({ catch: () => Promise.resolve(value) }) }) });
const purchase = {
  _id: 'p1', userId: 'u1', packageName: 'Standard', tasks: 30, amount: 299, currency: 'USD', paidAt: '2026-10-27T10:00:00Z',
  openTasks: 9, monthlyRecoverable: 1007.03, atStakeCurrency: 'A$', stripePaymentIntentId: 'pi_1', stripeCustomerId: 'cus_1',
};
const ann = { _id: 'u1', firstName: 'Ann', lastName: '<b>Lee</b>', email: 'ann@acme.com', phone: '+61400111222', whatsapp: '+61400111333', packageType: 'PRO' };

beforeEach(() => {
  delete process.env.FIXIT_PURCHASE_NOTIFY_EMAIL;
  mockSendMail.mockResolvedValue({ messageId: 'm1' });
  User.findById.mockReturnValue(leanCatch(ann));
  Seller.findOne.mockReturnValue(lean({ brand: 'Acme Goods', sellerAccount: [{ country: 'AU' }, { country: 'US' }, { country: 'AU' }] }));
});

it('tells support@estorefactory.com who bought what, and how to reach them', async () => {
  expect(await sendFixItPurchaseEmail(purchase)).toBe('m1');
  const mail = mockSendMail.mock.calls[0][0];
  expect(mail.to).toEqual(['support@estorefactory.com']);
  expect(mail.replyTo).toBe('ann@acme.com');
  expect(mail.subject).toBe('Fix it purchase: Standard ($299) — Ann <b>Lee</b>');
  for (const bit of ['ann@acme.com', '+61400111222', '+61400111333', 'Acme Goods', 'AU, US', '30 tasks', '$299', '~A$1,007/mo', 'https://dashboard.stripe.com/payments/pi_1', 'PRO']) {
    expect(mail.html).toContain(bit);
  }
  expect(mail.text).toContain('Phone: +61400111222');
});

it('escapes what the seller typed', async () => {
  await sendFixItPurchaseEmail(purchase);
  const { html } = mockSendMail.mock.calls[0][0];
  expect(html).toContain('Ann &lt;b&gt;Lee&lt;/b&gt;');
  expect(html).not.toContain('<b>Lee</b>');
});

it('never shows a Google signup\'s placeholder number as their phone', async () => {
  User.findById.mockReturnValue(leanCatch({ ...ann, phone: '1761550000', whatsapp: '1761550001', needsPhoneUpdate: true, phoneUpdateReason: 'missing' }));
  await sendFixItPurchaseEmail(purchase);
  const { html } = mockSendMail.mock.calls[0][0];
  expect(html).toContain('Not provided (signed up with Google)');
  expect(html).not.toContain('1761550000');
});

it('goes where FIXIT_PURCHASE_NOTIFY_EMAIL says, when set', async () => {
  process.env.FIXIT_PURCHASE_NOTIFY_EMAIL = 'a@esf.com, b@esf.com';
  await sendFixItPurchaseEmail(purchase);
  expect(mockSendMail.mock.calls[0][0].to).toEqual(['a@esf.com', 'b@esf.com']);
});

it('returns false instead of throwing when sending fails', async () => {
  mockSendMail.mockRejectedValue(new Error('SES down'));
  expect(await sendFixItPurchaseEmail(purchase)).toBe(false);
});
