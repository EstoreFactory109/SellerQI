/**
 * Summarising a Zoho task's comment thread for the client — date-wise.
 *
 * Three properties matter most here, and none of them is about prose quality:
 *   1. The feature never hard-fails on the LLM — no key, a thrown call, an
 *      empty completion, or a response with the WRONG NUMBER of day entries
 *      all still produce something readable, because a task row with a blank
 *      detail panel is worse than a plain one.
 *   2. An unchanged thread is never re-summarised. The nightly sync sees ~76
 *      threads that mostly sit still for weeks; without the hash check that is
 *      thousands of paid calls a year regenerating identical text.
 *   3. The model NEVER supplies a date. Real calendar days are grouped by us,
 *      the model returns one prose entry per day IN ORDER, and we zip that
 *      array back together with our own date labels by position. A response
 *      whose day count does not match the day blocks we sent is untrustworthy
 *      end to end and is treated exactly like unparseable JSON.
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

/** Each comment lands on its OWN calendar day by default — 1, 2, 3 Sep. */
const comment = (i, content, author = 'Priya', day = i) => ({
    id: `c${i}`, content, authorName: author, createdAt: `2026-09-0${day}T10:00:00.000Z`,
});

/** Three comments, three distinct days — the thread every test builds on. */
const THREAD = [
    comment(1, 'Pulled the top converting search terms for the listing.'),
    comment(2, 'Second draft sent for review.', 'Marcus'),
    comment(3, 'Waiting on the client for product photos.'),
];

/**
 * The model now answers with one "days" entry per day block it was given, in
 * order — never a single blended "summary" string. `texts` must have exactly
 * as many entries as the thread has distinct days, or the test is describing
 * a response that summariseTask would itself reject.
 */
const aiReplies = (texts, waitingOnClient = null, team = undefined) =>
    mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ days: texts, waitingOnClient, ...(team !== undefined ? { team } : {}) }) } }],
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

