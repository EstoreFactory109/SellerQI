/**
 * Who the ESF client pages will serve data to.
 *
 * This is the backstop behind the route guard in the client: the guard decides what
 * renders, this decides what is ANSWERED, and it is the one that actually matters.
 */

const mockFindById = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: (...a) => mockFindById(...a) }));

const esfClientOnly = require('../../middlewares/Auth/esfClientOnly.js');

const selectable = (doc) => ({ select: () => Promise.resolve(doc) });

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (req) => {
    const res = mockRes();
    const next = jest.fn();
    esfClientOnly(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0], next };
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('who is admitted', () => {
    test('an ESF client is', async () => {
        mockFindById.mockReturnValue(selectable({ isEsfClient: true }));

        const { next, status } = await run({ userId: 'u1' });

        expect(next).toHaveBeenCalled();
        expect(status).toBeUndefined();
    });

    test('an ordinary account is refused with a 403', async () => {
        mockFindById.mockReturnValue(selectable({ isEsfClient: false }));

        const { next, status, body } = await run({ userId: 'u1' });

        expect(next).not.toHaveBeenCalled();
        expect(status).toBe(403);
        expect(body.message).toMatch(/not available for this account/i);
    });

    test('a platform superAdmin gets NO exception', async () => {
        /**
         * It reads like a gap, so: req.userId is the account being VIEWED. Servicing a
         * real ESF client goes through the ESF switch, which mints a session as that
         * client — so the viewed account is an ESF client and is admitted above. The
         * superAdmin clause that used to be here only ever fired for an admin on their
         * OWN account, where these pages describe a relationship that does not exist.
         */
        mockFindById.mockReturnValue(selectable({ isEsfClient: false, accessType: 'superAdmin' }));

        const { next, status } = await run({ userId: 'u1' });

        expect(next).not.toHaveBeenCalled();
        expect(status).toBe(403);
    });

    test('a missing isEsfClient denies, rather than passing on undefined', async () => {
        // The field defaults to false on the model and is simply absent on older
        // accounts. `!== true` is what makes absent mean no.
        mockFindById.mockReturnValue(selectable({}));

        const { status } = await run({ userId: 'u1' });

        expect(status).toBe(403);
    });

    test('a truthy-but-wrong value does not get in', async () => {
        mockFindById.mockReturnValue(selectable({ isEsfClient: 'yes' }));

        const { status } = await run({ userId: 'u1' });

        expect(status).toBe(403);
    });
});

describe('before there is a session at all', () => {
    test('no userId is a 401, not a 403', async () => {
        const { status } = await run({});

        expect(status).toBe(401);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    test('a userId with no matching account is a 401', async () => {
        mockFindById.mockReturnValue(selectable(null));

        const { status } = await run({ userId: 'gone' });

        expect(status).toBe(401);
    });
});
