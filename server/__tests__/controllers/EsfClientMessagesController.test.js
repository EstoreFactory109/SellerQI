/**
 * The client's own Messages page.
 *
 * This suite exists because its absence let a real bug reach production: every handler
 * read `req.user._id`, but `auth` attaches only `req.userId` — there is no `req.user`
 * anywhere on this stack. Each endpoint threw `Cannot read properties of undefined`
 * and returned a 500 that looked like a server fault rather than a wiring mistake.
 *
 * So the first block pins the contract with the middleware, which is the thing no
 * amount of testing the service layer underneath would have caught.
 */

jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockThreadFind = jest.fn();
const mockThreadFindOne = jest.fn();
const mockThreadUpdateOne = jest.fn();
const mockMessageFind = jest.fn();
jest.mock('../../models/system/EmailThreadModels.js', () => ({
    EmailThread: {
        find: (...a) => mockThreadFind(...a),
        findOne: (...a) => mockThreadFindOne(...a),
        updateOne: (...a) => mockThreadUpdateOne(...a),
    },
    EmailMessage: { find: (...a) => mockMessageFind(...a) },
}));

const mockUserFindById = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: (...a) => mockUserFindById(...a) }));

const mockInsertClientReply = jest.fn();
const mockStartClientTicket = jest.fn();
jest.mock('../../Services/Gmail/GmailSendService.js', () => ({
    insertClientReply: (...a) => mockInsertClientReply(...a),
    startClientTicket: (...a) => mockStartClientTicket(...a),
}));

const {
    getEsfMessages, getEsfMessageThread, postEsfMessageReply, postEsfNewTicket,
} = require('../../controllers/analytics/EsfClientMessagesController.js');

const USER_ID = 'u1';

const CLIENT = {
    _id: USER_ID,
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '913-269-8400',
};