describe('groupByDay', () => {
    test('groups comments onto the same day and keeps distinct days separate', () => {
        const svc = loadService('key');
        const sameDay = [comment(1, 'first', 'Priya', 1), comment(2, 'second', 'Marcus', 1)];
        const groups = svc.groupByDay(sameDay);

        expect(groups).toHaveLength(1);
        expect(groups[0].comments).toHaveLength(2);
    });

    test('orders days oldest first regardless of input order', () => {
        const svc = loadService('key');
        const shuffled = [comment(3, 'c'), comment(1, 'a'), comment(2, 'b')];

        expect(svc.groupByDay(shuffled).map((g) => g.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    });

    test('an unparseable date gets its own bucket, sorted last, rather than being dropped', () => {
        const svc = loadService('key');
        const withBadDate = [...THREAD, { id: 'c9', content: 'x', authorName: 'A', createdAt: 'not-a-date' }];

        const keys = svc.groupByDay(withBadDate).map((g) => g.key);
        expect(keys).toContain('undated');
        expect(keys.indexOf('undated')).toBe(keys.length - 1);
    });
});

describe('formatDayLabel', () => {
    test('renders a real date as day + short month, in UTC', () => {
        const svc = loadService('key');
        expect(svc.formatDayLabel('2026-01-05')).toMatch(/^5 Jan/);
    });

    test('a null key reads as "Undated" rather than crashing', () => {
        const svc = loadService('key');
        expect(svc.formatDayLabel(null)).toBe('Undated');
    });
});

describe('summariseTask — reuse', () => {
    test('an unchanged thread reuses the stored text and calls no model', async () => {
        const svc = loadService('key');
        const hash = svc.hashThread(THREAD);

        const out = await svc.summariseTask(
            { name: 'T', comments: THREAD },
            { previousHash: hash, previousText: '1 Sep: Stored summary.', previousVersion: svc.PROMPT_VERSION }
        );

        expect(out.reused).toBe(true);
        expect(out.text).toBe('1 Sep: Stored summary.');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('a changed thread is re-summarised', async () => {
        const svc = loadService('key');
        // THREAD plus a 4th comment on its own (4th) day — four distinct days,
        // so the mocked reply needs four entries to match.
        aiReplies(['Pulled search terms.', 'Draft sent for review.', 'Waiting on photos.', 'Photos received, fresh update.']);

        const out = await svc.summariseTask(
            { name: 'T', comments: [...THREAD, comment(4, 'Photos received.')] },
            { previousHash: svc.hashThread(THREAD), previousText: 'Stored summary.', previousVersion: svc.PROMPT_VERSION }
        );

        expect(out.reused).toBe(false);
        expect(out.text).toContain('Photos received, fresh update.');
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });
});

describe('summariseTask — the day-for-day contract', () => {
    test('builds one dated line per distinct day, oldest first', async () => {
        const svc = loadService('key');
        aiReplies(['Pulled the top converting search terms.', 'Second draft sent for review.', 'Waiting on the client for photos.']);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.text).toBe(
            '1 Sept: Pulled the top converting search terms.\n'
            + '2 Sept: Second draft sent for review.\n'
            + '3 Sept: Waiting on the client for photos.'
        );
    });

    test('an empty string for a day omits that day entirely, not a blank line', async () => {
        const svc = loadService('key');
        // The middle day was nothing but "ok, thanks" — the model is told to
        // return "" for exactly that case.
        aiReplies(['Pulled the top converting search terms.', '', 'Waiting on the client for photos.']);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.text).toBe('1 Sept: Pulled the top converting search terms.\n3 Sept: Waiting on the client for photos.');
        expect(out.text).not.toContain('2 Sep');
    });

    test('every day coming back empty reads as "no detailed updates", not a blank panel', async () => {
        const svc = loadService('key');
        aiReplies(['', '', '']);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.text).toBe('No detailed updates on this task yet.');
    });

    test('a response with TOO FEW day entries is rejected wholesale, not zipped partially', async () => {
        // This is the core safety property: a 2-entry reply against a 3-day thread
        // cannot be trusted to line up with the right dates, so none of it is used.
        const svc = loadService('key');
        aiReplies(['Day one text.', 'Day two text.']);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.generatedBy).toBe('fallback');
        expect(out.text).not.toContain('Day one text');
    });

    test('a response with TOO MANY day entries is rejected the same way', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c', 'd']);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.generatedBy).toBe('fallback');
    });

    test('"days" missing from the response entirely falls back', async () => {
        const svc = loadService('key');
        aiRepliesRaw(JSON.stringify({ summary: 'the old single-string shape', waitingOnClient: null }));

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.generatedBy).toBe('fallback');
    });

    test('"days" that is not an array falls back', async () => {
        const svc = loadService('key');
        aiRepliesRaw(JSON.stringify({ days: 'one two three', waitingOnClient: null }));

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.generatedBy).toBe('fallback');
    });

    test('a non-string entry in an otherwise correctly-sized array is dropped, not crashed on', async () => {
        const svc = loadService('key');
        aiReplies([42, 'Second draft sent for review.', null]);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });

        expect(out.text).toBe('2 Sept: Second draft sent for review.');
    });

    test('more than MAX_DAYS_IN_SUMMARY distinct days shows only the most recent, with a count', async () => {
        const svc = loadService('key');
        const many = Array.from({ length: svc.MAX_DAYS_IN_SUMMARY + 3 }, (_, i) => comment(i, `Update on day ${i}.`, 'Priya', i + 1));
        aiReplies(Array.from({ length: svc.MAX_DAYS_IN_SUMMARY }, (_, i) => `Entry ${i}.`));

        const out = await svc.summariseTask({ name: 'T', comments: many });

        expect(out.text.split('\n')).toHaveLength(svc.MAX_DAYS_IN_SUMMARY);
        // The model is asked for exactly MAX_DAYS_IN_SUMMARY entries — the three
        // oldest days were windowed out before the prompt was even built.
        expect(mockCreate.mock.calls[0][0].messages[1].content.match(/Day \d+ \(/g)).toHaveLength(svc.MAX_DAYS_IN_SUMMARY);
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

    test('reports one dated line per distinct day, in order', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary(THREAD);

        expect(out).toBe(
            '1 Sept: Pulled the top converting search terms for the listing.\n'
            + '2 Sept: Second draft sent for review.\n'
            + '3 Sept: Waiting on the client for product photos.'
        );
    });

    test('within one day, picks the latest substantive line, not an earlier one', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary([
            comment(1, 'First thing that happened today.', 'Priya', 1),
            comment(2, 'Second, more recent thing today.', 'Marcus', 1),
        ]);

        expect(out).toContain('Second, more recent thing today.');
        expect(out).not.toContain('First thing that happened today.');
    });

    test('a trailing ack the same day does not hide the real update earlier that day', () => {
        const svc = loadService('key');
        // Scans backward from the latest comment of the day; "thanks!" alone is
        // mention-only-adjacent noise and must not become "the update".
        const out = svc.deterministicSummary([
            comment(1, 'Draft sent for review.', 'Priya', 1),
            comment(2, 'thanks!', 'Marcus', 1),
        ]);

        expect(out).toContain('Draft sent for review.');
    });

    test('clips a very long line', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary([comment(1, 'x'.repeat(500), 'Priya', 1)]);
        expect(out).toContain('…');
        expect(out.length).toBeLessThan(260);
    });

    test('more than MAX_DAYS_IN_SUMMARY days collapses the oldest into a trailing count', () => {
        const svc = loadService('key');
        const many = Array.from({ length: svc.MAX_DAYS_IN_SUMMARY + 2 }, (_, i) => comment(i, `Update ${i}.`, 'Priya', i + 1));

        const out = svc.deterministicSummary(many);
        const lines = out.split('\n');

        expect(lines).toHaveLength(svc.MAX_DAYS_IN_SUMMARY + 1); // + the trailing count line
        expect(lines.at(-1)).toBe('2 earlier days with activity not shown.');
    });

    test('a day that is only acknowledgements is skipped, not shown as an empty line', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary([
            comment(1, 'Draft sent for review.', 'Priya', 1),
            comment(2, 'ok thanks', 'Marcus', 2),
        ]);

        expect(out).toBe('1 Sept: Draft sent for review.');
    });
});

