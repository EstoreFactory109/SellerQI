/**
 * A client asking for work, and the decision on it.
 *
 * Two orderings carry this suite, and both are the kind of thing that looks fine in
 * review and fails in production:
 *
 *   - the request email is sent BEFORE the row is written, because the email is the only
 *     place the client's documents will ever exist
 *   - the Zoho task is created from the RAW text, not the redacted copy, because
 *     redaction strips URLs and a task saying "update amazon.com/dp/B08…" would arrive
 *     without the one thing that makes it actionable
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockSendTaskRequestEmail = jest.fn();
jest.mock('../../../Services/Gmail/GmailSendService.js', () => ({
    sendTaskRequestEmail: (...a) => mockSendTaskRequestEmail(...a),
}));

const mockCreateTask = jest.fn();
const mockListTasklists = jest.fn();
const mockCreateTasklist = jest.fn();
jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
    createTask: (...a) => mockCreateTask(...a),
    listTasklists: (...a) => mockListTasklists(...a),
    createTasklist: (...a) => mockCreateTasklist(...a),
}));

/**
 * The tasklist router, stubbed to "no opinion" by default.
 *
 * Mocked rather than left to run: the real one degrades deterministically with no
 * OPENAPI_KEY, so leaving it live would quietly exercise the token fallback in every
 * unrelated accept test and make those depend on word overlap in their fixtures.
 */
const mockRoute = jest.fn();
jest.mock('../../../Services/AI/TasklistRouterService.js', () => ({
    route: (...a) => mockRoute(...a),
}));

const mockSyncProject = jest.fn();
jest.mock('../../../Services/Zoho/ZohoTaskSync.js', () => ({ syncProject: (...a) => mockSyncProject(...a) }));

const mockCreate = jest.fn();
const mockCount = jest.fn();
const mockFindById = jest.fn();
jest.mock('../../../models/system/TaskRequestModel.js', () => {
    const model = {
        create: (...a) => mockCreate(...a),
        countDocuments: (...a) => mockCount(...a),
        findById: (...a) => mockFindById(...a),
    };
    model.MAX_PENDING_REQUESTS = 10;
    return model;
});

const mockUserFindById = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: (...a) => mockUserFindById(...a) }));

const TaskRequestService = require('../../../Services/User/TaskRequestService.js');

const CLIENT = {
    _id: 'u1',
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '913-269-8400',
};

const chain = (result) => ({
    select: function () { return this; },
    lean: () => Promise.resolve(result),
});

const submit = (over = {}) => TaskRequestService.submitTaskRequest({
    user: CLIENT,
    title: 'Add a size chart',
    description: 'The mixing bowl listing needs a size chart.',
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCount.mockResolvedValue(0);
    mockSendTaskRequestEmail.mockResolvedValue({ gmailMessageId: 'gm-1' });
    mockCreate.mockImplementation(async (doc) => ({ ...doc, _id: 'tr-1' }));
    mockCreateTask.mockResolvedValue({ id: 'zoho-99' });
    mockListTasklists.mockResolvedValue([]);
    mockCreateTasklist.mockResolvedValue({ id: 'tl-new', name: 'New List' });
    mockRoute.mockResolvedValue({
        tasklistId: null, tasklistName: null, newTasklistName: null, chosenBy: 'none',
    });
    mockSyncProject.mockResolvedValue({});
    mockUserFindById.mockReturnValue(chain({
        zohoProject: { projectId: 'p1', projectName: 'Morgan Repellent', portalId: 'portal-1' },
    }));
});

