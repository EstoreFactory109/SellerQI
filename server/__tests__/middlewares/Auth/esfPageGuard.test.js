/**
 * ESF staff can be blocked from individual pages of a client's account. Hiding the
 * sidebar link is cosmetic; this middleware is what actually refuses the data.
 *
 * Sibling of memberPageGuard.test.js and deliberately the same shape. It exists
 * because the unit tests on `pageKeyForApiPath` cannot catch the failure that keeps
 * happening here: Billing, then Messages, then Reports each shipped with a perfectly
 * correct matcher and no mapping, so the helper returned null, the guard fell through
 * and the endpoint stayed open. Only a test that drives the GUARD proves a page is
 * closed.
 */
let esfPageGuard;
let verifyAccessToken;
let findById;

const STAFF = '64b000000000000000000001';
const CLIENT = '64b0000000000000000000aa';

/** Cookie values are opaque here — verifyAccessToken is mocked to interpret them. */
const ESF_COOKIE = 'esf-token';
const ACCESS_COOKIE = 'access-token';

beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../utils/Tokens.js', () => ({ verifyAccessToken: jest.fn() }));
    jest.doMock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
    jest.doMock('../../../utils/Logger.js', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

    ({ verifyAccessToken } = require('../../../utils/Tokens.js'));
    ({ findById } = require('../../../models/user-auth/userModel.js'));
    esfPageGuard = require('../../../middlewares/Auth/esfPageGuard.js');
});

/**
 * @param path        the request path, as Express would present it
 * @param deniedPages the staff member's blocklist
 * @param isEsfClient whether the account being VIEWED is an ESF client
 */
const run = ({
    path,
    deniedPages = [],
    isEsfClient = true,
    esfRole = 'member',
    accessType = 'esfUser',
    cookies = { ESFToken: ESF_COOKIE, IBEXAccessToken: ACCESS_COOKIE },
} = {}) => new Promise((resolve) => {
    verifyAccessToken.mockImplementation(async (token) => ({
        isvalid: true,
        tokenData: token === ESF_COOKIE ? STAFF : CLIENT,
    }));

    findById.mockImplementation((id) => ({
        select: async () => (id === STAFF
            ? { _id: STAFF, accessType, esfRole, esfDeniedPages: deniedPages, email: 'staff@esf.com' }
            : { _id: CLIENT, isEsfClient }),
    }));

    const req = { cookies, baseUrl: '', path, originalUrl: path };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ blocked: true, status: this.statusCode, body }); return this; },
    };
    esfPageGuard(req, res, () => resolve({ blocked: false }));
});

describe('esfPageGuard', () => {
    /**
     * The regression this whole file is for. Each of these was, at some point, a page
     * an admin could switch off in the UI while its data stayed readable by URL.
     */
    describe.each([
        ['billing', '/api/pagewise/esf/billing'],
        ['billing (invoice PDF)', '/api/pagewise/esf/billing/invoices/ESFI3635/pdf'],
        ['messages', '/api/pagewise/esf/messages'],
        ['reports', '/api/pagewise/esf/reports'],
        ['reports (rows)', '/api/pagewise/esf/reports/inventory-health/rows'],
        ['report-history', '/api/pagewise/esf/reports/inventory-health/history'],
    ])('%s', (label, path) => {
        const pageKey = label.startsWith('billing') ? 'billing'
            : label.startsWith('report-history') ? 'report-history'
                : label.startsWith('reports') ? 'reports' : 'messages';

        it('refuses the data when the staff member is denied that page', async () => {
            const result = await run({ path, deniedPages: [pageKey] });

            expect(result.blocked).toBe(true);
            expect(result.status).toBe(403);
        });

        it('serves it when they are not denied', async () => {
            expect((await run({ path, deniedPages: [] })).blocked).toBe(false);
        });
    });

    /**
     * Report History is its own page key, so denying one must not deny the other.
     * A prefix-only matcher collapses these two into 'reports' and gets both wrong:
     * denying report-history leaks the history, denying reports blocks too much.
     */
    describe('Reports and Report History are independently blockable', () => {
        const REPORTS = '/api/pagewise/esf/reports';
        const HISTORY = '/api/pagewise/esf/reports/inventory-health/history';

        it('denying Report History leaves Reports readable', async () => {
            expect((await run({ path: HISTORY, deniedPages: ['report-history'] })).blocked).toBe(true);
            expect((await run({ path: REPORTS, deniedPages: ['report-history'] })).blocked).toBe(false);
        });

        it('denying Reports leaves Report History readable', async () => {
            expect((await run({ path: REPORTS, deniedPages: ['reports'] })).blocked).toBe(true);
            expect((await run({ path: HISTORY, deniedPages: ['reports'] })).blocked).toBe(false);
        });
    });

    describe('who the guard does NOT apply to', () => {
        it('never restricts the ESF owner', async () => {
            const result = await run({
                path: '/api/pagewise/esf/reports',
                deniedPages: ['reports'],
                esfRole: 'owner',
            });
            expect(result.blocked).toBe(false);
        });

        it('does not engage on a non-ESF client account', async () => {
            // An agency client or self-serve seller must be untouched by an ESF blocklist.
            const result = await run({
                path: '/api/pagewise/esf/reports',
                deniedPages: ['reports'],
                isEsfClient: false,
            });
            expect(result.blocked).toBe(false);
        });

        it('falls through with no ESFToken — an ordinary session is not staff', async () => {
            const result = await run({
                path: '/api/pagewise/esf/reports',
                deniedPages: ['reports'],
                cookies: { IBEXAccessToken: ACCESS_COOKIE },
            });
            expect(result.blocked).toBe(false);
            expect(findById).not.toHaveBeenCalled();
        });

        it('falls through for a non-staff account type', async () => {
            const result = await run({
                path: '/api/pagewise/esf/reports',
                deniedPages: ['reports'],
                accessType: 'seller',
            });
            expect(result.blocked).toBe(false);
        });
    });

    describe('shared infrastructure is never blocked', () => {
        it.each([
            '/api/pagewise/navbar',
            '/api/pagewise/comparison-debug',
        ])('%s falls through without even loading the staff record', async (path) => {
            // Blocking these would break the entire app for that member rather than
            // one page — and the early return means no database round-trip either.
            const result = await run({ path, deniedPages: ['reports', 'messages', 'billing'] });

            expect(result.blocked).toBe(false);
            expect(findById).not.toHaveBeenCalled();
        });
    });
});