describe('summariseTask — prompt', () => {
    test('bounds a runaway single day instead of sending all of it', async () => {
        const svc = loadService('key');
        aiReplies(['Summary.']);
        // All on the SAME calendar day, so this is a bound on one day block's
        // size, not on the number of days.
        const huge = Array.from({ length: 200 }, (_, i) => comment(1, `Update ${i} ${'z'.repeat(200)}`, 'Priya', 1));

        await svc.summariseTask({ name: 'T', comments: huge });

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage.length).toBeLessThan(2000);
        // The END is kept — the latest state is what a progress update is about.
        expect(userMessage).toContain('Update 199');
        // And it is still exactly one day block, even though it was truncated.
        expect(userMessage.match(/Day \d+ \(/g)).toHaveLength(1);
    });

    test('sends the task name so the model has context', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c']);

        await svc.summariseTask({ name: 'Rewriting bullet points', comments: THREAD });

        expect(mockCreate.mock.calls[0][0].messages[1].content).toContain('Rewriting bullet points');
    });

    test('labels day blocks with the real date, in order, for the model to read', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c']);

        await svc.summariseTask({ name: 'T', comments: THREAD });

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage.indexOf('Day 1 (1 Sept)')).toBeLessThan(userMessage.indexOf('Day 2 (2 Sept)'));
        expect(userMessage.indexOf('Day 2 (2 Sept)')).toBeLessThan(userMessage.indexOf('Day 3 (3 Sept)'));
    });
});

