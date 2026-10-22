/**
 * Which marketplace the onboarding connect page builds its Amazon consent URL for.
 *
 * The bug this guards: a US seller adding the UK was always given the FIRST marketplace
 * (US), so Seller Central / Ads consent opened for North America while the token was
 * saved against the UK.
 */

jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));

const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { getUserLocation } = require('../../../Services/User/UserLocationService.js');
const { getLoggedInUserLocation } = require('../../../controllers/user-auth/UserLocationController.js');
const { verifyLocationToken } = require('../../../utils/Tokens.js');

const sellerWith = (accounts) => {
  Seller.findOne.mockReturnValue({ sort: () => Promise.resolve({ sellerAccount: accounts }) });
};

const US = { country: 'US', region: 'NA' };
const UK = { country: 'UK', region: 'EU' };

describe('getUserLocation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('still returns the first marketplace when nothing is preferred', async () => {
    sellerWith([US, UK]);
    expect(await getUserLocation('u1')).toEqual(US);
  });

  it('returns the requested marketplace when the user has it', async () => {
    sellerWith([US, UK]);
    expect(await getUserLocation('u1', [{ country: 'uk', region: 'eu' }])).toEqual(UK);
  });

  it('tries preferences in order and skips ones the user does not have', async () => {
    sellerWith([US, UK]);
    const result = await getUserLocation('u1', [{ country: 'DE', region: 'EU' }, UK]);
    expect(result).toEqual(UK);
  });

  it('never returns a marketplace the user does not own', async () => {
    sellerWith([US]);
    expect(await getUserLocation('u1', [{ country: 'JP', region: 'FE' }])).toEqual(US);
  });

  it('ignores incomplete preferences', async () => {
    sellerWith([US, UK]);
    expect(await getUserLocation('u1', [{ country: 'UK' }, {}, null])).toEqual(US);
  });
});

describe('GET /app/user-location', () => {
  // asyncHandler does not return its promise, so wait for the response (or the error
  // it hands to next) rather than for the handler call.
  const run = (req) => new Promise((resolve, reject) => {
    const res = {
      cookies: {},
      cookie: jest.fn(function (name, value) { this.cookies[name] = value; return this; }),
      status: jest.fn(function (code) { this.statusCode = code; return this; }),
      json: jest.fn(function (body) { this.body = body; resolve(this); return this; }),
    };
    getLoggedInUserLocation({ userId: 'u1', query: {}, ...req }, res, reject);
  });

  beforeEach(() => jest.clearAllMocks());

  it('answers with the page marketplace and moves the session to it', async () => {
    sellerWith([US, UK]);
    const res = await run({ query: { country: 'UK', region: 'EU' }, country: 'US', region: 'NA' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(UK);
    // The token endpoints save to the cookie's marketplace, so it must follow.
    expect(await verifyLocationToken(res.cookies.IBEXLocationToken)).toMatchObject(UK);
  });

  it('falls back to the session marketplace and leaves the cookie alone', async () => {
    sellerWith([US, UK]);
    const res = await run({ country: 'UK', region: 'EU' });
    expect(res.body.data).toEqual(UK);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('does not move the session to a marketplace the user does not own', async () => {
    sellerWith([US]);
    const res = await run({ query: { country: 'JP', region: 'FE' }, country: 'US', region: 'NA' });
    expect(res.body.data).toEqual(US);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('is a 404 for a user with no marketplace yet', async () => {
    sellerWith([]);
    const res = await run({});
    expect(res.statusCode).toBe(404);
  });
});
