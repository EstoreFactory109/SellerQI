/**
 * The project-status endpoint, which is what the client's Status AND Overview pages both
 * read — Overview has no fetch of its own.
 *
 * The thing pinned hardest here is `openMessageCount`. The Overview page read
 * `board.openMessageCount` from this payload, and this payload never carried it, so the
 * "Open tickets" card showed 0 for every client no matter how many conversations were open.
 * The field did exist, on /esf/client-dashboard — an endpoint nothing calls.
 *
 * Moving the page to that endpoint was the obvious-looking fix and the wrong one: its
 * payload has no task data at all, which is everything else Overview renders. So the count
 * comes here instead, and these tests exist so it cannot quietly go missing again.
 */

const mockUserFindById = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: (...a) => mockUserFindById(...a) }));

const mockThreadCount = jest.fn();
jest.mock('../../models/system/EmailThreadModels.js', () => ({
    EmailThread: { countDocuments: (...a) => mockThreadCount(...a) },
    EmailMessage: {},
}));

const mockTaskRequestFind = jest.fn();
jest.mock('../../models/system/TaskRequestModel.js', () => ({ find: (...a) => mockTaskRequestFind(...a) }));

const mockGetBoard = jest.fn();
jest.mock('../../Services/Calculations/EsfProjectStatusService.js', () => ({
    getProjectBoard: (...a) => mockGetBoard(...a),
}), { virtual: true });

const { getEsfProjectStatus } = require('../../controllers/analytics/EsfProjectStatusController.js');

const USER_ID = 'u1';

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

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async () => {
    const res = mockRes();
    getEsfProjectStatus({ userId: USER_ID, params: {}, query: {} }, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

beforeEach(() => {
    mockUserFindById.mockReturnValue(chain({ zohoProject: { projectId: null } }));
    mockThreadCount.mockResolvedValue(0);
    mockTaskRequestFind.mockReturnValue(chain([]));
});

describe('openMessageCount', () => {
    test('is on the payload when no project is linked', async () => {
        // A client with no project still has conversations — and this is the state four of
        // the five live ESF clients are in.
        mockThreadCount.mockResolvedValue(3);

        const { status, body } = await run();

        expect(status).toBe(200);
        expect(body.data.linked).toBe(false);
        expect(body.data.openMessageCount).toBe(3);
    });

    test('counts only unresolved threads, for this user', async () => {
        // The same count exists in GmailSendService and the staff messages controller. All
        // three must agree on "open means resolvedAt is null" or the client's badge and the
        // staff inbox disagree about the same conversation.
        await run();

        expect(mockThreadCount).toHaveBeenCalledWith({ userId: USER_ID, resolvedAt: null });
    });

    test('degrades to 0 rather than failing the route', async () => {
        // A stat card is not worth losing the task board over.
        mockThreadCount.mockRejectedValue(new Error('mongo is down'));

        const { status, body } = await run();

        expect(status).toBe(200);
        expect(body.data.openMessageCount).toBe(0);
        expect(body.data).toHaveProperty('taskRequests');
    });
});

describe('the no-project payload is still complete', () => {
    test('carries every field the Overview page reads', async () => {
        // Overview consumes linked, inProgress, waitingOnYou, completed, comingUp, syncedAt
        // and openMessageCount. Losing any one blanks a section with no error.
        const { body } = await run();

        ['linked', 'inProgress', 'waitingOnYou', 'completed', 'comingUp', 'syncedAt', 'openMessageCount']
            .forEach((field) => expect(body.data).toHaveProperty(field));
    });
});
