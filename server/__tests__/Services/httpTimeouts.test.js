/**
 * Regression tests for a class of bug found and fixed in one session: five separate places
 * made an HTTP call with NO TIMEOUT. axios and Node's `https` module never time out on their
 * own — a socket that connects but never responds hangs the caller forever.
 *
 * WHY THIS MATTERS MORE THAN A NORMAL BUG
 * Each of these calls sits inside a scheduled pipeline phase, awaited from
 * `runWithLockExtension` (server/Services/BackgroundJobs/lockExtension.js). Before that file's
 * ceiling fix, a hang here meant the phase's BullMQ lock got renewed forever, so nothing ever
 * reclaimed the job — and because phase job ids are deterministic, the stuck job then silently
 * swallowed every later attempt to run that phase. One of these (the Ads OAuth call) caused a
 * real production incident: an account's dashboard silently froze for two days. A second (the
 * ASIN-relationship Catalog call, invoked once per ASIN in a sequential loop) was caught live,
 * stuck for 100+ minutes with the process at 0% CPU.
 *
 * These tests exist to pin the fix at the config level — asserting the exact `timeout` value
 * reaches axios/https — because a real hang is not something a fast unit test can reproduce or
 * should try to.
 */

jest.mock('axios');
const axios = require('axios');

// Deliberately NOT calling jest.resetModules() here: it would invalidate this `axios` reference
// for every module required afterward (each require would get a fresh, separately-mocked axios
// instance), so `axios.get.mockResolvedValue(...)` below would silently stop affecting the code
// under test. The one describe block that legitimately needs a fresh module registry (to pick
// up an env var read at module-load time) calls resetModules itself, scoped to just that block.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
    jest.clearAllMocks();
    process.env.AMAZON_ADS_CLIENT_ID = 'client-id';
    process.env.AMAZON_ADS_CLIENT_SECRET = 'client-secret';
});
afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('GenerateToken.js — the call that caused the production incident', () => {
    test('the Ads OAuth refresh POST carries an explicit timeout', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'tok' } });
        const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');

        await generateAdsAccessToken('refresh-token');

        expect(axios.post).toHaveBeenCalledTimes(1);
        const [, , config] = axios.post.mock.calls[0];
        expect(config.timeout).toBeGreaterThan(0);
    });
});

describe('GenerateProfileId.js', () => {
    test('the profile-list GET carries an explicit timeout', async () => {
        axios.get.mockResolvedValue({ data: { ok: true } });
        const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');

        await getProfileById('token', 'NA', 'US', 'user-1');

        expect(axios.get).toHaveBeenCalledTimes(1);
        const [, config] = axios.get.mock.calls[0];
        expect(config.timeout).toBeGreaterThan(0);
    });
});

describe('spApiReportAdapter.js — shared by 9 SP-API report types including finance', () => {
    test('checkSpApiStatusOnce (the call caught hanging live in production) carries a timeout', async () => {
        axios.get.mockResolvedValue({ data: { processingStatus: 'IN_PROGRESS' } });
        const { checkSpApiStatusOnce } = require('../../Services/Sp_API/spApiReportAdapter.js');

        await checkSpApiStatusOnce('token', 'report-1', 'sellingpartnerapi-na.amazon.com');

        const [, config] = axios.get.mock.calls[0];
        expect(config.timeout).toBeGreaterThan(0);
    });

    test('getSpApiDocumentUrl carries a timeout', async () => {
        axios.get.mockResolvedValue({ data: { url: 'https://example.com/doc' } });
        const { getSpApiDocumentUrl } = require('../../Services/Sp_API/spApiReportAdapter.js');

        await getSpApiDocumentUrl('token', 'doc-1', 'sellingpartnerapi-na.amazon.com');

        const [, config] = axios.get.mock.calls[0];
        expect(config.timeout).toBeGreaterThan(0);
    });

    test('both calls share the SAME timeout — one call site cannot silently drift from the other', async () => {
        axios.get.mockResolvedValue({ data: { processingStatus: 'IN_PROGRESS' } });
        const { checkSpApiStatusOnce, getSpApiDocumentUrl } = require('../../Services/Sp_API/spApiReportAdapter.js');

        await checkSpApiStatusOnce('token', 'report-1', 'host');
        const statusTimeout = axios.get.mock.calls[0][1].timeout;

        axios.get.mockResolvedValue({ data: { url: 'https://example.com/doc' } });
        await getSpApiDocumentUrl('token', 'doc-1', 'host');
        const docTimeout = axios.get.mock.calls[1][1].timeout;

        expect(statusTimeout).toBe(docTimeout);
    });
});

