/**
 * One session per browser.
 *
 * Every portal has its own cookie, and cookies are shared by every tab, so a
 * second login in another tab used to stack a second session on the first. These
 * pin the rule: while any valid session exists, the other portals' logins refuse.
 */

let resolveActiveSession;
let refuseIfOtherSession;
let verifyAccessToken;
let getActiveRefreshTokenUser;
let findById;

// token -> user id; user id -> accessType
const TOKENS = {
  'admin-token': 'admin-id',
  'esf-token': 'esf-id',
  'agency-token': 'agency-id',
  'seller-token': 'seller-id',
  'superadmin-admintoken': 'admin-id',
};
const ACCESS_TYPES = {
  'admin-id': 'superAdmin',
  'esf-id': 'esfUser',
  'agency-id': 'enterpriseAdmin',
  'seller-id': 'user',
};

beforeEach(() => {
  jest.resetModules();

  jest.doMock('../../../utils/Tokens.js', () => ({
    verifyAccessToken: jest.fn(),
    getActiveRefreshTokenUser: jest.fn(),
  }));
  jest.doMock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));

  ({ verifyAccessToken, getActiveRefreshTokenUser } = require('../../../utils/Tokens.js'));
  ({ findById } = require('../../../models/user-auth/userModel.js'));

  verifyAccessToken.mockImplementation(async (token) =>
    TOKENS[token] ? { isvalid: true, tokenData: TOKENS[token] } : { isvalid: false, tokenData: null }
  );
  getActiveRefreshTokenUser.mockResolvedValue(null);
  findById.mockImplementation((id) => ({
    select: () => ({ lean: async () => (ACCESS_TYPES[id] ? { accessType: ACCESS_TYPES[id] } : null) }),
  }));

  ({ resolveActiveSession } = require('../../../Services/User/activeSession.js'));
  ({ refuseIfOtherSession } = require('../../../middlewares/Auth/singleSession.js'));
});

describe('resolveActiveSession', () => {
  it('finds no session when there are no cookies', async () => {
    expect(await resolveActiveSession({})).toBeNull();
  });

  it('ignores an expired cookie rather than locking the login page', async () => {
    expect(await resolveActiveSession({ ESFToken: 'expired' })).toBeNull();
  });

  it('recognises each portal', async () => {
    expect((await resolveActiveSession({ SuperAdminToken: 'admin-token' })).kind).toBe('admin');
    expect((await resolveActiveSession({ ESFToken: 'esf-token' })).kind).toBe('esf');
    expect((await resolveActiveSession({ AdminToken: 'agency-token', IBEXAccessToken: 'seller-token' })).kind).toBe('agency');
    expect((await resolveActiveSession({ IBEXAccessToken: 'seller-token' })).kind).toBe('user');
  });

  it('counts a live refresh token as a seller session once the access token has expired', async () => {
    getActiveRefreshTokenUser.mockResolvedValue('seller-id');
    const session = await resolveActiveSession({ IBEXAccessToken: 'expired', IBEXRefreshToken: 'refresh' });
    expect(session.kind).toBe('user');
    expect(session.home).toBe('/analyse-account');
  });

  it('treats an admin impersonating a seller as an admin session, not a seller one', async () => {
    const session = await resolveActiveSession({ SuperAdminToken: 'admin-token', IBEXAccessToken: 'seller-token' });
    expect(session.kind).toBe('admin');
    expect(session.home).toBe('/manage-accounts');
  });

  it('treats ESF staff inside a client account as an ESF session', async () => {
    const session = await resolveActiveSession({ ESFToken: 'esf-token', IBEXAccessToken: 'seller-token' });
    expect(session.kind).toBe('esf');
    expect(session.home).toBe('/esf/clients');
    // ...and says a client account is open, so they can be sent back into it.
    expect(session.inAccount).toBe(true);
  });

  it('says no account is open for staff on the portal itself', async () => {
    const session = await resolveActiveSession({ ESFToken: 'esf-token' });
    expect(session.inAccount).toBe(false);
  });

  it("does not mistake a super admin's ordinary-login AdminToken for an agency", async () => {
    const session = await resolveActiveSession({ AdminToken: 'superadmin-admintoken', IBEXAccessToken: 'seller-token' });
    expect(session.kind).toBe('user');
  });

  it('does not let a seller token pass as an ESF session', async () => {
    expect(await resolveActiveSession({ ESFToken: 'seller-token' })).toBeNull();
  });
});

describe('refuseIfOtherSession', () => {
  const run = async (middleware, cookies) => {
    const req = { cookies, method: 'POST', originalUrl: '/app/esf/login' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    // asyncHandler does not return its promise, so wait for the handler to answer.
    await new Promise((resolve) => {
      next.mockImplementation(resolve);
      res.json.mockImplementation(() => { resolve(); return res; });
      middleware(req, res, next);
    });
    return { res, next };
  };

  it('lets a login through when nobody is signed in', async () => {
    const { next } = await run(refuseIfOtherSession('esf'), {});
    expect(next).toHaveBeenCalled();
  });

  it('refuses an ESF login while the admin portal is signed in', async () => {
    const { res, next } = await run(refuseIfOtherSession('esf'), { SuperAdminToken: 'admin-token' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activeSession: 'admin', home: '/manage-accounts' }) })
    );
  });

  it('refuses a seller login while the ESF portal is signed in', async () => {
    const { res } = await run(refuseIfOtherSession('user', 'agency'), { ESFToken: 'esf-token' });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('lets a portal replace its own session', async () => {
    const { next } = await run(refuseIfOtherSession('esf'), { ESFToken: 'esf-token' });
    expect(next).toHaveBeenCalled();
  });

  it('with no kinds allowed, refuses any session at all', async () => {
    const { res } = await run(refuseIfOtherSession(), { IBEXAccessToken: 'seller-token' });
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
