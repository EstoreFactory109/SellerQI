/**
 * After a seller pays for a Fix it package, give the team the work in Zoho: ONE parent task
 * per engagement (FixItWorkOrder: the Trial, or a subscription for its whole life), with the
 * seller's highest-value SellerQI tasks as its subtasks (FixItZohoSync). The project:
 *
 *   1. a project already linked to the account   → use it                         ('linked')
 *   2. none linked, but their brand's project exists in Zoho (FixItProjectMatcher)
 *                                                 → link it                        ('matched')
 *   3. none at all                                → create one named after the brand,
 *                                                   and link it                    ('created')
 *
 * Every buyer gets this, ESF client or not (a non-ESF buyer's project is linked to their
 * account but never appears in the ESF portal). A renewal raises the work order's quota;
 * it never creates another parent task.
 *
 * This is the one place SellerQI creates a Zoho project; everywhere else projects are made
 * in Zoho and only linked here (ZohoProjectLinks).
 *
 * Never throws: returns the outcome for the purchase record and the support email, which
 * goes out either way — a failed task is something the team adds by hand, not a lost sale.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const ZohoAuth = require('../Zoho/ZohoAuth.js');
const ZohoProjectsService = require('../Zoho/ZohoProjectsService.js');
const ZohoProjectLinks = require('../Zoho/ZohoProjectLinks.js');
const FixItProjectMatcher = require('../AI/FixItProjectMatcher.js');
const { getFixItPackage } = require('./fixItPackages.js');
const FixItWorkOrder = require('../../models/system/FixItWorkOrderModel.js');
const logger = require('../../utils/Logger.js');

const TASKLIST_NAME = 'Fix it packages';
const MAX_TASKLISTS_PER_PROJECT = 25; // same ceiling TaskRequestService respects
const SHORTLIST_SIZE = 15;
const DAYS_TO_FINISH = { trial: 3, standard: 30, accelerated: 30 };
const PACE = { trial: 'a quick trial', standard: '1 task per day', accelerated: '2 tasks per day' };

const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
const money = (amount, currency = 'USD') => (typeof amount === 'number'
    ? `${String(currency).toUpperCase() === 'USD' ? '$' : `${String(currency).toUpperCase()} `}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : 'an unknown amount');
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * READ-ONLY: the existing Zoho project that is this client's brand, if any.
 * Projects linked to another client are never offered (a project belongs to one client).
 * Used by resolveProject below and by scripts/dryRunFixItProjectMatch.js.
 * @returns {Promise<{ project: object|null, matchedBy: 'ai'|'exact'|'none', reason?: string,
 *                     nameTakenByAnotherClient: boolean, shortlist: object[] }>}
 */
