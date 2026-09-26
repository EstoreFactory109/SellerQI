/**
 * Member tokens name the member (`mid`), and their sessions live on the member row,
 * never on the owner - so members cannot push the owner's devices out of the
 * session limit, and a removed member's refresh token stops working.
 */
const jwt = require('jsonwebtoken');

let Tokens;
let User;
let AccountMember;

const OWNER = '64b000000000000000000001';
const MEMBER = '64b0000000000000000000aa';

beforeEach(() => {
  jest.resetModules();
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  jest.doMock('../../models/user-auth/userModel.js', () => ({
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    findById: jest.fn(),
    exists: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }));
  jest.doMock('../../models/user-auth/AccountMemberModel.js', () => ({
    updateOne: jest.fn().mockResolvedValue({}),
    exists: jest.fn(),
  }));

  User = require('../../models/user-auth/userModel.js');
  AccountMember = require('../../models/user-auth/AccountMemberModel.js');
  Tokens = require('../../utils/Tokens.js');
});

describe('member tokens', () => {
  it('an access token names the member, and verifying it says so', async () => {
    const token = await Tokens.createAccessToken(OWNER, { memberId: MEMBER });
    const decoded = await Tokens.verifyAccessToken(token);
    expect(decoded).toMatchObject({ isvalid: true, tokenData: OWNER, memberId: MEMBER });
  });

  it("the owner's own tokens name no member", async () => {
    const decoded = await Tokens.verifyAccessToken(await Tokens.createAccessToken(OWNER));
    expect(decoded.memberId).toBeNull();
  });

  it("records a member's refresh token on the member, not the owner", async () => {
    await Tokens.createRefreshToken(OWNER, { memberId: MEMBER });
    expect(AccountMember.updateOne).toHaveBeenCalledWith({ _id: MEMBER }, expect.any(Object));
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("refreshes a live member session into a token that still names the member", async () => {
    const refresh = jwt.sign({ id: OWNER, type: 'refresh', mid: MEMBER }, process.env.JWT_SECRET);
    AccountMember.exists.mockResolvedValue({ _id: MEMBER });
    const access = await Tokens.refreshAccess(refresh);
    expect((await Tokens.verifyAccessToken(access)).memberId).toBe(MEMBER);
    expect(AccountMember.exists).toHaveBeenCalledWith({ _id: MEMBER, owner: OWNER, status: 'active', refreshTokens: refresh });
  });

  it("refuses to refresh once the member is removed", async () => {
    const refresh = jwt.sign({ id: OWNER, type: 'refresh', mid: MEMBER }, process.env.JWT_SECRET);
    AccountMember.exists.mockResolvedValue(null);
    expect(await Tokens.refreshAccess(refresh)).toBe(false);
    expect(await Tokens.getActiveRefreshTokenUser(refresh)).toBeNull();
  });
});
