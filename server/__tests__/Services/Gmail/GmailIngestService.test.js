/**
 * Gmail into the conversation record.
 *
 * The cursor tests are the ones that matter. `history.list` only moves forward, so a
 * cursor advanced past a message that was never ingested does not make that message
 * late — it makes it permanently absent from the portal while sitting intact in Gmail,
 * where nobody will think to look. Every other bug here is visible; that one is not.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockGetMessage = jest.fn();
const mockListHistory = jest.fn();
jest.mock('../../../Services/Gmail/GmailClient.js', () => ({
    getMessage: (...a) => mockGetMessage(...a),
    listHistory: (...a) => mockListHistory(...a),
}));

const mockRedactBody = jest.fn();
jest.mock('../../../Services/AI/EmailRedactionService.js', () => ({ redactBody: (...a) => mockRedactBody(...a) }));

const mockConnFindOne = jest.fn();
const mockConnUpdateOne = jest.fn();
jest.mock('../../../models/system/GmailConnectionModel.js', () => {
    const m = {
        findOne: (...a) => mockConnFindOne(...a),
        updateOne: (...a) => mockConnUpdateOne(...a),
    };
    m.SINGLETON_KEY = 'gmail_inbox';
    return m;
});

const mockThreadFindOne = jest.fn();
const mockThreadFindOneAndUpdate = jest.fn();
const mockThreadFindById = jest.fn();
const mockThreadUpdateOne = jest.fn();
const mockMsgExists = jest.fn();
const mockMsgUpdateOne = jest.fn();
const mockMsgFind = jest.fn();
const mockMsgCount = jest.fn();
jest.mock('../../../models/system/EmailThreadModels.js', () => ({
    EmailThread: {
        findOne: (...a) => mockThreadFindOne(...a),
        findOneAndUpdate: (...a) => mockThreadFindOneAndUpdate(...a),
        findById: (...a) => mockThreadFindById(...a),
        updateOne: (...a) => mockThreadUpdateOne(...a),
    },
    EmailMessage: {
        exists: (...a) => mockMsgExists(...a),
        updateOne: (...a) => mockMsgUpdateOne(...a),
        find: (...a) => mockMsgFind(...a),
        countDocuments: (...a) => mockMsgCount(...a),
    },
}));

const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({
    findOne: (...a) => mockUserFindOne(...a),
    findById: (...a) => mockUserFindById(...a),
}));

const GmailIngest = require('../../../Services/Gmail/GmailIngestService.js');

const INBOX = 'hello@estorefactory.com';
const CLIENT = {
    _id: 'u1',
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '+1-913-269-8400',
    isEsfClient: true,
};

const b64 = (t) => Buffer.from(t, 'utf8').toString('base64url');

/** A chainable mongoose query stub. */
const chain = (result) => ({
    select: function () { return this; },
    sort: function () { return this; },
    limit: function () { return this; },
    lean: () => Promise.resolve(result),
});

const gmailMessage = (over = {}) => ({
    id: over.id || 'msg-1',
    threadId: 'thread-1',
    labelIds: over.labelIds || ['INBOX'],
    internalDate: '1758537600000',
    payload: {
        headers: [
            { name: 'From', value: over.from || 'walmart@morgansrepellent.com' },
            { name: 'To', value: over.to || INBOX },
            { name: 'Subject', value: 'Re: Walmart listings' },
            { name: 'Date', value: 'Mon, 22 Sep 2026 10:00:00 +0000' },
            { name: 'Message-ID', value: '<abc@x.com>' },
            { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass; spf=pass' },
        ],
        parts: [{ mimeType: 'text/plain', body: { data: b64('Please hold the listings.') } }],
    },
});

beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_INBOX_ADDRESS = INBOX;
    process.env.GMAIL_MESSAGING_ENABLED = 'true';

    mockMsgExists.mockResolvedValue(null);
    mockGetMessage.mockResolvedValue(gmailMessage());
    mockUserFindOne.mockReturnValue(chain(CLIENT));
    mockUserFindById.mockReturnValue(chain(CLIENT));
    mockThreadFindOne.mockReturnValue(chain({ _id: 't1', userId: 'u1', gmailThreadId: 'thread-1' }));
    mockThreadFindOneAndUpdate.mockResolvedValue({ _id: 't1' });
    mockThreadFindById.mockReturnValue(chain({ lastStaffReadAt: null, lastClientReadAt: null }));
    mockThreadUpdateOne.mockResolvedValue({});
    mockMsgUpdateOne.mockResolvedValue({});
    mockMsgFind.mockReturnValue(chain([{ direction: 'inbound', sentAt: new Date('2026-09-22T10:00:00Z') }]));
    mockMsgCount.mockResolvedValue(1);
    mockRedactBody.mockResolvedValue({
        text: 'Please hold the listings.',
        generatedBy: 'ai',
        sourceHash: 'hash1',
        redactionVersion: 1,
    });
    mockConnFindOne.mockReturnValue(chain({ historyId: '1000' }));
    mockConnUpdateOne.mockResolvedValue({});
});

