/**
 * Opening a client account from the ESF portal.
 *
 * Impersonation mints a real client session, and inside it the client's OWN Settings
 * page shows their name, email and phone. So this endpoint is the open window next to
 * the locked door: redacting the Clients list means nothing while any staff member can
 * switch into any client and read every field directly, for every client, in two clicks.
 *
 * That is the whole test. The rest is making sure the gate did not also lock out the
 * people who need it.
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

describe('impersonation is closed to members', () => {
    test('a member cannot open a client account', async () => {
        const { status } = await run(switchToEsfClient, request({ esfRole: ESF_ROLES.MEMBER }));

        expect(status).toBe(403);
        expect(mockIssueClientSession).not.toHaveBeenCalled();
    });

    test('no session is minted, so no cookie can leak out', async () => {
        const { res } = await run(switchToEsfClient, request({ esfRole: ESF_ROLES.MEMBER }));

        expect(res.cookie).not.toHaveBeenCalled();
    });

    test('a staff member with no role set is refused', async () => {
        // resolveEsfRole defaults to 'member', and the default has to be the closed one.
        const { status } = await run(switchToEsfClient, request({}));

        expect(status).toBe(403);
    });

    test('the attempt is logged, since it is a boundary someone tried to cross', async () => {
        const logger = require('../../../utils/Logger.js');

        await run(switchToEsfClient, request({ esfRole: ESF_ROLES.MEMBER }));

        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/impersonate/i));
    });
});

describe('and still open to those who need it', () => {
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
