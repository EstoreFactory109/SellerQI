/**
 * ecosystem.memory-check.js — warn at PM2 start when the configured memory budget cannot fit.
 *
 * WHY THIS EXISTS
 * On 2 Jul 2026 the kernel OOM-killer killed the PM2 God daemon (12.6 GB RSS) and took every
 * process down with it. The contributing condition was invisible: the summed
 * `max_memory_restart × instances` across all apps came to ~18.3 GB on a 16 GB host, because a
 * `WORKER_INSTANCES=5` line in `.env` silently overrode the committed `|| '3'` default. Nothing
 * anywhere printed that total, so nobody could see the box was over-committed until it died.
 *
 * This turns that into a line you cannot miss in `pm2 start` output.
 *
 * DESIGN
 * - **Never throws, never exits.** A config file that crashes takes production down, which would be
 *   far worse than the problem it is warning about. Every path is wrapped, and any failure degrades
 *   to silence.
 * - **Warns, does not block.** Over-commit is often survivable (these are ceilings, not
 *   reservations — idle processes sit far below them). The operator decides; this only makes the
 *   number visible.
 * - Zero dependencies beyond `os`, so it cannot fail to resolve.
 */

const os = require('os');

/** '512M' | '2G' | 1234 -> bytes. Returns 0 for anything unparseable. */
function parseMemoryString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 0;
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2].toUpperCase()];
    return mult ? n * mult : 0;
}

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * @param {Array}  apps      the `apps` array about to be exported from an ecosystem config
 * @param {string} label     which config file this is, for the message
 * @param {object} [opts]    { totalMemBytes } injectable for tests
 * @returns {object|null}    summary, or null if it could not be computed
 */
function checkMemoryBudget(apps, label, opts = {}) {
    try {
        if (!Array.isArray(apps) || apps.length === 0) return null;

        const totalMem = opts.totalMemBytes != null ? opts.totalMemBytes : os.totalmem();
        if (!Number.isFinite(totalMem) || totalMem <= 0) return null;

        const rows = apps.map((app) => {
            const instances = Math.max(1, parseInt(app && app.instances, 10) || 1);
            const cap = parseMemoryString(app && app.max_memory_restart);
            return { name: (app && app.name) || '(unnamed)', instances, cap, total: cap * instances };
        });

        const budget = rows.reduce((sum, r) => sum + r.total, 0);
        // Leave room for the OS, the PM2 daemon itself, and anything colocated (Redis/Mongo often
        // are). 20% is a rule of thumb, not a guarantee.
        const headroom = totalMem * 0.2;
        const overCommitted = budget > totalMem - headroom;

        if (overCommitted) {
            const worst = [...rows].sort((a, b) => b.total - a.total).slice(0, 3);
            /* eslint-disable no-console */
            console.warn(
                `\n⚠  [${label}] MEMORY OVER-COMMIT: apps may use up to ${gb(budget)} on a ${gb(totalMem)} host.\n` +
                `   Largest: ${worst.map((r) => `${r.name} ${gb(r.cap)}×${r.instances}=${gb(r.total)}`).join(', ')}\n` +
                `   These are ceilings, not reservations — but if several are reached at once the kernel\n` +
                `   OOM-killer can kill the PM2 daemon and take every process down (this happened 2 Jul 2026).\n` +
                `   Check WORKER_INSTANCES / WORKER_CONCURRENCY in .env — they override the committed defaults.\n`
            );
            /* eslint-enable no-console */
        }

        return { budget, totalMem, overCommitted, rows };
    } catch {
        // Deliberately silent: a warning helper must never be the reason PM2 fails to start.
        return null;
    }
}

module.exports = { checkMemoryBudget, parseMemoryString };