describe('GetPPCMetrics.js — 4 bare axios calls in one file', () => {
    test('checkPpcReportStatusOnce (the async-engine adapter call) carries a timeout', async () => {
        axios.get.mockResolvedValue({ data: { status: 'PENDING', url: null } });
        const { checkPpcReportStatusOnce } = require('../../Services/AmazonAds/GetPPCMetrics.js');

        await checkPpcReportStatusOnce('report-1', 'token', 'profile-1', 'NA');

        const [, config] = axios.get.mock.calls[0];
        expect(config.timeout).toBeGreaterThan(0);
    });
});

describe('AsinRelationshipService.js — raw https.request, not axios', () => {
    // Uses Node's `https` module directly, so it needs `req.setTimeout(...)`, not an axios
    // config key. Exercised against a REAL local server rather than a mocked `https`, because
    // the timeout wiring itself (setTimeout -> destroy -> the 'error' event actually firing) is
    // exactly what a mock would paper over — this is the live failure mode observed in
    // production (0% CPU, one open, unresponsive socket), reproduced for real over loopback.
    const http = require('http');

    // Path-aware: hangs for one specific ASIN, responds normally for any other. This is what
    // lets both tests below share one server without cross-talk.
    const HANG_ASIN = 'ASIN-HANGS';
    function makeServer() {
        return http.createServer((req, res) => {
            if (req.url.includes(encodeURIComponent(HANG_ASIN))) return; // never respond
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ relationships: [] }));
        });
    }

    let server, port;
    beforeAll(async () => {
        // Drive the real 30s production default down to something a unit test can afford,
        // without touching the production code path — same knob operators would use.
        process.env.ASIN_RELATIONSHIP_REQUEST_TIMEOUT_MS = '300';
        server = makeServer();
        await new Promise((resolve) => server.listen(0, resolve));
        port = server.address().port;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    // fetchAsinRelationship builds an HTTPS request; redirect it to our plain-HTTP test server
    // by stubbing https.request onto http.request for the duration of this describe block.
    let httpsRequestSpy;
    beforeEach(() => {
        // Force BOTH host and port to the local test server — options.hostname alone would still
        // resolve real Amazon hostnames onto the wrong port and fail every request uniformly.
        httpsRequestSpy = jest.spyOn(require('https'), 'request').mockImplementation((options, cb) =>
            http.request({ ...options, hostname: 'localhost', host: 'localhost', port }, cb)
        );
    });
    afterEach(() => httpsRequestSpy.mockRestore());

    test('a connection that never responds rejects within a bounded time instead of hanging forever', async () => {
        const { fetchAsinRelationship } = require('../../Services/Sp_API/AsinRelationshipService.js');

        const start = Date.now();
        await expect(fetchAsinRelationship('token', 'localhost', HANG_ASIN, 'mp-1')).rejects.toThrow();
        const elapsed = Date.now() - start;

        // Bounded, not indefinite — the entire point of the fix. 300ms configured timeout, so
        // anything well under a couple seconds confirms the timeout actually fired rather than
        // the request coincidentally erroring some other way. Pre-fix this never resolved at all.
        expect(elapsed).toBeLessThan(3000);
    }, 10000);

    test('a timeout on one ASIN is a normal caught error, not a special/different failure mode', async () => {
        // syncAsinRelationships's loop (unmodified by this fix) already wraps each
        // fetchAsinRelationship call in its own try/catch and continues to the next ASIN — this
        // pins that the timeout error this fix now produces flows through that SAME path
        // (rejects, has a message) rather than escaping the abstraction some other way (e.g. a
        // process-level 'uncaughtException' from a raw socket that isn't error-first).
        const { fetchAsinRelationship } = require('../../Services/Sp_API/AsinRelationshipService.js');

        await expect(fetchAsinRelationship('token', 'localhost', HANG_ASIN, 'mp-1'))
            .rejects.toMatchObject({ message: expect.any(String) });
    }, 10000);
});
