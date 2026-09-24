/**
 * The staff task-request queue.
 *
 * The access block is the one that earns its place. esfPageGuard runs on /api/pagewise
 * and engages only inside an impersonated client session — it does nothing for
 * /app/esf routes. So without an explicit check in the controller, every staff member
 * reaches these handlers regardless of role, and accepting a request writes a real task
 * into the shared Zoho portal. Forgetting exactly this is the hole that existed on the
 * Billing API.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockFind = jest.fn();
const mockCount = jest.fn();
const mockFindByIdAndDelete = jest.fn();
const mockFindById = jest.fn();
jest.mock('../../../models/system/TaskRequestModel.js', () => ({
    find: (...a) => mockFind(...a),
    countDocuments: (...a) => mockCount(...a),
    findByIdAndDelete: (...a) => mockFindByIdAndDelete(...a),
    findById: (...a) => mockFindById(...a),
}));

const mockAccept = jest.fn();
const mockReject = jest.fn();
jest.mock('../../../Services/User/TaskRequestService.js', () => ({
    acceptTaskRequest: (...a) => mockAccept(...a),
    rejectTaskRequest: (...a) => mockReject(...a),
}));

const mockUserFind = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: (...a) => mockUserFind(...a) }));
const mockSellerFind = jest.fn();
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: (...a) => mockSellerFind(...a) }));

const {
    listTaskRequests, acceptTaskRequest, rejectTaskRequest, deleteTaskRequest,
} = require('../../../controllers/esf/esfTaskRequests.js');
const { ESF_ROLES } = require('../../../Services/User/esfRoles.js');

/** Everything about the client that must never appear in a response. */
const CLIENT_SECRETS = ['Nitesh', 'Kumar', 'walmart@morgansrepellent.com', '913-269-8400'];

const REQUEST = {
    _id: 'tr-1',
    userId: 'u1',
    title: 'Add a size chart',
    description: 'The mixing bowl listing needs one.',
    neededBy: new Date('2026-10-15T00:00:00Z'),
    attachments: [{ filenameRedacted: 'brief.pdf', mimeType: 'application/pdf', size: 10 }],
    status: 'pending',
    requestedAt: new Date('2026-09-24T09:00:00Z'),
};

