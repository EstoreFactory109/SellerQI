/**
 * Tests for the Gmail backlog diagnostic.
 *
 * WHY THIS EXISTS
 * The script's entire value is that its output describes production BEFORE anything
 * touched it. That is a claim about what it does NOT do, and a claim like that is worth
 * nothing unasserted — so the first block below drives every verdict class and proves no
 * write method was reached on any model.
 *
 * The second block pins the verdicts themselves, because the retry design is built on
 * them: `gone-from-gmail` means retire (the mail no longer exists, nothing is lost),
 * while `gmail-unavailable` means keep waiting. Confusing those two either abandons a
 * client's email or retries a dead id forever, which is the bug this was written to end.
 */

const mockExists = jest.fn();
const mockGetMessage = jest.fn();
const mockParseMessage = jest.fn();
const mockRouteMessage = jest.fn();
const mockResolveClient = jest.fn();

jest.mock('../../models/system/EmailThreadModels.js', () => ({
    EmailMessage: { exists: (...a) => mockExists(...a) },
    EmailThread: {},
}));
jest.mock('../../models/system/GmailConnectionModel.js', () => ({ SINGLETON_KEY: 'gmail_inbox' }));
jest.mock('../../models/user-auth/userModel.js', () => ({}));
jest.mock('../../Services/Gmail/GmailClient.js', () => ({ getMessage: (...a) => mockGetMessage(...a) }));
jest.mock('../../Services/Gmail/gmailMessageParser.js', () => ({ parseMessage: (...a) => mockParseMessage(...a) }));
jest.mock('../../Services/Gmail/inboundRouting.js', () => ({ routeMessage: (...a) => mockRouteMessage(...a) }));
jest.mock('../../Services/Gmail/GmailIngestService.js', () => ({ resolveClient: (...a) => mockResolveClient(...a) }));
jest.mock('../../Services/Gmail/config.js', () => ({ getCredentials: () => ({ inboxAddress: 'support@estorefactory.com' }) }));
jest.mock('../../config/config.js', () => ({ dbUri: 'mongodb://x', dbName: 'y' }));

const { classify, maskAddress, VERDICTS, backlogIds } = require('../../scripts/diagnoseGmailPendingBacklog.js');

const INBOX = { inboxAddress: 'support@estorefactory.com' };

/** A parsed message with everything the classifier reads. */
const parsed = (over = {}) => ({
    gmailThreadId: 'thread-1',
    rfc822MessageId: '<abc@x.com>',
    fromEmail: 'walmart@morgansrepellent.com',
    toEmails: ['support@estorefactory.com'],
    sentAt: new Date('2026-09-24T10:00:00Z'),
    labelIds: ['INBOX'],
    bodyText: 'hello',
    bodyHtml: null,
    attachments: [],
    originHeader: null,
    ...over,
});

const apiError = (statusCode, message = 'boom') => Object.assign(new Error(message), { statusCode });

beforeEach(() => {
    mockExists.mockResolvedValue(null);
    mockGetMessage.mockResolvedValue({ id: 'm1' });
    mockParseMessage.mockReturnValue(parsed());
    mockRouteMessage.mockReturnValue({ action: 'ingest', direction: 'inbound', lookup: [] });
    mockResolveClient.mockResolvedValue({ user: { _id: 'u1' } });
});

describe('every verdict class', () => {
    test('a message deleted from Gmail is gone-from-gmail, not a transient failure', async () => {
        // The distinction the retry bound depends on: 404 can never succeed, so retrying
        // it is pure waste. All 32 ids in the live backlog were this.
        mockGetMessage.mockRejectedValue(apiError(404, 'not found in Gmail'));

        const row = await classify('m1', INBOX);

        expect(row.verdict).toBe('gone-from-gmail');
        expect(row.httpStatus).toBe(404);
    });

    test.each([[500, 'server error'], [401, 'unauthorised'], [429, 'rate limited']])(
        'HTTP %i is gmail-unavailable — keep waiting',
        async (status) => {
            mockGetMessage.mockRejectedValue(apiError(status));
            expect((await classify('m1', INBOX)).verdict).toBe('gmail-unavailable');
        },
    );

    test('an error with no statusCode is treated as transient, not permanent', async () => {
        // Failing safe: an unrecognised failure must not retire a message that might be
        // a client's, so anything that is not a definite 404 keeps its place.
        mockGetMessage.mockRejectedValue(new Error('socket hang up'));
        expect((await classify('m1', INBOX)).verdict).toBe('gmail-unavailable');
    });

    test('a message already stored short-circuits before any Gmail call', async () => {
        mockExists.mockResolvedValue({ _id: 'x' });

        expect((await classify('m1', INBOX)).verdict).toBe('already-stored');
        expect(mockGetMessage).not.toHaveBeenCalled();
    });

    test('our own echo, matched by Message-ID, is echo-reconciled', async () => {
        mockExists.mockImplementation(async (q) => (q.rfc822MessageId ? { _id: 'ours' } : null));
        expect((await classify('m1', INBOX)).verdict).toBe('echo-reconciled');
    });

    test('a portal echo with no local copy is the genuine deferral case', async () => {
        mockRouteMessage.mockReturnValue({ action: 'skip', reason: 'portal-echo' });
        expect((await classify('m1', INBOX)).verdict).toBe('echo-no-local-copy');
    });

    test('any other skip reason is routing-skip', async () => {
        mockRouteMessage.mockReturnValue({ action: 'skip', reason: 'authentication-failed' });

        const row = await classify('m1', INBOX);
        expect(row.verdict).toBe('routing-skip');
        expect(row.reason).toBe('authentication-failed');
    });

    test('no linked client is unmatched-sender', async () => {
        mockResolveClient.mockResolvedValue(null);
        expect((await classify('m1', INBOX)).verdict).toBe('unmatched-sender');
    });

    test('a missing gmailThreadId is reported, never attempted', async () => {
        // EmailThread.gmailThreadId is required AND unique, so the upsert ingest would do
        // next throws forever. Attempting it here would be a write.
        mockParseMessage.mockReturnValue(parsed({ gmailThreadId: null }));
        expect((await classify('m1', INBOX)).verdict).toBe('would-throw-null-thread');
    });

    test('a parser failure is caught and named, not thrown out of the run', async () => {
        mockParseMessage.mockImplementation(() => { throw new Error('bad MIME'); });

        const row = await classify('m1', INBOX);
        expect(row.verdict).toBe('would-throw-parse');
        expect(row.reason).toBe('bad MIME');
    });

    test('a healthy message reports would-ingest', async () => {
        expect((await classify('m1', INBOX)).verdict).toBe('would-ingest');
    });

    test('every verdict the classifier can return has a documented drain action', async () => {
        // Otherwise the report tells an operator what happened and not what to do.
        const produced = ['gone-from-gmail', 'gmail-unavailable', 'already-stored',
            'echo-reconciled', 'echo-no-local-copy', 'routing-skip', 'unmatched-sender',
            'would-throw-null-thread', 'would-throw-parse', 'would-ingest'];
        produced.forEach((v) => expect(VERDICTS[v]).toBeTruthy());
    });
});

