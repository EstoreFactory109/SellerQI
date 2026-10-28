#!/usr/bin/env node
/**
 * migrateTaskIdentity.js
 *
 * Gives every stored task its identity (Services/Calculations/TaskIdentity.js) and merges
 * rows that turn out to be the same problem under different labels — e.g. a completed
 * "Order Defect Rate" task and a pending "Order Defect Rate (unstable)" one, or a SKU's
 * restock task and its product's out-of-stock task. Run it BEFORE deploying the code
 * that matches on identity, so the first fetch does not close and reopen those rows.
 *
 * WHAT THIS DOES (per user + marketplace; safe to re-run)
 *   1. identityKey on every row, from its own asin / category / type / renderData. A
 *      grouped listing warning ("WARNING:<hash of message>") is re-keyed to Amazon's
 *      issue code, looked up from the seller's stored listing issues by that message.
 *   2. rows sharing an identity: ONE survives — the seller's decision first (completed >
 *      in progress > pending > resolved), then the newest — and keeps its own taskId,
 *      the earliest firstSeenAt and the summed reopenCount. TaskActionLog entries of the
 *      others are re-pointed to the survivor's taskId (so changes already sent to Amazon
 *      stay marked done), then the others are deleted.
 *   3. creates the unique task_identity_marketplace index.
 *   4. --drop-old-index: drops task_dedup_marketplace, only once no row lacks an identity.
 *
 * USAGE
 *   node server/scripts/migrateTaskIdentity.js                     # report only
 *   node server/scripts/migrateTaskIdentity.js --apply             # steps 1-3
 *   node server/scripts/migrateTaskIdentity.js --apply --drop-old-index   # after deploy
 *   --user-id=<id>[,<id>]   limit to these users
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { identityKeyOf, familyOf, listingIssueGroupKey, listingGroupEntity, SEP } = require('../Services/Calculations/TaskIdentity.js');
const { preferStored } = require('../Services/Calculations/TaskReconcilePlanner.js');

const IDENTITY_INDEX = {
    key: { userId: 1, country: 1, region: 1, identityKey: 1 },
    options: { unique: true, name: 'task_identity_marketplace', partialFilterExpression: { identityKey: { $type: 'string' } } },
};
const OLD_INDEX = 'task_dedup_marketplace';
const ROW_FIELDS = { _id: 1, taskId: 1, identityKey: 1, asin: 1, errorCategory: 1, errorType: 1, renderData: 1, status: 1, completedAt: 1, updatedAt: 1, createdAt: 1, firstSeenAt: 1, reopenCount: 1 };
const LISTING_GROUP = /^(WARNING|ERROR):/;

const argValue = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => process.argv.slice(2).includes(`--${name}`);

/**
 * The identity of a stored row. Grouped listing rows were keyed by a hash of the exact
 * message; `listingLookup(severity, message)` returns that issue's new group key, if the
 * seller's stored listing issues still have it.
 */
function identityOfRow(row, listingLookup) {
    if (LISTING_GROUP.test(String(row.asin || '')) && (row.errorType === 'listing_warnings' || row.errorType === 'listing_errors')) {
        const severity = String(row.asin).split(':')[0];
        const message = row.renderData?.messages?.[0];
        const groupKey = row.renderData?.groupKey || (message && listingLookup ? listingLookup(severity, message) : null);
        if (groupKey) {
            return [listingGroupEntity(severity, groupKey), row.errorCategory, familyOf(row.errorCategory, row.errorType)].join(SEP);
        }
    }
    return identityKeyOf(row);
}

/**
 * Pure: what to do with one marketplace's rows.
 * @returns {{ setIdentity: Array<{_id, identityKey, firstSeenAt?, reopenCount?}>,
 *             merges: Array<{ keep: object, drop: object[], identityKey: string }> }}
 */
