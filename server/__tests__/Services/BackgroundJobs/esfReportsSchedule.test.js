/**
 * When the next batch of reports actually goes out.
 *
 * WHAT THIS REPLACED
 * The Reports page hardcoded `{ name: 'Weekly Sales Summary', due: 'Monday' }`. Both halves
 * were false: the weekly cron is '0 8 * * 6' — Saturday — and no report has ever been called
 * "Weekly Sales Summary". So the first assertion below is the whole point: from a Thursday,
 * the answer must be Saturday, and it must be an instant rather than a day name.
 *
 * The day-name part is not pedantry. With TIMEZONE=UTC the weekly run fires at Friday 22:00
 * in Pacific/Honolulu, so a server that rendered "Saturday" would be telling that client the
 * wrong day. The server returns the instant; the browser decides what to call it.
 */

const SCHEDULE = '../../../Services/BackgroundJobs/esfReportsSchedule.js';

let schedule;
const ENV_KEYS = [
    'TIMEZONE', 'ESF_REPORTS_MAILER_ENABLED', 'ESF_REPORTS_WEEKLY_CRON',
    'ESF_REPORTS_BIWEEKLY_CRON', 'ESF_REPORTS_MONTHLY_CRON', 'ESF_REPORTS_QUARTERLY_CRON',
];
let saved;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
    process.env.TIMEZONE = 'UTC';
    jest.resetModules();
    schedule = require(SCHEDULE);
});

afterEach(() => {
    // resetMocks is on, but env is not — restore it or the next file inherits an override.
    ENV_KEYS.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });
});

/** A Thursday, deliberately: the bug shipped a Monday for a Saturday job. */
const THURSDAY = new Date('2026-10-01T12:00:00Z');
const ALL_KEYS = ['account-overview', 'buybox', 'review-requests', 'inventory-restock',
    'fba-aged-inventory', 'monthly-performance', 'listings-audit'];

describe('nextRunFor', () => {
    test('weekly from a Thursday is the coming SATURDAY, as an instant', () => {
        expect(schedule.nextRunFor('weekly', { now: THURSDAY }).toISOString())
            .toBe('2026-10-03T08:00:00.000Z');
    });

    test('from one minute after a run, it is the FOLLOWING week', () => {
        // The off-by-one that would have a client staring at a card saying "today".
        const justAfter = new Date('2026-10-03T08:01:00Z');

        expect(schedule.nextRunFor('weekly', { now: justAfter }).toISOString())
            .toBe('2026-10-10T08:00:00.000Z');
    });

    test.each([
        ['monthly', '2026-11-01T08:30:00.000Z'],
        ['quarterly', '2027-01-01T08:45:00.000Z'],
    ])('%s lands on its slot', (cadence, expected) => {
        expect(schedule.nextRunFor(cadence, { now: THURSDAY }).toISOString()).toBe(expected);
    });

    test('follows the scheduler timezone across a DST boundary', () => {
        // Same local 08:00 either side of 1 Nov 2026; the INSTANT moves, which is exactly
        // why the client is sent an instant and not a wall-clock time.
        process.env.TIMEZONE = 'America/New_York';
        jest.resetModules();
        const tz = require(SCHEDULE);

        expect(tz.nextRunFor('weekly', { now: new Date('2026-10-29T12:00:00Z') }).toISOString())
            .toBe('2026-10-31T12:00:00.000Z');   // EDT
        expect(tz.nextRunFor('weekly', { now: new Date('2026-11-05T12:00:00Z') }).toISOString())
            .toBe('2026-11-07T13:00:00.000Z');   // EST
    });

    test('biweekly only ever lands on an even ISO week', () => {
        // cron cannot express a fortnight, so the job runs weekly and returns early on odd
        // weeks. Unfiltered, this would promise a run that never comes.
        for (let day = 1; day <= 29; day += 7) {
            const at = schedule.nextRunFor('biweekly', { now: new Date(Date.UTC(2026, 9, day, 12)) });
            expect(schedule.isoWeek(at) % 2).toBe(0);
        }
    });

    test('biweekly skips a week when the coming Saturday is odd', () => {
        // Proves the filter does something, rather than the dates happening to line up.
        const from = new Date('2026-10-08T12:00:00Z');
        const weekly = schedule.nextRunFor('weekly', { now: from });
        const biweekly = schedule.nextRunFor('biweekly', { now: from });

        expect(schedule.isoWeek(weekly) % 2).toBe(1);
        expect(biweekly.getTime()).toBeGreaterThan(weekly.getTime());
    });

    test('honours a per-cadence env override', () => {
        // The whole reason this is server-side rather than a client constant.
        process.env.ESF_REPORTS_WEEKLY_CRON = '0 9 * * 1';
        jest.resetModules();

        expect(require(SCHEDULE).nextRunFor('weekly', { now: THURSDAY }).toISOString())
            .toBe('2026-10-05T09:00:00.000Z');   // Monday
    });

    test('returns null for an unreadable override instead of throwing', () => {
        // A bad env var must not 500 the page that asked.
        process.env.ESF_REPORTS_WEEKLY_CRON = 'not a cron';
        jest.resetModules();

        expect(require(SCHEDULE).nextRunFor('weekly', { now: THURSDAY })).toBeNull();
    });
});

