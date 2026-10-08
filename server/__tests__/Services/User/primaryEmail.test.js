/**
 * Changing an account's primary (login) email without verification - used by ESF
 * owner/admin for a client, and by the profile page. The only rule is that the
 * address must not already belong to someone else.
 */
let assertPrimaryEmailAvailable;
let UserModel;
let AccountMember;

const ME = '64b000000000000000000001';
const SOMEONE = '64b000000000000000000002';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../models/user-auth/userModel.js', () => ({ findOne: jest.fn() }));
  jest.doMock('../../../models/user-auth/AccountMemberModel.js', () => ({ exists: jest.fn().mockResolvedValue(null) }));
  UserModel = require('../../../models/user-auth/userModel.js');
  AccountMember = require('../../../models/user-auth/AccountMemberModel.js');
  ({ assertPrimaryEmailAvailable } = require('../../../Services/User/emailAccounts.js'));
});

const holderIs = (holder) => UserModel.findOne.mockReturnValue({ select: () => ({ lean: async () => holder }) });

describe('assertPrimaryEmailAvailable', () => {
  it('accepts a new, unused address (normalised)', async () => {
    holderIs(null);
    expect(await assertPrimaryEmailAvailable('  New@Client.com ', ME)).toEqual({ ok: true, email: 'new@client.com', unchanged: false });
  });

  it("refuses another account's address", async () => {
    holderIs({ _id: SOMEONE, email: 'taken@x.com' });
    expect(await assertPrimaryEmailAvailable('taken@x.com', ME)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses a member's address", async () => {
    holderIs(null);
    AccountMember.exists.mockResolvedValue({ _id: 'm' });
    expect(await assertPrimaryEmailAvailable('member@x.com', ME)).toMatchObject({ ok: false, status: 409 });
  });

  it('allows promoting one of the account\'s own extra addresses', async () => {
    holderIs({ _id: ME, email: 'old@x.com' });
    expect(await assertPrimaryEmailAvailable('extra@x.com', ME)).toEqual({ ok: true, email: 'extra@x.com', unchanged: false });
  });

  it('reports no change when it is already the primary address', async () => {
    holderIs({ _id: ME, email: 'same@x.com' });
    expect(await assertPrimaryEmailAvailable('SAME@x.com', ME)).toMatchObject({ ok: true, unchanged: true });
  });

  it('rejects a malformed address', async () => {
    expect(await assertPrimaryEmailAvailable('nope', ME)).toMatchObject({ ok: false, status: 400 });
  });
});