const chain = (result) => ({
    select: function () { return this; },
    sort: function () { return this; },
    limit: function () { return this; },
    lean: () => Promise.resolve(result),
});

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const run = async (handler, req) => {
    const res = mockRes();
    handler(req, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

const staffReq = (esfUser, over = {}) => ({
    esfUserId: 'staff-1', esfUser, esfRole: esfUser?.esfRole, query: {}, params: {}, body: {}, ...over,
});

const admin = (over) => staffReq({ esfRole: ESF_ROLES.ADMIN }, over);
const member = (over) => staffReq({ esfRole: ESF_ROLES.MEMBER }, over);

beforeEach(() => {
    jest.clearAllMocks();
    mockFind.mockReturnValue(chain([REQUEST]));
    mockCount.mockResolvedValue(1);
    mockFindByIdAndDelete.mockReturnValue(chain({ _id: 'tr-1' }));
    mockAccept.mockResolvedValue({ ...REQUEST, status: 'accepted', zohoTaskId: 'z-9' });
    mockReject.mockResolvedValue({ ...REQUEST, status: 'rejected', rejectionReason: 'Already covered.' });
    mockUserFind.mockReturnValue(chain([{
        _id: 'u1',
        zohoProject: { projectId: 'p1', projectName: "Natural Environmental Solutions (Morgan's Repellent)" },
        esfClientRef: 'EF-1184',
        sellerCentral: 's1',
    }]));
    mockSellerFind.mockReturnValue(chain([{ _id: 's1', brand: 'Generic' }]));
});

describe('only owners and admins get near this queue', () => {
    test('a member cannot list requests', async () => {
        const { status } = await run(listTaskRequests, member());

        expect(status).toBe(403);
        expect(mockFind).not.toHaveBeenCalled();
    });

    test('a member cannot accept — which would write into the shared Zoho portal', async () => {
        const { status } = await run(acceptTaskRequest, member({ params: { requestId: 'tr-1' } }));

        expect(status).toBe(403);
        expect(mockAccept).not.toHaveBeenCalled();
    });

    test('…nor reject', async () => {
        expect((await run(rejectTaskRequest, member({ params: { requestId: 'tr-1' } }))).status).toBe(403);
        expect(mockReject).not.toHaveBeenCalled();
    });

    test('…nor delete', async () => {
        expect((await run(deleteTaskRequest, member({ params: { requestId: 'tr-1' } }))).status).toBe(403);
        expect(mockFindByIdAndDelete).not.toHaveBeenCalled();
    });

    test('a staff member with no role set is treated as a member', async () => {
        expect((await run(listTaskRequests, staffReq({}))).status).toBe(403);
    });

    test('an admin can', async () => {
        expect((await run(listTaskRequests, admin())).status).toBe(200);
    });

    test('a platform superAdmin can, since esfAuth admits them to service the portal', async () => {
        expect((await run(listTaskRequests, staffReq({ accessType: 'superAdmin' }))).status).toBe(200);
    });
});

describe('the client is named by project, never by person', () => {
    test('the queue carries the label and no identity', async () => {
        const { body } = await run(listTaskRequests, admin());

        expect(body.data.requests[0].client).toBe("Natural Environmental Solutions (Morgan's Repellent)");
        CLIENT_SECRETS.forEach((secret) => expect(JSON.stringify(body.data)).not.toContain(secret));
    });

    test('the identity query does not even load the name and email fields', async () => {
        // Not loading them is what stops them being serialised by accident.
        await run(listTaskRequests, admin());

        expect(mockUserFind).toHaveBeenCalledWith({ _id: { $in: ['u1'] } });
    });

    test('warns when a client has no linked project, before anyone clicks accept', async () => {
        // Otherwise the failure surfaces at the Zoho call, on a page that cannot fix it.
        mockUserFind.mockReturnValue(chain([{ _id: 'u1', esfClientRef: 'EF-1184', zohoProject: {} }]));

        const { body } = await run(listTaskRequests, admin());

        expect(body.data.requests[0].clientHasProject).toBe(false);
    });
});

describe('deciding', () => {
    test('accepting returns the Zoho task id', async () => {
        const { status, body } = await run(acceptTaskRequest, admin({ params: { requestId: 'tr-1' } }));

        expect(status).toBe(200);
        expect(body.data.zohoTaskId).toBe('z-9');
    });

    test('rejecting passes the reason through to the service', async () => {
        await run(rejectTaskRequest, admin({ params: { requestId: 'tr-1' }, body: { reason: 'Already covered.' } }));

        expect(mockReject.mock.calls[0][0].reason).toBe('Already covered.');
    });

    test('a 4xx from the service reaches the admin verbatim', async () => {
        // "This client is not linked to a Zoho project" tells them exactly what to fix.
        mockAccept.mockRejectedValue(
            Object.assign(new Error('This client is not linked to a Zoho project'), { statusCode: 409 })
        );

        const { status, body } = await run(acceptTaskRequest, admin({ params: { requestId: 'tr-1' } }));

        expect(status).toBe(409);
        expect(body.message).toMatch(/not linked to a Zoho project/);
    });

    test('a 5xx is not, since it describes our internals', async () => {
        mockAccept.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.4:27017'));

        const { status, body } = await run(acceptTaskRequest, admin({ params: { requestId: 'tr-1' } }));

        expect(status).toBe(500);
        expect(body.message).not.toMatch(/ECONNREFUSED/);
    });

    test('listing hides decided requests unless asked', async () => {
        await run(listTaskRequests, admin());
        expect(mockFind).toHaveBeenCalledWith({ status: 'pending' });

        jest.clearAllMocks();
        mockFind.mockReturnValue(chain([REQUEST]));
        mockCount.mockResolvedValue(1);
        mockUserFind.mockReturnValue(chain([]));
        mockSellerFind.mockReturnValue(chain([]));
        await run(listTaskRequests, admin({ query: { decided: 'true' } }));
        expect(mockFind).toHaveBeenCalledWith({});
    });
});