/**
 * The no-write property. Not a formality: the alternative design — a --dry-run flag
 * threaded through ingestMessage — would have put six write calls and an automated client
 * reply behind a boolean.
 */
describe('it cannot write', () => {
    const WRITE_METHODS = ['updateOne', 'updateMany', 'create', 'deleteOne', 'deleteMany',
        'findOneAndUpdate', 'bulkWrite', 'insertMany', 'save'];

    test('no model write method is called for any verdict', async () => {
        const models = [
            require('../../models/system/EmailThreadModels.js').EmailMessage,
            require('../../models/system/EmailThreadModels.js').EmailThread,
            require('../../models/user-auth/userModel.js'),
            require('../../models/system/GmailConnectionModel.js'),
        ];
        const spies = [];
        models.forEach((model) => {
            WRITE_METHODS.forEach((name) => {
                model[name] = jest.fn(() => { throw new Error(`${name} was called`); });
                spies.push(model[name]);
            });
        });

        // Drive every branch that reaches the end of the classifier.
        mockGetMessage.mockRejectedValueOnce(apiError(404));
        await classify('a', INBOX);
        mockRouteMessage.mockReturnValueOnce({ action: 'skip', reason: 'portal-echo' });
        await classify('b', INBOX);
        mockResolveClient.mockResolvedValueOnce(null);
        await classify('c', INBOX);
        await classify('d', INBOX);

        spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
});

describe('maskAddress', () => {
    test('hides the local part and most of the domain by default', () => {
        const masked = maskAddress('walmart@morgansrepellent.com');

        expect(masked).not.toContain('walmart');
        expect(masked).not.toContain('morgansrepellent');
        expect(masked).toBe('w***@m***.com');
    });

    test('survives a value that is not an address', () => {
        expect(maskAddress('')).toBe('');
        expect(maskAddress(null)).toBe('');
        expect(maskAddress('nonsense')).toBe('n***');
    });
});

/**
 * Which field the live backlog is actually in depends on whether runSync's migration
 * has run yet (GmailIngestService.loadBacklog adopts pendingMessageIds into
 * pendingMessages and clears the legacy field, in one write, on its first run after
 * this deploy). A diagnostic that only read the legacy field would report an empty
 * backlog forever, the moment that migration completed - the exact silent wrong
 * answer this whole script was built to avoid.
 */
describe('backlogIds — reading the backlog regardless of migration state', () => {
    test('reads the legacy field before the migration has run', () => {
        expect(backlogIds({ pendingMessageIds: ['a', 'b'], pendingMessages: [] })).toEqual(['a', 'b']);
    });

    test('reads the structured field after the migration has run', () => {
        expect(backlogIds({ pendingMessageIds: [], pendingMessages: [{ id: 'a' }, { id: 'b' }] }))
            .toEqual(['a', 'b']);
    });

    test('reads both at once, de-duplicated, during the window between syncs', () => {
        // A connection document read between deploy and the first sync completing.
        expect(backlogIds({ pendingMessageIds: ['a'], pendingMessages: [{ id: 'a' }, { id: 'c' }] }))
            .toEqual(['a', 'c']);
    });

    test('an entry with no id is dropped rather than reported as "undefined"', () => {
        expect(backlogIds({ pendingMessages: [{ attempts: 1 }], pendingMessageIds: [] })).toEqual([]);
    });

    test('survives a connection document written before either field existed', () => {
        expect(backlogIds({})).toEqual([]);
        expect(backlogIds(null)).toEqual([]);
    });
});
