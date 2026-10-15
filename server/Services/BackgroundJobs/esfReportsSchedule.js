/**
 * esfReportsSchedule.js — when the next batch of reports actually goes out.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * The schedule used to live in esfReportsMailerStandalone.js, which is a worker: it requires
 * node-cron and dbConnect at module load. The Reports page needs the same knowledge, and an
 * API process must not drag a cron scheduler and a database connection in to answer "when is
 * my next report". So the constants moved down here, into a leaf that requires neither, and
 * the standalone imports them back.
 *
 * The point of the move is that there is now exactly ONE copy. An operator who sets
 * ESF_REPORTS_WEEKLY_CRON changes both the cron that fires and the date the client is shown,
 * and they cannot disagree.
 *
 * WHAT THIS REPLACED
 * ------------------
 * The client used to hardcode `{ name: 'Weekly Sales Summary', due: 'Monday' }`. That was
 * wrong twice over: the weekly cron is '0 8 * * 6' — Saturday — and no report has ever been
 * called "Weekly Sales Summary". Every ESF client saw the same false claim.
 *
 * WHY NOT node-cron's OWN getNextRun()
 * ------------------------------------
 * Because it is wrong for day-of-week expressions. Measured against node-cron@4.2.1,
 * '0 8 * * 6' returns 2028-01-01 — its matcher only lands on day-of-month boundaries, so it
 * skips to the next year where 1 January is a Saturday. It also returns null until the task
 * has been start()ed. The runtime matcher is fine, so the mail really does go out on
 * Saturday; only the prediction API is unusable. cron-parser gets all four expressions right,
 * including across DST.
 *
 * WHY IT RETURNS AN INSTANT AND NEVER A DAY NAME
 * ---------------------------------------------
 * "Saturday" is as wrong as "Monday" was for a reader in the wrong timezone. With
 * TIMEZONE=UTC, '0 8 * * 6' fires at Friday 22:00 in Pacific/Honolulu — the mail genuinely
 * lands on their Friday. The server ships the instant and the browser formats it, which is
 * the only arrangement that is right for every reader and makes the whole class of mistake
 * unrepresentable.
 */

const { parseExpression } = require('cron-parser');
const logger = require('../../utils/Logger.js');

const CADENCE_GROUPS = {
    weekly: {
        label: 'Weekly',
        reportKeys: ['account-overview', 'buybox', 'review-requests'],
    },
    biweekly: {
        label: 'Bi-weekly',
        reportKeys: ['inventory-restock'],
    },
    monthly: {
        label: 'Monthly',
        reportKeys: ['fba-aged-inventory', 'monthly-performance'],
    },
    quarterly: {
        label: 'Quarterly',
        reportKeys: ['listings-audit'],
    },
};

/**
 * ISO-8601 week number. Used to make "bi-weekly" mean every OTHER week rather
 * than every week — cron cannot express a fortnight, so the job runs weekly and
 * returns early on odd weeks.
 */
const isoWeek = (date = new Date()) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday of this week decides the year, per ISO-8601.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

/** True on the weeks the bi-weekly cycle should actually send. */
const isBiweeklyWeek = (date = new Date()) => isoWeek(date) % 2 === 0;

/** Saturday 08:00, Saturday 08:15 on even ISO weeks, the 1st at 08:30, quarter-starts 08:45. */
const DEFAULT_SCHEDULES = {
    weekly: '0 8 * * 6',
    biweekly: '15 8 * * 6',
    monthly: '30 8 1 * *',
    quarterly: '45 8 1 1,4,7,10 *',
};

const scheduleFor = (cadence) =>
    process.env[`ESF_REPORTS_${cadence.toUpperCase()}_CRON`] || DEFAULT_SCHEDULES[cadence];

const schedulerTimezone = () => process.env.TIMEZONE || 'UTC';

const isMailerEnabled = () => String(process.env.ESF_REPORTS_MAILER_ENABLED ?? 'true') !== 'false';

