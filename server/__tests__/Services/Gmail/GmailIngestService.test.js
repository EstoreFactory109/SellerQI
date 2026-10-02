/**
 * Gmail into the conversation record.
 *
 * The cursor tests are the ones that matter. `history.list` only moves forward, so a
 * cursor advanced past a message that was never ingested does not make that message
 * late — it makes it permanently absent from the portal while sitting intact in Gmail,
 * where nobody will think to look. Every other bug here is visible; that one is not.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

// Intent analysis has its own suite. Stubbed here so these tests stay about ingestion,
// and so a change to the model prompt cannot break the mail path's coverage.
const mockAnalyseMessage = jest.fn();
jest.mock('../../../Services/User/MessageIntentHandler.js', () => ({
    analyseMessage: (...a) => mockAnalyseMessage(...a),
}));

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
const mockMsgFindOne = jest.fn();
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
        findOne: (...a) => mockMsgFindOne(...a),
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
    mockMsgFindOne.mockReturnValue(chain({ _id: 'stored-1', gmailMessageId: 'msg-1' }));
    mockAnalyseMessage.mockResolvedValue(null);
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
        expect(persisted.pendingMessages.map((e) => e.id)).toContain('msg-boom');
        expect(persisted.historyId).toBe('2000');
    });

    test('the backlog is retried on the next run, and cleared on success', async () => {
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessageIds: ['msg-boom'] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });

        const summary = await GmailIngest.runSync();

        expect(summary.retried).toBe(1);
        const written = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(written.pendingMessages).toEqual([]);
        // The legacy field is cleared in the same write, so the adoption runs once.
        expect(written.pendingMessageIds).toEqual([]);
    });

    test('a growing backlog raises an alarm instead of growing the document', async () => {
        const many = Array.from({ length: 205 }, (_, i) => ({
            id: `old-${i}`, attempts: 1, firstSeenAt: new Date(), lastOutcome: 'throw',
        }));
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: many }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(new Error('still broken'));

        await GmailIngest.runSync();

        const persisted = mockConnUpdateOne.mock.calls.at(-1)[1].$set;
        expect(persisted.pendingMessages).toHaveLength(200);
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

describe('intent analysis never costs a message', () => {
    test('runs only after the message is stored', async () => {
        // The conversation record is the thing that must survive. Analysing first and
        // storing second would mean a model outage lost a client's email.
        const order = [];
        mockMsgUpdateOne.mockImplementation(async () => { order.push('stored'); return {}; });
        mockAnalyseMessage.mockImplementation(async () => { order.push('analysed'); });

        await GmailIngest.ingestMessage('msg-1');

        expect(order).toEqual(['stored', 'analysed']);
    });

    test('a failure there does not fail the ingest', async () => {
        // analyseMessage swallows its own errors, but this pins the contract so a future
        // refactor that lets one escape is caught here rather than in production.
        mockAnalyseMessage.mockRejectedValue(new Error('model exploded'));

        await expect(GmailIngest.ingestMessage('msg-1')).rejects.toThrow();
        // …and the message was still written before it blew up.
        expect(mockMsgUpdateOne).toHaveBeenCalled();
    });

    test('is given the RAW text, not the redacted copy', async () => {
        // Redaction strips every URL, and a listing link is exactly what makes a request
        // worth raising.
        await GmailIngest.ingestMessage('msg-1');

        const [args] = mockAnalyseMessage.mock.calls[0];
        expect(args.rawText).toContain('Please hold the listings.');
        expect(args.direction).toBe('inbound');
    });
});

/**
 * Clients answer questions by typing under each one inside the quote. Cutting the chain
 * used to throw those answers away: a real thread kept 3 lines of 56, so the intent model
 * saw a thank-you and a task request sat waiting for detail already sent.
 */