function planScope(rows, listingLookup) {
    const groups = new Map();
    for (const row of rows) {
        const key = identityOfRow(row, listingLookup);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const setIdentity = [];
    const merges = [];
    for (const [identityKey, members] of groups) {
        const keep = members.reduce((a, b) => preferStored(a, b));
        const drop = members.filter((r) => r !== keep);
        const patch = { _id: keep._id, identityKey };
        if (drop.length > 0) {
            const firstSeen = members.map((r) => r.firstSeenAt || r.createdAt).filter(Boolean).map((d) => new Date(d).getTime());
            if (firstSeen.length) patch.firstSeenAt = new Date(Math.min(...firstSeen));
            patch.reopenCount = members.reduce((n, r) => n + (Number(r.reopenCount) || 0), 0);
            merges.push({ keep, drop, identityKey });
        }
        if (keep.identityKey !== identityKey || drop.length > 0) setIdentity.push(patch);
    }
    return { setIdentity, merges };
}

/** severity + exact message -> group key, from the seller's stored listing issues for one marketplace. */
async function listingLookupFor(db, userId, country, region) {
    const seller = await db.collection('sellers').findOne(
        { User: userId },
        { projection: { 'sellerAccount.country': 1, 'sellerAccount.region': 1, 'sellerAccount.products.listingIssues': 1 } }
    );
    const map = new Map();
    for (const account of seller?.sellerAccount || []) {
        if (country && account.country !== country) continue;
        if (region && account.region !== region) continue;
        for (const product of account.products || []) {
            for (const issue of product.listingIssues || []) {
                if (!issue?.message) continue;
                const k = `${String(issue.severity || '').toUpperCase()}\u0000${String(issue.message).trim()}`;
                if (!map.has(k)) map.set(k, listingIssueGroupKey(issue));
            }
        }
    }
    return (severity, message) => map.get(`${severity}\u0000${String(message).trim()}`) || null;
}

async function run({ apply = false, dropOldIndex = false, userIds = null } = {}) {
    const db = mongoose.connection.db;
    const tasks = db.collection('taskitems');
    const actionLogs = db.collection('taskactionlogs');
    const report = { apply, scopes: 0, rows: 0, identitiesSet: 0, merged: { groups: 0, rowsRemoved: 0, actionLogsRepointed: 0, byFamily: {} }, samples: [], index: null, oldIndex: null };

    const match = userIds ? { userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } } : {};
    const scopes = await tasks.aggregate([{ $match: match }, { $group: { _id: { userId: '$userId', country: '$country', region: '$region' } } }]).toArray();

    for (const { _id: scope } of scopes) {
        report.scopes += 1;
        const filter = { userId: scope.userId, country: scope.country ?? null, region: scope.region ?? null };
        const rows = await tasks.find(filter, { projection: ROW_FIELDS }).toArray();
        report.rows += rows.length;
        const needsLookup = rows.some((r) => LISTING_GROUP.test(String(r.asin || '')));
        const lookup = needsLookup ? await listingLookupFor(db, scope.userId, scope.country, scope.region) : null;
        const { setIdentity, merges } = planScope(rows, lookup);

        report.identitiesSet += setIdentity.length;
        for (const m of merges) {
            report.merged.groups += 1;
            report.merged.rowsRemoved += m.drop.length;
            const family = String(m.identityKey).split(SEP)[2];
            report.merged.byFamily[family] = (report.merged.byFamily[family] || 0) + m.drop.length;
            if (report.samples.length < 15) {
                report.samples.push({
                    userId: String(scope.userId), country: scope.country, region: scope.region,
                    keep: `${m.keep.errorType} (${m.keep.status})`,
                    drop: m.drop.map((r) => `${r.errorType} (${r.status})`),
                });
            }
        }
        if (!apply) continue;

        for (const m of merges) {
            const dropIds = m.drop.map((r) => r.taskId).filter((t) => t && t !== m.keep.taskId);
            if (dropIds.length) {
                const r = await actionLogs.updateMany(
                    { userId: scope.userId, country: scope.country, region: scope.region, taskId: { $in: dropIds } },
                    { $set: { taskId: m.keep.taskId } }
                );
                report.merged.actionLogsRepointed += r.modifiedCount;
            }
            await tasks.deleteMany({ _id: { $in: m.drop.map((r) => r._id) } });
        }
        if (setIdentity.length) {
            await tasks.bulkWrite(setIdentity.map(({ _id, ...set }) => ({ updateOne: { filter: { _id }, update: { $set: set } } })), { ordered: false });
        }
    }

    const indexes = await tasks.indexes();
    if (indexes.some((ix) => ix.name === IDENTITY_INDEX.options.name)) report.index = 'already present';
    else if (apply) report.index = `created ${await tasks.createIndex(IDENTITY_INDEX.key, IDENTITY_INDEX.options)}`;
    else report.index = 'missing (would create)';

    const hasOld = indexes.some((ix) => ix.name === OLD_INDEX);
    if (!hasOld) report.oldIndex = 'already dropped';
    else if (!dropOldIndex) report.oldIndex = 'kept (drop with --drop-old-index after deploy)';
    else {
        const missing = await tasks.countDocuments({ identityKey: { $not: { $type: 'string' } } });
        if (missing > 0) report.oldIndex = `kept: ${missing} rows still have no identity (run --apply again)`;
        else if (apply) { await tasks.dropIndex(OLD_INDEX); report.oldIndex = 'dropped'; }
        else report.oldIndex = 'would drop';
    }
    return report;
}

if (require.main === module) {
    (async () => {
        const dbConsts = require('../config/config.js');
        const uri = dbConsts.dbUri && dbConsts.dbName ? `${dbConsts.dbUri}/${dbConsts.dbName}` : process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(uri);
        try {
            const userIds = argValue('user-id') ? argValue('user-id').split(',').filter(Boolean) : null;
            const report = await run({ apply: hasFlag('apply'), dropOldIndex: hasFlag('drop-old-index'), userIds });
            console.log(JSON.stringify(report, null, 2));
            if (!report.apply) console.log('\nReport only. Re-run with --apply to write.');
        } finally {
            await mongoose.disconnect();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { run, planScope, identityOfRow, listingLookupFor, IDENTITY_INDEX, OLD_INDEX };