describe('the history cursor', () => {
    test('advances only after every message on the page is handled', async () => {
        mockListHistory.mockResolvedValue({
            history: [{ messagesAdded: [{ message: { id: 'msg-1' } }] }],
            historyId: '2000',
        });

        await GmailIngest.runSync();

        const persisted = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(persisted.historyId).toBe('2000');
        expect(mockMsgUpdateOne).toHaveBeenCalled();
    });

    test('a message that failed is held for retry, not skipped past', async () => {
        // history.list only moves forward, so a cursor past an un-ingested message
        // loses it permanently. Holding the cursor instead would stop ALL client mail
        // on one bad message, which for a support inbox is its own outage — so the
        // failure is tracked durably and the cursor is allowed to move.
        mockListHistory.mockResolvedValue({
            history: [{ messagesAdded: [{ message: { id: 'msg-boom' } }] }],
            historyId: '2000',
        });
        mockGetMessage.mockRejectedValue(new Error('Gmail exploded'));

        const summary = await GmailIngest.runSync();

        expect(summary.failed).toBe(1);
        const persisted = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(persisted.pendingMessageIds).toContain('msg-boom');
        expect(persisted.historyId).toBe('2000');
    });

    test('the backlog is retried on the next run, and cleared on success', async () => {
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessageIds: ['msg-boom'] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });

        const summary = await GmailIngest.runSync();

        expect(summary.retried).toBe(1);
        expect(mockConnUpdateOne.mock.calls.at(-1)[1].$set.pendingMessageIds).toEqual([]);
    });

    test('a growing backlog raises an alarm instead of growing the document', async () => {
        const many = Array.from({ length: 205 }, (_, i) => `old-${i}`);
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessageIds: many }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(new Error('still broken'));

        await GmailIngest.runSync();

        const persisted = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(persisted.pendingMessageIds).toHaveLength(200);
        expect(persisted.lastError).toMatch(/failing to ingest/);
    });

    test('is a string, never a number', async () => {
        // uint64. Number loses precision above 2^53, which does not throw — it silently
        // starts skipping mail.
        mockListHistory.mockResolvedValue({ history: [], historyId: 9007199254740993n.toString() });

        await GmailIngest.runSync();

        const persisted = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(persisted.historyId).toBe('9007199254740993');
        expect(typeof persisted.historyId).toBe('string');
    });

    test('never moves backwards', async () => {
        mockConnFindOne.mockReturnValue(chain({ historyId: '5000' }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '4000' });

        await GmailIngest.runSync();

        expect(mockConnUpdateOne.mock.calls.at(-1)[1].$set.historyId).toBeUndefined();
    });

    test('compares as BigInt, not lexically', async () => {
        // '9' > '10' as strings. Lexical comparison would refuse every legitimate
        // advance once the id gained a digit.
        expect(GmailIngest.isNewer('10', '9')).toBe(true);
        expect(GmailIngest.isNewer('9', '10')).toBe(false);
    });

    test('an expired cursor is reported rather than retried forever', async () => {
        // 404 means older than Gmail's ~1 week history window. Retrying cannot fix it,
        // and leaving it means every later run 404s too — mail stops with no error
        // anyone sees.
        mockListHistory.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }));

        const summary = await GmailIngest.runSync();

        expect(summary.expired).toBe(true);
        expect(mockConnUpdateOne.mock.calls.at(-1)[1].$set.lastError).toMatch(/backfill/i);
    });

    test('refuses to walk from nothing', async () => {
        // Walking from zero replays the entire mailbox: every message ever received,
        // each redacted through the AI, filling the client pages with archaeology.
        mockConnFindOne.mockReturnValue(chain({ historyId: null }));

        expect((await GmailIngest.runSync()).skipped).toBe('no-cursor');
        expect(mockListHistory).not.toHaveBeenCalled();
    });

    test('does nothing at all while the feature flag is off', async () => {
        process.env.GMAIL_MESSAGING_ENABLED = 'false';

        expect((await GmailIngest.runSync()).skipped).toBe('disabled');
        expect(mockListHistory).not.toHaveBeenCalled();
    });

    test('stops after a bounded number of pages', async () => {
        // A mailbox disconnected for a week returns very long history, and an unbounded
        // walk holds the cursor — a single serialised value — for as long as it takes.
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000', nextPageToken: 'more' });

        const summary = await GmailIngest.runSync();

        expect(summary.pages).toBe(20);
    });
});