describe('nextScheduledReport', () => {
    const run = (availableKeys, now = THURSDAY) =>
        schedule.nextScheduledReport({ availableKeys, nameForKey: (k) => `name:${k}`, now });

    test('names the cadence and counts its reports, not one report', () => {
        // Weekly sends three in one email. Naming "the first available" would be the old
        // bug in a smaller font, and would change as availability changed.
        const next = run(ALL_KEYS);

        expect(next.status).toBe('scheduled');
        expect(next.cadence).toBe('weekly');
        expect(next.cadenceLabel).toBe('Weekly');
        expect(next.at).toBe('2026-10-03T08:00:00.000Z');
        expect(next.reportCount).toBe(3);
    });

    test('lists only the reports this client actually has data for', () => {
        const next = run(['buybox']);

        expect(next.reportCount).toBe(1);
        expect(next.reportNames).toEqual(['name:buybox']);
    });

    test('skips a cadence that would send nothing at all', () => {
        // buildAttachmentsForClient drops unavailable reports and the mailer sends no email
        // when none remain — so promising that date would promise mail that never arrives.
        const next = run(['fba-aged-inventory']);

        expect(next.cadence).toBe('monthly');
        expect(next.at).toBe('2026-11-01T08:30:00.000Z');
    });

    test('says nothing is scheduled rather than inventing a date', () => {
        const next = run([]);

        expect(next.status).toBe('nothing-available');
        expect(next.at).toBeNull();
        expect(next.note).toBeTruthy();
    });

    test('reports the kill switch rather than a date', () => {
        // Pulled during incidents; a card still promising Saturday is how tickets get filed.
        process.env.ESF_REPORTS_MAILER_ENABLED = 'false';
        jest.resetModules();
        const off = require(SCHEDULE);

        const next = off.nextScheduledReport({ availableKeys: ALL_KEYS, now: THURSDAY });
        expect(next.status).toBe('disabled');
        expect(next.at).toBeNull();
    });

    test('a broken cadence falls through to the next one', () => {
        process.env.ESF_REPORTS_WEEKLY_CRON = 'not a cron';
        jest.resetModules();
        const broken = require(SCHEDULE);

        const next = broken.nextScheduledReport({ availableKeys: ALL_KEYS, now: THURSDAY });
        expect(next.status).toBe('scheduled');
        expect(next.cadence).not.toBe('weekly');
    });
});

describe('one copy of the schedule', () => {
    test('the mailer and the worker read the same constants', () => {
        // They used to be separate literals in two files. An operator setting an override
        // would then change the cron that fires without changing the date the client sees.
        const mailer = require('../../../Services/BackgroundJobs/esfReportsMailer.js');
        const standalone = require('../../../Services/BackgroundJobs/esfReportsMailerStandalone.js');

        expect(mailer.CADENCE_GROUPS).toBe(schedule.CADENCE_GROUPS);
        expect(standalone.DEFAULT_SCHEDULES).toBe(schedule.DEFAULT_SCHEDULES);
    });

    test('every cadence with a cron has a report group, and vice versa', () => {
        // Catches a fifth cadence being added to one and not the other.
        expect(Object.keys(schedule.DEFAULT_SCHEDULES).sort())
            .toEqual(Object.keys(schedule.CADENCE_GROUPS).sort());
    });
});