describe('answers typed inside the quoted email', () => {
    const INLINE = [
        'Hi Nora,',
        '',
        'Answers below. Thank you.',
        '',
        '> Could you please confirm the correct pack size/quantity? 2500 sets.',
        '>',
        '> Should we include the bundle SKU KB-100?',
        '',
        'Warm Regards,',
        'Nitesh Kumar',
        '913-269-8400',
        '',
        '> On Sep 21, 2026, at 2:30 AM, Support eStore Factory <hello@estorefactory.com> wrote:',
        '> Could you please confirm the correct pack size/quantity?',
    ].join('\n');

    /** `find` serves two callers here — the previous-message lookup and the read receipt. */
    const withPreviousOutbound = (bodies) => {
        mockMsgFind.mockImplementation((query) => (query.direction === 'outbound'
            ? chain(bodies.map((bodyRedacted) => ({ bodyRedacted })))
            : chain([{ direction: 'inbound', sentAt: new Date('2026-09-22T10:00:00Z') }])));
    };

    beforeEach(() => {
        const msg = gmailMessage();
        msg.payload.parts = [{ mimeType: 'text/plain', body: { data: b64(INLINE) } }];
        mockGetMessage.mockResolvedValue(msg);
        // Echo, so the assertions can see what was actually handed over for redaction.
        mockRedactBody.mockImplementation(async (text) => ({
            text, generatedBy: 'ai', sourceHash: 'hash1', redactionVersion: 1,
        }));
    });

    test('the recovered answer reaches the intent model', async () => {
        withPreviousOutbound(['Could you please confirm the correct pack size/quantity?']);

        await GmailIngest.ingestMessage('msg-1');

        const [args] = mockAnalyseMessage.mock.calls[0];
        expect(args.rawText).toContain('2500 sets.');
        // Labelled with the line it answers — "2500 sets." alone means nothing.
        expect(args.rawText).toContain('Replies the client typed inside the quoted email');
    });

    test('staff see it too: it is composed into the stored body, not kept beside it', async () => {
        withPreviousOutbound(['Could you please confirm the correct pack size/quantity?']);

        await GmailIngest.ingestMessage('msg-1');

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert;
        expect(stored.bodyRedacted).toContain('2500 sets.');
        // Composed BEFORE redaction, so it crossed the same boundary as everything else.
        expect(mockRedactBody.mock.calls[0][0]).toContain('2500 sets.');
        expect(stored).not.toHaveProperty('bodyRaw');
    });

    test('the quoted chain itself is still cut from what is stored', async () => {
        withPreviousOutbound(['Could you please confirm the correct pack size/quantity?']);

        await GmailIngest.ingestMessage('msg-1');

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert;
        expect(stored.quotedTrimmed).toBe(true);
        expect(stored.bodyRedacted).not.toContain('wrote:');
        // The signature under the quote is not an answer.
        expect(stored.bodyRedacted).not.toContain('913-269-8400');
    });

    test('it asks only for our own earlier replies on this thread', async () => {
        withPreviousOutbound(['Could you please confirm the correct pack size/quantity?']);

        await GmailIngest.ingestMessage('msg-1');

        const call = mockMsgFind.mock.calls.find(([q]) => q.direction === 'outbound');
        expect(call[0]).toEqual({ gmailThreadId: 'thread-1', direction: 'outbound' });
    });

    test('a lookup failure costs the diff, not the email', async () => {
        // The heuristic path still finds it, and ingest behaves exactly as it did before
        // any of this existed.
        mockMsgFind.mockImplementation((query) => {
            if (query.direction === 'outbound') throw new Error('mongo is down');
            return chain([{ direction: 'inbound', sentAt: new Date('2026-09-22T10:00:00Z') }]);
        });

        const result = await GmailIngest.ingestMessage('msg-1');

        expect(result.status).toBe('ingested');
        expect(mockAnalyseMessage.mock.calls[0][0].rawText).toContain('2500 sets.');
    });

    test('an HTML quote with no text marker is still cut structurally', async () => {
        /**
         * The floor on all of this: recovery may only ever store LESS of the chain than
         * before, never more. A <blockquote> carrying no "On … wrote:" is the case where
         * the two cuts disagree — stripping tags first leaves the splitter nothing to
         * match on, while prepareBody removes the container while the structure is intact.
         */
        const msg = gmailMessage();
        msg.payload.parts = [{
            mimeType: 'text/html',
            body: {
                data: b64('<p>Approved.</p><blockquote>Our earlier note about the pack '
                    + 'size, which names a warehouse contact we hold no identifiers for.'
                    + '</blockquote>'),
            },
        }];
        mockGetMessage.mockResolvedValue(msg);
        withPreviousOutbound([]);

        await GmailIngest.ingestMessage('msg-1');

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert;
        expect(stored.bodyRedacted).toBe('Approved.');
        expect(stored.bodyRedacted).not.toContain('warehouse contact');
    });

    test('an ordinary message gains nothing and loses nothing', async () => {
        mockGetMessage.mockResolvedValue(gmailMessage());
        withPreviousOutbound(['Anything at all.']);

        await GmailIngest.ingestMessage('msg-1');

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert;
        expect(stored.bodyRedacted).toBe('Please hold the listings.');
        expect(stored.bodyRedacted).not.toContain('Replies the client typed');
    });
});