describe('ingesting one message', () => {
    test('stores a client email as inbound against the matched client', async () => {
        const result = await GmailIngest.ingestMessage('msg-1');

        expect(result).toMatchObject({ status: 'ingested', direction: 'inbound' });
        const [, update] = mockMsgUpdateOne.mock.calls[0];
        expect(update.$setOnInsert.direction).toBe('inbound');
        expect(update.$setOnInsert.userId).toBe('u1');
    });

    test('a portal reply echoed back is recognised by our own Message-ID', async () => {
        // The second echo guard. The origin header is the first, and it is lost if a
        // mail client strips unknown headers on a round trip; the id alone cannot help
        // while our own write has not landed yet. Between them a portal reply is never
        // stored twice.
        mockMsgExists.mockImplementation((query) => Promise.resolve(
            query.rfc822MessageId === '<abc@x.com>' ? { _id: 'ours' } : null
        ));

        expect((await GmailIngest.ingestMessage('msg-1')).status).toBe('duplicate');
        expect(mockMsgUpdateOne).not.toHaveBeenCalled();
    });

    test('a redelivery is a no-op, not a duplicate in the thread', async () => {
        // Pub/Sub delivers at least once, so this is the normal case, not an edge one.
        mockMsgExists.mockResolvedValue({ _id: 'existing' });

        expect((await GmailIngest.ingestMessage('msg-1')).status).toBe('duplicate');
        expect(mockGetMessage).not.toHaveBeenCalled();
    });

    test('stores only the redacted body — there is no raw field to leak', async () => {
        await GmailIngest.ingestMessage('msg-1');

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert;
        expect(stored.bodyRedacted).toBe('Please hold the listings.');
        expect(stored).not.toHaveProperty('bodyRaw');
        expect(stored).not.toHaveProperty('bodyHtml');
    });

    test('nothing is stored when redaction fails', async () => {
        // Inverts this repo's usual "never hard-fail on the LLM" rule. The normal
        // fallback shows more raw text; here that would show exactly what must be hidden.
        mockRedactBody.mockRejectedValue(new Error('redaction blew up'));

        await expect(GmailIngest.ingestMessage('msg-1')).rejects.toThrow();
        expect(mockMsgUpdateOne).not.toHaveBeenCalled();
    });

    test('an unmatched sender is counted, not silently dropped', async () => {
        mockUserFindOne.mockReturnValue(chain(null));
        mockThreadFindOne.mockReturnValue(chain(null));

        expect((await GmailIngest.ingestMessage('msg-1')).status).toBe('unmatched');
        expect(mockMsgUpdateOne).not.toHaveBeenCalled();
    });

    test('the unmatched address is never written to the log file', async () => {
        // Logger.js writes unrotated to logs.txt. Logging the address would put a
        // client's email on disk forever.
        const logger = require('../../../utils/Logger.js');
        mockUserFindOne.mockReturnValue(chain(null));
        mockThreadFindOne.mockReturnValue(chain(null));

        await GmailIngest.ingestMessage('msg-1');

        const logged = logger.warn.mock.calls.flat().join(' ');
        expect(logged).not.toContain('morgansrepellent');
    });

    test('attachment filenames are redacted — they name the client too', async () => {
        mockGetMessage.mockResolvedValue({
            ...gmailMessage(),
            payload: {
                ...gmailMessage().payload,
                parts: [
                    { mimeType: 'text/plain', body: { data: b64('see attached') } },
                    {
                        mimeType: 'application/pdf',
                        filename: 'Nitesh Kumar CV.pdf',
                        body: { attachmentId: 'a1', size: 100 },
                    },
                ],
            },
        });

        await GmailIngest.ingestMessage('msg-1');

        const [attachment] = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.attachments;
        expect(attachment.filenameRedacted).not.toContain('Nitesh');
        expect(attachment.filenameRedacted).toContain('[name]');
    });
});

