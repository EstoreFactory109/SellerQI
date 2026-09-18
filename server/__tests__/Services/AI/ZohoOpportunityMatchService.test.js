/**
 * Matching the Dashboard's "Top things to fix" against open Zoho tasks.
 *
 * The property that matters is the DIRECTION of the errors, not the hit rate. A
 * duplicate row in Coming up is an annoyance an account manager explains away; wrongly
 * marking a problem "already covered" hides the biggest issue on an account the seller
 * is paying to have audited, and nothing in the UI would ever reveal it.
 *
 * So every ambiguous case below must resolve to covered: false.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
})));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const ORIGINAL_KEY = process.env.OPENAPI_KEY;

const loadService = (apiKey) => {
    if (apiKey === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = apiKey;
    jest.resetModules();
    return require('../../../Services/AI/ZohoOpportunityMatchService.js');
};

const OPPORTUNITIES = [
    { candidateId: 'o1', title: 'Listings missing bullet points', action: 'Rewrite bullets for 12 ASINs' },
    { candidateId: 'o2', title: 'Keywords spending with zero sales', action: 'Pause wasted ad spend' },
];

const TASKS = [
    { taskId: 't1', name: 'Content Phase 1', tasklist: 'Content' },
    { taskId: 't2', name: 'SEO content', tasklist: 'Content' },
];

const aiReplies = (matches) => mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ matches }) } }],
});

afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = ORIGINAL_KEY;
});

beforeEach(() => mockCreate.mockReset());

describe('hashInputs', () => {
    test('is order-independent but content-sensitive', () => {
        const svc = loadService('key');
        const base = svc.hashInputs(OPPORTUNITIES, TASKS);

        // Zoho returns tasks in no guaranteed order; re-matching on reorder alone would
        // pay for a call a night for nothing.
        expect(svc.hashInputs([...OPPORTUNITIES].reverse(), [...TASKS].reverse())).toBe(base);

        // A NEW task must invalidate: it might be the one that covers an opportunity.
        expect(svc.hashInputs(OPPORTUNITIES, [...TASKS, { taskId: 't3', name: 'Bullets' }])).not.toBe(base);
        // And so must a renamed one.
        expect(svc.hashInputs(OPPORTUNITIES, [{ ...TASKS[0], name: 'Renamed' }, TASKS[1]])).not.toBe(base);
    });
});

describe('conservative bias', () => {
    test('a low-confidence match is treated as not covered', async () => {
        const svc = loadService('key');
        aiReplies([{ candidateId: 'o1', covered: true, taskId: 't1', confidence: 'low' }]);

        const { matches } = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(matches.find((m) => m.candidateId === 'o1').covered).toBe(false);
    });

    test('a match naming a task we never sent is discarded, not trusted', async () => {
        const svc = loadService('key');
        aiReplies([{ candidateId: 'o1', covered: true, taskId: 'task-that-does-not-exist', confidence: 'high' }]);

        const { matches } = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        // A hallucinated id must not silently remove a real problem from the page.
        expect(matches.find((m) => m.candidateId === 'o1').covered).toBe(false);
    });

    test('an opportunity the model forgot stays visible', async () => {
        const svc = loadService('key');
        aiReplies([{ candidateId: 'o1', covered: false, confidence: 'high' }]);

        const { matches } = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        // Silence must not read as "covered" — o2 was never mentioned in the reply.
        expect(matches).toHaveLength(2);
        expect(matches.find((m) => m.candidateId === 'o2')).toMatchObject({ covered: false });
    });

    test('a duplicated candidateId cannot flip an earlier answer', async () => {
        const svc = loadService('key');
        aiReplies([
            { candidateId: 'o1', covered: false, confidence: 'high' },
            { candidateId: 'o1', covered: true, taskId: 't1', confidence: 'high' },
        ]);

        const { matches } = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(matches.filter((m) => m.candidateId === 'o1')).toHaveLength(1);
        expect(matches.find((m) => m.candidateId === 'o1').covered).toBe(false);
    });

    test('accepts a well-formed high-confidence match', async () => {
        const svc = loadService('key');
        aiReplies([{ candidateId: 'o1', covered: true, taskId: 't1', confidence: 'high' }]);

        const { matches } = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(matches.find((m) => m.candidateId === 'o1')).toMatchObject({
            covered: true, coveredByTaskId: 't1', coveredByTaskName: 'Content Phase 1', matchedBy: 'ai',
        });
    });
});

describe('never hard-fails', () => {
    test('falls back to token matching with no API key', async () => {
        const svc = loadService(undefined);

        const out = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(out.generatedBy).toBe('fallback');
        expect(out.matches).toHaveLength(2);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('falls back when the call throws', async () => {
        const svc = loadService('key');
        mockCreate.mockRejectedValue(new Error('429 rate limited'));

        const out = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(out.generatedBy).toBe('fallback');
        expect(out.matches).toHaveLength(2);
    });

    test('falls back on unparseable JSON rather than throwing', async () => {
        const svc = loadService('key');
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

        const out = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: TASKS });

        expect(out.generatedBy).toBe('fallback');
    });

    test('spends no call when there are no open tasks to collide with', async () => {
        const svc = loadService('key');

        const out = await svc.matchOpportunities({ opportunities: OPPORTUNITIES, tasks: [] });

        expect(out.matches.every((m) => !m.covered)).toBe(true);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('spends no call when there are no opportunities', async () => {
        const svc = loadService('key');

        const out = await svc.matchOpportunities({ opportunities: [], tasks: TASKS });

        expect(out.matches).toEqual([]);
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('deterministicMatch', () => {
    test('does not match on a single generic word', () => {
        const svc = loadService('key');

        // "Inventory restock" vs "unfulfillable inventory" are different work; one
        // shared word must not suppress the second.
        const out = svc.deterministicMatch(
            [{ candidateId: 'o1', title: 'Unfulfillable inventory sitting in FBA', action: '' }],
            [{ taskId: 't1', name: 'Inventory restock planning' }]
        );

        expect(out[0].covered).toBe(false);
    });

    test('matches when several distinctive words line up', () => {
        const svc = loadService('key');

        const out = svc.deterministicMatch(
            [{ candidateId: 'o1', title: 'Unfulfillable inventory in FBA', action: '' }],
            [{ taskId: 't1', name: 'Unfulfillable inventory' }]
        );

        expect(out[0]).toMatchObject({ covered: true, coveredByTaskId: 't1', matchedBy: 'tokens' });
    });

    test('an opportunity of only noise words matches nothing', () => {
        const svc = loadService('key');

        const out = svc.deterministicMatch(
            [{ candidateId: 'o1', title: 'Fix the listing', action: '' }],
            [{ taskId: 't1', name: 'Fix the listing task' }]
        );

        // Every word here is a noise word; matching on them would cover everything.
        expect(out[0].covered).toBe(false);
    });
});

describe('reuse', () => {
    test('an unchanged pairing reuses the stored matches and calls no model', async () => {
        const svc = loadService('key');
        const stored = [{ candidateId: 'o1', covered: true, coveredByTaskId: 't1', matchedBy: 'ai' }];

        const out = await svc.matchOpportunities({
            opportunities: OPPORTUNITIES,
            tasks: TASKS,
            previous: { hash: svc.hashInputs(OPPORTUNITIES, TASKS), version: svc.PROMPT_VERSION, matches: stored },
        });

        expect(out.reused).toBe(true);
        expect(out.matches).toEqual(stored);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a prompt-version bump re-matches even when nothing else moved', async () => {
        const svc = loadService('key');
        aiReplies([{ candidateId: 'o1', covered: false, confidence: 'high' }]);

        const out = await svc.matchOpportunities({
            opportunities: OPPORTUNITIES,
            tasks: TASKS,
            previous: {
                hash: svc.hashInputs(OPPORTUNITIES, TASKS),
                version: svc.PROMPT_VERSION - 1,
                matches: [{ candidateId: 'o1', covered: true }],
            },
        });

        // Otherwise an improved prompt would never reach the accounts already matched.
        expect(out.reused).toBe(false);
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test('a new task invalidates reuse', async () => {
        const svc = loadService('key');
        aiReplies([]);

        const out = await svc.matchOpportunities({
            opportunities: OPPORTUNITIES,
            tasks: [...TASKS, { taskId: 't9', name: 'Bullet point rewrite' }],
            previous: { hash: svc.hashInputs(OPPORTUNITIES, TASKS), version: svc.PROMPT_VERSION, matches: [] },
        });

        expect(out.reused).toBe(false);
    });
});
