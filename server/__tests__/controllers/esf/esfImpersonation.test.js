/**
 * Opening a client account from the ESF portal.
 *
 * Impersonation mints a real client session, and inside it the client's OWN Settings
 * page shows their name, email and phone. A member may open the clients allocated to
 * them — that is the work they were assigned — and no other: opening an unallocated
 * client would expose every identity the Clients list redacts.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockIssueClientSession = jest.fn();
const mockListManagedClients = jest.fn();
jest.mock('../../../Services/User/ManagedClientService.js', () => ({
    issueClientSession: (...a) => mockIssueClientSession(...a),
    listManagedClients: (...a) => mockListManagedClients(...a),
    createManagedClient: jest.fn(),
    ESF_CLIENT_QUERY: { isEsfClient: true },
    agencyClientQuery: jest.fn(),
}));

const mockUserFindOne = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({
    findOne: (...a) => mockUserFindOne(...a),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
}));

const { switchToEsfClient } = require('../../../controllers/esf/esf.js');
const { ESF_ROLES } = require('../../../Services/User/esfRoles.js');

const CLIENT_ID = '507f1f77bcf86cd799439011';

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (handler, req) => {
    const res = mockRes();
    handler(req, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], res };
};

const request = (esfUser) => ({
    esfUserId: 'staff1',
    esfUser,
    esfRole: esfUser?.esfRole,
    body: { clientId: CLIENT_ID },
});

beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindOne.mockResolvedValue({ _id: CLIENT_ID, email: 'client@example.com', firstName: 'A', lastName: 'B' });
    mockIssueClientSession.mockResolvedValue({
        ok: true, accessToken: 'a', refreshToken: 'r', locationToken: 'l',
    });
});

const OTHER_CLIENT_ID = '507f1f77bcf86cd799439022';
const member = (allocated) => ({ accessType: 'esfUser', esfRole: ESF_ROLES.MEMBER, esfAllowedClients: allocated });

describe('a member can open only the clients allocated to them', () => {
    test('an allocated client opens', async () => {
        const { status, res } = await run(switchToEsfClient, request(member([CLIENT_ID])));

        expect(status).toBe(200);
        expect(mockIssueClientSession).toHaveBeenCalledWith(CLIENT_ID);
        expect(res.cookie).toHaveBeenCalled();
    });

    test('the lookup is the asked-for client AND the allocation, not the allocation alone', async () => {
        // The old spread replaced the asked-for _id with the allocation, so findOne
        // returned whichever allocated client came first.
        await run(switchToEsfClient, request(member([CLIENT_ID, OTHER_CLIENT_ID])));

        const query = mockUserFindOne.mock.calls[0][0];
        expect(query.$and).toEqual(expect.arrayContaining([
            expect.objectContaining({ _id: CLIENT_ID }),
            { _id: { $in: [CLIENT_ID, OTHER_CLIENT_ID] } },
        ]));
    });

    test('an unallocated client is refused, and no session or cookie is minted', async () => {
        const { status, res } = await run(switchToEsfClient, request(member([OTHER_CLIENT_ID])));

        expect(status).toBe(403);
        expect(mockIssueClientSession).not.toHaveBeenCalled();
        expect(res.cookie).not.toHaveBeenCalled();
    });

    test('a member with nothing allocated is refused', async () => {
        const { status } = await run(switchToEsfClient, request(member([])));

        expect(status).toBe(403);
    });

    test('a staff member with no role and no allocation is refused', async () => {
        // resolveEsfRole defaults to 'member', and the default has to be the closed one.
        const { status } = await run(switchToEsfClient, request({}));

        expect(status).toBe(403);
    });

    test('a refused attempt is logged, since it is a boundary someone tried to cross', async () => {
        const logger = require('../../../utils/Logger.js');

        await run(switchToEsfClient, request(member([])));

        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/unallocated client/i));
    });
});

describe('owner and admin open any client', () => {
    test.each([ESF_ROLES.OWNER, ESF_ROLES.ADMIN])('%s can open a client account', async (esfRole) => {
        const { status } = await run(switchToEsfClient, request({ esfRole }));

        expect(status).toBe(200);
        expect(mockIssueClientSession).toHaveBeenCalledWith(CLIENT_ID);
    });

    test('a platform superAdmin can, since esfAuth admits them to service the portal', async () => {
        const { status } = await run(switchToEsfClient, request({ accessType: 'superAdmin' }));

        expect(status).toBe(200);
    });
});
