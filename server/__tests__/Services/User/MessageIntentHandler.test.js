/**
 * Acting on what the model read in a conversation.
 *
 * The central assertion is the asymmetry: a client's request is CREATED, an admin's
 * decision is only STAGED. Both are inferences of similar reliability and they are
 * treated differently because of where they land — a created request sits in a queue a
 * human reviews, whereas an applied decision would skip that review and write a real
 * task into the live Zoho portal.
 *
 * The rest guard the loops. This system writes emails and reads emails, so anything that
 * lets it read its own writing, or ask the same question twice, becomes visible to a
 * client as a machine talking to itself.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockDetectTaskRequest = jest.fn();
const mockDetectDecision = jest.fn();
jest.mock('../../../Services/AI/MessageIntentService.js', () => ({
    detectTaskRequest: (...a) => mockDetectTaskRequest(...a),
    detectDecision: (...a) => mockDetectDecision(...a),
    missingDetailsQuestion: (missing) => (missing.length ? `Please tell us ${missing.join(' and ')}` : null),
}));

const mockSendAutomatedReply = jest.fn();
jest.mock('../../../Services/Gmail/GmailSendService.js', () => ({
    sendAutomatedReply: (...a) => mockSendAutomatedReply(...a),
}));

const mockFindOne = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../models/system/TaskRequestModel.js', () => ({
    findOne: (...a) => mockFindOne(...a),
    create: (...a) => mockCreate(...a),
}));

const { analyseMessage } = require('../../../Services/User/MessageIntentHandler.js');

const USER = {
    _id: 'u1', firstName: 'Nitesh', lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com', phone: '913-269-8400',
};
const THREAD = { _id: 't1' };
const MESSAGE = { _id: 'm1', gmailMessageId: 'gm1' };

const inbound = (over = {}) => analyseMessage({
    direction: 'inbound', origin: 'email',
    rawText: 'Can you add a size chart to the mixing bowl listing?',
    user: USER, thread: THREAD, message: MESSAGE, ...over,
});

const outbound = (over = {}) => analyseMessage({
    direction: 'outbound', origin: 'email',
    rawText: 'Yes, we can do that.',
    user: USER, thread: THREAD, message: MESSAGE, ...over,
});

const detected = (over = {}) => ({
    isRequest: true, confidence: 0.9, actionable: true,
    title: 'Add a size chart', description: 'To the mixing bowl listing.',
    neededBy: null, missing: [], ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockImplementation(async (doc) => ({ ...doc, _id: 'tr-1', save: jest.fn() }));
    mockDetectTaskRequest.mockResolvedValue(detected());
    mockDetectDecision.mockResolvedValue({ intent: null, confidence: 0, actionable: false, reason: '' });
    mockSendAutomatedReply.mockResolvedValue({ id: 'sent-1' });
});

describe('a client request is created; an admin decision is only staged', () => {
    test('a detected client request is queued', async () => {
        await inbound();

        expect(mockCreate).toHaveBeenCalled();
        expect(mockCreate.mock.calls[0][0].source).toBe('ai');
    });

    test('a detected admin ACCEPT is staged, never applied', async () => {
        // The whole safety argument. Applying it would create a real Zoho task with no
        // human confirming, on a model reading of a sentence.
        const pending = { _id: 'tr-1', status: 'pending', save: jest.fn() };
        mockFindOne.mockResolvedValue(pending);
        mockDetectDecision.mockResolvedValue({ intent: 'accept', confidence: 0.95, actionable: true, reason: '' });

        await outbound();

        expect(pending.stagedDecision.intent).toBe('accept');
        // Untouched: status stays pending until a human clicks.
        expect(pending.status).toBe('pending');
    });

    test('a decision is not even looked for without a request waiting', async () => {
        // "Yes, go ahead" refers to nothing in particular otherwise, and asking the
        // model to interpret it invites an answer about something else entirely.
        mockFindOne.mockResolvedValue(null);

        await outbound();

        expect(mockDetectDecision).not.toHaveBeenCalled();
    });
});

describe('confidence', () => {
    test('a low-confidence request is not queued', async () => {
        mockDetectTaskRequest.mockResolvedValue(detected({ confidence: 0.4, actionable: false }));

        await inbound();

        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a low-confidence decision is not staged', async () => {
        const pending = { _id: 'tr-1', status: 'pending', save: jest.fn() };
        mockFindOne.mockResolvedValue(pending);
        mockDetectDecision.mockResolvedValue({ intent: 'accept', confidence: 0.3, actionable: false, reason: '' });

        await outbound();

        expect(pending.save).not.toHaveBeenCalled();
    });
});

describe('the loops this could create', () => {
    test('never analyses a message this system wrote', async () => {
        // Our own follow-up question, read back as a client message, would queue a
        // request describing our own question.
        await inbound({ origin: 'portal-ai' });

        expect(mockDetectTaskRequest).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('never analyses a portal submission either', async () => {
        await inbound({ origin: 'portal-client' });

        expect(mockDetectTaskRequest).not.toHaveBeenCalled();
    });

    test('a second message on a thread does not create a second request', async () => {
        // A client answering our follow-up is still talking about the same work. Without
        // this, the more detail they gave the more duplicates they would get.
        mockFindOne.mockResolvedValue({ _id: 'tr-1', missingDetails: [], save: jest.fn() });

        await inbound();

        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('asks for missing details exactly once', async () => {
        const existing = { _id: 'tr-1', missingDetails: ['timing'], detailsRequestedAt: new Date(), save: jest.fn() };
        mockFindOne.mockResolvedValue(existing);
        mockDetectTaskRequest.mockResolvedValue(detected({ missing: ['timing'] }));

        await inbound();

        // Already asked. Asking again reads as a system that is not listening.
        expect(mockSendAutomatedReply).not.toHaveBeenCalled();
    });

    test('asks when details are missing on a new request', async () => {
        mockDetectTaskRequest.mockResolvedValue(detected({ missing: ['timing'] }));

        await inbound();

        expect(mockSendAutomatedReply).toHaveBeenCalled();
        expect(mockSendAutomatedReply.mock.calls[0][0].body).toMatch(/Please tell us timing/);
    });

    test('does not ask when nothing is missing', async () => {
        await inbound();

        expect(mockSendAutomatedReply).not.toHaveBeenCalled();
    });
});

describe('what is stored', () => {
    test('the description is redacted for the portal and kept raw for Zoho', async () => {
        mockDetectTaskRequest.mockResolvedValue(detected({
            description: 'This is Nitesh Kumar, call 913-269-8400 about the bowl',
        }));

        await inbound();

        const [doc] = mockCreate.mock.calls[0];
        expect(doc.descriptionRaw).toContain('Nitesh Kumar');
        expect(doc.description).not.toContain('Nitesh');
        expect(doc.description).not.toContain('913-269-8400');
    });

    test('links back to the message it was read from', async () => {
        // So the admin can check the model got it right rather than taking its word.
        await inbound();

        const [doc] = mockCreate.mock.calls[0];
        expect(doc.sourceThreadId).toBe('t1');
        expect(doc.sourceMessageId).toBe('m1');
        expect(doc.aiConfidence).toBe(0.9);
    });
});

describe('failures are silent, not fatal', () => {
    test('a model failure leaves the message alone', async () => {
        mockDetectTaskRequest.mockRejectedValue(new Error('OpenAI down'));

        await expect(inbound()).resolves.toBeNull();
    });

    test('a failed follow-up email does not lose the queued request', async () => {
        // The request is already useful; an admin can simply ask themselves.
        mockDetectTaskRequest.mockResolvedValue(detected({ missing: ['timing'] }));
        mockSendAutomatedReply.mockRejectedValue(new Error('Gmail down'));

        await expect(inbound()).resolves.toBeTruthy();
        expect(mockCreate).toHaveBeenCalled();
    });
});
