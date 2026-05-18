/**
 * DashboardSliceService.js
 *
 * Helper for reading and writing DashboardSlice documents.
 *
 * Design principles:
 *   - Slice writes NEVER throw out of the helper. Slice failure must not fail
 *     the phase that wrote it (slices are an additive optimisation, not a
 *     correctness requirement). All errors are logged and swallowed.
 *   - Writes are idempotent: same (userId, country, region, sliceKey) →
 *     upsert overwrites, no duplicates ever exist.
 *   - Reads are pull-everything-for-an-account in ONE query so finalize stays
 *     cheap (the whole point of slices).
 *
 * Slice keys (kept in `SLICE_KEYS` for typo-resistance):
 *   listings, ppc, inventory, performance, mcp, finance, keywords, issues
 */

const DashboardSlice = require('../../models/dashboard/DashboardSliceModel.js');
const logger = require('../../utils/Logger.js');

const SLICE_KEYS = Object.freeze({
    LISTINGS:    'listings',
    ADS:         'ads',
    PPC:         'ppc',
    INVENTORY:   'inventory',
    PERFORMANCE: 'performance',
    MCP:         'mcp',
    FINANCE:     'finance',
    KEYWORDS:    'keywords',
    ISSUES:      'issues'
});

const ALL_SLICE_KEYS = Object.values(SLICE_KEYS);

// Minimum slices needed for finalize to attempt slice-based assembly.
// Below this, finalize falls back to legacy Analyse() so half-written
// pipelines (e.g. a single failed phase) still produce a valid dashboard.
const SLICE_MIN_FOR_ASSEMBLY = parseInt(process.env.SLICE_MIN_FOR_ASSEMBLY || '6', 10);

/**
 * Upsert a slice document. Never throws.
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.country
 * @param {string} args.region
 * @param {string} args.sliceKey - one of SLICE_KEYS
 * @param {Object} args.data     - arbitrary slice payload
 * @param {string} [args.producedByPhase] - which phase wrote this slice
 * @param {number} [args.version] - slice schema version (default 1)
 * @returns {Promise<{ success: boolean, sliceKey: string, error?: string }>}
 */
async function writeSlice(args = {}) {
    const { userId, country, region, sliceKey, data, producedByPhase, version } = args;

    if (!userId || !country || !region || !sliceKey) {
        logger.warn('[DashboardSliceService.writeSlice] Missing required keys', {
            hasUserId: !!userId,
            hasCountry: !!country,
            hasRegion: !!region,
            hasSliceKey: !!sliceKey
        });
        return { success: false, sliceKey: sliceKey || null, error: 'Missing required keys' };
    }

    if (!ALL_SLICE_KEYS.includes(sliceKey)) {
        logger.warn(`[DashboardSliceService.writeSlice] Unknown sliceKey "${sliceKey}" — writing anyway`, { userId, country, region });
    }

    try {
        await DashboardSlice.findOneAndUpdate(
            { userId: userId.toString(), country, region, sliceKey },
            {
                $set: {
                    data: data || {},
                    version: version || 1,
                    producedByPhase: producedByPhase || null,
                    producedAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        logger.info(`[DashboardSliceService] Wrote slice "${sliceKey}"`, {
            userId: userId.toString(), country, region, producedByPhase: producedByPhase || null
        });
        return { success: true, sliceKey };
    } catch (error) {
        // Slice writes must never fail the phase — log and continue.
        logger.error(`[DashboardSliceService] Failed to write slice "${sliceKey}" (non-fatal)`, {
            userId: userId.toString(),
            country,
            region,
            error: error?.message
        });
        return { success: false, sliceKey, error: error?.message };
    }
}

/**
 * Read all slices for a (userId, country, region) tuple.
 *
 * @returns {Promise<Object<string, *>>} Map of sliceKey → data
 *   Returns empty object if read fails (caller should fall back to Analyse()).
 */
async function readAllSlices(userId, country, region) {
    if (!userId || !country || !region) return {};
    try {
        const rows = await DashboardSlice
            .find({ userId: userId.toString(), country, region })
            .lean();

        const out = {};
        for (const row of rows) {
            out[row.sliceKey] = row.data;
        }
        return out;
    } catch (error) {
        logger.error('[DashboardSliceService.readAllSlices] read failed', {
            userId: userId.toString(),
            country,
            region,
            error: error?.message
        });
        return {};
    }
}

/**
 * Check whether enough slices are present to attempt finalize-as-assembler.
 *
 * @returns {Promise<{ ready: boolean, count: number, sliceKeys: string[] }>}
 */
async function hasMinimumSlices(userId, country, region, minimum = SLICE_MIN_FOR_ASSEMBLY) {
    try {
        const rows = await DashboardSlice
            .find({ userId: userId.toString(), country, region })
            .select('sliceKey')
            .lean();
        const keys = rows.map(r => r.sliceKey);
        return { ready: keys.length >= minimum, count: keys.length, sliceKeys: keys };
    } catch (error) {
        logger.error('[DashboardSliceService.hasMinimumSlices] read failed', { error: error?.message });
        return { ready: false, count: 0, sliceKeys: [] };
    }
}

/**
 * Delete all slices for a user/account (used by user-data purge flow).
 *
 * @returns {Promise<{ deletedCount: number }>}
 */
async function clearSlicesForAccount(userId, country, region) {
    if (!userId || !country || !region) return { deletedCount: 0 };
    try {
        const result = await DashboardSlice.deleteMany({
            userId: userId.toString(), country, region
        });
        return { deletedCount: result?.deletedCount || 0 };
    } catch (error) {
        logger.error('[DashboardSliceService.clearSlicesForAccount] delete failed', {
            userId: userId.toString(),
            country,
            region,
            error: error?.message
        });
        return { deletedCount: 0 };
    }
}

module.exports = {
    SLICE_KEYS,
    ALL_SLICE_KEYS,
    SLICE_MIN_FOR_ASSEMBLY,
    writeSlice,
    readAllSlices,
    hasMinimumSlices,
    clearSlicesForAccount
};
