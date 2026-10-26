/**
 * getLocation: which marketplace a request is about.
 *
 * Pages now name their marketplace per request (X-Marketplace) instead of relying on the one
 * session cookie. These pin the lookup order and — above all — that an explicit marketplace the
 * user doesn't own is refused rather than silently swapped for another one.
 */
const mockVerify = jest.fn();
const mockOwns = jest.fn();
const mockPrimary = jest.fn();
const mockFindById = jest.fn();

jest.mock('../../../utils/Tokens', () => ({ verifyLocationToken: (...a) => mockVerify(...a) }));
jest.mock('../../../utils/Logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../../utils/marketplaceAccess.js', () => ({
    ...jest.requireActual('../../../utils/marketplaceAccess.js'),
    ownsMarketplace: (...a) => mockOwns(...a),
    primaryMarketplace: (...a) => mockPrimary(...a),
}));
jest.mock('../../../models/user-auth/userModel.js', () => ({
    findById: (...a) => ({ select: () => ({ lean: () => mockFindById(...a) }) }),
}));

const { getLocation, getLocationOptional, getLocationCookieOnly } = require('../../../middlewares/Auth/getLocation.js');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (middleware, { cookies = {}, headers = {}, query = {}, method = 'GET', userId = 'u1' } = {}) => {
    const req = { cookies, headers, query, method, userId };
    const res = mockRes();
    const next = jest.fn();
    middleware(req, res, next);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    return { req, next, status: res.status.mock.calls[0]?.[0] };
};

beforeEach(() => {
    mockVerify.mockReset();
    mockOwns.mockReset();
    mockPrimary.mockReset();
    mockFindById.mockReset();
});

describe('getLocation — explicit marketplace', () => {
    test('an owned X-Marketplace header wins over the cookie', async () => {
        mockOwns.mockResolvedValue(true);
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });

        const { req, next } = await run(getLocation, { cookies: { IBEXLocationToken: 't' }, headers: { 'x-marketplace': 'uk:eu' } });

        expect(req.country).toBe('UK');
        expect(req.region).toBe('EU');
        expect(req.marketplaceSource).toBe('explicit');
        expect(next).toHaveBeenCalled();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    test('a marketplace the user does not own is refused, never swapped for the cookie', async () => {
        mockOwns.mockResolvedValue(false);
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });

        const { req, next, status } = await run(getLocation, { cookies: { IBEXLocationToken: 't' }, headers: { 'x-marketplace': 'DE:EU' } });

        expect(status).toBe(403);
        expect(next).not.toHaveBeenCalled();
        expect(req.country).toBeUndefined();
    });

    test('a malformed marketplace is a 400', async () => {
        const { status, next } = await run(getLocation, { headers: { 'x-marketplace': 'UK-EU' } });
        expect(status).toBe(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('?marketplace= works on a GET but is ignored on a POST', async () => {
        mockOwns.mockResolvedValue(true);
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });

        const get = await run(getLocation, { query: { marketplace: 'UK:EU' }, cookies: { IBEXLocationToken: 't' } });
        expect(get.req.country).toBe('UK');

        const post = await run(getLocation, { method: 'POST', query: { marketplace: 'UK:EU' }, cookies: { IBEXLocationToken: 't' } });
        expect(post.req.country).toBe('US');
        expect(post.req.marketplaceSource).toBe('cookie');
    });
});

describe('getLocation — fallbacks', () => {
    test('with no header the cookie is used exactly as before, with no database read', async () => {
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });

        const { req, next } = await run(getLocation, { cookies: { IBEXLocationToken: 't' } });

        expect(req.country).toBe('US');
        expect(next).toHaveBeenCalled();
        expect(mockFindById).not.toHaveBeenCalled();
        expect(mockOwns).not.toHaveBeenCalled();
    });

    test('an unreadable cookie is still a 400', async () => {
        mockVerify.mockResolvedValue(null);
        const { status } = await run(getLocation, { cookies: { IBEXLocationToken: 'bad' } });
        expect(status).toBe(400);
    });

    test('no header and no cookie: the saved preference, if still owned', async () => {
        mockFindById.mockResolvedValue({ preferredMarketplace: { country: 'UK', region: 'EU' } });
        mockOwns.mockResolvedValue(true);

        const { req } = await run(getLocation, {});

        expect(req.country).toBe('UK');
        expect(req.marketplaceSource).toBe('preference');
    });

    test('no header, no cookie, no usable preference: the primary marketplace', async () => {
        mockFindById.mockResolvedValue({ preferredMarketplace: { country: 'UK', region: 'EU' } });
        mockOwns.mockResolvedValue(false); // disconnected since
        mockPrimary.mockResolvedValue({ country: 'US', region: 'NA' });

        const { req } = await run(getLocation, {});

        expect(req.country).toBe('US');
        expect(req.marketplaceSource).toBe('primary');
    });

    test('nothing at all is still a 401', async () => {
        mockFindById.mockResolvedValue(null);
        mockPrimary.mockResolvedValue(null);
        const { status } = await run(getLocation, {});
        expect(status).toBe(401);
    });

    test('without auth (no userId) a header cannot be trusted', async () => {
        const { status } = await run(getLocation, { headers: { 'x-marketplace': 'UK:EU' }, userId: null });
        expect(status).toBe(403);
        expect(mockOwns).not.toHaveBeenCalled();
    });
});

describe('getLocationOptional / getLocationCookieOnly', () => {
    test('optional still refuses a marketplace the user does not own', async () => {
        mockOwns.mockResolvedValue(false);
        const { status, next } = await run(getLocationOptional, { headers: { 'x-marketplace': 'UK:EU' } });
        expect(status).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('optional lets a request with nothing through', async () => {
        mockFindById.mockResolvedValue(null);
        mockPrimary.mockResolvedValue(null);
        const { next, status, req } = await run(getLocationOptional, {});
        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
        expect(req.country).toBeUndefined();
    });

    test('cookie-only ignores the header entirely', async () => {
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });
        const { req } = await run(getLocationCookieOnly, { cookies: { IBEXLocationToken: 't' }, headers: { 'x-marketplace': 'UK:EU' } });
        expect(req.country).toBe('US');
        expect(mockOwns).not.toHaveBeenCalled();
    });
});
