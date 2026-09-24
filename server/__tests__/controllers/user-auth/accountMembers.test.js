/**
 * Removing members: a member can remove other members (they have full access)
 * but never themselves - leaving the account is the owner's call.
 */
let removeMember;
let updateMemberPermissions;
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
  // A normal seller (not an ESF client), so the Estore Factory pages are not offered.
  jest.doMock('../../../models/user-auth/userModel.js', () => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ isEsfClient: false }) }) })),
  }));
  AccountMember = require('../../../models/user-auth/AccountMemberModel.js');
  ({ removeMember, updateMemberPermissions } = require('../../../controllers/user-auth/AccountMemberController.js'));
});

const call = (handler, req) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; },
  };
  handler({ userId: OWNER, params: {}, body: {}, ...req }, res, (err) => resolve({ status: 'next', err }));
});
const run = (req) => call(removeMember, req);

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

describe('updateMemberPermissions', () => {
  it('is for the owner only - a member could otherwise lift their own limits', async () => {
    const { status } = await call(updateMemberPermissions, { memberId: ME, params: { memberId: OTHER }, body: { deniedPages: [] } });
    expect(status).toBe(403);
  });

  it('keeps only page keys offered for this account', async () => {
    const member = { _id: OTHER, email: 'o@x.com', status: 'active', deniedPages: [], save: jest.fn() };
    AccountMember.findOne.mockResolvedValue(member);
    const { status } = await call(updateMemberPermissions, {
      params: { memberId: OTHER },
      body: { deniedPages: ['tasks', 'billing', 'user-logging', 'not-a-page'] },
    });
    expect(status).toBe(200);
    // billing is an Estore Factory page and this is not an ESF client; user-logging is never offered.
    expect(member.deniedPages).toEqual(['tasks']);
    expect(member.save).toHaveBeenCalled();
  });
});
