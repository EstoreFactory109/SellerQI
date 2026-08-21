/**
 * batchedItemModel.js
 *
 * Factory for the "one document per row, grouped by batchId" item collections that keep a whole
 * report out of a single MongoDB document.
 *
 * WHY A FACTORY. `LedgerSummaryViewItemModel` established this pattern and
 * `ProductWiseSponsoredAdsItemModel` repeated it; both carry a byte-identical copy of the same
 * three indexes and the same four statics, and `deleteOldBatches` in particular is subtle enough
 * that a third and fourth hand-written copy is how they drift. The reports that still needed
 * migrating — ledger detail and FBA reimbursements — get their schemas from here instead.
 *
 * THE PATTERN. The legacy parent model holds the whole report in one embedded `data[]` array and
 * stops being written; each row becomes its own document here, tagged with the `batchId` of the
 * fetch that produced it. Readers ask for the newest batch, so a fetch is atomic from their point
 * of view even though it is many inserts.
 *
 * WHAT `batchId` BUYS, and the trap. Readers resolve the newest batch and read ONLY that batch.
 * That is what makes a half-finished insert invisible rather than half-visible — but it also means
 * any row left on an older batchId is invisible even though it is still in the collection, and
 * `deleteOldBatches` will purge it within `keepCount` runs. A caller that preserves rows from a
 * partial fetch must therefore re-stamp them into the new batch; see the adoption step in
 * ProductWiseSponsoredAdsService for what that looks like.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Build an item schema: the shared scope/batch keys plus the caller's row columns.
 *
 * Keyed on `User` (capital) to match the legacy parents these collections replace, and the purge
 * registries that file them under `collectionsWithUser`.
 *
 * @param {object} rowFields  mongoose path definitions for the report's own columns
 * @param {object} [options]
 * @param {Array<object>} [options.extraIndexes] additional compound indexes to declare
 */
function buildBatchedItemSchema(rowFields, { extraIndexes = [] } = {}) {
    const schema = new Schema({
        User: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        country: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        region: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        // Groups every row of one fetch. Not required and with no default: the service generates it
        // so all of a fetch's rows share one value.
        batchId: {
            type: Schema.Types.ObjectId,
            index: true
        },
        ...rowFields,
    }, { timestamps: true });

    // Serves the "newest batch" probe.
    schema.index({ User: 1, country: 1, region: 1, createdAt: -1 });
    // Serves fetching that batch's rows.
    schema.index({ User: 1, country: 1, region: 1, batchId: 1 });
    // Serves deleteOldBatches' $group.
    schema.index({ batchId: 1, createdAt: -1 });
    for (const idx of extraIndexes) schema.index(idx.fields, idx.options || {});

    /**
     * Resolve the newest batch and return its rows.
     *
     * Two steps on purpose: the first learns which batch is newest, the second reads only that
     * batch. Doing it in one sorted query would risk mixing rows from two batches when a fetch is
     * mid-flight.
     */
    schema.statics.findLatestByUserCountryRegion = async function(userId, country, region) {
        const latestItem = await this.findOne({ User: userId, country, region })
            .sort({ createdAt: -1 })
            .select('batchId createdAt')
            .lean();

        if (!latestItem || !latestItem.batchId) {
            return { items: [], createdAt: null, batchId: null };
        }

        const items = await this.find({ batchId: latestItem.batchId }).lean();
        return { items, createdAt: latestItem.createdAt, batchId: latestItem.batchId };
    };

    schema.statics.findByBatchId = function(batchId) {
        return this.find({ batchId }).lean();
    };

    schema.statics.deleteByBatchId = function(batchId) {
        return this.deleteMany({ batchId });
    };

    /**
     * Keep the newest `keepCount` batches, delete the rest.
     *
     * Ranked by each batch's MAX createdAt, so a batch that adopted older rows (whose createdAt is
     * deliberately left untouched) is still ranked by when it was actually written.
     */
    schema.statics.deleteOldBatches = async function(userId, country, region, keepCount = 3) {
        const batches = await this.aggregate([
            { $match: { User: new mongoose.Types.ObjectId(userId), country, region } },
            { $group: { _id: '$batchId', createdAt: { $max: '$createdAt' } } },
            { $sort: { createdAt: -1 } },
            { $skip: keepCount },
            { $project: { _id: 1 } }
        ]);

        if (batches.length === 0) return { deletedCount: 0 };
        return this.deleteMany({ batchId: { $in: batches.map((b) => b._id) } });
    };

    return schema;
}

module.exports = { buildBatchedItemSchema };