/**
 * How far the biweekly walk may go before giving up.
 *
 * Only biweekly needs to skip candidates, and it skips at most every other week, so two
 * iterations is the real answer. The cap is here so a pathological override cannot spin.
 */
const MAX_SKIPS = 60;

/**
 * The next instant a cadence's cron will fire.
 *
 * @returns {Date|null} null when the expression cannot be parsed — the same condition that
 *   makes setupEsfReportsCrons skip that cycle entirely, so a bad override shows as "no next
 *   run" rather than crashing the page that asked.
 */
const nextRunFor = (cadence, { now = new Date() } = {}) => {
    const expression = scheduleFor(cadence);
    if (!expression) return null;

    try {
        const iterator = parseExpression(expression, { currentDate: now, tz: schedulerTimezone() });

        for (let i = 0; i < MAX_SKIPS; i += 1) {
            const candidate = iterator.next().toDate();
            /*
             * Biweekly runs on even ISO weeks only, and runEsfReportsCadence returns early
             * on the odd ones — so an unfiltered answer would promise a run that never comes.
             *
             * This reads the ISO week of the UTC instant, which is what the production gate
             * does. That is deliberate rather than sloppy: mirroring the real computation
             * keeps the card right even under an override where the local and UTC weeks
             * differ, whereas computing the "correct" local week would make it disagree with
             * the mailer.
             */
            if (cadence !== 'biweekly' || isoWeek(candidate) % 2 === 0) return candidate;
        }
        return null;
    } catch (error) {
        logger.warn(`[EsfReportsSchedule] cannot read the ${cadence} cron ("${expression}"): ${error.message}`);
        return null;
    }
};

/** Every cadence that will fire, soonest first. Unparseable ones are dropped. */
const upcomingRuns = ({ now = new Date() } = {}) =>
    Object.keys(CADENCE_GROUPS)
        .map((cadence) => ({ cadence, at: nextRunFor(cadence, { now }) }))
        .filter((entry) => entry.at)
        .sort((a, b) => a.at - b.at);

/**
 * The block the Reports page and the Overview card both render.
 *
 * @param {object} opts
 * @param {string[]|null} opts.availableKeys  report keys that have data behind them for this
 *   client. `null` means "unknown", and then nothing is filtered.
 * @param {Function} opts.nameForKey  key -> display name.
 */
const nextScheduledReport = ({ availableKeys = null, nameForKey = (k) => k, now = new Date() } = {}) => {
    const empty = {
        cadence: null, cadenceLabel: null, at: null, timezone: schedulerTimezone(),
        reportNames: [], reportCount: 0,
    };

    if (!isMailerEnabled()) {
        // The kill switch is pulled during incidents. A card still promising Saturday while
        // the mailer is off is how support tickets get filed.
        return { ...empty, status: 'disabled', note: 'Scheduled reports are paused.' };
    }

    for (const { cadence, at } of upcomingRuns({ now })) {
        const keys = CADENCE_GROUPS[cadence].reportKeys
            .filter((key) => availableKeys === null || availableKeys.includes(key));

        /*
         * A cadence whose reports all lack data sends NO email at all — buildAttachmentsForClient
         * skips unavailable reports and runEsfReportsCadence sends nothing when none remain. So
         * promising that date would be promising mail that never arrives; walk on to the next
         * cadence that will actually deliver something.
         */
        if (keys.length === 0) continue;

        return {
            cadence,
            cadenceLabel: CADENCE_GROUPS[cadence].label,
            at: at.toISOString(),
            timezone: schedulerTimezone(),
            reportNames: keys.map(nameForKey),
            reportCount: keys.length,
            status: 'scheduled',
            note: null,
        };
    }

    return { ...empty, status: 'nothing-available', note: 'No report has data behind it yet.' };
};

module.exports = {
    CADENCE_GROUPS,
    isoWeek,
    isBiweeklyWeek,
    DEFAULT_SCHEDULES,
    scheduleFor,
    schedulerTimezone,
    isMailerEnabled,
    nextRunFor,
    upcomingRuns,
    nextScheduledReport,
};
