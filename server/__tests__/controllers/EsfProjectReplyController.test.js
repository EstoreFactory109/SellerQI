/**
 * Replying to a Zoho task from the client Status page.
 *
 * Two properties carry the risk here and neither is about happy-path plumbing:
 *   1. A client can only write to a task in THEIR OWN linked project. Every write
 *      uses one org-wide admin token that can reach every project in the portal, so
 *      the project scoping in the lookup is the only thing standing between a
 *      guessed task id and another client's thread.
 *   2. The comment carries attribution. Zoho records the connected admin account as
 *      the author whatever we do, so without the prefix the agency cannot tell a
 *      client's words from their own staff's.
 */

const mockPostTaskComment = jest.fn();
const mockUploadTaskAttachment = jest.fn();
jest.mock('../../Services/Zoho/ZohoProjectsService.js', () => ({
    postTaskComment: mockPostTaskComment,
    uploadTaskAttachment: mockUploadTaskAttachment,
}));

const mockUserFindById = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: mockUserFindById }));

const mockTaskFindOne = jest.fn();
const mockTaskUpdateOne = jest.fn();
jest.mock('../../models/system/ZohoProjectTaskModel.js', () => ({
    findOne: mockTaskFindOne,
    updateOne: mockTaskUpdateOne,
}));

jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const fsp = require('fs/promises');
jest.mock('fs/promises', () => ({ unlink: jest.fn().mockResolvedValue(undefined), readFile: jest.fn() }));

// The controller turns each temp file into a Blob before uploading it; without this the
// blob step throws on the fake paths below and every upload "fails" for the wrong reason.
jest.mock('fs', () => ({ openAsBlob: jest.fn().mockResolvedValue({ size: 1, type: 'image/jpeg' }) }));

const { postEsfTaskReply, buildComment } = require('../../controllers/analytics/EsfProjectReplyController.js');

const CLIENT = { _id: 'u1', name: 'Dana Reyes', email: 'dana@acme.com', zohoProject: { projectId: 'proj-1' } };

const chain = (result) => ({ select: () => ({ lean: () => Promise.resolve(result) }) });

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/**
 * utils/AsyncHandler.js does not return its promise — it kicks off
 * `Promise.resolve(handler(...)).catch(next)` and returns undefined — so awaiting the
 * handler resolves immediately, before any of its awaits have run. Flush the queue
 * instead, or every assertion here races an unfinished controller.
 */
