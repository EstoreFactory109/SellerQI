/**
 * LedgerDetailViewService.js
 *
 * Read/write layer for the ledger-detail report, keeping it out of a single MongoDB document.
 *
 * WHY THIS EXISTS. `GET_LEDGER_DETAIL_VIEW_DATA.js` used to `LedgerDetailView.create({ data })`
 * with the whole 9-month report embedded. Measured 2026-08-21 that collection was 2,975MB, its
 * largest document 14.91MB / 32,175 rows, and 3 of 157 accounts sat within ~1MB of MongoDB's hard
 * 16MB ceiling — past which the write dies with a driver-level `ERR_OUT_OF_RANGE` that names
 * nothing useful. Two accounts were already failing.
 *
 * That mattered more than a failed write usually does: the report feeds
 * `calculateDamagedInventoryReimbursement` and `calculateDisposedInventoryReimbursement`, and both
 * treat an empty read as "fall back to the summary report" rather than an error. So the seller's
 * recoverable-money figures silently came from a weaker source.
 *
 * Rows now live one-per-document in LedgerDetailViewItem, grouped by the `batchId` of the fetch
 * that produced them. `getLedgerDetailViewData` reassembles the newest batch into the exact shape
 * the legacy document had, so every caller is unchanged.
 *
 * This is a faithful copy of LedgerSummaryViewService, which migrated the sibling report — with one
 * addition noted at the insert, and one column rename noted in the mapper.
 */

const mongoose = require('mongoose');
const LedgerDetailView = require('../../models/finance/LedgerDetailViewModel.js');
const LedgerDetailViewItem = require('../../models/finance/LedgerDetailViewItemModel.js');
const { insertManyChunked } = require('../../utils/chunkedInsert.js');
const logger = require('../../utils/Logger.js');

/** Keep the newest N fetches. Matches every sibling item collection. */
const KEEP_BATCHES = 3;

/**
 * The report's own columns, in the order the legacy row schema declared them.
 *
 * `country` is deliberately absent: it is the TRANSACTION's marketplace and is stored as
 * `rowCountry` so it cannot collide with the account-scope `country` key. It is handled explicitly
 * at both ends.
 */
const ROW_STRING_FIELDS = [
    'date_and_time', 'reference_id', 'fnsku', 'asin', 'msku', 'title',
    'event_type', 'fulfillment_center', 'reason', 'disposition', 'reconciled',
];
/** Numeric-ish columns the legacy schema defaulted to "0". */
const ROW_ZERO_FIELDS = ['quantity', 'unreconciled_quantity'];

/**
 * Persist one fetch of ledger-detail rows.
 *
 * @returns {Promise<{success: boolean, itemCount: number, batchId: string, recordId: string}>}
 *   `recordId` is the batchId, so callers that used to return the created document's `_id` keep a
 *   stable identifier.
 */
