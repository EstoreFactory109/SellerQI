/**
 * After an ESF client pays for a Fix it package, give the team the work as a Zoho task.
 *
 *   1. a project already linked to the account   → add the task there            ('linked')
 *   2. none linked, but their brand's project exists in Zoho (FixItProjectMatcher)
 *                                                 → link it, then add the task     ('matched')
 *   3. none at all                                → create a project named after the brand,
 *                                                   link it, then add the task     ('created')
 *
 * Sellers who are not ESF clients have no project and get none ('skipped'): the support
 * email is how the team hears about them.
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
        const linked = await ZohoProjectLinks.linkProject({ clientId: user._id, projectId: found.project.id, staffUserId: null });
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
    const linked = await ZohoProjectLinks.linkProject({ clientId: user._id, projectId: created.id, staffUserId: null });
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
        `Package: ${purchase.packageName} — fix ${purchase.tasks} of their SellerQI tasks (${PACE[purchase.packageId] || 'as agreed'}).`,
        `Paid: ${money(purchase.amount, purchase.currency)}${pkg && purchase.amount !== pkg.priceUsd ? ` (list price $${pkg.priceUsd})` : ''}.`,
    ];
    if (typeof purchase.openTasks === 'number') {
        const stake = typeof purchase.monthlyRecoverable === 'number'
            ? `, worth ~${purchase.atStakeCurrency || '$'}${Math.round(purchase.monthlyRecoverable).toLocaleString('en-US')}/mo`
            : '';
        lines.push(`They had ${purchase.openTasks} open tasks in SellerQI${stake}. Start with the highest-value ones (SellerQI → Tasks → High impact).`);
    }
    lines.push(
        '',
        `Brand: ${brand}`,
        `Contact: ${user.email}${user.phone && !user.needsPhoneUpdate ? ` · ${user.phone}` : ''}`,
        `Stripe payment: ${purchase.stripePaymentIntentId || 'n/a'}`,
        '',
        'Added automatically by SellerQI.',
    );
    return lines.join('\n');
};

/**
 * @param {object} purchase  a FixItPurchase (plain object)
 * @returns {Promise<{ status: 'done'|'skipped'|'failed', projectId?, projectName?, projectSource?, taskId?, taskName?, error? }>}
 */
const addFixItTaskToZoho = async (purchase) => {
    // Kept outside the try: a project created or linked before the task failed is still
    // worth telling the team about.
    let project = null;
    try {
        if (purchase.zohoTaskId) {
            return { status: 'done', projectId: purchase.zohoProjectId, projectName: purchase.zohoProjectName, projectSource: purchase.zohoProjectSource, taskId: purchase.zohoTaskId, taskName: purchase.zohoTaskName };
        }
        const user = await UserModel.findById(purchase.userId)
            .select('firstName lastName email phone needsPhoneUpdate isEsfClient zohoProject').lean();
        if (!user) return { status: 'failed', error: 'Buyer account not found' };
        if (!user.isEsfClient) return { status: 'skipped' };

        const connection = await ZohoAuth.getConnection();
        if (!connection?.portalId) return { status: 'failed', error: 'Zoho Projects is not connected' };

        const seller = await SellerCentralModel.findOne({ User: user._id }).select('brand').lean();
        const brand = String(seller?.brand || '').trim() || fullName(user) || user.email;

        project = await resolveProject(user, brand);
        const tasklistId = await fixItTasklist(project.projectId, project.portalId);
        const taskName = `Fix it – ${purchase.packageName} package: fix ${purchase.tasks} tasks (paid ${money(purchase.amount, purchase.currency)})`;
        const due = new Date(Date.now() + (DAYS_TO_FINISH[purchase.packageId] || 30) * 86400000);
        const task = await ZohoProjectsService.createTask({
            projectId: project.projectId,
            portalId: project.portalId,
            name: taskName,
            description: taskDescription(purchase, user, brand),
            tasklistId,
            endDate: isoDay(due),
        });

        // The client's Status page reads Mongo: pull the new task in now, not at the nightly run.
        try {
            const ZohoTaskSync = require('../Zoho/ZohoTaskSync.js');
            Promise.resolve(ZohoTaskSync.syncProject({ projectId: project.projectId, projectName: project.projectName, portalId: project.portalId }))
                .catch((error) => logger.warn(`[FixItZoho] task ${task.id} created; follow-up sync failed (nightly run will catch up): ${error.message}`));
        } catch (_) { /* sync is a nicety */ }

        logger.info(`[FixItZoho] purchase ${purchase._id}: task ${task.id} in project ${project.projectId} (${project.source})`);
        return { status: 'done', projectId: project.projectId, projectName: project.projectName, projectSource: project.source, taskId: String(task.id), taskName };
    } catch (error) {
        logger.error(`[FixItZoho] purchase ${purchase._id}: Zoho task not created: ${error.message}`);
        return {
            status: 'failed',
            error: String(error.message || 'Unknown error').slice(0, 300),
            ...(project ? { projectId: project.projectId, projectName: project.projectName, projectSource: project.source } : {}),
        };
    }
};

module.exports = { addFixItTaskToZoho, findExistingProject, TASKLIST_NAME };
