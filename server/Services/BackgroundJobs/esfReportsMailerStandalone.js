/**
 * Estore Factory reports mailer — cron schedules and manual runner.
 *
 * Owns the four cron schedules that email ESF clients their reports.
 *
 * WHERE THIS RUNS
 * `setupEsfReportsCrons()` is called by cronProducerStandalone.js, the process
 * that owns all cron scheduling. It is NOT a PM2 app of its own: the ecosystem
 * memory budget has no room for one (12.75 GB already committed against the
 * 13 GB assertion in __tests__/ecosystemMemoryCheck.test.js, on a 16 GB host),
 * which is the same reason the Zoho task sync is hosted there. Running this
 * file directly is for manual one-off runs only — see --run= below.
 *
 * WHY NOT api-server's JobScheduler
 * The existing weekly report email lives there, and the evidence says it does
 * not survive: in three months it fired three times (4 Jul, 15 Aug, 5 Sep) with
 * 42- and 21-day gaps where a weekly job should show 7, because any api-server
 * restart crossing 09:00 Saturday silently skips that week with no catch-up.
 * cron-producer exists precisely to decouple scheduling from the HTTP process.
 *
 * SCHEDULES (all in TIMEZONE, default UTC), staggered so four cycles landing on
 * the same morning do not hit SES at once:
 *
 *   weekly     Sat 08:00          the 3 weekly reports
 *   biweekly   Sat 08:15          the 1 bi-weekly report, even ISO weeks only
 *   monthly    1st 08:30          the 2 monthly reports
 *   quarterly  1 Jan/Apr/Jul/Oct 08:45   the 1 quarterly report
 *
 * Every schedule is overridable by env so a cycle can be moved or paused
 * without a deploy. Set ESF_REPORTS_MAILER_ENABLED=false to stop all of them.
 */
const cron = require('node-cron');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { runEsfReportsCadence } = require('./esfReportsMailer.js');

const DEFAULT_SCHEDULES = {
    weekly: '0 8 * * 6',
    biweekly: '15 8 * * 6',
    monthly: '30 8 1 * *',
    quarterly: '45 8 1 1,4,7,10 *',
};

const scheduleFor = (cadence) =>
    process.env[`ESF_REPORTS_${cadence.toUpperCase()}_CRON`] || DEFAULT_SCHEDULES[cadence];

const setupEsfReportsCrons = () => {
    const timezone = process.env.TIMEZONE || 'UTC';
    const enabled = String(process.env.ESF_REPORTS_MAILER_ENABLED ?? 'true') !== 'false';

    if (!enabled) {
        logger.warn('[EsfReportsMailer] Disabled by ESF_REPORTS_MAILER_ENABLED=false — no cycles scheduled');
        return [];
    }

    const jobs = [];
    for (const cadence of Object.keys(DEFAULT_SCHEDULES)) {
        const expression = scheduleFor(cadence);
        if (!cron.validate(expression)) {
            logger.error(`[EsfReportsMailer] Invalid cron for ${cadence}: "${expression}" — that cycle will NOT run`);
            continue;
        }

        const job = cron.schedule(expression, async () => {
            try {
                logger.info(`[EsfReportsMailer] Cron fired for ${cadence}`);
                await runEsfReportsCadence(cadence);
            } catch (error) {
                // Never rethrow: one bad cycle must not take the process down and
                // silence the other three.
                logger.error(`[EsfReportsMailer] ${cadence} run failed`, { error: error?.message, stack: error?.stack });
            }
        }, { scheduled: false, timezone });

        job.start();
        jobs.push(job);
        logger.info(`[EsfReportsMailer] Scheduled ${cadence}`, { cron: expression, timezone });
    }
    return jobs;
};

if (require.main === module) {
    (async () => {
        try {
            process.on('unhandledRejection', (reason) => {
                logger.error('[EsfReportsMailer] Unhandled rejection (non-fatal)', { error: reason?.message || reason });
            });
            process.on('uncaughtException', (err) => {
                logger.error('[EsfReportsMailer] Uncaught exception', { error: err?.message, stack: err?.stack });
            });
            process.on('SIGINT', () => {
                logger.info('[EsfReportsMailer] Received SIGINT. Shutting down gracefully...');
                process.exit(0);
            });
            process.on('SIGTERM', () => {
                logger.info('[EsfReportsMailer] Received SIGTERM. Shutting down gracefully...');
                process.exit(0);
            });

            logger.info('[EsfReportsMailer] Starting Estore Factory reports mailer...');
            await dbConnect();

            // `--run=weekly` sends that cycle immediately and exits. Used to test a
            // cycle without waiting for its slot; `--force` also overrides the
            // even-week gate on the bi-weekly cycle.
            const runArg = process.argv.find((a) => a.startsWith('--run='));
            if (runArg) {
                const cadence = runArg.split('=')[1];
                const force = process.argv.includes('--force');
                const onlyArg = process.argv.find((a) => a.startsWith('--user='));
                const result = await runEsfReportsCadence(cadence, {
                    force,
                    onlyUserId: onlyArg ? onlyArg.split('=')[1] : undefined,
                });
                logger.info(`[EsfReportsMailer] One-off run complete: ${JSON.stringify(result)}`);
                process.exit(0);
            }

            setupEsfReportsCrons();
            logger.info('[EsfReportsMailer] Running — waiting for cron to fire');
        } catch (err) {
            logger.error('[EsfReportsMailer] Failed to start', { error: err?.message, stack: err?.stack });
            process.exit(1);
        }
    })();
}

module.exports = { setupEsfReportsCrons, DEFAULT_SCHEDULES };
