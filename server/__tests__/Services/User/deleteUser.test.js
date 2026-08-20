/**
 * The two delete modes, and the guard that keeps the purge list complete.
 *
 * WHY THIS EXISTS
 * Commit cfb4b02 (six-month inactivity cleanup) replaced `User.findByIdAndDelete`
 * with a `purgedAt` stamp for BOTH callers of deleteUserById. That was right for the
 * automated cleanup and wrong for the admin's manual delete, which is supposed to
 * remove the account. Nothing in the flow deleted the User document any more.
 *
 * Separately, fullUserDataPurgeService's model lists were never kept in step with the
 * models added after it was written. In production that left 1.9M+ rows belonging to
 * purged users in expense/finance/review collections. The completeness test below is
 * the important one: it fails the moment someone adds a model with `ref: 'User'` and
 * forgets the purge list, which is exactly how the leak happened.
 */

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', '..', '..', 'models');
const PURGE_SERVICE = path.join(__dirname, '..', '..', '..', 'Services', 'User', 'fullUserDataPurgeService.js');

/**
 * Collections that reference a user but are deliberately NOT in the purge lists.
 * Each needs a reason; anything else showing up is a leak.
 */
const INTENTIONALLY_EXCLUDED = {
    'userModel.js': 'the account itself - removed by deleteUserById when hardDelete is set',
    'sellerCentralModel.js': 'deleted separately by deleteSellerDocumentsForUser',
};

/** Purged only when the caller passes includeBillingHistory (admin manual delete). */
const BILLING_HISTORY_MODELS = ['SubscriptionModel.js', 'PaymentLogsModel.js'];

const listFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full) : (entry.name.endsWith('.js') ? [full] : []);
    });

/** Model files whose schema has a field with `ref: 'User'`. */
const modelsReferencingUser = () =>
    listFiles(MODELS_DIR).filter((file) => /ref:\s*['"]User['"]/.test(fs.readFileSync(file, 'utf8')));

/** Basenames of the model files actually listed as `{ model: X, key: Y }` in the purge service. */
const modelsCoveredByPurge = () => {
    const src = fs.readFileSync(PURGE_SERVICE, 'utf8');
    const varToFile = {};
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*require\('([^']*models[^']*)'\)/g)) {
        varToFile[m[1]] = path.basename(m[2]);
    }
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\('([^']*models[^']*)'\)/g)) {
        m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => { varToFile[v] = path.basename(m[2]); });
    }
    const listed = [...src.matchAll(/\{\s*model:\s*(\w+)\s*,\s*key:\s*'([^']+)'/g)];
    return {
        files: new Set(listed.map((m) => varToFile[m[1]]).filter(Boolean)),
        entries: listed.map((m) => ({ variable: m[1], file: varToFile[m[1]], key: m[2] })),
    };
};

