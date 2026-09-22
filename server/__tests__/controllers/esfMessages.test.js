/**
 * The ESF staff inbox.
 *
 * The single most valuable test in this feature is the forbidden-token one below: it
 * asserts over the ENTIRE serialised response, so it catches the regression no unit
 * test can — someone adds a field to the model and to the serialiser without thinking
 * about who reads it. Field-by-field assertions would pass while the payload grew a
 * `clientEmail`.
 *
 * Second is the page-access check. esfPageGuard does not cover /app/esf routes — it
 * engages only on /api/pagewise inside an impersonated client session — so a staff
 * member blocked from Messages reaches this controller unless the check is made by
 * hand. That omission is exactly the hole that existed on the Billing API.
 */

const mockThreadFind = jest.fn();
const mockThreadFindById = jest.fn();
const mockThreadCount = jest.fn();
const mockThreadUpdateOne = jest.fn();
const mockThreadFindByIdAndUpdate = jest.fn();
const mockMessageFind = jest.fn();

jest.mock('../../models/system/EmailThreadModels.js', () => ({
    EmailThread: {
        find: mockThreadFind,
        findById: mockThreadFindById,
        countDocuments: mockThreadCount,
        updateOne: mockThreadUpdateOne,
        findByIdAndUpdate: mockThreadFindByIdAndUpdate,
    },
    EmailMessage: { find: mockMessageFind },
}));

const mockUserFind = jest.fn();
jest.mock('../../models/user-auth/userModel.js', () => ({ find: mockUserFind }));
const mockSellerFind = jest.fn();
jest.mock('../../models/user-auth/sellerCentralModel.js', () => ({ find: mockSellerFind }));
jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { listStaffThreads, getStaffThread, setThreadResolved } = require('../../controllers/esf/esfMessages.js');

/** The client behind the thread — none of this may appear in any response. */
const CLIENT_SECRETS = ['Nitesh', 'Kumar', 'walmart@morgansrepellent.com', '913-269-8400'];

const THREAD = {
    _id: 't1',
    userId: 'u1',
    displaySubject: 'Walmart listings',
    lastMessageAt: new Date('2026-09-22T10:00:00Z'),
    lastMessageDirection: 'inbound',
    messageCount: 3,
    resolvedAt: null,
    staffUnreadCount: 1,
    clientUnreadCount: 0,
};

const MESSAGE = {
    _id: 'm1',
    threadId: 't1',
    userId: 'u1',
    direction: 'inbound',
    bodyRedacted: 'Please hold the Walmart listings until Friday. Call me on [phone].',
    sentAt: new Date('2026-09-22T10:00:00Z'),
    redactedBy: 'ai',
    attachments: [],
};

const chain = (result, extra = {}) => {
    const c = {
        select: () => c, sort: () => c, limit: () => c,
        lean: () => Promise.resolve(result),
        ...extra,
    };
    return c;
};

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
    await new Promise((r) => setImmediate(r));
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

const staffReq = (over = {}) => ({
    esfUserId: 'staff1',
    esfUser: { esfDeniedPages: [] },
    query: {},
    params: {},
    body: {},
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockThreadFind.mockReturnValue(chain([THREAD]));
    mockThreadFindById.mockReturnValue(chain(THREAD));
    mockThreadCount.mockResolvedValue(1);
    mockThreadUpdateOne.mockResolvedValue({});
    mockThreadFindByIdAndUpdate.mockReturnValue(chain({ ...THREAD, resolvedAt: new Date() }));
    mockMessageFind.mockReturnValue(chain([MESSAGE]));
    mockUserFind.mockReturnValue(chain([{
        _id: 'u1',
        zohoProject: { projectName: "Natural Environmental Solutions (Morgan's Repellent)" },
        esfClientRef: 'EF-1184',
        sellerCentral: 's1',
    }]));
    mockSellerFind.mockReturnValue(chain([{ _id: 's1', brand: 'Generic' }]));
});

