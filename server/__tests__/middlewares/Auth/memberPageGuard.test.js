/**
 * A member of a seller account can be limited to some pages. The data for a
 * blocked page must be refused, not just its sidebar link hidden - and nobody
 * else (the owner, shared endpoints) may be affected.
 */
let memberPageGuard;
let verifyAccessToken;
let findOne;

const OWNER = '64b000000000000000000001';
const MEMBER = '64b0000000000000000000aa';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../utils/Tokens.js', () => ({ verifyAccessToken: jest.fn() }));
  jest.doMock('../../../models/user-auth/AccountMemberModel.js', () => ({ findOne: jest.fn() }));
  ({ verifyAccessToken } = require('../../../utils/Tokens.js'));
  ({ findOne } = require('../../../models/user-auth/AccountMemberModel.js'));
  memberPageGuard = require('../../../middlewares/Auth/memberPageGuard.js');

  findOne.mockReturnValue({ select: () => ({ lean: async () => ({ email: 'm@x.com', deniedPages: ['tasks'] }) }) });
});

const run = ({ path, memberId = MEMBER, cookie = 'access' }) => new Promise((resolve) => {
  verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: OWNER, memberId });
  const req = { cookies: cookie ? { IBEXAccessToken: cookie } : {}, baseUrl: '', path, originalUrl: path };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { resolve({ blocked: true, status: this.statusCode }); return this; },
  };
  memberPageGuard(req, res, () => resolve({ blocked: false }));
});

describe('memberPageGuard', () => {
  it('refuses the data of a page the member is blocked from', async () => {
    expect(await run({ path: '/api/pagewise/tasks' })).toEqual({ blocked: true, status: 403 });
  });

  it('lets through pages the member may open', async () => {
    expect((await run({ path: '/api/pagewise/dashboard' })).blocked).toBe(false);
  });

  it("never restricts the owner's own session", async () => {
    expect((await run({ path: '/api/pagewise/tasks', memberId: null })).blocked).toBe(false);
  });

  it('leaves shared endpoints alone', async () => {
    expect((await run({ path: '/api/pagewise/navbar' })).blocked).toBe(false);
    expect(findOne).not.toHaveBeenCalled();
  });
});