describe('summariseTask — prompt versioning', () => {
    test('an unchanged thread is re-summarised when the prompt version moved on', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'Regenerated.']);

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
        expect(out.text).toContain('Regenerated.');
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
        aiReplies(['a', 'b', 'c'], { ask: 'Send four lifestyle photos', kind: 'photos' });

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toEqual({ ask: 'Send four lifestyle photos', kind: 'photos' });
    });

    test('null is a normal answer, not a failure', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c'], null);

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toBeNull();
    });

    test('an unknown kind is coerced rather than shown raw', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c'], { ask: 'Confirm the new pack size', kind: 'something-new' });

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient.kind).toBe('other');
    });

    test('drops a malformed or empty ask instead of showing an empty banner row', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'c'], { ask: '', kind: 'photos' });

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toBeNull();
    });

    test('falls back with no ask when the model returns unparseable JSON', async () => {
        const svc = loadService('key');
        aiRepliesRaw('not json at all');

        const out = await svc.summariseTask({ name: 'T', comments: THREAD });
        expect(out.waitingOnClient).toBeNull();
        expect(out.generatedBy).toBe('fallback');
    });
});

describe('staff names never reach the client', () => {
    test('redacts full names, mentions and possessives', () => {
        const svc = loadService('key');
        const out = svc.redactNames(
            "Bhavdeep Lalakiya uploaded the labels, @Nora Shah will review Priya's draft.",
            ['Bhavdeep Lalakiya', 'Nora Shah', 'Priya Sharma']
        );

        expect(out).not.toMatch(/Bhavdeep|Lalakiya|Nora|Shah|Priya/i);
        expect(out).toContain('the team');
    });

    test('redacts a surname used on its own', () => {
        const svc = loadService('key');
        // The model may well shorten "Priya Sharma" to "Sharma" — matching only the
        // full name would let that through.
        expect(svc.redactNames('Sharma sent the files.', ['Priya Sharma'])).not.toMatch(/Sharma/i);
    });

    test('leaves short fragments alone rather than mangling ordinary words', () => {
        const svc = loadService('key');
        // A two-letter name part would match inside unrelated words.
        expect(svc.redactNames('We will do it in a bit.', ['Jo Li'])).toBe('We will do it in a bit.');
    });

    test('the deterministic fallback never attributes an update to the author by name', () => {
        const svc = loadService('key');
        const out = svc.deterministicSummary([
            comment(1, 'Drafted the copy.', 'Bhavdeep Lalakiya', 1),
            comment(2, 'Sent for review.', 'Nora Shah', 2),
        ]);

        expect(out).not.toMatch(/Bhavdeep|Lalakiya|Nora|Shah/i);
    });

    test('scrubs a name the model put in a day entry anyway', async () => {
        const svc = loadService('key');
        aiReplies(['Priya Sharma finished the bullets.', 'Marcus is reviewing.', 'Still with Marcus.'], null, 'Content team');

        const out = await svc.summariseTask({
            name: 'Bullets', comments: THREAD, ownerNames: ['Priya Sharma'], updatedByName: 'Marcus',
        });

        expect(out.text).not.toMatch(/Priya|Sharma|Marcus/i);
    });

    test('scrubs a name from the pending ask too', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'Waiting on photos.'], { ask: 'Send the photos to Priya Sharma', kind: 'photos' }, 'Photography team');

        const out = await svc.summariseTask({ name: 'Photos', comments: THREAD, ownerNames: ['Priya Sharma'] });

        expect(out.waitingOnClient.ask).not.toMatch(/Priya|Sharma/i);
    });

    test('redacts an owner who never commented', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'Assigned to Devendra Joshi.'], null, 'Design team');

        // Gathering names from the thread alone would miss an assignee who never
        // posted — which is exactly who an "assigned to" sentence names.
        const out = await svc.summariseTask({ name: 'T', comments: THREAD, ownerNames: ['Devendra Joshi'] });

        expect(out.text).not.toMatch(/Devendra|Joshi/i);
    });
});

