/**
 * Tests for the PM2 memory-budget check.
 *
 * Context: on 2 Jul 2026 the kernel OOM-killer killed the PM2 God daemon at 12.6 GB RSS and took
 * every process with it. A contributing condition was that the summed `max_memory_restart ×
 * instances` came to ~18.3 GB on a 16 GB host — because `WORKER_INSTANCES=5` in `.env` silently beat
 * the committed `|| '3'` default. Nothing printed that total, so it was invisible until the box died.
 *
 * The two properties that actually matter here:
 *   1. It must NEVER throw. This runs inside an ecosystem config, so an exception would stop PM2
 *      from starting at all — strictly worse than the over-commit it is warning about.
 *   2. The arithmetic must be right, because an incorrect number is worse than no number.
 */

const { checkMemoryBudget, parseMemoryString } = require('../../ecosystem.memory-check.js');

const GB = 1024 ** 3;

// Silence the intentional console.warn so test output stays readable.
let warnSpy;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe('parseMemoryString', () => {
    test('parses the PM2 suffix forms actually used in the ecosystem files', () => {
        expect(parseMemoryString('1G')).toBe(GB);
        expect(parseMemoryString('2G')).toBe(2 * GB);
        expect(parseMemoryString('512M')).toBe(512 * 1024 ** 2);
        expect(parseMemoryString('768M')).toBe(768 * 1024 ** 2);
    });

    test('tolerates case, whitespace and a trailing B', () => {
        expect(parseMemoryString('2g')).toBe(2 * GB);
        expect(parseMemoryString(' 2GB ')).toBe(2 * GB);
    });

    test('a raw number is treated as bytes', () => {
        expect(parseMemoryString(4096)).toBe(4096);
    });

    test('unparseable input yields 0 rather than NaN', () => {
        // NaN would silently poison the sum and make the whole warning meaningless.
        for (const bad of [undefined, null, '', 'lots', {}, [], 'G', NaN]) {
            expect(parseMemoryString(bad)).toBe(0);
        }
    });
});

describe('checkMemoryBudget — the arithmetic', () => {
    const apps = [
        { name: 'worker', max_memory_restart: '2G', instances: 5 },
        { name: 'integration-worker', max_memory_restart: '3G', instances: 1 },
        { name: 'api-server', max_memory_restart: '1G', instances: 1 },
    ];

    test('multiplies cap by instance count', () => {
        const r = checkMemoryBudget(apps, 'test', { totalMemBytes: 64 * GB });
        expect(r.budget).toBe(14 * GB);           // 2×5 + 3 + 1
        expect(r.overCommitted).toBe(false);
    });

    test('reproduces the real 16 GB over-commit that preceded the OOM', () => {
        // The production shape: 8 apps summing ~18.3 GB on a 16 GB host.
        const prodLike = [
            { name: 'worker', max_memory_restart: '2G', instances: 5 },
            { name: 'integration-worker', max_memory_restart: '3G', instances: 1 },
            { name: 'weekly-history-worker', max_memory_restart: '2G', instances: 1 },
            { name: 'api-server', max_memory_restart: '1G', instances: 1 },
            { name: 'alerts-worker', max_memory_restart: '768M', instances: 1 },
            { name: 'cron-producer', max_memory_restart: '512M', instances: 1 },
            { name: 'freshness-sweeper', max_memory_restart: '512M', instances: 1 },
            { name: 'delete-user-worker', max_memory_restart: '512M', instances: 1 },
        ];
        const r = checkMemoryBudget(prodLike, 'test', { totalMemBytes: 16 * GB });
        expect(r.budget / GB).toBeCloseTo(18.25, 2);
        expect(r.overCommitted).toBe(true);
        expect(warnSpy).toHaveBeenCalled();
    });

    test('dropping WORKER_INSTANCES 5 -> 3 reclaims exactly 4 GB', () => {
        // This is Phase 1 of the fix: same 75 job slots, two fewer V8 heaps.
        const five = checkMemoryBudget(apps, 'test', { totalMemBytes: 64 * GB }).budget;
        const three = checkMemoryBudget(
            apps.map((a) => (a.name === 'worker' ? { ...a, instances: 3 } : a)),
            'test', { totalMemBytes: 64 * GB }
        ).budget;
        expect((five - three) / GB).toBe(4);
    });

    test('missing instances defaults to 1, not 0', () => {
        const r = checkMemoryBudget([{ name: 'x', max_memory_restart: '2G' }], 'test', { totalMemBytes: 64 * GB });
        expect(r.budget).toBe(2 * GB);
    });

    test('an app with no cap contributes nothing rather than NaN', () => {
        const r = checkMemoryBudget(
            [{ name: 'capped', max_memory_restart: '1G', instances: 1 }, { name: 'uncapped', instances: 2 }],
            'test', { totalMemBytes: 64 * GB }
        );
        expect(r.budget).toBe(GB);
    });
});

describe('checkMemoryBudget — the headroom rule', () => {
    const oneApp = (cap) => [{ name: 'w', max_memory_restart: cap, instances: 1 }];

    test('warns when the budget eats into the 20% reserved for OS/daemon/Redis', () => {
        // 14 GB on 16 GB leaves only 2 GB — below the 20% (3.2 GB) reserve, so it must warn even
        // though 14 < 16. This is the post-Phase-1 production case.
        const r = checkMemoryBudget(oneApp('14G'), 'test', { totalMemBytes: 16 * GB });
        expect(r.overCommitted).toBe(true);
    });

    test('does not warn when there is comfortable headroom', () => {
        const r = checkMemoryBudget(oneApp('8G'), 'test', { totalMemBytes: 16 * GB });
        expect(r.overCommitted).toBe(false);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('checkMemoryBudget — must never throw', () => {
    // A config file that crashes stops PM2 from starting at all. Every one of these would be a
    // production outage caused by a warning helper.
    test.each([
        ['undefined apps', undefined],
        ['null apps', null],
        ['empty array', []],
        ['not an array', 'nope'],
        ['array of nulls', [null, undefined]],
        ['apps with junk fields', [{ name: 1, max_memory_restart: {}, instances: 'many' }]],
    ])('%s returns without throwing', (_label, input) => {
        expect(() => checkMemoryBudget(input, 'test', { totalMemBytes: 16 * GB })).not.toThrow();
    });

    test('a nonsensical host memory value is handled', () => {
        for (const bad of [0, -1, NaN]) {
            expect(() => checkMemoryBudget([{ name: 'w', max_memory_restart: '2G', instances: 1 }], 'test', { totalMemBytes: bad })).not.toThrow();
        }
    });

    test('a getter that throws does not propagate', () => {
        const hostile = [{ get name() { throw new Error('boom'); }, max_memory_restart: '2G', instances: 1 }];
        expect(() => checkMemoryBudget(hostile, 'test', { totalMemBytes: 16 * GB })).not.toThrow();
    });
});