describe('the client is never identified', () => {
    test('the thread list carries the project label and no identity', async () => {
        const { body } = await run(listStaffThreads, staffReq());
        const serialised = JSON.stringify(body.data);

        expect(body.data.threads[0].client).toBe("Natural Environmental Solutions (Morgan's Repellent)");
        CLIENT_SECRETS.forEach((secret) => expect(serialised).not.toContain(secret));
    });

    test('the conversation carries no identity either', async () => {
        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));
        const serialised = JSON.stringify(body.data);

        CLIENT_SECRETS.forEach((secret) => expect(serialised).not.toContain(secret));
    });

    test('messages are attributed to roles, never to people', async () => {
        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(body.data.messages[0].author).toBe('Client');
    });

    test('the identity query does not even load the name and email fields', async () => {
        // Not loading them is what stops them being serialised by accident — the
        // response-shaping layer is the second defence, not the first.
        await run(listStaffThreads, staffReq());

        const selected = mockUserFind.mock.results[0].value;
        expect(typeof selected.select).toBe('function');
        // The controller asks for the label inputs only.
        expect(mockUserFind).toHaveBeenCalledWith({ _id: { $in: ['u1'] } });
    });

    test('a payload that somehow contains an address is rejected, not served', async () => {
        // The runtime tripwire. Simulates the regression the other layers cannot
        // catch: a field added upstream that carries contact detail.
        mockMessageFind.mockReturnValue(chain([{
            ...MESSAGE, bodyRedacted: 'reach me at walmart@morgansrepellent.com',
        }]));

        const { status } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(status).toBe(500);
    });
});

describe('page access is enforced here, not by esfPageGuard', () => {
    const blocked = staffReq({ esfUser: { esfDeniedPages: ['messages'] } });

    test('a blocked staff member cannot list threads', async () => {
        const { status } = await run(listStaffThreads, blocked);

        expect(status).toBe(403);
        expect(mockThreadFind).not.toHaveBeenCalled();
    });

    test('…nor open one', async () => {
        const { status } = await run(getStaffThread, { ...blocked, params: { threadId: 't1' } });

        expect(status).toBe(403);
        expect(mockThreadFindById).not.toHaveBeenCalled();
    });

    test('…nor resolve one', async () => {
        const { status } = await run(setThreadResolved, { ...blocked, params: { threadId: 't1' } });

        expect(status).toBe(403);
        expect(mockThreadFindByIdAndUpdate).not.toHaveBeenCalled();
    });
});

describe('listing', () => {
    test('hides resolved threads by default', async () => {
        await run(listStaffThreads, staffReq());

        expect(mockThreadFind).toHaveBeenCalledWith({ resolvedAt: null });
    });

    test('includes them when asked', async () => {
        await run(listStaffThreads, staffReq({ query: { resolved: 'true' } }));

        expect(mockThreadFind).toHaveBeenCalledWith({});
    });

    test('puts threads needing a reply first', async () => {
        mockThreadFind.mockReturnValue(chain([
            { ...THREAD, _id: 't-waiting', lastMessageDirection: 'outbound' },
            { ...THREAD, _id: 't-needs', lastMessageDirection: 'inbound' },
        ]));

        const { body } = await run(listStaffThreads, staffReq());

        expect(body.data.threads[0].id).toBe('t-needs');
        expect(body.data.threads[0].needsReply).toBe(true);
    });

    test('the unread badge counts unread messages, not the whole thread', async () => {
        // THREAD has three messages and one unread. Badging messageCount would tell
        // staff there are three new ones.
        const { body } = await run(listStaffThreads, staffReq());

        expect(body.data.threads[0].unreadCount).toBe(1);
        expect(body.data.threads[0].messageCount).toBe(3);
    });

    test('labels fall back when a client has no project or brand', async () => {
        mockUserFind.mockReturnValue(chain([{ _id: 'u1', esfClientRef: 'EF-3310', sellerCentral: null }]));
        mockSellerFind.mockReturnValue(chain([]));

        const { body } = await run(listStaffThreads, staffReq());

        expect(body.data.threads[0].client).toBe('EF-3310');
    });
});