const THREAD = {
    _id: 't1',
    userId: USER_ID,
    displaySubject: 'Walmart listings',
    lastMessageAt: new Date('2026-09-22T10:00:00Z'),
    lastMessageDirection: 'outbound',
    messageCount: 2,
    clientUnreadCount: 1,
    staffUnreadCount: 0,
    resolvedAt: null,
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

/** AsyncHandler does not return its promise — flush rather than await. */
const run = async (handler, req) => {
    const res = mockRes();
    handler(req, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

/** Shaped exactly as `auth` + `esfClientOnly` leave it: userId only, no user object. */
const clientReq = (over = {}) => ({
    userId: USER_ID,
    params: {},
    body: {},
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockThreadFind.mockReturnValue(chain([THREAD]));
    mockThreadFindOne.mockReturnValue(chain(THREAD));
    mockThreadUpdateOne.mockResolvedValue({});
    mockMessageFind.mockReturnValue(chain([]));
    mockUserFindById.mockReturnValue(chain(CLIENT));
    mockInsertClientReply.mockResolvedValue({ id: 'ins-1' });
    mockStartClientTicket.mockResolvedValue({ threadId: 't-new', subject: 'Listing issue' });
});

describe('the contract with the auth middleware', () => {
    /**
     * `auth` sets `req.userId` and nothing else. Reading `req.user` gives undefined, and
     * `.  _id` on it throws — which every one of these endpoints did in production.
     */
    test('listing works from req.userId alone', async () => {
        const { status } = await run(getEsfMessages, clientReq());

        expect(status).toBe(200);
        expect(mockThreadFind).toHaveBeenCalledWith({ userId: USER_ID });
    });

    test('opening a thread works from req.userId alone', async () => {
        const { status } = await run(getEsfMessageThread, clientReq({ params: { threadId: 't1' } }));

        expect(status).toBe(200);
    });

    test('replying works from req.userId alone', async () => {
        const { status } = await run(postEsfMessageReply, clientReq({
            params: { threadId: 't1' }, body: { body: 'any update?' },
        }));

        expect(status).toBe(201);
    });

    test('raising a ticket works from req.userId alone', async () => {
        const { status } = await run(postEsfNewTicket, clientReq({
            body: { subject: 'Listing issue', body: 'The title is wrong.' },
        }));

        expect(status).toBe(201);
    });
});

describe('scoping', () => {
    test('a thread is selected BY user, not merely checked afterwards', async () => {
        // A find-then-compare invites the refactor that drops the compare and visibly
        // changes nothing — until someone tries another client's thread id.
        await run(getEsfMessageThread, clientReq({ params: { threadId: 't1' } }));

        expect(mockThreadFindOne).toHaveBeenCalledWith({ _id: 't1', userId: USER_ID });
    });

    test('messages are scoped by user as well as by thread', async () => {
        await run(getEsfMessageThread, clientReq({ params: { threadId: 't1' } }));

        expect(mockMessageFind).toHaveBeenCalledWith({ threadId: 't1', userId: USER_ID });
    });

    test("another client's thread reads as not found, not as forbidden", async () => {
        // 404 rather than 403: telling them the thread exists but is not theirs
        // confirms it exists.
        mockThreadFindOne.mockReturnValue(chain(null));

        expect((await run(getEsfMessageThread, clientReq({ params: { threadId: 'other' } }))).status).toBe(404);
    });
});

describe('sending needs the full identity, not just the id', () => {
    /**
     * The redaction bundle is built from the client's own name, addresses and numbers.
     * Passing a bare id — or an empty object — would redact against an empty bundle,
     * and everything they typed about themselves would reach staff intact.
     */
    test('a reply is given the loaded client record', async () => {
        await run(postEsfMessageReply, clientReq({ params: { threadId: 't1' }, body: { body: 'x' } }));

        expect(mockInsertClientReply.mock.calls[0][0].user).toMatchObject({
            _id: USER_ID, firstName: 'Nitesh', phone: '913-269-8400',
        });
    });

    test('a ticket is given the loaded client record', async () => {
        await run(postEsfNewTicket, clientReq({ body: { subject: 's', body: 'b' } }));

        expect(mockStartClientTicket.mock.calls[0][0].user).toMatchObject({ _id: USER_ID, firstName: 'Nitesh' });
    });

    test('a deleted account is refused rather than sending with no bundle', async () => {
        mockUserFindById.mockReturnValue(chain(null));

        expect((await run(postEsfNewTicket, clientReq({ body: { subject: 's', body: 'b' } }))).status).toBe(401);
        expect(mockStartClientTicket).not.toHaveBeenCalled();
    });
});

describe('opening a thread', () => {
    test('clears the client unread count and not the staff one', async () => {
        // Two counters exist precisely so neither side marks the other's as read.
        await run(getEsfMessageThread, clientReq({ params: { threadId: 't1' } }));

        const [, update] = mockThreadUpdateOne.mock.calls[0];
        expect(update.$set.clientUnreadCount).toBe(0);
        expect(update.$set).not.toHaveProperty('staffUnreadCount');
    });
});

describe('errors the client can act on', () => {
    test('a 4xx from the service is passed through verbatim', async () => {
        // "You already have 10 open conversations" tells them what to do instead.
        mockStartClientTicket.mockRejectedValue(
            Object.assign(new Error('You already have 10 open conversations.'), { statusCode: 409 })
        );

        const { status, body } = await run(postEsfNewTicket, clientReq({ body: { subject: 's', body: 'b' } }));

        expect(status).toBe(409);
        expect(body.message).toMatch(/10 open conversations/);
    });

    test('a 5xx is not, since it describes our internals', async () => {
        mockStartClientTicket.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.4:27017'));

        const { status, body } = await run(postEsfNewTicket, clientReq({ body: { subject: 's', body: 'b' } }));

        expect(status).toBe(500);
        expect(body.message).not.toMatch(/ECONNREFUSED/);
    });
});
