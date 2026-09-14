/**
 * Summarising a Zoho task's comment thread for the client.
 *
 * Two properties matter most here and neither is about prose quality:
 *   1. The feature never hard-fails on the LLM — no key, a thrown call, an
 *      empty completion all still produce something readable, because a task
 *      row with a blank detail panel is worse than a plain one.
 *   2. An unchanged thread is never re-summarised. The nightly sync sees ~76
 *      threads that mostly sit still for weeks; without the hash check that is
 *      thousands of paid calls a year regenerating identical text.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
})));

const ORIGINAL_KEY = process.env.OPENAPI_KEY;

/** The module caches its client, so each key scenario needs a fresh require. */
const loadService = (apiKey) => {
    if (apiKey === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = apiKey;
    jest.resetModules();
    return require('../../../Services/AI/ZohoTaskSummaryService.js');
};

const comment = (i, content, author = 'Priya') => ({
    id: `c${i}`, content, authorName: author, createdAt: `2026-09-0${i}T10:00:00.000Z`,
});

const THREAD = [
    comment(1, 'Pulled the top converting search terms for the listing.'),
    comment(2, 'Second draft sent for review.', 'Marcus'),
    comment(3, 'Waiting on the client for product photos.'),
];

/** The model now answers with JSON: a summary plus an optional pending ask. */
const aiReplies = (summary, waitingOnClient = null) =>
    mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ summary, waitingOnClient }) } }],
    });
const aiRepliesRaw = (content) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });

afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAPI_KEY;
    else process.env.OPENAPI_KEY = ORIGINAL_KEY;
});

beforeEach(() => {
    mockCreate.mockReset();
});

describe('hashThread', () => {
    test('is stable for the same thread and changes when content does', () => {
        const svc = loadService('key');
        const base = svc.hashThread(THREAD);

        expect(svc.hashThread([...THREAD])).toBe(base);
        expect(svc.hashThread([...THREAD, comment(4, 'New update')])).not.toBe(base);
        // An edit must invalidate too — not just an added comment.
        expect(svc.hashThread([{ ...THREAD[0], content: 'edited' }, ...THREAD.slice(1)])).not.toBe(base);
    });
});

describe('summariseTask — reuse', () => {
    test('an unchanged thread reuses the stored text and calls no model', async () => {
        const svc = loadService('key');
        const hash = svc.hashThread(THREAD);

        const out = await svc.summariseTask(
            { name: 'T', comments: THREAD },
            { previousHash: hash, previousText: 'Stored summary.', previousVersion: svc.PROMPT_VERSION }
        );

        expect(out.reused).toBe(true);
        expect(out.text).toBe('Stored summary.');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a changed thread is re-summarised', async () => {
        const svc = loadService('key');
        aiReplies('Fresh summary.');

        const out = await svc.summariseTask(
            { name: 'T', comments: [...THREAD, comment(4, 'Photos received.')] },
            { previousHash: svc.hashThread(THREAD), previousText: 'Stored summary.', previousVersion: svc.PROMPT_VERSION }
        );

        expect(out.reused).toBe(false);
        expect(out.text).toBe('Fresh summary.');
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });
});

describe('summariseTask — never hard-fails', () => {
    test('falls back when no API key is configured', async () => {
        const svc = loadService(undefined);
        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.generatedBy).toBe('fallback');
        expect(out.text).toContain('Waiting on the client for product photos.');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('falls back when the call throws', async () => {
        const svc = loadService('key');
        mockCreate.mockRejectedValue(new Error('429 rate limited'));

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.generatedBy).toBe('fallback');
        expect(out.text.length).toBeGreaterThan(0);
    });

    test('falls back when the model returns empty content', async () => {
        const svc = loadService('key');
        aiRepliesRaw('   ');

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.generatedBy).toBe('fallback');
    });

    test('does not spend a call on a thread too thin to summarise', async () => {
        const svc = loadService('key');
        const out = await svc.summariseTask({ name: 'T', comments: [comment(1, 'Done.')] });

        expect(out.generatedBy).toBe('fallback');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('an empty thread says so rather than returning nothing', async () => {
        const svc = loadService('key');
        const out = await svc.summariseTask({ name: 'T', comments: [] });

        expect(out.text).toBe('No updates on this task yet.');
        expect(out.commentCount).toBe(0);
    });
});

describe('deterministicSummary', () => {
    test('skips a leading mention-only line', () => {
        const svc = loadService('key');
        // Real Zoho comments open by tagging whoever is being asked, so the first
        // line is often just names — reporting that as "the latest update" is useless.
        const out = svc.deterministicSummary([
            comment(1, '@Bhavdeep Lalakiya, @Nora Shah\nLabels are finalised and uploaded.'),
        ]);

        expect(out).toContain('Labels are finalised and uploaded.');
        expect(out).not.toContain('@Nora Shah');
    });

    test('reports the newest comment and counts the rest', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary(THREAD);

        expect(out).toContain('Waiting on the client for product photos.');
        expect(out).toContain('2 earlier updates');
    });

    test('clips a very long line', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary([comment(1, 'x'.repeat(500)), comment(2, 'y'.repeat(500))]);
        expect(out).toContain('…');
        expect(out.length).toBeLessThan(320);
    });
});