const run = async (req) => {
    const res = mockRes();
    const next = jest.fn();
    postEsfTaskReply(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    const failure = next.mock.calls[0]?.[0];
    if (failure) throw failure;

    return { res, status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

const baseReq = (over = {}) => ({
    userId: 'u1',
    params: { taskId: 'task-1' },
    body: { message: 'Photos are in the shared drive.' },
    files: [],
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindById.mockReturnValue(chain(CLIENT));
    mockTaskFindOne.mockReturnValue(chain({ taskId: 'task-1', name: 'Listing images' }));
    mockTaskUpdateOne.mockResolvedValue({});
    mockPostTaskComment.mockResolvedValue({ commentId: 'c-99' });
    mockUploadTaskAttachment.mockResolvedValue({ attachmentId: 'a-1' });
});

describe('authorization', () => {
    test('refuses a task that is not in the caller\'s project', async () => {
        // The lookup is scoped by the caller's own projectId, so another client's task
        // simply is not found — this is the guard, not a cosmetic 404.
        mockTaskFindOne.mockReturnValue(chain(null));

        const { status } = await run(baseReq({ params: { taskId: 'someone-elses-task' } }));

        expect(status).toBe(404);
        expect(mockPostTaskComment).not.toHaveBeenCalled();
    });

    test('scopes the task lookup by the caller\'s project, never by task id alone', async () => {
        await run(baseReq());

        expect(mockTaskFindOne).toHaveBeenCalledWith({ projectId: 'proj-1', taskId: 'task-1' });
    });

    test('refuses when the account has no linked project', async () => {
        mockUserFindById.mockReturnValue(chain({ _id: 'u1', zohoProject: null }));

        const { status } = await run(baseReq());

        expect(status).toBe(400);
        expect(mockPostTaskComment).not.toHaveBeenCalled();
    });
});

describe('attribution', () => {
    test('names the client and the portal in the comment body', () => {
        const comment = buildComment({ message: 'Here are the photos.', user: CLIENT, fileNames: [] });

        expect(comment).toContain('Dana Reyes');
        expect(comment).toContain('dana@acme.com');
        expect(comment).toContain('SellerQI portal');
        expect(comment).toContain('Here are the photos.');
    });

    test('still identifies the sender when only files are sent', () => {
        const comment = buildComment({ message: '', user: CLIENT, fileNames: ['front.jpg'] });

        expect(comment).toContain('Dana Reyes');
        expect(comment).toContain('front.jpg');
    });

    test('falls back to a generic label rather than leaving it unattributed', () => {
        expect(buildComment({ message: 'hi', user: null, fileNames: [] })).toContain('Client');
    });

    test('posts the attributed text, not the raw message', async () => {
        await run(baseReq());

        const { comment } = mockPostTaskComment.mock.calls[0][0];
        expect(comment).toContain('Dana Reyes');
        expect(comment).toContain('Photos are in the shared drive.');
    });
});

describe('validation', () => {
    test('rejects an empty reply with no files', async () => {
        const { status } = await run(baseReq({ body: { message: '   ' } }));

        expect(status).toBe(400);
        expect(mockPostTaskComment).not.toHaveBeenCalled();
    });

    test('rejects an oversized message', async () => {
        const { status } = await run(baseReq({ body: { message: 'x'.repeat(5001) } }));

        expect(status).toBe(400);
        expect(mockPostTaskComment).not.toHaveBeenCalled();
    });
});

describe('failure handling', () => {
    test('a failed comment fails the request — there is no half-sent reply', async () => {
        mockPostTaskComment.mockRejectedValue(new Error('401 INVALID_OAUTHSCOPE'));

        const { status } = await run(baseReq());

        expect(status).toBe(502);
        expect(mockTaskUpdateOne).not.toHaveBeenCalled();
    });

    test('one failed upload does not discard a reply already in the thread', async () => {
        mockUploadTaskAttachment
            .mockResolvedValueOnce({ attachmentId: 'a-1' })
            .mockRejectedValueOnce(new Error('413 too large'));

        const { status, body } = await run(baseReq({
            files: [
                { originalname: 'ok.jpg', path: '/tmp/a', size: 10, mimetype: 'image/jpeg' },
                { originalname: 'huge.mp4', path: '/tmp/b', size: 20, mimetype: 'video/mp4' },
            ],
        }));

        expect(status).toBe(200);
        expect(body.data.attachmentsSent).toEqual(['ok.jpg']);
        expect(body.data.attachmentsFailed).toEqual(['huge.mp4']);
        // Recorded either way, so the failure leaves a trace rather than vanishing.
        expect(mockTaskUpdateOne).toHaveBeenCalled();
    });

    test('temp files are removed even when the reply is rejected before sending', async () => {
        // Multer has already written these to disk by the time validation runs, so an
        // early return that skips cleanup leaks a file per rejected request.
        await run(baseReq({
            body: { message: '' },
            files: [{ originalname: 'a.jpg', path: '/tmp/leaked', size: 1, mimetype: 'image/jpeg' }],
        }));

        expect(fsp.unlink).toHaveBeenCalledWith('/tmp/leaked');
    });

    test('temp files are removed on the happy path too', async () => {
        await run(baseReq({
            files: [{ originalname: 'a.jpg', path: '/tmp/clean', size: 1, mimetype: 'image/jpeg' }],
        }));

        expect(fsp.unlink).toHaveBeenCalledWith('/tmp/clean');
    });
});

describe('recording the reply', () => {
    test('stores the client\'s own text and who sent it', async () => {
        await run(baseReq());

        const [filter, update] = mockTaskUpdateOne.mock.calls[0];
        expect(filter).toEqual({ projectId: 'proj-1', taskId: 'task-1' });

        const pushed = update.$push.clientResponses;
        expect(pushed.text).toBe('Photos are in the shared drive.');
        expect(pushed.zohoCommentId).toBe('c-99');
        expect(pushed.respondedByUserId).toBe('u1');
        expect(pushed.respondedByName).toBe('Dana Reyes');
    });

    test('appends rather than replacing, so earlier replies survive', async () => {
        await run(baseReq());

        // $set here would erase the history the page uses to show what was already sent.
        expect(mockTaskUpdateOne.mock.calls[0][1]).toHaveProperty('$push');
        expect(mockTaskUpdateOne.mock.calls[0][1]).not.toHaveProperty('$set');
    });
});
