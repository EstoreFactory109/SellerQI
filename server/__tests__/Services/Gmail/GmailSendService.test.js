/**
 * Replies, from both sides.
 *
 * Two assertions carry this file. The client's reply must be INSERTED and not sent —
 * sending would mail our own inbox from itself, making the client's words look like
 * ours. And both writes must carry the echo guards, or every portal message appears
 * twice once our own watch reports it back.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

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
    mockSendMessage.mockResolvedValue({ id: 'sent-1' });
    mockInsertMessage.mockResolvedValue({ id: 'ins-1', threadId: 'gt-new' });
    mockThreadCount.mockResolvedValue(0);
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
    test('is INSERTED, never sent', async () => {
        // send would mail our own inbox from itself: the client's words would arrive
        // looking like ours, and we would generate real outbound mail for a message
        // that never needs to leave the building.
        await GmailSend.insertClientReply({ threadId: 't1', body: 'Any update?', user: CLIENT });

        expect(mockInsertMessage).toHaveBeenCalled();
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('keeps the client as the From address', async () => {
        // The entire reason this is an insert.
        await GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT });

        expect(decodeRaw(mockInsertMessage.mock.calls[0][0].raw))
            .toContain('From: walmart@morgansrepellent.com');
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
        ['client', () => GmailSend.insertClientReply({ threadId: 't1', body: 'x', user: CLIENT }), () => mockInsertMessage],
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
        expect(mockInsertMessage.mock.calls[0][0].threadId).toBeUndefined();
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('adopts the thread id Gmail hands back', async () => {
        await ticket();

        expect(mockThreadFindOneAndUpdate.mock.calls[0][0]).toEqual({ gmailThreadId: 'gt-new' });
    });

    test('does NOT prefix the subject with Re:', async () => {
        // "Re:" on a brand-new ticket tells the recipient's mail client this answers
        // something they sent, so it reads as a reply nobody wrote.
        await ticket();

        const raw = decodeRaw(mockInsertMessage.mock.calls[0][0].raw);
        expect(raw).toContain('Subject: Listing issue');
        expect(raw).not.toContain('Subject: Re:');
    });

    test('arrives as unread, so the admin notices it in Gmail too', async () => {
        await ticket();

        expect(mockInsertMessage.mock.calls[0][0].labelIds).toEqual(['INBOX', 'UNREAD']);
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

        expect(decodeRaw(mockInsertMessage.mock.calls[0][0].raw)).not.toMatch(/^Bcc:/m);
    });

    test('refuses an empty subject', async () => {
        await expect(ticket({ subject: '   ' })).rejects.toThrow(/needs a subject/);
        expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    test('refuses a subject longer than the cap', async () => {
        await expect(ticket({ subject: 'x'.repeat(200) })).rejects.toThrow(/longer than/);
    });

    test('refuses once too many conversations are already open', async () => {
        // Sprawl, not speed, is the thing worth preventing: twenty threads about one
        // problem is worse for the client than one, and it buries the staff inbox.
        mockThreadCount.mockResolvedValue(10);

        await expect(ticket()).rejects.toThrow(/already have 10 open/);
        expect(mockInsertMessage).not.toHaveBeenCalled();
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
