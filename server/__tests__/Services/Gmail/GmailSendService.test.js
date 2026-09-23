/**
 * Replies, from both sides.
 *
 * Two assertions carry this file. The client's reply must be INSERTED and not sent —
 * sending would mail our own inbox from itself, making the client's words look like
 * ours. And both writes must carry the echo guards, or every portal message appears
 * twice once our own watch reports it back.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockReadFile = jest.fn();
const mockUnlink = jest.fn();
jest.mock('fs/promises', () => ({
    readFile: (...a) => mockReadFile(...a),
    unlink: (...a) => mockUnlink(...a),
}));

const mockSendMessage = jest.fn();
const mockInsertMessage = jest.fn();
jest.mock('../../../Services/Gmail/GmailClient.js', () => ({
    sendMessage: (...a) => mockSendMessage(...a),
    insertMessage: (...a) => mockInsertMessage(...a),
}));

const mockThreadFindOne = jest.fn();
const mockThreadUpdateOne = jest.fn();
const mockMsgUpdateOne = jest.fn();
const mockThreadCount = jest.fn();
const mockThreadFindOneAndUpdate = jest.fn();
jest.mock('../../../models/system/EmailThreadModels.js', () => ({
    EmailThread: {
        findOne: (...a) => mockThreadFindOne(...a),
        updateOne: (...a) => mockThreadUpdateOne(...a),
        countDocuments: (...a) => mockThreadCount(...a),
        findOneAndUpdate: (...a) => mockThreadFindOneAndUpdate(...a),
    },
    EmailMessage: { updateOne: (...a) => mockMsgUpdateOne(...a) },
}));

const GmailSend = require('../../../Services/Gmail/GmailSendService.js');

const INBOX = 'hello@estorefactory.com';

const THREAD = {
    _id: 't1',
    userId: 'u1',
    gmailThreadId: 'gt1',
    clientEmail: 'walmart@morgansrepellent.com',
    rawSubject: 'Walmart listings',
    rfc822MessageIdOfLast: '<last@morgansrepellent.com>',
    referencesTail: ['<root@morgansrepellent.com>'],
};

const CLIENT = {
    _id: 'u1',
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '913-269-8400',
};

const decodeRaw = (raw) => Buffer.from(raw, 'base64url').toString('utf8');

beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_INBOX_ADDRESS = INBOX;
    process.env.GMAIL_MESSAGING_ENABLED = 'true';

    mockThreadFindOne.mockReturnValue({
        select: function () { return this; },
        lean: () => Promise.resolve(THREAD),
    });
    mockThreadUpdateOne.mockResolvedValue({});
    mockMsgUpdateOne.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({ id: 'sent-1', threadId: 'gt-new' });
    mockInsertMessage.mockResolvedValue({ id: 'ins-1', threadId: 'gt-new' });
    mockThreadCount.mockResolvedValue(0);
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.4 pretend'));
    mockUnlink.mockResolvedValue(undefined);
    mockThreadFindOneAndUpdate.mockResolvedValue({ _id: 't-new', displaySubject: 'Listing issue' });
});

describe('a staff reply', () => {
    test('is genuinely sent to the client', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'We have paused them.' });

        expect(mockSendMessage).toHaveBeenCalled();
        expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    test('goes out under one agency identity, never a person', async () => {
        // The client is told which agency they are dealing with, never which staff
        // member — the same rule the Status page applies in the other direction.
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x', staffUserId: 'staff-7' });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('From: "eStore Factory" <hello@estorefactory.com>');
        expect(raw).not.toContain('staff-7');
    });

    test('records who sent it for our own audit', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x', staffUserId: 'staff-7' });

        expect(mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.sentByUserId).toBe('staff-7');
    });

    test('threads on both mechanisms, not just Gmail internal', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        expect(mockSendMessage.mock.calls[0][0].threadId).toBe('gt1');
        expect(decodeRaw(mockSendMessage.mock.calls[0][0].raw))
            .toContain('In-Reply-To: <last@morgansrepellent.com>');
    });

    test('matches the thread subject, which Gmail requires for a threaded send', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        expect(decodeRaw(mockSendMessage.mock.calls[0][0].raw)).toContain('Subject: Re: Walmart listings');
    });

    test('reopens a resolved conversation', async () => {
        // Someone who resolves a thread and then replies to it plainly does not
        // consider it closed, and leaving it resolved hides their own reply from the
        // default inbox view.
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        expect(mockThreadUpdateOne.mock.calls[0][1].$set.resolvedAt).toBeNull();
    });
});

describe('a client reply', () => {
    test('is actually DELIVERED, not filed silently into the mailbox', async () => {
        // This used insert, which files a message without transmitting it. Faithful as
        // a record and useless in practice: an inserted message is synthetic, so Gmail
        // raises no new-mail notification and the admin is never told a client wrote.
        await GmailSend.insertClientReply({ threadId: 't1', body: 'Any update?', user: CLIENT });

        expect(mockSendMessage).toHaveBeenCalled();
        expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    test('goes to our own inbox, because Gmail will not let us send as the client', async () => {
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('To: hello@estorefactory.com');
        expect(raw).toContain('From: "SellerQI Portal" <hello@estorefactory.com>');
    });

    test('carries Reply-To: the client, or the admin replies to us and they hear nothing', async () => {
        // The single header this redesign turns on. Without it, hitting Reply in Gmail
        // sends the answer straight back to our own inbox — a loop the client is not
        // part of, and no error anywhere.
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        expect(decodeRaw(mockSendMessage.mock.calls[0][0].raw))
            .toContain('Reply-To: walmart@morgansrepellent.com');
    });

    test('tells the admin in the body who wrote it', async () => {
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        const body = Buffer.from(
            decodeRaw(mockSendMessage.mock.calls[0][0].raw).split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''),
            'base64'
        ).toString('utf8');
        expect(body).toContain('walmart@morgansrepellent.com');
        expect(body).toContain('client portal');
    });

    test('is redacted before staff can read it', async () => {
        // The portal being the origin is not a reason to trust the content — the client
        // types their own name and number here as readily as they would in an email,
        // and it is about to be read on a page that must not show either.
        await GmailSend.insertClientReply({
            threadId: 't1',
            body: 'This is Nitesh Kumar, call me on 913-269-8400',
            user: CLIENT,
        });

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.bodyRedacted;
        expect(stored).not.toContain('Nitesh');
        expect(stored).not.toContain('913-269-8400');
    });

    test('is scoped to the client, so a thread id cannot select across accounts', async () => {
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        expect(mockThreadFindOne).toHaveBeenCalledWith({ _id: 't1', userId: 'u1' });
    });

    test('counts as inbound, so the thread needs a staff reply', async () => {
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        const [, update] = mockThreadUpdateOne.mock.calls[0];
        expect(update.$set.lastMessageDirection).toBe('inbound');
        expect(update.$inc.staffUnreadCount).toBe(1);
    });
});

describe('the echo guards', () => {
    test.each([
        ['staff', () => GmailSend.sendStaffReply({ threadId: 't1', body: 'x' }), () => mockSendMessage],
        ['client', () => GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT }), () => mockSendMessage],
    ])('a %s reply is stamped with its origin', async (_label, act, getMock) => {
        // Anything we put into Gmail is reported by our own watch and re-ingested.
        // Without the header the message appears twice.
        await act();

        expect(decodeRaw(getMock().mock.calls[0][0].raw)).toContain('X-SellerQI-Origin: portal-');
    });

    test('our own copy is stored with the Message-ID we generated', async () => {
        // The second guard. The header alone fails if a client strips unknown headers
        // on a round trip; the Message-ID alone loses the race where the push arrives
        // before our write lands. Neither is redundant.
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        const sentId = /Message-ID: (<[^>]+>)/.exec(raw)[1];

        expect(mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.rfc822MessageId).toBe(sentId);
    });

    test('the stored copy is keyed on the Gmail id, so the echo upserts onto it', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        expect(mockMsgUpdateOne.mock.calls[0][0]).toEqual({ gmailMessageId: 'sent-1' });
    });

    test('the next reply threads off this one', async () => {
        // A stale rfc822MessageIdOfLast makes the following message show up in the
        // client's mail app as a separate conversation.
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        const stored = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.rfc822MessageId;
        expect(mockThreadUpdateOne.mock.calls[0][1].$set.rfc822MessageIdOfLast).toBe(stored);
    });
});

describe('raising a ticket', () => {
    const ticket = (over = {}) => GmailSend.startClientTicket({
        subject: 'Listing issue',
        body: 'The kitchen scale title is wrong.',
        user: CLIENT,
        ...over,
    });

    test('opens a NEW Gmail thread rather than joining one', async () => {
        await ticket();

        // No threadId passed — that is what makes Gmail create the conversation.
        expect(mockSendMessage.mock.calls[0][0].threadId).toBeUndefined();
    });

    test('is delivered, so the admin is actually notified a ticket was raised', async () => {
        await ticket();

        expect(mockSendMessage).toHaveBeenCalled();
        expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    test('is replyable straight from Gmail', async () => {
        await ticket();

        expect(decodeRaw(mockSendMessage.mock.calls[0][0].raw))
            .toContain('Reply-To: walmart@morgansrepellent.com');
    });

    test('adopts the thread id Gmail hands back', async () => {
        await ticket();

        expect(mockThreadFindOneAndUpdate.mock.calls[0][0]).toEqual({ gmailThreadId: 'gt-new' });
    });

    test('does NOT prefix the subject with Re:', async () => {
        // "Re:" on a brand-new ticket tells the recipient's mail client this answers
        // something they sent, so it reads as a reply nobody wrote.
        await ticket();

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('Subject: Listing issue');
        expect(raw).not.toContain('Subject: Re:');
    });

    test('opens needing a staff reply', async () => {
        await ticket();

        const { $set } = mockThreadFindOneAndUpdate.mock.calls[0][1];
        expect($set.lastMessageDirection).toBe('inbound');
        expect($set.staffUnreadCount).toBe(1);
    });

    test('REDACTS THE SUBJECT, which staff see at the top of their inbox', async () => {
        // A subject is displayed to staff, so it leaks identity exactly as a body does —
        // and it is the more visible of the two, sitting in the conversation list.
        await ticket({ subject: 'Nitesh Kumar - urgent' });

        const stored = mockThreadFindOneAndUpdate.mock.calls[0][1].$setOnInsert.displaySubject;
        expect(stored).not.toContain('Nitesh');
        expect(stored).toContain('[name]');
    });

    test('keeps the raw subject, because Gmail needs it to thread replies', async () => {
        await ticket({ subject: 'Nitesh Kumar - urgent' });

        // select:false on the model — stored for sending, never served to staff.
        expect(mockThreadFindOneAndUpdate.mock.calls[0][1].$setOnInsert.rawSubject)
            .toBe('Nitesh Kumar - urgent');
    });

    test('redacts the body too', async () => {
        await ticket({ body: 'Call me on 913-269-8400' });

        expect(mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.bodyRedacted).not.toContain('913-269-8400');
    });

    test('a subject with a newline cannot inject headers', async () => {
        await ticket({ subject: 'Hello\r\nBcc: attacker@evil.com' });

        expect(decodeRaw(mockSendMessage.mock.calls[0][0].raw)).not.toMatch(/^Bcc:/m);
    });

    test('refuses an empty subject', async () => {
        await expect(ticket({ subject: '   ' })).rejects.toThrow(/needs a subject/);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('refuses a subject longer than the cap', async () => {
        await expect(ticket({ subject: 'x'.repeat(200) })).rejects.toThrow(/longer than/);
    });

    test('refuses once too many conversations are already open', async () => {
        // Sprawl, not speed, is the thing worth preventing: twenty threads about one
        // problem is worse for the client than one, and it buries the staff inbox.
        mockThreadCount.mockResolvedValue(10);

        await expect(ticket()).rejects.toThrow(/already have 10 open/);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });
});

describe('the acknowledgement back to the client', () => {
    const ticket2 = () => GmailSend.startClientTicket({
        subject: 'Listing issue', body: 'The title is wrong.', user: CLIENT,
    });

    test('gives the client an email they can reply to', async () => {
        // Without it the ticket notification exists only in OUR inbox, so a client
        // following up by email has to compose a fresh one — which Gmail files as a new
        // thread and which therefore arrives as a SECOND ticket about the same issue.
        await ticket2();

        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        const ack = decodeRaw(mockSendMessage.mock.calls[1][0].raw);
        expect(ack).toContain('To: walmart@morgansrepellent.com');
    });

    test('lands inside the same Gmail thread, not a separate one', async () => {
        await ticket2();

        expect(mockSendMessage.mock.calls[1][0].threadId).toBe('gt-new');
    });

    test('comes from the agency, never an individual', async () => {
        await ticket2();

        expect(decodeRaw(mockSendMessage.mock.calls[1][0].raw))
            .toContain('From: "eStore Factory" <hello@estorefactory.com>');
    });

    test('does NOT carry Reply-To the client, which would point them at themselves', async () => {
        // The notification needs Reply-To so the ADMIN reaches the client. This one is
        // addressed TO the client, so the same header would send their reply to their
        // own inbox.
        await ticket2();

        // Anchored to the line start: "In-Reply-To:" contains "Reply-To:" as a
        // substring, so a plain toContain check passes on a message that threads
        // correctly and has no Reply-To at all.
        expect(decodeRaw(mockSendMessage.mock.calls[1][0].raw)).not.toMatch(/^Reply-To:/m);
    });

    test('failing does not fail the ticket', async () => {
        // The ticket is already raised and visible in the portal. Losing it because a
        // courtesy email bounced would be the wrong trade.
        mockSendMessage
            .mockResolvedValueOnce({ id: 'sent-1', threadId: 'gt-new' })
            .mockRejectedValueOnce(new Error('SMTP exploded'));

        await expect(ticket2()).resolves.toMatchObject({ threadId: 't-new' });
    });

    test('becomes what the next reply threads off', async () => {
        // It is the message the client actually holds, so replies must chain from it.
        await ticket2();

        const update = mockThreadUpdateOne.mock.calls.at(-1)[1];
        expect(update.$set.rfc822MessageIdOfLast).toMatch(/^<[0-9a-f-]+@estorefactory\.com>$/);
    });
});

describe('a client who emails without a subject', () => {
    test('can still be replied to', async () => {
        // Gmail rejects a threaded send whose subject does not match the thread's. A
        // blank subject substituted with "(no subject)" produces "Re: (no subject)"
        // against a genuinely blank thread — mismatch, refused, and that client could
        // never be answered. Real senders do this constantly.
        mockThreadFindOne.mockReturnValue({
            select: function () { return this; },
            lean: () => Promise.resolve({ ...THREAD, rawSubject: '' }),
        });

        await GmailSend.sendStaffReply({ threadId: 't1', body: 'On it.' });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('Subject: \r\n');
        expect(raw).not.toContain('(no subject)');
    });
});

describe('attachments', () => {
    const upload = (over = {}) => ({
        originalname: 'invoice.pdf',
        mimetype: 'application/pdf',
        path: '/tmp/gmail-abc.pdf',
        size: 1024,
        ...over,
    });

    test('are carried on a staff reply as a real MIME part', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'See attached.', files: [upload()] });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('Content-Type: multipart/mixed');
        expect(raw).toContain('Content-Disposition: attachment; filename="invoice.pdf"');
    });

    test('the temp file is removed after a successful send', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x', files: [upload()] });

        expect(mockUnlink).toHaveBeenCalledWith('/tmp/gmail-abc.pdf');
    });

    test('AND after a failed one', async () => {
        // These land in public/temp. A send that throws must not leave the file behind,
        // or a disk fills up over months from nothing but failed replies — and the
        // symptom is the whole server dying for reasons pointing nowhere near Messages.
        mockSendMessage.mockRejectedValue(new Error('Gmail exploded'));

        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: 'x', files: [upload()] }))
            .rejects.toThrow();
        expect(mockUnlink).toHaveBeenCalledWith('/tmp/gmail-abc.pdf');
    });

    test('a client filename is redacted, since it can carry their name', async () => {
        await GmailSend.insertClientReply({
            threadId: 't1', body: 'x', user: CLIENT, files: [upload({ originalname: 'Nitesh Kumar CV.pdf' })],
        });

        const [stored] = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.attachments;
        expect(stored.filenameRedacted).not.toContain('Nitesh');
        expect(stored.filenameRedacted).toContain('[name]');
    });

    test('metadata is stored but never the bytes', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x', files: [upload()] });

        const [stored] = mockMsgUpdateOne.mock.calls[0][1].$setOnInsert.attachments;
        expect(stored).toMatchObject({ mimeType: 'application/pdf', size: 1024 });
        expect(stored).not.toHaveProperty('content');
        expect(stored).not.toHaveProperty('data');
    });

    test('a total over the cap is refused BEFORE anything is sent', async () => {
        // multer caps each file but cannot see the sum, so five legal files can still
        // exceed Gmail's 25MB message ceiling — and Gmail would reject it at the very
        // end, after the client had waited through the whole upload.
        const big = [upload({ size: 8 * 1024 * 1024 }), upload({ size: 9 * 1024 * 1024 })];

        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: 'x', files: big }))
            .rejects.toThrow(/limit is 15MB/);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('a message with no files stays plain text, not an empty multipart', async () => {
        await GmailSend.sendStaffReply({ threadId: 't1', body: 'x' });

        const raw = decodeRaw(mockSendMessage.mock.calls[0][0].raw);
        expect(raw).toContain('Content-Type: text/plain');
        expect(raw).not.toContain('multipart/mixed');
    });
});

describe('what is refused', () => {
    test('an empty reply', async () => {
        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: '   ' }))
            .rejects.toThrow(/cannot be empty/);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('one longer than the cap', async () => {
        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: 'x'.repeat(20000) }))
            .rejects.toThrow(/longer than/);
    });

    test('anything at all while messaging is disabled', async () => {
        process.env.GMAIL_MESSAGING_ENABLED = 'false';

        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: 'x' })).rejects.toThrow(/not enabled/);
    });

    test('a thread that does not exist', async () => {
        mockThreadFindOne.mockReturnValue({ select: function () { return this; }, lean: () => Promise.resolve(null) });

        await expect(GmailSend.sendStaffReply({ threadId: 'nope', body: 'x' })).rejects.toThrow(/not found/);
    });

    test('a thread with no reply address, rather than sending nowhere', async () => {
        mockThreadFindOne.mockReturnValue({
            select: function () { return this; },
            lean: () => Promise.resolve({ ...THREAD, clientEmail: null }),
        });

        await expect(GmailSend.sendStaffReply({ threadId: 't1', body: 'x' })).rejects.toThrow(/no reply address/);
    });
});