describe('summariseTask — prompt', () => {
    test('bounds a runaway thread instead of sending all of it', async () => {
        const svc = loadService('key');
        aiReplies('Summary.');
        const huge = Array.from({ length: 200 }, (_, i) => comment(1, `Update ${i} ${'z'.repeat(200)}`));

        await svc.summariseTask({ name: 'T', comments: huge });

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        // One pathological thread must not dominate the nightly token spend.
        expect(userMessage.length).toBeLessThan(7000);
        // The END is kept — the latest state is what a progress update is about.
        expect(userMessage).toContain('Update 199');
    });

    test('sends the task name so the model has context', async () => {
        const svc = loadService('key');
        aiReplies('Summary.');

        await svc.summariseTask({ name: 'Rewriting bullet points', comments: THREAD });

        expect(mockCreate.mock.calls[0][0].messages[1].content).toContain('Rewriting bullet points');
    });
});

describe('summariseTask — prompt versioning', () => {
    test('an unchanged thread is re-summarised when the prompt version moved on', async () => {
        const svc = loadService('key');
        aiReplies('Regenerated.');

        const out = await svc.summariseTask(
            { name: 'T', comments: THREAD },
            {
                previousHash: svc.hashThread(THREAD),
                previousText: 'Written by the old prompt.',
                previousVersion: svc.PROMPT_VERSION - 1,
            }
        );

        // The thread is identical, so the hash alone would have served stale text
        // produced by a prompt we no longer use.
        expect(out.reused).toBe(false);
        expect(out.text).toBe('Regenerated.');
    });

    test('reuse carries the previously detected ask, not just the summary', async () => {
        const svc = loadService('key');
        const ask = { ask: 'Send four lifestyle photos', kind: 'photos' };

        const out = await svc.summariseTask(
            { name: 'T', comments: THREAD },
            {
                previousHash: svc.hashThread(THREAD),
                previousText: 'Stored.',
                previousVersion: svc.PROMPT_VERSION,
                previousAsk: ask,
            }
        );

        // Dropping it on reuse would make the Waiting-on-you banner empty itself
        // on the first night nothing changed.
        expect(out.waitingOnClient).toEqual(ask);
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('waitingOnClient extraction', () => {
    test('passes through a well-formed ask', async () => {
        const svc = loadService('key');
        aiReplies('We need photos.', { ask: 'Send four lifestyle photos', kind: 'photos' });

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toEqual({ ask: 'Send four lifestyle photos', kind: 'photos' });
    });

    test('null is a normal answer, not a failure', async () => {
        const svc = loadService('key');
        aiReplies('Work is progressing.', null);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toBeNull();
        expect(out.generatedBy).toBe('ai');
    });

    test('an unknown kind is coerced rather than shown raw', async () => {
        const svc = loadService('key');
        aiReplies('S.', { ask: 'Do the thing', kind: 'wildly-invented-kind' });

        // The UI maps kind to a label; an unmapped value would render blank.
        expect((await svc.summariseTask({ name: 'T', comments: THREAD })).waitingOnClient)
            .toEqual({ ask: 'Do the thing', kind: 'other' });
    });

    test('drops a malformed or empty ask instead of showing an empty banner row', async () => {
        const svc = loadService('key');
        for (const bad of [{ kind: 'photos' }, { ask: '', kind: 'photos' }, 'not an object', { ask: 'x'.repeat(400) }]) {
            aiReplies('S.', bad);
            expect((await svc.summariseTask({ name: 'T', comments: THREAD })).waitingOnClient).toBeNull();
        }
    });

    test('falls back with no ask when the model returns unparseable JSON', async () => {
        const svc = loadService('key');
        aiRepliesRaw('this is not json');

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.generatedBy).toBe('fallback');
        expect(out.waitingOnClient).toBeNull();
        expect(out.text.length).toBeGreaterThan(0);
    });
});