describe('fullUserDataPurgeService coverage', () => {
    it('purges every collection that references a user, except the documented exclusions', () => {
        const { files: covered } = modelsCoveredByPurge();
        const uncovered = modelsReferencingUser()
            .map((f) => path.basename(f))
            .filter((base) => !covered.has(base) && !INTENTIONALLY_EXCLUDED[base]);

        // If this fails, a model with `ref: 'User'` was added without adding it to
        // fullUserDataPurgeService - its rows will survive user deletion forever.
        // Either add it to the right list, or document it in INTENTIONALLY_EXCLUDED.
        expect(uncovered).toEqual([]);
    });

    it('keeps billing history in its own conditional list, not the unconditional ones', () => {
        const src = fs.readFileSync(PURGE_SERVICE, 'utf8');
        // Everything before billingHistoryCollections is purged unconditionally.
        const [unconditional, conditional] = src.split('const billingHistoryCollections');
        expect(conditional).toBeDefined();
        for (const model of BILLING_HISTORY_MODELS) {
            const variable = model.replace(/Model\.js$/, '');
            expect(unconditional).not.toMatch(new RegExp(`\\{\\s*model:\\s*${variable}\\s*,`));
            expect(conditional).toMatch(new RegExp(`\\{\\s*model:\\s*${variable}\\s*,`));
        }
        // ...and it only runs behind the flag.
        expect(src).toMatch(/if \(includeBillingHistory\) \{\s*await runOne\(billingHistoryCollections/);
    });

    it('never purges the users collection itself', () => {
        const { files: covered } = modelsCoveredByPurge();
        expect(covered.has('userModel.js')).toBe(false);
    });

    it('lists real models with a matching key, resolved exactly as the service imports them', () => {
        // Resolved the same way the service does, honouring `const X = require(...)`
        // vs `const { X } = require(...)`. Do NOT fall back to "find the model inside
        // the exported object": that leniency is what hid the Alert bug, where the
        // service passed the whole discriminator map and every alert purge threw.
        const src = fs.readFileSync(PURGE_SERVICE, 'utf8');
        const serviceDir = path.dirname(PURGE_SERVICE);
        const resolved = {};
        // Only model requires - the service also pulls in mongoose and the logger.
        for (const m of src.matchAll(/const\s+(\w+)\s*=\s*require\('([^']*models\/[^']+)'\)/g)) {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            resolved[m[1]] = require(path.resolve(serviceDir, m[2]));
        }
        for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\('([^']*models\/[^']+)'\)/g)) {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            const mod = require(path.resolve(serviceDir, m[2]));
            m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => { resolved[v] = mod?.[v]; });
        }

        const problems = [];
        for (const { variable, key } of modelsCoveredByPurge().entries) {
            const model = resolved[variable];
            if (!model || typeof model.deleteMany !== 'function') {
                problems.push(`${variable} is not a mongoose model - deleteMany would throw`);
                continue;
            }
            // A wrong key silently deletes nothing: deleteMany just matches no documents.
            if (!model.schema?.path(key)) problems.push(`${variable} has no field "${key}"`);
        }
        expect(problems).toEqual([]);
    });
});