async function saveLedgerDetailViewData(userId, country, region, dataArray) {
    if (!userId) throw new Error('User ID is required');
    if (!country || !region) throw new Error('Country and region are required');

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }

    const rows = Array.isArray(dataArray) ? dataArray : [];
    // One batchId per save, generated before any I/O so every row of this fetch shares it.
    const batchId = new mongoose.Types.ObjectId();

    logger.info('Saving Ledger Detail View data using separate collection', {
        userId: userObjectId.toString(), country, region, itemCount: rows.length,
    });

    if (rows.length === 0) {
        // Deliberately deletes nothing: a zero-row fetch leaves the previous batch as the live one,
        // rather than blanking a report the readers would then silently replace with the summary.
        logger.info('No Ledger Detail View data to save');
        return { success: true, message: 'No data to save', itemCount: 0, batchId: batchId.toString(), recordId: batchId.toString() };
    }

    const itemsToInsert = rows.map((item) => {
        const doc = { User: userObjectId, country, region, batchId };
        // `??` not `||`: the legacy schema applied its default only when a column was ABSENT, so a
        // stored empty string must stay an empty string. Using `||` rewrote '' to '0' on 111,982 of
        // 115,576 real ledger rows — numerically harmless downstream, but a silent data change, and
        // the kind of thing that makes a later parity check impossible to trust.
        for (const f of ROW_STRING_FIELDS) doc[f] = item?.[f] ?? undefined;
        for (const f of ROW_ZERO_FIELDS) doc[f] = item?.[f] ?? '0';
        // The row's own marketplace column, kept clear of the account-scope key.
        doc.rowCountry = item?.country ?? undefined;
        doc.store = item?.store ?? '';
        return doc;
    });

    const inserted = await insertManyChunked(LedgerDetailViewItem, itemsToInsert, { ordered: false });

    // NOT in the summary sibling, and deliberate here. A silently-empty read does not surface as an
    // error downstream — the reimbursement calculators fall back to the summary report — so a
    // save that wrote nothing has to be loud. Mirrors the guard in ProductWiseSponsoredAdsService.
    if (inserted === 0) {
        throw new Error('insertMany returned 0 documents — check schema validation');
    }

    logger.info('Ledger Detail View data saved successfully', {
        userId: userObjectId.toString(), country, region, itemCount: inserted, batchId: batchId.toString(),
    });

    // Retention. Isolated so a cleanup failure can never fail the save.
    try {
        const res = await LedgerDetailViewItem.deleteOldBatches(userObjectId, country, region, KEEP_BATCHES);
        if (res.deletedCount > 0) {
            logger.info('Cleaned up old Ledger Detail View batches', {
                userId: userObjectId.toString(), deletedCount: res.deletedCount,
            });
        }
    } catch (cleanupError) {
        logger.warn('Failed to cleanup old Ledger Detail View batches', {
            userId: userObjectId.toString(), error: cleanupError.message,
        });
    }

    return {
        success: true,
        message: 'Data saved successfully',
        itemCount: inserted,
        batchId: batchId.toString(),
        recordId: batchId.toString(),
        userId: userObjectId.toString(),
        country,
        region,
    };
}

/**
 * Read the newest fetch, shaped exactly like the legacy document.
 *
 * Returns `{ _id, User, country, region, data, createdAt, updatedAt }` — callers only ever touch
 * `.data`, so they need no change. Falls back to the legacy embedded document for accounts whose
 * last successful write predates this migration.
 */
async function getLedgerDetailViewData(userId, country, region) {
    if (!userId) throw new Error('User ID is required');

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }

    const { items, createdAt, batchId } = await LedgerDetailViewItem.findLatestByUserCountryRegion(
        userObjectId, country, region
    );

    if (items && items.length > 0) {
        const data = items.map((item) => {
            const row = {};
            for (const f of ROW_STRING_FIELDS) row[f] = item[f];
            for (const f of ROW_ZERO_FIELDS) row[f] = item[f];
            // Map the renamed column back, so consumers see the field name they always saw.
            row.country = item.rowCountry;
            row.store = item.store;
            return row;
        });

        return { _id: batchId, User: userObjectId, country, region, data, createdAt, updatedAt: createdAt };
    }

    const legacy = await LedgerDetailView.findOne({ User: userObjectId, country, region })
        .sort({ createdAt: -1 })
        .lean();
    if (legacy && Array.isArray(legacy.data) && legacy.data.length > 0) return legacy;

    return null;
}

/** Delete both formats for an account. Used by the purge paths. */
async function deleteLedgerDetailViewData(userId, country, region) {
    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }
    const filter = { User: userObjectId, ...(country ? { country } : {}), ...(region ? { region } : {}) };
    const [items, docs] = await Promise.all([
        LedgerDetailViewItem.deleteMany(filter),
        LedgerDetailView.deleteMany(filter),
    ]);
    return { itemsDeleted: items?.deletedCount || 0, documentsDeleted: docs?.deletedCount || 0 };
}

module.exports = {
    saveLedgerDetailViewData,
    getLedgerDetailViewData,
    deleteLedgerDetailViewData,
};
