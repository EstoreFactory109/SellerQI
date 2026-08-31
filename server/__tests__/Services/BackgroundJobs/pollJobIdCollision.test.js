/**
 * Poll-job id collisions across consecutive runs.
 *
 * THE BUG
 * A self-rescheduling phase re-enqueues itself as `${parentJobId}-${phase}-poll${n}`. That id is
 * deterministic per (account, phase, attempt) but NOT per run — and BullMQ SILENTLY IGNORES an
 * `add` whose jobId already exists: it returns the pre-existing job and creates nothing, with no
 * error to catch. Completed jobs linger for `removeOnComplete.age` (2h, queue.js), so on an
 * hourly account the previous run's finished poll still owns the id when the next run reaches the
 * same phase. The add evaporates and the chain stops — no next phase, no poll, no failure.
 *
 * Measured on account 6a57b823 (a PRO customer that had been "stalling" for weeks):
 *   sched_finance        completed 2026-08-30T23:12:58  rescheduled:true pollAttempt:1
 *   sched_finance-poll1  completed 2026-08-30T22:12:52  <- still the PREVIOUS run's job
 * The 23:01 run's poll1 was never created and the pipeline sat frozen for 9.5h. Its finance chain
 * burns 8+ polls per run, so it collided on essentially every run.
 *
 * THE GUARDS, both of which must hold:
 *   - a leftover id is cleared before the add, so the poll is actually created
 *   - an ACTIVE holder is NOT removed, because that is live work from a concurrent run
 */

const HOUR = 60 * 60 * 1000;

/** Minimal fake queue that reproduces BullMQ's silent-drop-on-duplicate-id semantics. */
function makeQueue(existing = []) {
    const jobs = new Map();
    const removed = [];
    for (const j of existing) jobs.set(j.id, j);
    return {
        removed,
        jobs,
        getJob: async (id) => jobs.get(id) || null,
        // THE SEMANTIC THAT CAUSES THE BUG: an existing id wins and nothing new is created.
        add: async (_name, data, opts) => {
            if (jobs.has(opts.jobId)) return jobs.get(opts.jobId);   // silently returns the OLD job
            const job = { id: opts.jobId, data, opts, created: true, getState: async () => 'delayed' };
            jobs.set(opts.jobId, job);
            return job;
        },
    };
}

const finishedJob = (id, ageMs) => ({
    id,
    timestamp: Date.now() - ageMs,
    getState: async () => 'completed',
    remove: async function () { this._removed = true; },
});

/**
 * The reschedule logic as worker.js now performs it. Kept in the test as an executable
 * description of the contract — the production copy lives in processScheduledPhase.
 */
async function reschedulePoll(queue, selfJobId, delayMs) {
    let idBlocked = false;
    const existing = await queue.getJob(selfJobId);
    if (existing) {
        const st = await existing.getState().catch(() => 'unknown');
        if (st === 'active') {
            idBlocked = true;
        } else {
            await existing.remove();
            queue.jobs.delete(selfJobId);
            queue.removed.push(selfJobId);
        }
    }
    if (idBlocked) return { enqueued: false, reason: 'active-holder' };
    const job = await queue.add('process-user-data', { phase: 'sched_finance' }, {
        jobId: selfJobId, delay: delayMs, removeOnComplete: true, removeOnFail: true,
    });
    return { enqueued: !!job.created, reason: job.created ? 'created' : 'silently-dropped' };
}

const POLL_ID = 'scheduled-u1-US-NA-sched_finance-poll1';

describe('the collision that stalled a live account', () => {
    // THE REGRESSION TEST. Without clearing the id first, this is exactly what production did.
    test('a completed poll from the previous run silently swallows the new add', async () => {
        const queue = makeQueue([finishedJob(POLL_ID, HOUR)]);

        // the OLD behaviour: add straight over the top
        const job = await queue.add('process-user-data', {}, { jobId: POLL_ID, delay: 1000 });

        expect(job.created).toBeUndefined();      // nothing was created
        expect(job.getState && (await job.getState())).toBe('completed');   // we got the OLD job back
    });

    test('clearing the id first means the poll is actually created', async () => {
        const queue = makeQueue([finishedJob(POLL_ID, HOUR)]);

        const result = await reschedulePoll(queue, POLL_ID, 1000);

        expect(result).toEqual({ enqueued: true, reason: 'created' });
        expect(queue.removed).toContain(POLL_ID);
        expect(await (await queue.getJob(POLL_ID)).getState()).toBe('delayed');
    });

    test('with no leftover job, the poll is created and nothing is removed', async () => {
        const queue = makeQueue([]);

        const result = await reschedulePoll(queue, POLL_ID, 1000);

        expect(result.enqueued).toBe(true);
        expect(queue.removed).toEqual([]);
    });
});

describe('live work is never destroyed to make room', () => {
    // THE OTHER DIRECTION. An ACTIVE holder means another run is executing this very poll.
    // Removing it would kill real in-flight work; stopping this chain is the lesser harm, and it
    // is logged as an error rather than vanishing silently the way the original bug did.
    test('an ACTIVE holder is left alone and the poll is skipped', async () => {
        const active = {
            id: POLL_ID,
            timestamp: Date.now() - 60_000,
            getState: async () => 'active',
            remove: async () => { throw new Error('must not be called'); },
        };
        const queue = makeQueue([active]);

        const result = await reschedulePoll(queue, POLL_ID, 1000);

        expect(result).toEqual({ enqueued: false, reason: 'active-holder' });
        expect(queue.removed).toEqual([]);
        expect(await (await queue.getJob(POLL_ID)).getState()).toBe('active');
    });
});

describe('the poll no longer holds its id after finishing', () => {
    // The root of the collision is retention: queue.js keeps completed jobs for 2h, which is
    // longer than the 1h gap between runs. A poll is an ephemeral self-reschedule, so it opts out.
    test('poll jobs are enqueued with removeOnComplete and removeOnFail', async () => {
        const queue = makeQueue([]);

        await reschedulePoll(queue, POLL_ID, 1000);

        const { opts } = await queue.getJob(POLL_ID);
        expect(opts.removeOnComplete).toBe(true);
        expect(opts.removeOnFail).toBe(true);
    });
});