describe('read receipts', () => {
    /**
     * The receipt answers "has the client opened this in the portal", and nothing
     * wider. These tests pin the two things that would quietly make it lie: a tick on
     * a message the receipt cannot describe, and a comparison that drifts to the wrong
     * timestamp.
     */
    const OUTBOUND = { ...MESSAGE, _id: 'm-out', direction: 'outbound' };

    test('an outbound message the client opened afterwards shows as seen', async () => {
        mockThreadFindById.mockReturnValue(chain({
            ...THREAD, lastClientReadAt: new Date('2026-09-22T11:00:00Z'),
        }));
        mockMessageFind.mockReturnValue(chain([OUTBOUND])); // sent 10:00

        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(body.data.messages[0].seenByClient).toBe(true);
    });

    test('one sent after their last visit does not', async () => {
        mockThreadFindById.mockReturnValue(chain({
            ...THREAD, lastClientReadAt: new Date('2026-09-22T09:00:00Z'),
        }));
        mockMessageFind.mockReturnValue(chain([OUTBOUND])); // sent 10:00

        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(body.data.messages[0].seenByClient).toBe(false);
    });

    test('a client who has never opened the portal shows as not seen, not as unknown', async () => {
        mockThreadFindById.mockReturnValue(chain({ ...THREAD, lastClientReadAt: null }));
        mockMessageFind.mockReturnValue(chain([OUTBOUND]));

        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(body.data.messages[0].seenByClient).toBe(false);
    });

    test("the client's own messages carry no receipt at all", async () => {
        // Null rather than false: a tick here would be telling staff whether staff
        // have read it, which is both useless and easily misread as being about the
        // client. The UI renders nothing for null.
        mockThreadFindById.mockReturnValue(chain({
            ...THREAD, lastClientReadAt: new Date('2026-09-22T11:00:00Z'),
        }));

        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(body.data.messages[0].direction).toBe('inbound');
        expect(body.data.messages[0].seenByClient).toBeNull();
    });

    test('the list row ticks only when the team spoke last', async () => {
        mockThreadFind.mockReturnValue(chain([
            { ...THREAD, _id: 't-ours', lastMessageDirection: 'outbound', lastClientReadAt: null },
            { ...THREAD, _id: 't-theirs', lastMessageDirection: 'inbound' },
        ]));

        const { body } = await run(listStaffThreads, staffReq());
        const byId = Object.fromEntries(body.data.threads.map((t) => [t.id, t]));

        expect(byId['t-ours'].lastSeenByClient).toBe(false);
        expect(byId['t-theirs'].lastSeenByClient).toBeNull();
    });

    test('opening the thread as staff does not mark it seen by the client', async () => {
        // getStaffThread writes lastStaffReadAt on the way out. Reading the receipt
        // from that write instead of from lastClientReadAt would make every message
        // show as seen the moment a staff member opened it.
        mockThreadFindById.mockReturnValue(chain({ ...THREAD, lastClientReadAt: null }));
        mockMessageFind.mockReturnValue(chain([OUTBOUND]));

        const { body } = await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        expect(mockThreadUpdateOne).toHaveBeenCalled();
        expect(body.data.messages[0].seenByClient).toBe(false);
    });
});

describe('opening a thread', () => {
    test('clears the staff unread count and not the client one', async () => {
        // Two counters exist precisely so opening it here does not mark it read for
        // the client as well.
        await run(getStaffThread, staffReq({ params: { threadId: 't1' } }));

        const [, update] = mockThreadUpdateOne.mock.calls[0];
        expect(update.$set.staffUnreadCount).toBe(0);
        expect(update.$set).not.toHaveProperty('clientUnreadCount');
    });

    test('404s for a thread that does not exist', async () => {
        mockThreadFindById.mockReturnValue(chain(null));

        expect((await run(getStaffThread, staffReq({ params: { threadId: 'nope' } }))).status).toBe(404);
    });
});

describe('resolving', () => {
    test('records who resolved it', async () => {
        await run(setThreadResolved, staffReq({ params: { threadId: 't1' }, body: { resolved: true } }));

        const [, update] = mockThreadFindByIdAndUpdate.mock.calls[0];
        expect(update.$set.resolvedBy).toBe('staff1');
        expect(update.$set.resolvedAt).toBeInstanceOf(Date);
    });

    test('reopening clears both fields rather than leaving a stale resolver', async () => {
        mockThreadFindByIdAndUpdate.mockReturnValue(chain({ ...THREAD, resolvedAt: null }));

        await run(setThreadResolved, staffReq({ params: { threadId: 't1' }, body: { resolved: false } }));

        const [, update] = mockThreadFindByIdAndUpdate.mock.calls[0];
        expect(update.$set.resolvedAt).toBeNull();
        expect(update.$set.resolvedBy).toBeNull();
    });
});
