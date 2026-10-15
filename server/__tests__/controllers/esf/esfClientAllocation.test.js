/**
 * Allocating clients to a member, and what a member then sees.
 *
 * The portal's rule used to be "every ESF staff member sees every ESF client". An admin
 * can now allocate, and a member sees only what they were given — including nothing,
 * which is where every member starts.
 *
 * What these pin is the boundary, not the plumbing: the list query a member gets, and
 * the refusal to store an allocation that would never be read.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockListManagedClients = jest.fn();
jest.mock('../../../Services/User/ManagedClientService.js', () => ({
    issueClientSession: jest.fn(),
    listManagedClients: (...a) => mockListManagedClients(...a),
    createManagedClient: jest.fn(),
    ESF_CLIENT_QUERY: { isEsfClient: true },
    agencyClientQuery: jest.fn(),
}));

const mockUserFind = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserAggregate = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({
    find: (...a) => mockUserFind(...a),
    findById: jest.fn(),
    // loadModifiableStaff resolves the target through findOne, not findById.
    findOne: (...a) => mockUserFindOne(...a),
    aggregate: (...a) => mockUserAggregate(...a),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
}));

const { getEsfClients, updateEsfUserClients } = require('../../../controllers/esf/esf.js');

const OWNER = { _id: 's1', accessType: 'esfUser', esfRole: 'owner' };
const ADMIN = { _id: 's2', accessType: 'esfUser', esfRole: 'admin' };
const MEMBER = (clients) => ({
    _id: 's3', accessType: 'esfUser', esfRole: 'member', esfAllowedClients: clients,
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

const listReq = (esfUser) => ({ esfUserId: esfUser._id, esfUser, esfRole: esfUser.esfRole, params: {}, body: {} });

beforeEach(() => {
    jest.clearAllMocks();
    mockListManagedClients.mockResolvedValue([]);
    mockUserFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });
});

describe('the clients list a member is given', () => {
    test('is narrowed to their allocation', async () => {
        await run(getEsfClients, listReq(MEMBER(['c1', 'c2'])));

        expect(mockListManagedClients).toHaveBeenCalledWith(
            { isEsfClient: true, _id: { $in: ['c1', 'c2'] } },
            expect.anything()
        );
    });

    test('is EMPTY when they have no allocation, not everything', async () => {
        /**
         * The fail-open case. Dropping the filter when there is nothing to filter by
         * turns "sees nothing" into "sees every client", and looks like a working
         * portal from the outside.
         */
        await run(getEsfClients, listReq(MEMBER([])));

        expect(mockListManagedClients).toHaveBeenCalledWith(
            { isEsfClient: true, _id: { $in: [] } },
            expect.anything()
        );
    });

    test.each([['owner', OWNER], ['admin', ADMIN]])('is unfiltered for %s', async (_l, staff) => {
        await run(getEsfClients, listReq(staff));

        expect(mockListManagedClients).toHaveBeenCalledWith(
            { isEsfClient: true },
            expect.anything()
        );
    });
});

describe('saving an allocation', () => {
    const OID = '507f1f77bcf86cd799439011';
    // A real ObjectId: loadModifiableStaff validates the id before it looks anything up.
    const MEMBER_ID = '507f1f77bcf86cd799439022';
    const target = (over = {}) => ({
        _id: MEMBER_ID, email: 'member@example.com', accessType: 'esfUser', esfRole: 'member',
        esfAllowedClients: [], save: jest.fn().mockResolvedValue(undefined), ...over,
    });

    const saveReq = (esfUser, clientIds, targetDoc) => {
        mockUserFindOne.mockResolvedValue(targetDoc);
        return {
            esfUserId: esfUser._id, esfUser, esfRole: esfUser.esfRole,
            params: { userId: MEMBER_ID }, body: { clientIds },
        };
    };

    test('stores only ids that are really ESF clients', async () => {
        const doc = target();
        // sanitizeClientIds validates against the database before storing.
        mockUserFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: OID }]) }) });

        await run(updateEsfUserClients, saveReq(OWNER, [OID, '507f1f77bcf86cd799439099'], doc));

        expect(doc.esfAllowedClients).toEqual([OID]);
        expect(doc.save).toHaveBeenCalled();
    });

    test('an empty array is a real instruction, saved as empty', async () => {
        // Unlike the page blocklist, [] here means "sees nothing" rather than "no
        // restriction", so it must be stored rather than treated as a no-op.
        const doc = target({ esfAllowedClients: [OID] });

        await run(updateEsfUserClients, saveReq(OWNER, [], doc));

        expect(doc.esfAllowedClients).toEqual([]);
        expect(doc.save).toHaveBeenCalled();
    });

    test('a member cannot allocate', async () => {
        const { status } = await run(updateEsfUserClients, saveReq(MEMBER(['c1']), [OID], target()));

        expect(status).toBe(403);
    });

    test('allocating to an admin is refused rather than silently stored', async () => {
        /**
         * They are exempt by role, so the list would never be read — and the team page
         * would then show a count beside someone who actually sees every client.
         */
        const doc = target({ esfRole: 'admin' });

        const { status, body } = await run(updateEsfUserClients, saveReq(OWNER, [OID], doc));

        expect(status).toBe(409);
        expect(body.message).toMatch(/already see every client/i);
        expect(doc.save).not.toHaveBeenCalled();
    });

    test('a non-array body is rejected', async () => {
        const { status } = await run(updateEsfUserClients, saveReq(OWNER, 'c1', target()));

        expect(status).toBe(400);
    });
});