describe('deleteUserById modes', () => {
    const USER_ID = '6a83491798121a117ee5687c';
    let User;
    let Seller;
    let deleteUserById;

    const loadWithMocks = () => {
        jest.resetModules();
        jest.doMock('../../../models/user-auth/userModel.js', () => ({
            findById: jest.fn(),
            findByIdAndUpdate: jest.fn(),
            findByIdAndDelete: jest.fn(),
            countDocuments: jest.fn(),
        }));
        jest.doMock('../../../models/user-auth/sellerCentralModel.js', () => ({
            find: jest.fn(),
            findByIdAndDelete: jest.fn(),
        }));
        User = require('../../../models/user-auth/userModel.js');
        Seller = require('../../../models/user-auth/sellerCentralModel.js');
        ({ deleteUserById } = require('../../../Services/User/deleteUserService.js'));

        User.findById.mockResolvedValue({ _id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B' });
        User.countDocuments.mockResolvedValue(0);
        User.findByIdAndUpdate.mockResolvedValue({});
        User.findByIdAndDelete.mockResolvedValue({});
        Seller.find.mockResolvedValue([{ _id: 'seller1' }]);
        Seller.findByIdAndDelete.mockResolvedValue({});
    };

    beforeEach(loadWithMocks);

    it('soft delete (default) keeps the account and stamps purgedAt', async () => {
        const result = await deleteUserById(USER_ID);

        expect(User.findByIdAndDelete).not.toHaveBeenCalled();
        expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
        const update = User.findByIdAndUpdate.mock.calls[0][1];
        expect(update.$set.purgedAt).toBeInstanceOf(Date);
        expect(result.data.hardDelete).toBe(false);
    });

    it('the six-month cleanup call signature still means soft delete', async () => {
        // SixMonthUserMaintenanceService calls deleteUserById(userIdStr) with no options.
        await deleteUserById(USER_ID);
        expect(User.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('hard delete removes the account and does not stamp purgedAt', async () => {
        const result = await deleteUserById(USER_ID, { hardDelete: true });

        expect(User.findByIdAndDelete).toHaveBeenCalledWith(USER_ID);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
        expect(result.data.hardDelete).toBe(true);
    });

    it('deletes the Seller documents in both modes', async () => {
        await deleteUserById(USER_ID);
        expect(Seller.findByIdAndDelete).toHaveBeenCalledWith('seller1');

        loadWithMocks();
        await deleteUserById(USER_ID, { hardDelete: true });
        expect(Seller.findByIdAndDelete).toHaveBeenCalledWith('seller1');
    });

    it('refuses a hard delete that would orphan an agency\'s clients', async () => {
        User.countDocuments.mockResolvedValue(3);

        await expect(deleteUserById(USER_ID, { hardDelete: true })).rejects.toMatchObject({ statusCode: 409 });
        expect(User.findByIdAndDelete).not.toHaveBeenCalled();
        // Nothing should have been removed before the refusal.
        expect(Seller.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('does not run the agency check for a soft delete', async () => {
        User.countDocuments.mockResolvedValue(3);

        await expect(deleteUserById(USER_ID)).resolves.toMatchObject({ success: true });
        expect(User.countDocuments).not.toHaveBeenCalled();
    });

    it('rejects a missing user', async () => {
        User.findById.mockResolvedValue(null);
        await expect(deleteUserById(USER_ID, { hardDelete: true })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('purgeAllUserData billing history', () => {
    const USER_ID = '6a83491798121a117ee5687c';

    /** Runs the real purge with every model's deleteMany stubbed, and reports which ran. */
    const runPurge = async (options) => {
        jest.resetModules();
        const { purgeAllUserData } = require('../../../Services/User/fullUserDataPurgeService.js');
        const Subscription = require('../../../models/user-auth/SubscriptionModel.js');
        const PaymentLogs = require('../../../models/system/PaymentLogsModel.js');

        const mongoose = require('mongoose');
        const touched = [];
        const spies = Object.values(mongoose.models).map((model) =>
            jest.spyOn(model, 'deleteMany').mockImplementation((filter) => {
                touched.push({ name: model.collection.collectionName, filter });
                return Promise.resolve({ deletedCount: 0 });
            })
        );

        await purgeAllUserData(USER_ID, options);
        spies.forEach((s) => s.mockRestore());
        return {
            touched: touched.map((t) => t.name),
            subscriptions: Subscription.collection.collectionName,
            paymentLogs: PaymentLogs.collection.collectionName,
        };
    };

    it('leaves billing history alone by default (six-month cleanup)', async () => {
        const { touched, subscriptions, paymentLogs } = await runPurge(undefined);
        expect(touched).not.toContain(subscriptions);
        expect(touched).not.toContain(paymentLogs);
        // ...but still purged the operational collections.
        expect(touched.length).toBeGreaterThan(50);
    });

    it('purges billing history when asked (admin manual delete)', async () => {
        const { touched, subscriptions, paymentLogs } = await runPurge({ includeBillingHistory: true });
        expect(touched).toContain(subscriptions);
        expect(touched).toContain(paymentLogs);
    });
}, 30000);

describe('purge job ids', () => {
    it('are unique per enqueue so a second purge for the same user still runs', async () => {
        jest.resetModules();
        // Stand-in for BullMQ's own id assignment, which is what we now rely on.
        let seq = 0;
        const add = jest.fn().mockImplementation((name, data, opts) =>
            Promise.resolve({ id: opts?.jobId ?? `auto-${++seq}` }));
        jest.doMock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add, on: jest.fn() })) }));
        jest.doMock('../../../config/queueRedisConn.js', () => ({ getQueueRedisConnection: () => ({}) }));

        const { enqueueFullUserDataPurge } = require('../../../Services/BackgroundJobs/deleteUserQueue.js');
        const first = await enqueueFullUserDataPurge('user-1');
        const second = await enqueueFullUserDataPurge('user-1');

        // BullMQ silently drops an add() reusing a jobId, and completed jobs stick
        // around for 24h - a fixed id meant the admin delete's purge never ran if the
        // six-month cleanup had already purged that user the same day. A timestamp
        // is not enough either: two enqueues in one millisecond produce the same id.
        expect(add.mock.calls.every((call) => call[2]?.jobId === undefined)).toBe(true);
        expect(first.id).not.toBe(second.id);
        // Default keeps billing history; the admin route opts in explicitly.
        expect(add.mock.calls[0][1]).toEqual({ userId: 'user-1', includeBillingHistory: false });

        await enqueueFullUserDataPurge('user-1', { includeBillingHistory: true });
        expect(add.mock.calls[2][1]).toEqual({ userId: 'user-1', includeBillingHistory: true });
    });
});
