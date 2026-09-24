/**
 * Removing members: a member can remove other members (they have full access)
 * but never themselves - leaving the account is the owner's call.
 */
let removeMember;
let AccountMember;

const OWNER = '64b000000000000000000001';
const ME = '64b0000000000000000000aa';
const OTHER = '64b0000000000000000000bb';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../models/user-auth/AccountMemberModel.js', () => ({
    findOne: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({}),
  }));
  AccountMember = require('../../../models/user-auth/AccountMemberModel.js');
  ({ removeMember } = require('../../../controllers/user-auth/AccountMemberController.js'));
});

const run = (req) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; },
  };
  removeMember({ userId: OWNER, params: {}, ...req }, res, (err) => resolve({ status: 'next', err }));
});

describe('removeMember', () => {
  it('refuses a member removing themselves', async () => {
    AccountMember.findOne.mockResolvedValue({ _id: ME, email: 'me@x.com', status: 'active' });
    const { status } = await run({ memberId: ME, params: { memberId: ME } });
    expect(status).toBe(403);
    expect(AccountMember.deleteOne).not.toHaveBeenCalled();
  });

  it('lets a member remove another member', async () => {
    AccountMember.findOne.mockResolvedValue({ _id: OTHER, email: 'other@x.com', status: 'active' });
    const { status } = await run({ memberId: ME, params: { memberId: OTHER } });
    expect(status).toBe(200);
    expect(AccountMember.deleteOne).toHaveBeenCalledWith({ _id: OTHER });
  });

  it('lets the owner remove any member', async () => {
    AccountMember.findOne.mockResolvedValue({ _id: ME, email: 'me@x.com', status: 'active' });
    const { status } = await run({ params: { memberId: ME } });
    expect(status).toBe(200);
  });
});
