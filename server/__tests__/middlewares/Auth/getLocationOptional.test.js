/**
 * The marketplace cookie, made optional for routes that only wanted it as a cache key.
 *
 * WHY THIS EXISTS
 * `getLocation` answers 401 when the IBEXLocationToken cookie is missing. That is right for
 * a route whose data is marketplace-scoped, and wrong for the ESF reports routes, whose own
 * comment says the middleware is there only so analyseDataCache has something to key on.
 * The consequence was that Reports was the one client-facing ESF page that hard-failed for a
 * brand-new client — who has no marketplace yet, because createEsfClient never minted the
 * cookie.
 *
 * Deleting the middleware from those routes would have been simpler and worse: every client
 * would have lost a 10-minute cache over a fan-out that touches eight collections. So the
 * contract here is narrow and worth pinning: set the fields when they are knowable, never
 * answer, never throw.
 */

const mockVerify = jest.fn();
jest.mock('../../../utils/Tokens', () => ({ verifyLocationToken: (...a) => mockVerify(...a) }));
jest.mock('../../../utils/Logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const { getLocation, getLocationOptional } = require('../../../middlewares/Auth/getLocation.js');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (middleware, cookies) => {
    const req = { cookies };
    const res = mockRes();
    const next = jest.fn();
    middleware(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
    return { req, next, status: res.status.mock.calls[0]?.[0] };
};

describe('getLocationOptional', () => {
    test('sets the marketplace when the cookie is readable', async () => {
        mockVerify.mockResolvedValue({ country: 'US', region: 'NA' });

        const { req, next, status } = await run(getLocationOptional, { IBEXLocationToken: 'ok' });

        expect(req.country).toBe('US');
        expect(req.region).toBe('NA');
        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
    });

    test('passes through with no cookie at all — the whole point', async () => {
        // This is the brand-new client. Under getLocation this was a 401 and a dead page.
        const { req, next, status } = await run(getLocationOptional, {});

        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
        expect(req.country).toBeUndefined();
        expect(req.region).toBeUndefined();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    test('treats an unreadable cookie as an absent one, not a 400', async () => {
        // Failing on a bad cookie would reintroduce the outage this exists to prevent.
        mockVerify.mockResolvedValue(false);

        const { req, next, status } = await run(getLocationOptional, { IBEXLocationToken: 'rubbish' });

        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
        expect(req.country).toBeUndefined();
    });

    test('survives a request with no cookies object', async () => {
        const { next, status } = await run(getLocationOptional, undefined);

        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
    });
});

/**
 * The strict variant is unchanged and still guards every non-ESF route. Pinned here so a
 * future edit cannot quietly relax the one that is supposed to be strict.
 */
describe('getLocation is still strict', () => {
    test('401s with no cookie', async () => {
        const { next, status } = await run(getLocation, {});

        expect(status).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('400s on an unreadable cookie', async () => {
        mockVerify.mockResolvedValue(false);

        const { next, status } = await run(getLocation, { IBEXLocationToken: 'rubbish' });

        expect(status).toBe(400);
        expect(next).not.toHaveBeenCalled();
    });
});
