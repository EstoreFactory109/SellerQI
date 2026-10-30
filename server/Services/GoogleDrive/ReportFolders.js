/**
 * ReportFolders.js — the Drive folders one ESF client's report PDFs go into.
 *
 *     SellerQI Reports / <brand> / <Weekly|Bi-weekly|Monthly|Quarterly>
 *
 * Ids are stored (DriveConnection.rootFolderId, DriveReportFolder) and reused; names are
 * only looked up when a folder is first needed. That way:
 *   - a brand renamed in Zoho renames the folder, and history stays in one place;
 *   - a folder the team moved in Drive is still found;
 *   - a folder deleted (or trashed) in Drive is created again on the next run.
 *
 * Two clients with the same brand name get "<brand> (EF-1184)" for the second, so their
 * reports never mix.
 */

const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const DriveConnection = require('../../models/system/DriveConnectionModel.js');
const DriveReportFolder = require('../../models/system/DriveReportFolderModel.js');
const DriveClient = require('./DriveClient.js');
const { rootFolderName } = require('./config.js');
const { CADENCE_GROUPS } = require('../BackgroundJobs/esfReportsSchedule.js');

/** Seller.brand values that name no brand. The live data's only populated brand is "Generic". */
const JUNK_BRAND = /^(generic|unbranded|no ?brand|none|n\/?a|null|undefined|-+|\.+)$/i;

/** Characters that make a folder awkward to find or sync; Drive itself accepts almost anything. */
const cleanName = (value) => String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

/**
 * The client's brand, for a folder only ESF sees. Same precedence as esfClientLabel
 * (Zoho project, then Seller brand), but it falls back to the client's own name and email
 * rather than an anonymous reference — the folder is ESF's, not a shared inbox.
 */
const brandFolderName = (user = {}, seller = null) => {
    const project = cleanName(user?.zohoProject?.projectName);
    if (project) return project;

    const brand = cleanName(seller?.brand);
    if (brand && !JUNK_BRAND.test(brand)) return brand;

    const fullName = cleanName([user?.firstName, user?.lastName].filter(Boolean).join(' '));
    if (fullName) return fullName;

    return cleanName(user?.email) || `Client ${String(user?._id || '').slice(-6)}`;
};

const cadenceFolderName = (cadence) => CADENCE_GROUPS[cadence]?.label || cleanName(cadence);

/** Distinguishes two clients with the same brand. Stored reference first, never derived from the email. */
const clientSuffix = (user) => user?.esfClientRef || String(user?._id || '').slice(-6);

/** "SellerQI Reports" in the connected Drive, created by SellerQI the first time. */
const ensureRootFolder = async () => {
    const connection = await DriveConnection.findOne({ key: DriveConnection.SINGLETON_KEY }).lean();
    if (connection?.rootFolderId && await DriveClient.getFolder(connection.rootFolderId)) {
        return connection.rootFolderId;
    }

    // drive.file sees only what SellerQI created, so this finds our own earlier root
    // (e.g. after a reconnect that could not read the account address) and nothing else.
    const name = rootFolderName();
    const folder = await DriveClient.findChildFolder('root', name) || await DriveClient.createFolder('root', name);
    await DriveConnection.updateOne({ key: DriveConnection.SINGLETON_KEY }, { $set: { rootFolderId: folder.id } });
    return folder.id;
};

/**
 * The brand folder for a client that has none yet: an existing folder of that name is
 * reused when no other client owns it (a lost mapping), otherwise the name gets the
 * client's suffix.
 */
const claimBrandFolder = async (rootId, base, user) => {
    const existing = await DriveClient.findChildFolder(rootId, base);
    if (!existing) return DriveClient.createFolder(rootId, base);

    const owner = await DriveReportFolder.findOne({ brandFolderId: existing.id }).select('userId').lean();
    if (!owner || String(owner.userId) === String(user._id)) return existing;

    const suffixed = `${base} (${clientSuffix(user)})`;
    return await DriveClient.findChildFolder(rootId, suffixed) || DriveClient.createFolder(rootId, suffixed);
};

/** The brand was renamed: rename the folder too, unless another folder already has that name. */
const renameBrandFolder = async (rootId, folderId, base, user) => {
    const taken = await DriveClient.findChildFolder(rootId, base);
    const name = taken && taken.id !== folderId ? `${base} (${clientSuffix(user)})` : base;
    await DriveClient.renameFolder(folderId, name);
};

/**
 * The folder id this client's `cadence` reports go into, creating whatever is missing.
 *
 * @param {object} client  at least { _id }; the rest is loaded here
 * @param {'weekly'|'biweekly'|'monthly'|'quarterly'} cadence
 * @returns {Promise<{ folderId: string, brandName: string }>}
 */
const ensureClientFolder = async (client, cadence) => {
    const user = await User.findById(client._id)
        .select('_id firstName lastName email zohoProject esfClientRef')
        .lean() || client;
    const seller = await Seller.findOne({ User: client._id }).select('brand').lean();
    const base = brandFolderName(user, seller);
    const rootId = await ensureRootFolder();

    const row = await DriveReportFolder.findOne({ userId: client._id }).lean();
    let brandFolderId = null;
    let cadenceFolders = {};

    if (row && row.rootFolderId === rootId && await DriveClient.getFolder(row.brandFolderId)) {
        brandFolderId = row.brandFolderId;
        cadenceFolders = row.cadenceFolders || {};
        if (row.brandName !== base) await renameBrandFolder(rootId, brandFolderId, base, user);
    } else {
        brandFolderId = (await claimBrandFolder(rootId, base, user)).id;
    }

    let cadenceFolderId = cadenceFolders[cadence] || null;
    if (!cadenceFolderId || !(await DriveClient.getFolder(cadenceFolderId))) {
        const name = cadenceFolderName(cadence);
        cadenceFolderId = (await DriveClient.findChildFolder(brandFolderId, name)
            || await DriveClient.createFolder(brandFolderId, name)).id;
    }

    await DriveReportFolder.updateOne(
        { userId: client._id },
        {
            $set: {
                rootFolderId: rootId,
                brandFolderId,
                // The base name, not a suffixed one, so an unchanged brand never renames again.
                brandName: base,
                [`cadenceFolders.${cadence}`]: cadenceFolderId,
            },
        },
        { upsert: true }
    );

    return { folderId: cadenceFolderId, brandName: base };
};

module.exports = {
    ensureClientFolder,
    ensureRootFolder,
    brandFolderName,
    cadenceFolderName,
    cleanName,
};
