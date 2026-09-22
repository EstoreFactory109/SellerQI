/**
 * The model layer over deterministic redaction.
 *
 * The property under test is not "the AI does a good job" — it is that the AI cannot
 * make things WORSE than the deterministic pass, on any path. Three ways it could:
 *
 *   it reintroduces identity (including a hallucinated name, which is worse than the
 *     real one because staff have no reason to doubt it)
 *   it deletes the message instead of cleaning it
 *   it is unavailable, and the fallback shows raw text
 *
 * All three are rejected here. Note the fallback direction is the opposite of
 * ZohoTaskSummaryService's: falling back to "more raw text" would fall back to exactly
 * what must be hidden, so this one fails CLOSED on content.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
})));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { buildIdentityBundle } = require('../../../Services/Email/identityRedaction.js');

const ORIGINAL_KEY = process.env.OPENAPI_KEY;

const load = (apiKey) => {
    if (apiKey === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = apiKey;
    jest.resetModules();
    return require('../../../Services/AI/EmailRedactionService.js');
};

const CLIENT = {
    firstName: 'Nitesh', lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '+1-913-269-8400',
};
const bundle = buildIdentityBundle(CLIENT);

const BODY = 'Please hold the listings until Friday. Call me on 913-269-8400 if urgent. Thanks, Nitesh Kumar';
const IDENTIFYING = /nitesh|kumar|morgansrepellent|913.?269.?8400/i;

const aiReturns = (text) => mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ text, removed: 1 }) } }],
});

afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = ORIGINAL_KEY;
});

beforeEach(() => mockCreate.mockReset());

describe('the model never sees the identifiers we already hold', () => {
    test('sends the deterministically-redacted text, not the original', async () => {
        const svc = load('key');
        aiReturns('Please hold the listings until Friday. Call if urgent.');

        await svc.redactBody(BODY, bundle);

        const sent = mockCreate.mock.calls[0][0].messages[1].content;
        // This is a third-party disclosure question as much as a technical one: the
        // client's name and number never leave our servers.
        expect(sent).not.toMatch(IDENTIFYING);
        expect(sent).toContain('[phone]');
    });
});

describe('never hard-fails, and never falls back to raw text', () => {
    test('no API key returns the deterministic text', async () => {
        const svc = load(undefined);

        const out = await svc.redactBody(BODY, bundle);

        expect(out.generatedBy).toBe('deterministic');
        expect(out.text).not.toMatch(IDENTIFYING);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a failed call returns the deterministic text', async () => {
        const svc = load('key');
        mockCreate.mockRejectedValue(new Error('429 rate limited'));

        const out = await svc.redactBody(BODY, bundle);

        expect(out.generatedBy).toBe('deterministic');
        expect(out.text).not.toMatch(IDENTIFYING);
    });

    test('unparseable JSON returns the deterministic text', async () => {
        const svc = load('key');
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

        expect((await svc.redactBody(BODY, bundle)).generatedBy).toBe('deterministic');
    });

    test('an oversized body skips the model rather than paying to tidy it', async () => {
        const svc = load('key');

        const out = await svc.redactBody('x'.repeat(7000), bundle);

        expect(out.generatedBy).toBe('deterministic');
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('the model output is gated, not trusted', () => {
    test('rejects output that reintroduced a name', async () => {
        const svc = load('key');
        aiReturns('Nitesh asked us to hold the listings until Friday.');

        const out = await svc.redactBody(BODY, bundle);

        expect(out.generatedBy).toBe('deterministic');
        expect(out.text).not.toMatch(IDENTIFYING);
    });

    test('rejects output that reintroduced a phone number', async () => {
        const svc = load('key');
        aiReturns('Hold the listings. Call 913-269-8400 if urgent, thanks very much.');

        expect((await svc.redactBody(BODY, bundle)).generatedBy).toBe('deterministic');
    });

    test('rejects output that grew — the shape of an invented name', async () => {
        const svc = load('key');
        aiReturns(`${BODY.replace(/Nitesh Kumar/, 'the client')} ${'and more invented content '.repeat(12)}`);

        expect((await svc.redactBody(BODY, bundle)).generatedBy).toBe('deterministic');
    });

    test('rejects output that deleted the message instead of cleaning it', async () => {
        const svc = load('key');
        aiReturns('Hold.');

        expect((await svc.redactBody(BODY, bundle)).generatedBy).toBe('deterministic');
    });

    test('rejects empty output', async () => {
        const svc = load('key');
        aiReturns('   ');

        expect((await svc.redactBody(BODY, bundle)).generatedBy).toBe('deterministic');
    });

    test('accepts a clean repair and uses it', async () => {
        const svc = load('key');
        const repaired = 'Please hold the listings until Friday. Call the number given if urgent.';
        aiReturns(repaired);

        const out = await svc.redactBody(BODY, bundle);

        expect(out.generatedBy).toBe('ai');
        expect(out.text).toBe(repaired);
    });
});

describe('validate', () => {
    test('is the gate, independent of the prompt', () => {
        const svc = load('key');
        const input = 'Hold the listings until Friday, please confirm receipt today.';

        expect(svc.validate('Hold the listings until Friday, please confirm today.', input, bundle).ok).toBe(true);
        expect(svc.validate('Nitesh says hold the listings until Friday please.', input, bundle).ok).toBe(false);
        expect(svc.validate('', input, bundle).ok).toBe(false);
        expect(svc.validate(null, input, bundle).ok).toBe(false);
    });
});

describe('reuse', () => {
    test('unchanged text with the same version is not re-processed', async () => {
        const svc = load('key');
        const hash = svc.hashInput(BODY);

        const out = await svc.redactBody(BODY, bundle, {
            previousHash: hash, previousText: 'Stored clean text.', previousVersion: svc.REDACTION_VERSION,
        });

        expect(out.reused).toBe(true);
        expect(out.text).toBe('Stored clean text.');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a version bump re-processes even though the text is identical', async () => {
        const svc = load('key');
        aiReturns('Freshly cleaned text that is long enough to pass validation.');

        const out = await svc.redactBody(BODY, bundle, {
            previousHash: svc.hashInput(BODY),
            previousText: 'Stale text from an older prompt.',
            previousVersion: svc.REDACTION_VERSION - 1,
        });

        // Otherwise an improved prompt never reaches the messages already stored.
        expect(out.reused).toBe(false);
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });
});

describe('the prompt forbids the dangerous edit', () => {
    test('instructs against summarising and against dropping negations', async () => {
        const svc = load('key');
        aiReturns('Please hold the listings until Friday. Call if urgent, thank you.');

        await svc.redactBody(BODY, bundle);
        const system = mockCreate.mock.calls[0][0].messages[0].content;

        // Staff act on these emails. A model that quietly turns "do not publish" into
        // "publish" is an operational incident, not a privacy one.
        expect(system).toMatch(/do not publish/i);
        expect(system).toMatch(/NOT summarise|not summarise/i);
        expect(system).toMatch(/companies|COMPANIES/i);
    });
});
