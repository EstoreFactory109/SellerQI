/**
 * The eager-promise / sequential-await hazard in ScheduledIntegration's batch runner.
 *
 * WHAT THIS PROTECTS
 * `getScheduledApiData`'s setup loop INVOKES every service immediately —
 * `promise = wrapSpApiFunction(...)(...)` — collecting the already-running promises into batch
 * arrays. The batches are then awaited one after another, and a batch can be skipped outright by
 * runBatch(). So a batch-4 promise can reject while batch 1 is still being awaited, at which point
 * nothing is listening and Node raises `unhandledRejection`. worker.js terminates the process on
 * that, so a single unlucky SP-API error takes down a worker mid-pipeline.
 *
 * Captured in production on 2026-08-29, which is the only reason this was ever found: a burst of
 * `QuotaExceeded` rejected five report promises within 250ms —
 *   GET_LEDGER_SUMMARY_VIEW_DATA, GET_LEDGER_DETAIL_VIEW_DATA, GET_STRANDED_INVENTORY_UI_DATA,
 *   GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA, GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT
 * — and killed the worker. BullMQ then re-ran `sched_init`, producing the ~20-minute duplicate-run
 * series and the orphaned tracking docs behind it. ~340 restarts in 46 hours.
 *
 * addToBatch now attaches a no-op `.catch()` when a promise enters a batch. The two properties
 * below are what make that correct, and BOTH must hold — a fix that stopped the crash by
 * swallowing the error would be worse than the crash.
 */

/** Reproduces the real shape: a promise created now, rejecting now, awaited several ticks later. */
function rejectsImmediately(reason) {
    return Promise.reject(new Error(reason));
}

/** Let enough microtasks/macrotasks pass that Node would have raised unhandledRejection. */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('a rejection that lands before its batch is awaited', () => {
    // These run in a CHILD PROCESS on purpose. Jest installs its own `unhandledRejection`
    // listener, so an in-process test can never observe the thing being tested — it would pass
    // whether or not the guard existed, which is worse than no test.
    const { spawnSync } = require('child_process');

    /** Run a snippet under a bare node with worker.js's terminate-on-unhandled-rejection policy. */
    function runInChild(body) {
        const src = `
            process.on('unhandledRejection', (reason) => {
                // exactly what worker.js does: record the reason, then die
                process.stdout.write('UNHANDLED:' + reason.message);
                process.exit(1);
            });
            ${body}
            setTimeout(() => { process.stdout.write('SURVIVED'); process.exit(0); }, 50);
        `;
        const r = spawnSync(process.execPath, ['-e', src], { encoding: 'utf8' });
        return { code: r.status, out: (r.stdout || '').trim() };
    }

    // THE BUG, demonstrated end to end: this is what production was doing, and the exit code 1
    // here is the same exit code PM2 recorded ~340 times in 46 hours.
    test('WITHOUT a handler attached at creation, the process dies', () => {
        const { code, out } = runInChild(`
            const batch4 = [Promise.reject(new Error('QuotaExceeded'))];   // created, nothing listening
            // batch 1 is still being awaited over here...
        `);

        expect(out).toBe('UNHANDLED:QuotaExceeded');
        expect(code).toBe(1);
    });

    // THE FIX, same scenario.
    test('WITH the no-op catch addToBatch attaches, the process survives', () => {
        const { code, out } = runInChild(`
            const batch4 = [Promise.reject(new Error('QuotaExceeded'))];
            batch4.forEach((p) => p.catch(() => {}));                      // what addToBatch now does
        `);

        expect(out).toBe('SURVIVED');
        expect(code).toBe(0);
    });
});

describe('the guard must not swallow the failure', () => {
    // THE OTHER DIRECTION, and the one that matters most. Suppressing the crash by hiding the
    // error would turn a loud failure into silently missing seller data. `.catch()` returns a NEW
    // promise, which addToBatch discards; Promise.allSettled attaches its own handlers to the
    // ORIGINAL, so it still observes the rejection and the same reason.
    test('Promise.allSettled still reports rejected, with the original reason', async () => {
        const p = rejectsImmediately('QuotaExceeded');
        p.catch(() => {});

        const [result] = await Promise.allSettled([p]);

        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(Error);
        expect(result.reason.message).toBe('QuotaExceeded');
    });

    test('a fulfilled promise is completely unaffected', async () => {
        const p = Promise.resolve({ data: 'ok' });
        p.catch(() => {});

        const [result] = await Promise.allSettled([p]);

        expect(result.status).toBe('fulfilled');
        expect(result.value).toEqual({ data: 'ok' });
    });

    // A batch that runBatch() skips is never awaited AT ALL, so its promises would otherwise be
    // guaranteed to go unhandled rather than merely racing.
    test('a batch that is never awaited still raises nothing', async () => {
        let unhandled = [];
        const record = (r) => unhandled.push(r);
        process.on('unhandledRejection', record);
        try {
            const skipped = [rejectsImmediately('never awaited')];
            skipped.forEach((p) => p.catch(() => {}));
            await settle();
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', record);
        }
    });
});