const findExistingProject = async (user, brand) => {
    const all = (await ZohoProjectLinks.getProjects()).filter((p) => p?.id && p?.name && p.projectType !== 'template');
    const taken = new Set((await UserModel.find({ 'zohoProject.projectId': { $in: all.map((p) => String(p.id)) }, _id: { $ne: user._id } })
        .select('zohoProject.projectId').lean()).map((u) => String(u.zohoProject.projectId)));
    const free = all.filter((p) => !taken.has(String(p.id)));

    const needles = [{ value: brand, weight: 1 }, { value: fullName(user), weight: 0.6 }];
    const shortlist = free
        .map((p) => ({ p, s: ZohoProjectLinks.scoreProject(p, needles) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, SHORTLIST_SIZE)
        .map((x) => x.p);

    const match = await FixItProjectMatcher.matchProject({ brand, clientName: fullName(user), email: user.email }, shortlist);
    if (match.project) return { ...match, nameTakenByAnotherClient: false, shortlist };

    // Last guard against a duplicate: a project with exactly the brand's name made moments
    // ago (not in the 5-minute cache yet), or by a re-run, is linked rather than re-created.
    const fresh = (await ZohoProjectLinks.getProjects({ refresh: true })).filter((p) => p?.id && p?.name);
    const sameName = fresh.find((p) => FixItProjectMatcher.sameName(p.name, brand));
    if (sameName && !taken.has(String(sameName.id))) return { project: sameName, matchedBy: 'exact', nameTakenByAnotherClient: false, shortlist };
    return { project: null, matchedBy: 'none', nameTakenByAnotherClient: Boolean(sameName), shortlist };
};

/** The client's Zoho project: the linked one, a matching existing one (linked now), or a new one. */
const resolveProject = async (user, brand) => {
    if (user.zohoProject?.projectId) {
        return { projectId: String(user.zohoProject.projectId), projectName: user.zohoProject.projectName, portalId: user.zohoProject.portalId || null, source: 'linked' };
    }

    const found = await findExistingProject(user, brand);
    if (found.project) {
        const linked = await ZohoProjectLinks.linkProject({ clientId: user._id, projectId: found.project.id, staffUserId: null, allowNonEsfClient: true });
        logger.info(`[FixItZoho] linked existing project ${found.project.id} ("${found.project.name}") to ${user._id} (${found.matchedBy}${found.reason ? `: ${found.reason}` : ''})`);
        return { projectId: linked.projectId, projectName: linked.projectName, portalId: linked.portalId, source: 'matched' };
    }

    // Another client already owns a project with this exact name: say whose this one is,
    // rather than leave the team two identical names to tell apart.
    const name = found.nameTakenByAnotherClient && fullName(user) ? `${brand} – ${fullName(user)}` : brand;
    const created = await ZohoProjectsService.createProject({
        name,
        description: `Created by SellerQI for ${fullName(user) || user.email} (${user.email}) after a Fix it package purchase.`,
    });
    await ZohoProjectLinks.invalidateProjectCache();
    const linked = await ZohoProjectLinks.linkProject({ clientId: user._id, projectId: created.id, staffUserId: null, allowNonEsfClient: true });
    logger.info(`[FixItZoho] created project ${created.id} ("${created.name}") for ${user._id}`);
    return { projectId: linked.projectId, projectName: linked.projectName || created.name, portalId: linked.portalId, source: 'created' };
};

/** "Fix it packages" — reused, else created; any failure just means the task goes in unfiled. */
const fixItTasklist = async (projectId, portalId) => {
    try {
        const lists = await ZohoProjectsService.listTasklists({ projectId, portalId });
        const existing = lists.find((l) => String(l.name).trim().toLowerCase() === TASKLIST_NAME.toLowerCase());
        if (existing) return existing.id;
        if (lists.length >= MAX_TASKLISTS_PER_PROJECT) return null;
        const created = await ZohoProjectsService.createTasklist({ projectId, name: TASKLIST_NAME, portalId });
        return created?.id || null;
    } catch (error) {
        logger.warn(`[FixItZoho] tasklist for project ${projectId} unavailable (task goes in unfiled): ${error.message}`);
        return null;
    }
};

const taskDescription = (purchase, user, brand) => {
    const pkg = getFixItPackage(purchase.packageId);
    const lines = [
        `${fullName(user) || user.email} bought the Fix it ${purchase.packageName} package through SellerQI on ${new Date(purchase.paidAt || Date.now()).toUTCString()}.`,
        '',
        `Package: ${purchase.packageName} — fix ${purchase.tasks} of their SellerQI tasks${purchase.billing === 'monthly' ? ' every month' : ''} (${PACE[purchase.packageId] || 'as agreed'}).`,
        `Paid: ${money(purchase.amount, purchase.currency)}${purchase.billing === 'monthly' ? '/month' : ''}${pkg && purchase.amount !== pkg.priceUsd ? ` (list price $${pkg.priceUsd})` : ''}.`,
        '',
        'The tasks to fix are the subtasks below — the seller\'s highest-value SellerQI tasks, added by SellerQI and kept in step with it.',
        '',
        `Brand: ${brand}`,
        `Contact: ${user.email}${user.phone && !user.needsPhoneUpdate ? ` · ${user.phone}` : ''}`,
    ];
    return lines.join('\n');
};

/** One work order per engagement: the Trial purchase, or the subscription for its whole life. */
const workOrderKey = (purchase) => (purchase.billing === 'monthly' && purchase.stripeSubscriptionId
    ? purchase.stripeSubscriptionId
    : `purchase:${purchase._id}`);

const parentTaskName = (purchase) => (purchase.billing === 'monthly'
    ? `Fix it – ${purchase.packageName} subscription (${purchase.tasks} tasks a month)`
    : `Fix it – ${purchase.packageName} (${purchase.tasks} tasks)`);

/** Their marketplace: the one they bought from, else their first connected one. */
const marketplaceOf = async (purchase, userId) => {
    if (purchase.country && purchase.region) return { country: purchase.country, region: purchase.region };
    const seller = await SellerCentralModel.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region').lean();
    const account = (seller?.sellerAccount || []).find((a) => a?.country && a?.region);
    return { country: account?.country || null, region: account?.region || null };
};

const resultOf = (wo, sync) => ({
    status: 'done',
    projectId: wo.zohoProjectId,
    projectName: wo.zohoProjectName,
    projectSource: wo.zohoProjectSource,
    taskId: wo.zohoParentTaskId,
    // What support reads in the email: the parent, and how many of the seller's tasks are under it.
    taskName: sync && typeof sync.total === 'number'
        ? `${wo.zohoParentTaskName} — ${sync.total} subtask${sync.total === 1 ? '' : 's'}${sync.done ? `, ${sync.done} done` : ''}`
        : wo.zohoParentTaskName,
});

/**
 * After a paid period: the engagement's work order (created on its first payment, its quota
 * raised on each renewal), then a sync that tops its subtasks up. Every buyer gets one —
 * ESF clients and others alike.
 * @param {object} purchase  a FixItPurchase (plain object)
 * @returns {Promise<{ status: 'done'|'failed', projectId?, projectName?, projectSource?, taskId?, taskName?, subtasks?, error? }>}
 */
const addFixItTaskToZoho = async (purchase) => {
    let project = null;
    const FixItZohoSync = require('./FixItZohoSync.js');
    try {
        // Already done for this period (a retry after the email failed, say).
        if (purchase.zohoTaskId) {
            return { status: 'done', projectId: purchase.zohoProjectId, projectName: purchase.zohoProjectName, projectSource: purchase.zohoProjectSource, taskId: purchase.zohoTaskId, taskName: purchase.zohoTaskName };
        }
        const key = workOrderKey(purchase);
        let wo = await FixItWorkOrder.findOne({ key }).lean();

        if (wo?.zohoParentTaskId) {
            // A renewal: more tasks paid for, same parent task. Raised once per period.
            const period = Number(purchase.period) || 1;
            if (purchase.billing === 'monthly' && period > (wo.monthsPaid || 1)) {
                await FixItWorkOrder.updateOne(
                    { _id: wo._id, monthsPaid: { $lt: period } },
                    { $set: { monthsPaid: period, status: 'active', endedAt: null }, $inc: { quota: Number(purchase.tasks) || 0 } }
                );
            }
            const sync = await FixItZohoSync.syncWorkOrderById(wo._id);
            wo = await FixItWorkOrder.findById(wo._id).lean();
            // Same project and parent as month 1: never reported as a new project again.
            return { ...resultOf(wo, sync), projectSource: 'linked' };
        }

        const user = await UserModel.findById(purchase.userId)
            .select('firstName lastName email phone needsPhoneUpdate isEsfClient zohoProject').lean();
        if (!user) return { status: 'failed', error: 'Buyer account not found' };
        const connection = await ZohoAuth.getConnection();
        if (!connection?.portalId) return { status: 'failed', error: 'Zoho Projects is not connected' };

        const seller = await SellerCentralModel.findOne({ User: user._id }).select('brand').lean();
        const brand = String(seller?.brand || '').trim() || fullName(user) || user.email;
        project = await resolveProject(user, brand);
        const { country, region } = await marketplaceOf(purchase, user._id);
        const name = parentTaskName(purchase);

        // Claim the work order before creating anything in Zoho, so a retry never makes a second parent.
        wo = await FixItWorkOrder.findOneAndUpdate(
            { key },
            { $setOnInsert: {
                userId: user._id, country, region, key,
                kind: purchase.billing === 'monthly' ? 'subscription' : 'trial',
                packageId: purchase.packageId, packageName: purchase.packageName,
                tasksPerPeriod: purchase.tasks, quota: purchase.tasks, monthsPaid: Number(purchase.period) || 1,
                portalId: project.portalId || String(connection.portalId),
                zohoProjectId: project.projectId, zohoProjectName: project.projectName, zohoProjectSource: project.source,
                zohoParentTaskName: name,
            } },
            { upsert: true, new: true }
        ).lean();

        if (!wo.zohoParentTaskId) {
            // A crash after creating the parent but before saving it: adopt that parent
            // (a top-level task with exactly this name) rather than make a second one.
            const existing = await ZohoProjectsService.listProjectTasks({ projectId: wo.zohoProjectId, portalId: wo.portalId }).catch(() => []);
            let parent = existing.find((t) => !t.parentTaskId && t.name === name) || null;
            if (!parent) {
                const tasklistId = await fixItTasklist(project.projectId, project.portalId);
                parent = await ZohoProjectsService.createTask({
                    projectId: project.projectId,
                    portalId: project.portalId,
                    name,
                    description: taskDescription(purchase, user, brand),
                    tasklistId,
                    ...(purchase.billing === 'monthly' ? {} : { endDate: isoDay(new Date(Date.now() + (DAYS_TO_FINISH[purchase.packageId] || 30) * 86400000)) }),
                });
            }
            await FixItWorkOrder.updateOne({ _id: wo._id }, { $set: { zohoParentTaskId: String(parent.id), zohoOpenStatusId: parent.statusId || null } });
            logger.info(`[FixItZoho] work order ${wo._id}: parent task ${parent.id} in project ${project.projectId} (${project.source})`);
        }

        const sync = await FixItZohoSync.syncWorkOrderById(wo._id);
        wo = await FixItWorkOrder.findById(wo._id).lean();

        // The client's Status page reads Mongo: pull the new task in now, not at the nightly run.
        try {
            const ZohoTaskSync = require('../Zoho/ZohoTaskSync.js');
            Promise.resolve(ZohoTaskSync.syncProject({ projectId: project.projectId, projectName: project.projectName, portalId: project.portalId }))
                .catch((error) => logger.warn(`[FixItZoho] follow-up project sync failed (nightly run will catch up): ${error.message}`));
        } catch (_) { /* sync is a nicety */ }

        return resultOf(wo, sync);
    } catch (error) {
        logger.error(`[FixItZoho] purchase ${purchase._id}: Zoho work not set up: ${error.message}`);
        return {
            status: 'failed',
            error: String(error.message || 'Unknown error').slice(0, 300),
            ...(project ? { projectId: project.projectId, projectName: project.projectName, projectSource: project.source } : {}),
        };
    }
};

/**
 * The subscription changed in Stripe: cancelled (no more top-ups), resumed, or ended.
 * @param {object} sub  a FixItSubscription (plain)
 */
const onSubscriptionChanged = async (sub) => {
    if (!sub?.stripeSubscriptionId) return;
    const ended = sub.status === 'canceled';
    const status = ended ? 'ended' : sub.cancelAtPeriodEnd ? 'ending' : 'active';
    await FixItWorkOrder.updateOne(
        { key: sub.stripeSubscriptionId, status: { $ne: status } },
        { $set: { status, endedAt: ended ? (sub.endedAt || new Date()) : null } }
    );
    // Back to a normal seller once nothing of theirs is running (history kept).
    if (ended && sub.userId) await require('./FixItEsfClient.js').release(sub.userId);
};

module.exports = { addFixItTaskToZoho, onSubscriptionChanged, findExistingProject, workOrderKey, TASKLIST_NAME };