describe('team assignment', () => {
    test('accepts a team from the fixed vocabulary', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'Ads are running.'], null, 'Advertising team');

        expect((await svc.summariseTask({ name: 'PPC', comments: THREAD })).team).toBe('Advertising team');
    });

    test('an invented team falls back rather than reaching the client', async () => {
        const svc = loadService('key');
        aiReplies(['a', 'b', 'Work continues.'], null, 'The Bullet Squad');

        // A label outside the vocabulary reads as disorganised next to the others.
        const out = await svc.summariseTask({ name: 'A+ content', comments: THREAD });
        expect(svc.TEAMS).toContain(out.team);
        expect(out.team).toBe('Design team');
    });

    test('reuse keeps the stored team', async () => {
        const svc = loadService('key');

        const out = await svc.summariseTask(
            { name: 'T', comments: THREAD },
            {
                previousHash: svc.hashThread(THREAD),
                previousText: 'Stored.',
                previousVersion: svc.PROMPT_VERSION,
                previousTeam: 'SEO team',
            }
        );

        expect(out.team).toBe('SEO team');
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('role accounts are not treated as people', () => {
    test('does not redact a shared role name out of ordinary prose', () => {
        const svc = loadService('key');
        // This portal really does have a Zoho user called "Support".
        const out = svc.redactNames('Contact Amazon support to resolve the account health issue.', ['Support']);

        expect(out).toBe('Contact Amazon support to resolve the account health issue.');
    });

    test('still redacts a real person who shares a task with a role account', () => {
        const svc = loadService('key');
        const out = svc.redactNames('Support raised it and Bhavdeep fixed it.', ['Support', 'Bhavdeep Lalakiya']);

        expect(out).toMatch(/support/i);
        expect(out).not.toMatch(/Bhavdeep/i);
    });
});

/**
 * The newest dated line, for a surface with room for one line only — the
 * Client Dashboard's "What we're working on" widget, which has no
 * white-space: pre-line handling and would otherwise collapse the full
 * multi-day text into one run-on sentence, then clamp it mid-word.
 */
describe('latestLine', () => {
    test('returns the LAST dated line — day order is oldest first', () => {
        const svc = loadService('key');
        const text = '1 Sept: Pulled search terms.\n2 Sept: Draft sent for review.\n3 Sept: Photos received.';

        expect(svc.latestLine(text)).toBe('3 Sept: Photos received.');
    });

    test('a single-day summary returns that one line', () => {
        const svc = loadService('key');
        expect(svc.latestLine('1 Sept: Only one day of activity.')).toBe('1 Sept: Only one day of activity.');
    });

    test('skips the trailing "(N) earlier days" note — it is not an update', () => {
        const svc = loadService('key');
        const text = '1 Sept: Oldest shown day.\n2 Sept: Newest shown day.\n3 earlier days with activity not shown.';

        // Showing the collapsed-history note instead of a real update would be
        // exactly backwards for a "what's happening now" glance.
        expect(svc.latestLine(text)).toBe('2 Sept: Newest shown day.');
    });

    test('a singular "1 earlier day" note is also excluded, not just the plural', () => {
        const svc = loadService('key');
        const text = '1 Sept: Oldest shown day.\n2 Sept: Newest shown day.\n1 earlier day with activity not shown.';

        expect(svc.latestLine(text)).toBe('2 Sept: Newest shown day.');
    });

    test('returns null for "no updates yet" rather than printing the phrase as an update', () => {
        const svc = loadService('key');
        expect(svc.latestLine('No updates on this task yet.')).toBeNull();
    });

    test('returns null for "no detailed updates yet" too', () => {
        const svc = loadService('key');
        expect(svc.latestLine('No detailed updates on this task yet.')).toBeNull();
    });

    test('returns null for empty or missing text rather than crashing', () => {
        const svc = loadService('key');
        expect(svc.latestLine(null)).toBeNull();
        expect(svc.latestLine(undefined)).toBeNull();
        expect(svc.latestLine('')).toBeNull();
    });
});
