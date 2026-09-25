/**
 * Choosing which Zoho tasklist an approved request is filed under.
 *
 * The defences are the point of these tests, not the happy path. A model that picks a
 * plausible-looking list nobody offered, or that invents a list per request, degrades a
 * shared workspace in a way no single accept looks responsible for.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn());
const OpenAI = require('openai');

const { route, deterministicRoute, isUsableName, MAX_NAME_CHARS } = require('../../../Services/AI/TasklistRouterService.js');

const LISTS = [
    { id: 'tl-1', name: 'Seller Central Task' },
    { id: 'tl-2', name: 'Walmart' },
    { id: 'tl-3', name: 'Graphics' },
];

const answer = (payload) => ({ choices: [{ message: { content: JSON.stringify(payload) } }] });

const OLD_KEY = process.env.OPENAPI_KEY;
beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAPI_KEY = 'test-key';
    /**
     * Re-applied every test, not once in the factory.
     *
     * jest.config sets resetMocks, which strips mockImplementation off the constructor —
     * `new OpenAI()` then yields a bare {} whose `.chat` is undefined, the service throws
     * inside its own try, and every "the model said X" test quietly passes through the
     * deterministic fallback instead. Four of these tests passed for that reason before
     * this line existed.
     */
    OpenAI.mockImplementation(() => ({
        chat: { completions: { create: (...a) => mockCreate(...a) } },
    }));
});
afterAll(() => { process.env.OPENAPI_KEY = OLD_KEY; });

describe('it will not act on an answer it cannot verify', () => {
    test('an id nobody offered is a hallucination, not a choice', async () => {
        // The single most dangerous failure: a confident answer naming a list that does
        // not exist would file the task into nothing and look successful.
        mockCreate.mockResolvedValue(answer({ tasklistId: 'tl-999', confidence: 'high' }));

        const result = await route({ title: 'Something', tasklists: LISTS });

        expect(result.tasklistId).toBeNull();
        expect(result.chosenBy).toBe('none');
    });

    test('low confidence is demoted rather than acted on', async () => {
        mockCreate.mockResolvedValue(answer({ tasklistId: 'tl-2', confidence: 'low' }));

        const result = await route({ title: 'Something vague', tasklists: LISTS });

        expect(result.tasklistId).toBeNull();
    });

    test('the name comes from our own list, never the model’s echo of it', async () => {
        // A model returning the right id with a wrong name must not get to relabel a
        // tasklist in our records.
        mockCreate.mockResolvedValue(answer({
            tasklistId: 'tl-2', confidence: 'high', name: 'Walmart Marketplace Work',
        }));

        const result = await route({ title: 'Walmart fix', tasklists: LISTS });

        expect(result.tasklistId).toBe('tl-2');
        expect(result.tasklistName).toBe('Walmart');
        // Provenance asserted so the token fallback cannot satisfy this test.
        expect(result.chosenBy).toBe('ai');
    });

    test('unparseable JSON falls back instead of throwing', async () => {
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

        const result = await route({ title: 'Walmart listing fix', tasklists: LISTS });

        // Token fallback still finds Walmart here.
        expect(result.chosenBy).toBe('tokens');
        expect(result.tasklistId).toBe('tl-2');
    });

    test('a thrown model call is never fatal', async () => {
        mockCreate.mockRejectedValue(new Error('429 rate limited'));

        await expect(route({ title: 'Anything at all', tasklists: LISTS })).resolves.toMatchObject({
            chosenBy: expect.any(String),
        });
    });
});

describe('proposing a new list', () => {
    test('a sensible category is passed back for the caller to create', async () => {
        mockCreate.mockResolvedValue(answer({
            tasklistId: null, confidence: 'high', newTasklistName: 'Video Production',
        }));

        const result = await route({ title: 'Record a brand jingle', tasklists: LISTS });

        expect(result.newTasklistName).toBe('Video Production');
        expect(result.tasklistId).toBeNull();
        expect(result.chosenBy).toBe('ai');
    });

    test('a name that names the client is refused', async () => {
        /**
         * A tasklist is a permanent label in a workspace that other clients' work also
         * lives in. "Nitesh Kumar video" would outlive the request that created it.
         */
        const bundle = { names: ['Nitesh Kumar'], emails: [], phones: [], domains: [] };
        mockCreate.mockResolvedValue(answer({
            tasklistId: null, confidence: 'high', newTasklistName: 'Nitesh Kumar video',
        }));

        const result = await route({ title: 'A video', tasklists: LISTS, bundle });

        expect(result.newTasklistName).toBeNull();
    });

    test.each([
        ['', 'empty'],
        ['ab', 'too short'],
        ['x'.repeat(MAX_NAME_CHARS + 1), 'too long'],
        ['Please create a list for product videos.', 'a sentence, not a label'],
    ])('refuses %j (%s)', (name) => {
        expect(isUsableName(name)).toBe(false);
    });

    test('accepts a plain short category', () => {
        expect(isUsableName('Video Production')).toBe(true);
        expect(isUsableName('PPC')).toBe(true);
    });
});

describe('the deterministic fallback', () => {
    test('matches when every distinctive word in the list name appears', () => {
        expect(deterministicRoute('Walmart listing fix needed', LISTS)).toMatchObject({ id: 'tl-2' });
    });

    test('will not match on one word of a multi-word list name', () => {
        // "Seller Central Task" must not swallow anything mentioning "seller".
        expect(deterministicRoute('The seller wants a refund', LISTS)).toBeNull();
    });

    test('returns nothing rather than guessing', () => {
        expect(deterministicRoute('Record a brand jingle', LISTS)).toBeNull();
    });

    test('is what runs when there is no API key', async () => {
        /**
         * Re-required rather than just unsetting the key: the service memoises its client
         * for the life of the process, so a client built by an earlier test in this file
         * would still be there and this would pass or fail on test ORDER. That memoising
         * is deliberate in the service; it just has to be stepped around here.
         */
        delete process.env.OPENAPI_KEY;
        jest.resetModules();
        // eslint-disable-next-line global-require
        const fresh = require('../../../Services/AI/TasklistRouterService.js');

        const result = await fresh.route({ title: 'Walmart listing fix', tasklists: LISTS });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(result.chosenBy).toBe('tokens');
        expect(result.tasklistId).toBe('tl-2');
    });
});

describe('nothing to choose from', () => {
    test('no tasklists means no call and no choice', async () => {
        const result = await route({ title: 'Anything', tasklists: [] });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(result.chosenBy).toBe('none');
    });

    test('candidates missing an id or name are discarded', async () => {
        const result = await route({ title: 'x', tasklists: [{ id: null, name: 'Broken' }, { id: 'a' }] });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(result.chosenBy).toBe('none');
    });
});
