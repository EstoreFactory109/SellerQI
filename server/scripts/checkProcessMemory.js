#!/usr/bin/env node
/**
 * checkProcessMemory.js — READ ONLY. What PM2 is actually using, versus what it is allowed to use.
 *
 * Why this exists
 * ---------------
 * The VM has been OOM-killing node processes, and there was no way to see it coming: the only
 * memory telemetry in the whole system was `process.memoryUsage()` captured by ErrorLogs.js, and
 * only on error paths. By the time an OOM shows up in behaviour, the evidence is already gone —
 * `FinanceService.js:73-74` puts it plainly: "a real OOM there is invisible: the process dies
 * before any catch runs."
 *
 * Three things it surfaces that config alone will not tell you:
 *
 *   1. THE GOD DAEMON. Every app writes stdout/stderr through the PM2 daemon, and `merge_logs:true`
 *      funnels each app onto one daemon-side stream. If that write back-pressures — full disk, or a
 *      rotated/unlinked fd — the unwritten lines buffer in the DAEMON's heap, not the app's. It has
 *      been observed at ~12.6 GB. Nothing else reports on it.
 *
 *   2. OVER-COMMIT. Summed `max_memory_restart` across all apps is what the box is *promising*.
 *      Exceed physical RAM and the kernel OOM-killer firing is arithmetic, not bad luck. Note
 *      `ecosystem.config.js` loads `.env` BEFORE exporting, so `WORKER_INSTANCES` there silently
 *      overrides the file's default — the promise can be much bigger than the file suggests.
 *
 *   3. RESTART CHURN. A climbing `restart_time` on worker/integration-worker means jobs are being
 *      killed mid-flight, which is exactly what corrupts a finance sync.
 *
 * Usage:
 *   node server/scripts/checkProcessMemory.js
 *   node server/scripts/checkProcessMemory.js --json
 *
 * Needs the `pm2` CLI on PATH. Touches no database and changes nothing.
 */
/* eslint-disable no-console */
const { execSync } = require('child_process');
const os = require('os');

const JSON_OUT = process.argv.includes('--json');

function parseCap(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;                       // already bytes
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i);
    if (!m) return null;
    const mult = { K: 1024, M: 1048576, G: 1073741824 }[(m[2] || '').toUpperCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
}

const mb = (b) => Math.round((b || 0) / 1048576);