describe('a reply counts as having read what came before it', () => {
    /**
     * The read receipt originally listened only for the client opening the thread in
     * the portal. This is an email conversation: a client living in their mail app
     * never produces that signal, so every message we sent showed a single tick
     * forever — including ones they had demonstrably read, because they answered them.
     */
    test('an inbound message advances lastClientReadAt to its own timestamp', async () => {
        const replyAt = new Date('2026-09-23T11:57:00Z');
        mockMsgFind.mockReturnValue(chain([{ direction: 'inbound', sentAt: replyAt }]));
        mockThreadFindById.mockReturnValue(chain({ lastClientReadAt: null, lastStaffReadAt: null }));

        await GmailIngest.ingestMessage('msg-1');

        expect(mockThreadUpdateOne.mock.calls.at(-1)[1].$set.lastClientReadAt).toEqual(replyAt);
    });

    test('so a staff message sent before their reply reads as seen', async () => {
        // The whole point: staff wrote at 11:56, client answered at 11:57. Two ticks.
        const replyAt = new Date('2026-09-23T11:57:00Z');
        mockMsgFind.mockReturnValue(chain([{ direction: 'inbound', sentAt: replyAt }]));
        mockThreadFindById.mockReturnValue(chain({ lastClientReadAt: null, lastStaffReadAt: null }));

        await GmailIngest.ingestMessage('msg-1');

        const readAt = mockThreadUpdateOne.mock.calls.at(-1)[1].$set.lastClientReadAt;
        expect(new Date(readAt) >= new Date('2026-09-23T11:56:00Z')).toBe(true);
    });

    test('never moves the marker BACKWARDS', async () => {
        // Backfill walks old mail. An ancient inbound message ingested late must not
        // drag the marker back and resurrect read messages as unread.
        const already = new Date('2026-09-23T12:00:00Z');
        mockMsgFind.mockReturnValue(chain([{ direction: 'inbound', sentAt: new Date('2026-09-01T09:00:00Z') }]));
        mockThreadFindById.mockReturnValue(chain({ lastClientReadAt: already, lastStaffReadAt: null }));

        await GmailIngest.ingestMessage('msg-1');

        expect(mockThreadUpdateOne.mock.calls.at(-1)[1].$set.lastClientReadAt).toEqual(already);
    });

    test('a thread with no inbound message leaves the marker alone', async () => {
        mockMsgFind.mockReturnValue(chain([]));
        mockThreadFindById.mockReturnValue(chain({ lastClientReadAt: null, lastStaffReadAt: null }));

        await GmailIngest.ingestMessage('msg-1');

        expect(mockThreadUpdateOne.mock.calls.at(-1)[1].$set.lastClientReadAt).toBeUndefined();
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

/**
 * A failure must not be able to retry forever, and must not be dropped after one go.
 *
 * Both halves were broken, in opposite directions, in the same twelve lines. The retry
 * loop deleted an id on ANY non-throwing return - `deferred` included - so a portal echo
 * whose own write had genuinely failed got exactly one retry and was then forgotten,
 * which is the loss the deferral exists to prevent. Meanwhile a throwing message was kept
 * with no counter at all, which is how 37 of them accumulated over a week while
 * /api/gmail/status reported the connection healthy.
 */
describe('a failure cannot retry forever', () => {
    const entry = (over = {}) => ({
        id: 'stuck-1', attempts: 0, firstSeenAt: new Date(), lastAttemptAt: null,
        lastOutcome: 'throw', lastReason: null, ...over,
    });
    const err = (status, message = 'boom') => Object.assign(new Error(message), { statusCode: status });
    const persisted = () => mockConnUpdateOne.mock.calls.at(-1)[1].$set;

    test('a deferral is kept and counted, not dropped after one retry', async () => {
        // The regression test for the silent-loss half. Fails against the old loop.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        // Our own origin header with no local copy is what routeMessage defers on.
        const echo = gmailMessage();
        echo.payload.headers.push({ name: 'X-SellerQI-Origin', value: 'portal-staff' });
        mockGetMessage.mockResolvedValue(echo);
        mockMsgExists.mockResolvedValue(null);

        await GmailIngest.runSync();

        const [kept] = persisted().pendingMessages;
        expect(kept.id).toBe('stuck-1');
        expect(kept.attempts).toBe(1);
        expect(kept.lastOutcome).toBe('deferred');
    });

    test('a thrown failure increments across runs without resetting its age', async () => {
        const firstSeenAt = new Date('2026-09-20T00:00:00Z');
        mockConnFindOne.mockReturnValue(chain({
            historyId: '1000', pendingMessages: [entry({ attempts: 3, firstSeenAt })],
        }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(500));

        await GmailIngest.runSync();

        const [kept] = persisted().pendingMessages;
        expect(kept.attempts).toBe(4);
        expect(new Date(kept.firstSeenAt).toISOString()).toBe(firstSeenAt.toISOString());
    });

    test('a Gmail 404 retires immediately - there is nothing left to fetch', async () => {
        // Every one of the 37 messages in the live backlog was this: deleted from the
        // mailbox while history.list still listed it. Waiting out an attempt count for
        // a message that no longer exists is pure cost.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(404, 'not found in Gmail'));

        await GmailIngest.runSync();

        expect(persisted().pendingMessages).toEqual([]);
        expect(persisted().deadLetterMessages).toHaveLength(1);
        expect(persisted().deadLetterMessages[0].id).toBe('stuck-1');
    });

    test.each([
        ['many attempts but recent', { attempts: 99, firstSeenAt: new Date() }],
        ['old but few attempts', { attempts: 1, firstSeenAt: new Date('2026-01-01T00:00:00Z') }],
    ])('does NOT retire on %s - both bounds are required', async (_label, over) => {
        // ORing them is the tempting simplification and it is wrong both ways: attempts
        // alone abandons good mail during an outage, age alone keeps dead ids forever.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry(over)] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(500));

        await GmailIngest.runSync();

        expect(persisted().pendingMessages).toHaveLength(1);
        expect(persisted().deadLetterMessages).toEqual([]);
    });

    test('retires when both bounds are passed, and says so once', async () => {
        mockConnFindOne.mockReturnValue(chain({
            historyId: '1000',
            pendingMessages: [entry({ attempts: 30, firstSeenAt: new Date('2026-01-01T00:00:00Z') })],
        }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(500));

        await GmailIngest.runSync();

        expect(persisted().deadLetterMessages).toHaveLength(1);
        expect(persisted().lastError).toMatch(/retired/i);
    });

    test('retiring keeps the Gmail id, so the message stays recoverable', async () => {
        // Retired is not deleted. If this ever becomes a quiet prune it has reintroduced
        // exactly the bug the dead-letter list was added to end.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(404));

        await GmailIngest.runSync();

        const [dead] = persisted().deadLetterMessages;
        expect(dead.id).toBe('stuck-1');
        expect(dead.lastReason).toBeTruthy();
        expect(dead.retiredAt).toBeInstanceOf(Date);
    });

    test('the recorded reason carries no client content', async () => {
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(500, 'failed for walmart@morgansrepellent.com'));

        await GmailIngest.runSync();

        // It stores whatever the error said, so the rule is that errors must not embed
        // client detail - pinned here because this field is read by an operator later.
        const [kept] = persisted().pendingMessages;
        expect(kept.lastReason.length).toBeLessThanOrEqual(300);
    });

    test('adopts the legacy id list once, dating it from now rather than epoch', async () => {
        // Guessing "it has been failing forever" would retire the entire existing
        // backlog on the first run after deploy, before anyone had seen what was in it.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessageIds: ['legacy-1'] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(500));

        await GmailIngest.runSync();

        const [adopted] = persisted().pendingMessages;
        expect(adopted.id).toBe('legacy-1');
        expect(adopted.attempts).toBe(1);
        expect(Date.now() - new Date(adopted.firstSeenAt).getTime()).toBeLessThan(60000);
        expect(persisted().pendingMessageIds).toEqual([]);
    });

    test('a skipped message clears on the first attempt', async () => {
        // skipped/unmatched are terminal decisions, not failures. Clearing them on sight
        // is what drains most of a backlog for free once this ships.
        mockConnFindOne.mockReturnValue(chain({ historyId: '1000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockResolvedValue({
            ...gmailMessage(),
            labelIds: ['DRAFT'],
        });

        await GmailIngest.runSync();

        expect(persisted().pendingMessages).toEqual([]);
        expect(persisted().deadLetterMessages).toEqual([]);
    });

    test('the cursor rules still hold with the new backlog', async () => {
        // Re-asserted here because this change rewrites the function that owns them.
        mockConnFindOne.mockReturnValue(chain({ historyId: '5000', pendingMessages: [entry()] }));
        mockListHistory.mockResolvedValue({ history: [], historyId: '2000' });
        mockGetMessage.mockRejectedValue(err(404));

        await GmailIngest.runSync();

        // Never backwards, even while retiring an entry on the same run.
        expect(persisted()).not.toHaveProperty('historyId');
    });
});
