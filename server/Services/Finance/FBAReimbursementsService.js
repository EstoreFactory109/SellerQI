/**
 * FBAReimbursementsService.js
 *
 * Read/write layer for the FBA-reimbursements report, keeping it out of a single MongoDB document.
 *
 * WHY THIS EXISTS. `GET_FBA_REIMBURSEMENTS_DATA.js` used to `FBAReimbursements.create({ data })`
 * with the whole report embedded — the same shape that broke ledger detail. It has more headroom
 * (measured 2026-08-21: 209MB, largest document 3.63MB / 5,337 rows, no account over 4MB) but the
 * stored maximum understates the truth, because a write that exceeds the 16MB ceiling never lands
 * and so never shows up in the statistics. It failed for the largest account on 2026-08-15.
 *
 * Rows now live one-per-document in FBAReimbursementsItem, grouped by the `batchId` of the fetch.
 * `getFBAReimbursementsData` reassembles the newest batch into the shape the legacy document had,
 * so all five readers are unchanged.
 *
 * Faithful copy of LedgerSummaryViewService, with the same "inserted 0 => throw" guard added as in
 * LedgerDetailViewService.
 */

const mongoose = require('mongoose');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel.js');
const FBAReimbursementsItem = require('../../models/finance/FBAReimbursementsItemModel.js');
const { insertManyChunked } = require('../../utils/chunkedInsert.js');
const logger = require('../../utils/Logger.js');

/** Keep the newest N fetches. Matches every sibling item collection. */
const KEEP_BATCHES = 3;

/** Report columns the legacy row schema left free-form. */
const ROW_STRING_FIELDS = [
    'approval_date', 'reimbursement_id', 'case_id', 'amazon_order_id', 'reason', 'sku',
    'fnsku', 'asin', 'product_name', 'condition', 'currency_unit',
    'original_reimbursement_id', 'original_reimbursement_type',
];
/** Numeric-ish columns the legacy schema defaulted to "0". */
const ROW_ZERO_FIELDS = [
    'amount_per_unit', 'amount_total', 'quantity_reimbursed_cash',
    'quantity_reimbursed_inventory', 'quantity_reimbursed_total',
];

/**
 * Persist one fetch of reimbursement rows.
 *
 * @returns {Promise<{success: boolean, itemCount: number, batchId: string, recordId: string}>}
 *   `recordId` is the batchId, preserving the caller's stable-identifier contract.
 */
async function saveFBAReimbursementsData(userId, country, region, dataArray) {
    if (!userId) throw new Error('User ID is required');
    if (!country || !region) throw new Error('Country and region are required');

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }

    const rows = Array.isArray(dataArray) ? dataArray : [];
    const batchId = new mongoose.Types.ObjectId();

    logger.info('Saving FBA Reimbursements data using separate collection', {
        userId: userObjectId.toString(), country, region, itemCount: rows.length,
    });

    if (rows.length === 0) {
        // Deletes nothing on purpose: a zero-row fetch leaves the previous batch live rather than
        // blanking the report the reimbursement calculators read.
        logger.info('No FBA Reimbursements data to save');
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
        doc.store = item?.store ?? '';
        return doc;
    });

    const inserted = await insertManyChunked(FBAReimbursementsItem, itemsToInsert, { ordered: false });

    // A save that wrote nothing must be loud: the readers below treat an empty result as "no
    // reimbursements", which is indistinguishable from a real zero.
    if (inserted === 0) {
        throw new Error('insertMany returned 0 documents — check schema validation');
    }

    logger.info('FBA Reimbursements data saved successfully', {
        userId: userObjectId.toString(), country, region, itemCount: inserted, batchId: batchId.toString(),
    });

    try {
        const res = await FBAReimbursementsItem.deleteOldBatches(userObjectId, country, region, KEEP_BATCHES);
        if (res.deletedCount > 0) {
            logger.info('Cleaned up old FBA Reimbursements batches', {
                userId: userObjectId.toString(), deletedCount: res.deletedCount,
            });
        }
    } catch (cleanupError) {
        logger.warn('Failed to cleanup old FBA Reimbursements batches', {
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
 * NOTE one reader indexes positionally — `reimbursementData.data[0]?.currency_unit` in
 * QMateReimbursementService — so the returned array must keep a usable first element, not just the
 * right length.
 */
async function getFBAReimbursementsData(userId, country, region) {
    if (!userId) throw new Error('User ID is required');

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }

    const { items, createdAt, batchId } = await FBAReimbursementsItem.findLatestByUserCountryRegion(
        userObjectId, country, region
    );

    if (items && items.length > 0) {
        const data = items.map((item) => {
            const row = {};
            for (const f of ROW_STRING_FIELDS) row[f] = item[f];
            for (const f of ROW_ZERO_FIELDS) row[f] = item[f];
            row.store = item.store;
            return row;
        });

        return { _id: batchId, User: userObjectId, country, region, data, createdAt, updatedAt: createdAt };
    }

    const legacy = await FBAReimbursements.findOne({ User: userObjectId, country, region })
        .sort({ createdAt: -1 })
        .lean();
    if (legacy && Array.isArray(legacy.data) && legacy.data.length > 0) return legacy;

    return null;
}

/** Delete both formats for an account. Used by the purge paths. */
async function deleteFBAReimbursementsData(userId, country, region) {
    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }
    const filter = { User: userObjectId, ...(country ? { country } : {}), ...(region ? { region } : {}) };
    const [items, docs] = await Promise.all([
        FBAReimbursementsItem.deleteMany(filter),
        FBAReimbursements.deleteMany(filter),
    ]);
    return { itemsDeleted: items?.deletedCount || 0, documentsDeleted: docs?.deletedCount || 0 };
}

module.exports = {
    saveFBAReimbursementsData,
    getFBAReimbursementsData,
    deleteFBAReimbursementsData,
};
