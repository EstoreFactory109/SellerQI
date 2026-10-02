/**
 * POST /api/gmail/pending/requeue — putting a retired message back into the live backlog.
 *
 * WHY THIS ENDPOINT EXISTS
 * Retirement already keeps every id, attempt count and reason on deadLetterMessages — the
 * whole point of retiring rather than deleting. This is the one gap retirement alone
 * leaves: getting a message BACK when the retirement turns out to have been wrong.
 *
 * Deliberately no matching "drop" endpoint. Hand-removing an id from the live backlog is
 * the operation that risks losing a client's mail, and nothing here should make that
 * easier — these tests assert what the endpoint DOES do, not what it refuses to.
 */
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
jest.mock('../../models/system/GmailConnectionModel.js', () => ({
    SINGLETON_KEY: 'gmail_inbox',
    findOne: (...a) => mockFindOne(...a),
    updateOne: (...a) => mockUpdateOne(...a),
}));
jest.mock('../../Services/Gmail/config.js', () => ({
    getCredentials: () => ({ inboxAddress: 'support@estorefactory.com' }),
    getPubSubConfig: () => ({ topicName: null }),
    isMessagingEnabled: () => true,
    getPollMinutes: () => 10,
}));
jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { requeueGmailPending } = require('../../controllers/integration/GmailController.js');

const chain = (value) => ({ lean: async () => value });
const OWNER = { esfRole: 'owner', email: 'owner@esf.com' };
const MEMBER = { esfRole: 'member', email: 'staff@esf.com' };

const run = ({ esfUser = OWNER, body = {} } = {}) => new Promise((resolve) => {
    const req = { esfUserId: 'staff-1', esfUser, esfRole: esfUser.esfRole, body };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body2) { resolve({ status: this.statusCode, body: body2 }); return this; },
    };
    requeueGmailPending(req, res, () => resolve({ status: 500, body: null }));
});

beforeEach(() => {
    mockUpdateOne.mockResolvedValue({});
});

describe('access', () => {
    test('a member cannot requeue the shared inbox backlog', async () => {
        mockFindOne.mockReturnValue(chain({ deadLetterMessages: [{ id: 'm1' }] }));

        const { status } = await run({ esfUser: MEMBER, body: { ids: ['m1'] } });

        expect(status).toBe(403);
        expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    test('the owner can', async () => {
        mockFindOne.mockReturnValue(chain({ deadLetterMessages: [{ id: 'm1' }] }));

        const { status } = await run({ body: { ids: ['m1'] } });

        expect(status).toBe(200);
    });
});

describe('moving an entry back', () => {
    test('resets attempts and firstSeenAt, for a full fresh bounded cycle', async () => {
        mockFindOne.mockReturnValue(chain({
            pendingMessages: [],
            deadLetterMessages: [{ id: 'm1', attempts: 30, lastOutcome: 'throw', lastReason: 'boom' }],
        }));

        await run({ body: { ids: ['m1'] } });

        const [, update] = mockUpdateOne.mock.calls[0];
        const [moved] = update.$set.pendingMessages;
        expect(moved.attempts).toBe(0);
        expect(moved.firstSeenAt).toBeInstanceOf(Date);
        // The reason survives, for context — only the bound resets.
        expect(moved.lastReason).toBe('boom');
    });

    test('removes it from deadLetterMessages in the same write', async () => {
        mockFindOne.mockReturnValue(chain({
            pendingMessages: [],
            deadLetterMessages: [{ id: 'm1' }, { id: 'm2' }],
        }));

        await run({ body: { ids: ['m1'] } });

        const [, update] = mockUpdateOne.mock.calls[0];
        expect(update.$set.deadLetterMessages.map((e) => e.id)).toEqual(['m2']);
    });

    test('appends to an existing pending backlog rather than replacing it', async () => {
        mockFindOne.mockReturnValue(chain({
            pendingMessages: [{ id: 'already-retrying', attempts: 2 }],
            deadLetterMessages: [{ id: 'm1' }],
        }));

        await run({ body: { ids: ['m1'] } });

        const [, update] = mockUpdateOne.mock.calls[0];
        expect(update.$set.pendingMessages.map((e) => e.id).sort()).toEqual(['already-retrying', 'm1']);
    });

    test('requeues several ids in one call', async () => {
        mockFindOne.mockReturnValue(chain({
            pendingMessages: [],
            deadLetterMessages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        }));

        const { body } = await run({ body: { ids: ['a', 'c'] } });

        expect(body.data.requeued.sort()).toEqual(['a', 'c']);
    });
});

describe('ids that do not match a dead-lettered entry', () => {
    test('reports them as not found rather than inventing an entry', async () => {
        mockFindOne.mockReturnValue(chain({ pendingMessages: [], deadLetterMessages: [{ id: 'a' }] }));

        const { body } = await run({ body: { ids: ['a', 'never-retired'] } });

        expect(body.data.requeued).toEqual(['a']);
        expect(body.data.notFound).toEqual(['never-retired']);
    });

    test('an id already back in pendingMessages is reported not found, not duplicated', async () => {
        // It is not in deadLetterMessages any more, so there is nothing to move.
        mockFindOne.mockReturnValue(chain({
            pendingMessages: [{ id: 'already-active' }],
            deadLetterMessages: [],
        }));

        const { body } = await run({ body: { ids: ['already-active'] } });

        expect(body.data.requeued).toEqual([]);
        expect(body.data.notFound).toEqual(['already-active']);
        expect(mockUpdateOne).toHaveBeenCalled();
    });
});

describe('input validation', () => {
    test('rejects an empty ids array', async () => {
        const { status } = await run({ body: { ids: [] } });

        expect(status).toBe(400);
        expect(mockFindOne).not.toHaveBeenCalled();
    });

    test('rejects a missing ids field', async () => {
        const { status } = await run({ body: {} });
        expect(status).toBe(400);
    });

    test('de-duplicates a repeated id', async () => {
        mockFindOne.mockReturnValue(chain({ pendingMessages: [], deadLetterMessages: [{ id: 'm1' }] }));

        const { body } = await run({ body: { ids: ['m1', 'm1'] } });

        expect(body.data.requeued).toEqual(['m1']);
    });

    test('404s when there is no connection document at all', async () => {
        mockFindOne.mockReturnValue(chain(null));

        const { status } = await run({ body: { ids: ['m1'] } });

        expect(status).toBe(404);
    });
});

describe('no drop endpoint exists', () => {
    test('this module exports no function for removing a backlog entry outright', () => {
        const controller = require('../../controllers/integration/GmailController.js');
        const exported = Object.keys(controller).join(' ').toLowerCase();

        expect(exported).not.toMatch(/drop|delete|discard/);
    });
});