describe('submitting', () => {
    test('emails the request before writing the row', async () => {
        // The email is the ONLY place the documents live — Zoho cannot accept them on
        // this portal. A row written first would, on a mail failure, show an admin a
        // request listing attachments nobody can open.
        const order = [];
        mockSendTaskRequestEmail.mockImplementation(async () => { order.push('email'); return { gmailMessageId: 'gm-1' }; });
        mockCreate.mockImplementation(async (doc) => { order.push('row'); return { ...doc, _id: 'tr-1' }; });

        await submit();

        expect(order).toEqual(['email', 'row']);
    });

    test('writes NO row when the email fails', async () => {
        mockSendTaskRequestEmail.mockRejectedValue(new Error('Gmail down'));

        await expect(submit()).rejects.toThrow();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('keeps the raw text for Zoho and a redacted copy for the portal', async () => {
        await submit({ description: 'This is Nitesh Kumar, call 913-269-8400 about the bowl' });

        const [doc] = mockCreate.mock.calls[0];
        expect(doc.descriptionRaw).toContain('Nitesh Kumar');
        expect(doc.description).not.toContain('Nitesh');
        expect(doc.description).not.toContain('913-269-8400');
    });

    test('redacts attachment filenames, which name the client too', async () => {
        await submit({ files: [{ originalname: 'Nitesh Kumar brief.pdf', mimetype: 'application/pdf', size: 10 }] });

        const [doc] = mockCreate.mock.calls[0];
        expect(doc.attachments[0].filenameRedacted).not.toContain('Nitesh');
        expect(doc.attachments[0].filenameRedacted).toContain('[name]');
    });

    test('stores metadata but never the bytes', async () => {
        await submit({ files: [{ originalname: 'a.pdf', mimetype: 'application/pdf', size: 4096 }] });

        const [doc] = mockCreate.mock.calls[0];
        expect(doc.attachments[0]).toMatchObject({ mimeType: 'application/pdf', size: 4096 });
        expect(doc.attachments[0]).not.toHaveProperty('content');
    });

    test('refuses a request with no description', async () => {
        await expect(submit({ description: '  ' })).rejects.toThrow(/more detail/);
        expect(mockSendTaskRequestEmail).not.toHaveBeenCalled();
    });

    test('refuses once too many are already awaiting a decision', async () => {
        mockCount.mockResolvedValue(10);

        await expect(submit()).rejects.toThrow(/already have 10 requests/);
        expect(mockSendTaskRequestEmail).not.toHaveBeenCalled();
    });
});

describe('accepting', () => {
    const pending = (over = {}) => ({
        _id: 'tr-1',
        userId: 'u1',
        status: 'pending',
        titleRaw: 'Add a size chart',
        descriptionRaw: 'Update this listing: amazon.com/dp/B08XYZ',
        neededBy: new Date('2026-10-15T00:00:00Z'),
        attachments: [],
        save: jest.fn().mockResolvedValue(undefined),
        ...over,
    });

    const accept = (doc) => {
        mockFindById.mockReturnValue({ select: () => Promise.resolve(doc) });
        return TaskRequestService.acceptTaskRequest({ requestId: 'tr-1', staffUserId: 'admin-1' });
    };

    test('creates the Zoho task from the RAW description, URLs intact', async () => {
        // Redaction strips every URL. Sending the redacted copy would hand the team a
        // task with the listing link removed — the one thing it needed.
        await accept(pending());

        expect(mockCreateTask.mock.calls[0][0].description).toContain('amazon.com/dp/B08XYZ');
    });

    test('attributes the task, since Zoho writes are all one shared account', async () => {
        await accept(pending());

        expect(mockCreateTask.mock.calls[0][0].description).toMatch(/Requested by the client/i);
    });

    test('carries the needed-by date, which decides the Status column', async () => {
        // classifyTask files a dateless task under "In progress" rather than "Coming up".
        await accept(pending());

        expect(mockCreateTask.mock.calls[0][0].endDate).toBe('2026-10-15');
    });

    test('says so when the files could not go with it', async () => {
        await accept(pending({ attachments: [{ filenameRedacted: 'a.pdf' }] }));

        expect(mockCreateTask.mock.calls[0][0].description).toMatch(/attached to the request email/i);
    });

    test('records the Zoho task id on the request', async () => {
        const doc = pending();
        await accept(doc);

        expect(doc.zohoTaskId).toBe('zoho-99');
        expect(doc.status).toBe('accepted');
        expect(doc.decidedBy).toBe('admin-1');
    });

    test('refuses a client with no linked project, before touching Zoho', async () => {
        mockUserFindById.mockReturnValue(chain({ zohoProject: {} }));

        await expect(accept(pending())).rejects.toThrow(/not linked to a Zoho project/);
        expect(mockCreateTask).not.toHaveBeenCalled();
    });

    test('refuses a request that was already decided', async () => {
        await expect(accept(pending({ status: 'accepted' }))).rejects.toThrow(/already accepted/);
        expect(mockCreateTask).not.toHaveBeenCalled();
    });

    test('does not wait for the follow-up sync', async () => {
        // A full project sync measured ~30s on the linked project. Awaiting it would
        // hold the admin's HTTP response open for that long.
        let released;
        mockSyncProject.mockReturnValue(new Promise((resolve) => { released = resolve; }));

        await accept(pending());

        expect(mockSyncProject).toHaveBeenCalled();
        released({});
    });

    test('a failed sync does not fail the accept', async () => {
        // The task exists in Zoho either way; the nightly run reconciles.
        mockSyncProject.mockRejectedValue(new Error('Zoho timeout'));

        await expect(accept(pending())).resolves.toMatchObject({ status: 'accepted' });
    });
});

describe('rejecting', () => {
    const pending = () => ({
        _id: 'tr-1', userId: 'u1', status: 'pending', save: jest.fn().mockResolvedValue(undefined),
    });

    const reject = (doc, reason) => {
        mockFindById.mockReturnValue(Promise.resolve(doc));
        return TaskRequestService.rejectTaskRequest({ requestId: 'tr-1', staffUserId: 'admin-1', reason });
    };

    test('records the reason the client will read', async () => {
        const doc = pending();
        await reject(doc, 'Already covered by an existing task.');

        expect(doc.rejectionReason).toBe('Already covered by an existing task.');
        expect(doc.status).toBe('rejected');
    });

    test('refuses a rejection with no reason', async () => {
        // A client told "no" with no explanation re-submits the same request.
        await expect(reject(pending(), '   ')).rejects.toThrow(/reason/);
    });
});

/** Local copies — the accept helpers above are scoped inside their own describe. */
const filingDoc = (over = {}) => ({
    _id: 'tr-1',
    userId: 'u1',
    status: 'pending',
    titleRaw: 'Add a size chart',
    descriptionRaw: 'The mixing bowl listing needs a size chart.',
    neededBy: null,
    attachments: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
});

const acceptFiling = () => {
    mockFindById.mockReturnValue({ select: () => Promise.resolve(filingDoc()) });
    return TaskRequestService.acceptTaskRequest({ requestId: 'tr-1', staffUserId: 'admin-1' });
};

describe('filing the new task under a tasklist', () => {
    const LISTS = [
        { id: 'tl-1', name: 'Seller Central Task' },
        { id: 'tl-2', name: 'Walmart' },
        { id: 'tl-3', name: 'Graphics' },
    ];

    beforeEach(() => {
        mockListTasklists.mockResolvedValue(LISTS);
        mockCreateTask.mockResolvedValue({ id: 'zoho-99', tasklistId: 'tl-2', tasklist: 'Walmart' });
    });

    test('a chosen list is sent to Zoho and recorded on the request', async () => {
        mockRoute.mockResolvedValue({
            tasklistId: 'tl-2', tasklistName: 'Walmart', newTasklistName: null, chosenBy: 'ai',
        });

        const doc = await acceptFiling();

        expect(mockCreateTask.mock.calls[0][0].tasklistId).toBe('tl-2');
        expect(doc.zohoTasklistId).toBe('tl-2');
        expect(doc.zohoTasklistName).toBe('Walmart');
        expect(doc.tasklistChosenBy).toBe('ai');
        expect(mockCreateTasklist).not.toHaveBeenCalled();
    });

    test('a proposed name that already exists reuses that list instead of creating a twin', async () => {
        // The likeliest way this clutters a project: two lists differing only in case.
        mockRoute.mockResolvedValue({
            tasklistId: null, tasklistName: null, newTasklistName: 'graphics', chosenBy: 'ai',
        });
        mockCreateTask.mockResolvedValue({ id: 'zoho-99', tasklistId: 'tl-3', tasklist: 'Graphics' });

        const doc = await acceptFiling();

        expect(mockCreateTasklist).not.toHaveBeenCalled();
        expect(mockCreateTask.mock.calls[0][0].tasklistId).toBe('tl-3');
        expect(doc.tasklistChosenBy).toBe('ai');
    });

    test('a genuinely new name creates the list and says so', async () => {
        mockRoute.mockResolvedValue({
            tasklistId: null, tasklistName: null, newTasklistName: 'Video Production', chosenBy: 'ai',
        });
        mockCreateTasklist.mockResolvedValue({ id: 'tl-9', name: 'Video Production' });
        mockCreateTask.mockResolvedValue({ id: 'zoho-99', tasklistId: 'tl-9', tasklist: 'Video Production' });

        const doc = await acceptFiling();

        expect(mockCreateTasklist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Video Production' }));
        expect(doc.tasklistChosenBy).toBe('created');
        expect(doc.zohoTasklistName).toBe('Video Production');
    });

    test('a cluttered project never gets another list', async () => {
        // 25 lists is already a navigation problem; one more per unusual request is how
        // it becomes unusable.
        mockListTasklists.mockResolvedValue(
            Array.from({ length: TaskRequestService.MAX_TASKLISTS_PER_PROJECT }, (_, i) => ({ id: `t${i}`, name: `List ${i}` }))
        );
        mockRoute.mockResolvedValue({
            tasklistId: null, tasklistName: null, newTasklistName: 'Another One', chosenBy: 'ai',
        });
        mockCreateTask.mockResolvedValue({ id: 'zoho-99' });

        const doc = await acceptFiling();

        expect(mockCreateTasklist).not.toHaveBeenCalled();
        expect(doc.zohoTaskId).toBe('zoho-99');
        expect(doc.tasklistChosenBy).toBe('none');
    });
});

describe('filing never blocks an approval', () => {
    test('a dead tasklists endpoint still creates the task, unfiled', async () => {
        // Filing is a nicety; approving the work is not. This is exactly the behaviour
        // that existed before tasklists were considered at all.
        mockListTasklists.mockRejectedValue(new Error('INVALID_OAUTHSCOPE'));
        mockCreateTask.mockResolvedValue({ id: 'zoho-99' });

        const doc = await acceptFiling();

        expect(doc.status).toBe('accepted');
        expect(doc.zohoTaskId).toBe('zoho-99');
        expect(mockCreateTask.mock.calls[0][0].tasklistId).toBeNull();
    });

    test('a failure to CREATE the list still creates the task', async () => {
        mockListTasklists.mockResolvedValue([{ id: 'tl-1', name: 'Graphics' }]);
        mockRoute.mockResolvedValue({
            tasklistId: null, tasklistName: null, newTasklistName: 'Video Production', chosenBy: 'ai',
        });
        mockCreateTasklist.mockRejectedValue(new Error('Zoho said no'));
        mockCreateTask.mockResolvedValue({ id: 'zoho-99' });

        const doc = await acceptFiling();

        expect(doc.status).toBe('accepted');
        expect(doc.tasklistChosenBy).toBe('none');
    });

    test('a router that throws still creates the task', async () => {
        mockListTasklists.mockResolvedValue([{ id: 'tl-1', name: 'Graphics' }]);
        mockRoute.mockRejectedValue(new Error('model exploded'));
        mockCreateTask.mockResolvedValue({ id: 'zoho-99' });

        const doc = await acceptFiling();

        expect(doc.status).toBe('accepted');
    });

    test('the record follows where the task LANDED, not what we asked for', async () => {
        /**
         * createTask replays without tasklist_id when Zoho refuses the field, so the
         * requested list and the actual one can differ. Recording the request would
         * claim a filing that never happened.
         */
        mockListTasklists.mockResolvedValue([{ id: 'tl-2', name: 'Walmart' }]);
        mockRoute.mockResolvedValue({
            tasklistId: 'tl-2', tasklistName: 'Walmart', newTasklistName: null, chosenBy: 'ai',
        });
        mockCreateTask.mockResolvedValue({ id: 'zoho-99', tasklistId: null, tasklist: null });

        const doc = await acceptFiling();

        expect(doc.zohoTasklistId).toBeNull();
        expect(doc.tasklistChosenBy).toBe('none');
    });
});