describe("the admin's own reply from Gmail", () => {
    const adminReply = () => ({
        ...gmailMessage({ id: 'msg-out', from: `"eStore Factory" <${INBOX}>`, to: 'walmart@morgansrepellent.com' }),
        labelIds: ['SENT'],
    });

    test('is stored as outbound rather than discarded', async () => {
        mockGetMessage.mockResolvedValue(adminReply());

        const result = await GmailIngest.ingestMessage('msg-out');

        expect(result).toMatchObject({ status: 'ingested', direction: 'outbound' });
    });

    test('is matched through the thread, never through the sender', async () => {
        // The sender is our own inbox. Fed to the matcher it matches nothing, which is
        // exactly how these replies used to be lost.
        mockGetMessage.mockResolvedValue(adminReply());

        await GmailIngest.ingestMessage('msg-out');

        expect(mockThreadFindOne).toHaveBeenCalledWith({ gmailThreadId: 'thread-1' });
        expect(mockUserFindOne).not.toHaveBeenCalled();
    });

    test('is recorded as origin email, distinct from a portal reply', async () => {
        mockGetMessage.mockResolvedValue(adminReply());

        await GmailIngest.ingestMessage('msg-out');

        expect(mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.origin).toBe('email');
    });

    test('refreshes the threading headers the next portal reply needs', async () => {
        // Miss this and the next reply sent from the portal threads off a stale
        // Message-ID, so the client's mail app shows it as a separate conversation —
        // surfacing as though the bug were on their side.
        mockGetMessage.mockResolvedValue(adminReply());

        await GmailIngest.ingestMessage('msg-out');

        expect(mockThreadFindOneAndUpdate.mock.calls[0][1].$set.rfc822MessageIdOfLast).toBe('<abc@x.com>');
    });
});

describe('matching', () => {
    test('requires isEsfClient, so staff never open a thread against themselves', async () => {
        // ESF staff are User documents too. Without the flag, a staff member emailing
        // the inbox becomes a client conversation on the staff Messages page.
        mockThreadFindOne.mockReturnValue(chain(null));

        await GmailIngest.ingestMessage('msg-1');

        expect(mockUserFindOne.mock.calls[0][0].isEsfClient).toBe(true);
    });

    test('an unverified additional address does not attach mail to an account', async () => {
        mockThreadFindOne.mockReturnValue(chain(null));

        await GmailIngest.ingestMessage('msg-1');

        const query = mockUserFindOne.mock.calls[0][0];
        const additional = query.$or.find((clause) => clause.additionalEmails);
        expect(additional.additionalEmails.$elemMatch.isVerified).toBe(true);
    });
});

describe('thread counters', () => {
    test('are recounted, not incremented', async () => {
        // Increments drift the moment anything is ingested twice or out of order — and
        // both happen here, because Pub/Sub redelivers and backfill walks old mail.
        // The symptom is an unread badge that never clears.
        await GmailIngest.ingestMessage('msg-1');

        expect(mockMsgCount).toHaveBeenCalled();
        const [, update] = mockThreadUpdateOne.mock.calls.at(-1);
        expect(update.$set.messageCount).toBe(1);
        expect(update.$set).not.toHaveProperty('$inc');
    });

    test('take direction from the newest stored message, not the one just ingested', async () => {
        // Backfill ingests old mail. Taking direction from the message in hand would
        // flip a thread's status backwards to whatever was oldest.
        mockMsgFind.mockReturnValue(chain([{ direction: 'outbound', sentAt: new Date('2026-09-23T10:00:00Z') }]));

        await GmailIngest.ingestMessage('msg-1');

        expect(mockThreadUpdateOne.mock.calls.at(-1)[1].$set.lastMessageDirection).toBe('outbound');
    });
});
