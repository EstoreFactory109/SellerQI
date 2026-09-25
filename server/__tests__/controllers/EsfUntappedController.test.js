/**
 * The Untapped endpoint.
 *
 * Two things are worth pinning here. The total must be summed from the same rows the
 * cards render — the page it replaced opened with a hardcoded figure that agreed with
 * nothing — and the three different kinds of "nothing" must stay distinguishable, since
 * collapsing them is what makes a working feature look broken.
 */

const mockUserFindById = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: (...a) => mockUserFindById(...a) }));

const mockUntappedFindOne = jest.fn();
jest.mock('../../models/system/EsfUntappedModel.js', () => ({ findOne: (...a) => mockUntappedFindOne(...a) }));

const { getEsfUntapped } = require('../../controllers/analytics/EsfUntappedController.js');

const USER_ID = 'u1';
const chain = (result) => ({
    select: function () { return this; },
    lean: () => Promise.resolve(result),
});

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (handler, req) => {
    const res = mockRes();
    handler(req, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

const clientReq = () => ({ userId: USER_ID, params: {}, body: {} });

const OPPORTUNITIES = [
    { taskId: 'c1', section: 'within', title: 'No A+ content', body: 'Nine ASINs.', amount: 2100, period: 'month', amountLabel: 'estimated upside', parsedBy: 'pattern' },
    { taskId: 'c2', section: 'off', title: 'No website', body: 'People search.', amount: 3600, period: 'month', amountLabel: 'estimated upside', parsedBy: 'pattern' },
    { taskId: 'c3', section: 'off', title: 'No social', body: 'Kitchen gear.', amount: 1100, period: 'month', amountLabel: 'estimated upside', parsedBy: 'pattern' },
];

beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindById.mockReturnValue(chain({ zohoProject: { projectId: 'p-1', projectName: 'Acme' } }));
    mockUntappedFindOne.mockReturnValue(chain({
        projectId: 'p-1', projectName: 'Acme', currencyCode: 'USD',
        opportunities: OPPORTUNITIES, syncedAt: new Date('2026-09-25T02:00:00Z'),
    }));
});

describe('the payload the page renders', () => {
    test('splits the opportunities into the two sections', async () => {
        const { body } = await run(getEsfUntapped, clientReq());

        expect(body.data.within.map((o) => o.id)).toEqual(['c1']);
        expect(body.data.off.map((o) => o.id)).toEqual(['c2', 'c3']);
    });

    test('the total is summed from the same rows, not stored separately', async () => {
        const { body } = await run(getEsfUntapped, clientReq());
        expect(body.data.totalAmount).toBe(6800);
    });

    test('an opportunity with no readable price contributes nothing to the total', async () => {
        // It still shows — the agency wrote the explanation — but it must not be
        // counted as zero-and-visible in a way that inflates or blanks the headline.
        mockUntappedFindOne.mockReturnValue(chain({
            projectId: 'p-1', currencyCode: 'USD', opportunities: [
                ...OPPORTUNITIES,
                { taskId: 'c4', section: 'off', title: 'Unpriced', body: 'Words.', amount: null, parsedBy: 'none' },
            ],
        }));

        const { body } = await run(getEsfUntapped, clientReq());

        expect(body.data.totalAmount).toBe(6800);
        expect(body.data.off.map((o) => o.id)).toContain('c4');
        expect(body.data.off.find((o) => o.id === 'c4').amount).toBeNull();
    });

    test('internal handles never reach the client', async () => {
        // taskId is our handle on the Zoho record and parsedBy is a diagnostic about
        // OUR parser — telling a client "we could not read this" reports our problem
        // as if it were theirs.
        const { body } = await run(getEsfUntapped, clientReq());
        const serialised = JSON.stringify(body.data);

        expect(serialised).not.toMatch(/parsedBy|parentTaskId|projectId/);
        expect(body.data.within[0]).not.toHaveProperty('section');
    });

    test('syncedAt is carried through so the page can say how fresh it is', async () => {
        const { body } = await run(getEsfUntapped, clientReq());
        expect(body.data.syncedAt).toEqual(new Date('2026-09-25T02:00:00Z'));
    });
});

describe('the three different kinds of nothing', () => {
    test('no linked project answers linked:false', async () => {
        mockUserFindById.mockReturnValue(chain({ zohoProject: null }));

        const { status, body } = await run(getEsfUntapped, clientReq());

        expect(status).toBe(200);
        expect(body.data.linked).toBe(false);
        expect(body.data.totalAmount).toBe(0);
    });

    test('linked but nothing published yet is linked:true with empty lists', async () => {
        // The distinction the page needs: "nothing here yet" versus "connect a project".
        mockUntappedFindOne.mockReturnValue(chain(null));

        const { body } = await run(getEsfUntapped, clientReq());

        expect(body.data.linked).toBe(true);
        expect(body.data.within).toEqual([]);
        expect(body.data.off).toEqual([]);
    });

    test('a database failure is a 500 that says nothing internal', async () => {
        mockUntappedFindOne.mockImplementation(() => { throw new Error('ECONNREFUSED 10.0.0.1:27017'); });

        const { status, body } = await run(getEsfUntapped, clientReq());

        expect(status).toBe(500);
        expect(body.message).not.toMatch(/ECONNREFUSED|27017/);
    });
});