function main() {
    let list;
    try {
        list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    } catch (err) {
        console.error(`Could not run \`pm2 jlist\`: ${err.message}`);
        console.error('This script must run on the host where PM2 is managing the processes.');
        process.exit(1);
    }

    const totalRam = os.totalmem();
    const freeRam = os.freemem();

    const apps = list.map((p) => {
        const capBytes = parseCap(p.pm2_env?.max_memory_restart);
        const rss = p.monit?.memory || 0;
        return {
            name: p.name,
            pmId: p.pm_id,
            status: p.pm2_env?.status,
            rssBytes: rss,
            capBytes,
            pctOfCap: capBytes ? Math.round((rss / capBytes) * 100) : null,
            restarts: p.pm2_env?.restart_time ?? 0,
            unstableRestarts: p.pm2_env?.unstable_restarts ?? 0,
            uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
            nodeArgs: p.pm2_env?.node_args || null,
        };
    });

    // The God daemon is not in `pm2 jlist` — it is the process that OWNS the list.
    let daemonRssBytes = null;
    try {
        const pid = execSync('pm2 pid 2>/dev/null || cat ~/.pm2/pm2.pid 2>/dev/null', { encoding: 'utf8' }).trim().split('\n')[0];
        if (pid && /^\d+$/.test(pid)) {
            const kb = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
            if (/^\d+$/.test(kb)) daemonRssBytes = parseInt(kb, 10) * 1024;
        }
    } catch { /* best effort — never fail the report over this */ }

    const summedCap = apps.reduce((a, x) => a + (x.capBytes || 0), 0);
    const summedRss = apps.reduce((a, x) => a + x.rssBytes, 0) + (daemonRssBytes || 0);

    if (JSON_OUT) {
        console.log(JSON.stringify({ totalRam, freeRam, daemonRssBytes, summedCap, summedRss, apps }, null, 2));
        return;
    }

    console.log(`\nHost: ${os.hostname()}   RAM ${mb(totalRam)}MB total, ${mb(freeRam)}MB free\n`);
    console.log('  NAME                      RSS       CAP      %CAP   RESTARTS  NODE_ARGS');
    console.log('  ' + '-'.repeat(92));
    for (const a of apps.sort((x, y) => y.rssBytes - x.rssBytes)) {
        const pct = a.pctOfCap == null ? '  -' : `${String(a.pctOfCap).padStart(3)}%`;
        const flag = a.pctOfCap != null && a.pctOfCap >= 80 ? ' ←' : '';
        console.log(
            `  ${String(a.name).padEnd(24)} ${(mb(a.rssBytes) + 'MB').padStart(8)} ` +
            `${(a.capBytes ? mb(a.capBytes) + 'MB' : '-').padStart(8)}  ${pct}   ` +
            `${String(a.restarts).padStart(8)}  ${a.nodeArgs || '(none)'}${flag}`
        );
    }

    console.log(`\n  PM2 God daemon:          ${daemonRssBytes == null ? '(could not read)' : mb(daemonRssBytes) + 'MB'}`);
    console.log(`  Sum of RSS (incl daemon):${(mb(summedRss) + 'MB').padStart(9)}`);
    console.log(`  Sum of max_memory_restart:${(mb(summedCap) + 'MB').padStart(8)}  ← what the box is PROMISING`);

    console.log('\n--- Reading ---');
    const problems = [];

    if (summedCap > totalRam) {
        problems.push(
            `Over-committed: caps total ${mb(summedCap)}MB but the box has ${mb(totalRam)}MB. ` +
            `If enough processes get busy at once the kernel OOM-killer is arithmetic, not bad luck.`
        );
    }
    if (daemonRssBytes != null && daemonRssBytes > 1073741824) {
        problems.push(
            `PM2 God daemon at ${mb(daemonRssBytes)}MB. It owns every process's stdout/stderr, so this ` +
            `usually means log writes are backing up (full disk, or rotation left it writing to an ` +
            `unlinked fd). Check \`pm2 conf pm2-logrotate\` and \`df -h\`; \`pm2 reloadLogs\` reopens ` +
            `the fds, and scripts/pm2-reset-and-start.sh resets the daemon outright.`
        );
    }
    const noCap = apps.filter((a) => !a.nodeArgs || !/max-old-space-size/.test(a.nodeArgs));
    if (noCap.length) {
        problems.push(
            `${noCap.length} app(s) have no --max-old-space-size (${noCap.map((a) => a.name).join(', ')}). ` +
            `V8 then sizes its heap from total system RAM, so the heap ceiling exceeds the PM2 cap meant ` +
            `to contain it — and PM2's cap is a poll-based RSS check, so a fast allocation burst reaches ` +
            `the kernel first.`
        );
    }
    const churn = apps.filter((a) => a.restarts >= 5);
    if (churn.length) {
        problems.push(
            `Restart churn: ${churn.map((a) => `${a.name}=${a.restarts}`).join(', ')}. ` +
            `For worker/integration-worker this means jobs are dying mid-flight — enough to corrupt a ` +
            `finance sync. Cross-check with \`node server/scripts/cleanupStaleJobStatus.js\`.`
        );
    }
    const nearCap = apps.filter((a) => a.pctOfCap != null && a.pctOfCap >= 80);
    if (nearCap.length) {
        problems.push(`Near cap (≥80%): ${nearCap.map((a) => `${a.name} ${a.pctOfCap}%`).join(', ')}.`);
    }

    if (problems.length === 0) {
        console.log('Nothing alarming: caps fit in RAM, the daemon is small, every app has a heap ceiling.');
    } else {
        for (const p of problems) console.log(`\n! ${p}`);
    }
    console.log('');
}

main();
