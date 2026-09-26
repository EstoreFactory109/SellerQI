/**
 * A member signed in to a seller account holds the owner's session, with tokens
 * that also name the member. Removing the member must end that session on the next
 * request, and the owner's own tokens (which name no member) must never be affected.
 */
let auth;
let verifyAccessToken;
let exists;

const OWNER = '64b000000000000000000001';
const MEMBER = '64b0000000000000000000aa';

beforeEach(() => {
  jest.resetModules();

  jest.doMock('../../../utils/Tokens', () => ({ verifyAccessToken: jest.fn() }));
  jest.doMock('../../../models/user-auth/AccountMemberModel.js', () => ({ exists: jest.fn() }));

  ({ verifyAccessToken } = require('../../../utils/Tokens'));
  ({ exists } = require('../../../models/user-auth/AccountMemberModel.js'));
  auth = require('../../../middlewares/Auth/auth.js');
});

const run = async ({ memberId = null } = {}) => {
  verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: OWNER, memberId });
  const req = { cookies: { IBEXAccessToken: 'access' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  // asyncHandler does not return its promise, so wait for the middleware to answer.
  await new Promise((resolve) => {
    next.mockImplementation(resolve);
    res.json.mockImplementation(() => { resolve(); return res; });
    auth(req, res, next);
  });
  return { req, res, next };
};

describe('auth — member sessions', () => {
  it("lets the owner's own token through without a member lookup", async () => {
    const { req, next } = await run();
    expect(next).toHaveBeenCalled();
    expect(req.memberId).toBeUndefined();
    expect(exists).not.toHaveBeenCalled();
  });

  it('marks the request as a member session while the member is active', async () => {
    exists.mockResolvedValue({ _id: MEMBER });
    const { req, next } = await run({ memberId: MEMBER });
    expect(next).toHaveBeenCalled();
    expect(req.memberId).toBe(MEMBER);
    expect(exists).toHaveBeenCalledWith({ _id: MEMBER, owner: OWNER, status: 'active' });
  });

  it('refuses the request once the member has been removed', async () => {
    exists.mockResolvedValue(null);
    const { res, next } = await run({ memberId: MEMBER });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
