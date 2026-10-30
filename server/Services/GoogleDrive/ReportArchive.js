/**
 * ReportArchive.js — save an ESF client's report PDFs to the connected Google Drive.
 *
 * Called by the ESF reports mailer with the same PDFs it emails. Independent of the email
 * in both directions: a Drive failure is logged and counted, never thrown, so the email
 * still goes; and the mailer saves before it sends.
 *
 * Re-runs never duplicate: a file with the same dated name in the same folder has its
 * content replaced instead.
 */

const logger = require('../../utils/Logger.js');
const DriveConnection = require('../../models/system/DriveConnectionModel.js');
const DriveClient = require('./DriveClient.js');
const { ensureClientFolder } = require('./ReportFolders.js');
const { isReportsArchiveEnabled } = require('./config.js');

/**
 * Whether this run should save to Drive: switched on AND a Drive connected. Checked once
 * per run by the mailer, so a missing connection is one log line, not one per client.
 */
const archiveReadiness = async () => {
    if (!isReportsArchiveEnabled()) return { ready: false, reason: 'GDRIVE_REPORTS_ENABLED is not true' };
    const connection = await DriveConnection.findOne({ key: DriveConnection.SINGLETON_KEY })
        .select('+refreshToken')
        .lean();
    if (!connection?.refreshToken) return { ready: false, reason: 'no Google Drive is connected' };
    return { ready: true, reason: null };
};

/** "2026-10-31", the run's date, first in the file name so a folder sorts by date. */
const datePrefix = (runDate) => new Date(runDate).toISOString().slice(0, 10);

const noteError = (message) => DriveConnection.updateOne(
    { key: DriveConnection.SINGLETON_KEY },
    { $set: { lastError: String(message).slice(0, 500), lastErrorAt: new Date() } }
).catch(() => {});

/**
 * @param {object} args
 * @param {object} args.client       at least { _id }
 * @param {string} args.cadence      'weekly' | 'biweekly' | 'monthly' | 'quarterly'
 * @param {Array<{filename: string, content: Buffer}>} args.attachments
 * @param {Date}   [args.runDate]
 * @returns {Promise<{ saved: number, failed: number, folder: string|null }>}  never throws
 */
const saveReportsToDrive = async ({ client, cadence, attachments = [], runDate = new Date() }) => {
    const result = { saved: 0, failed: 0, folder: null };
    if (!attachments.length) return result;

    let folderId;
    try {
        const folder = await ensureClientFolder(client, cadence);
        folderId = folder.folderId;
        result.folder = folder.brandName;
    } catch (error) {
        logger.error(`[ReportArchive] Drive folders for ${client._id} (${cadence}) failed: ${error.message}`);
        await noteError(error.message);
        result.failed = attachments.length;
        return result;
    }

    for (const attachment of attachments) {
        const name = `${datePrefix(runDate)} ${attachment.filename}`;
        try {
            const existing = await DriveClient.findFileByName(folderId, name);
            if (existing) await DriveClient.updatePdf(existing.id, attachment.content);
            else await DriveClient.uploadPdf({ folderId, name, buffer: attachment.content });
            result.saved += 1;
        } catch (error) {
            logger.error(`[ReportArchive] "${name}" for ${client._id} not saved: ${error.message}`);
            await noteError(error.message);
            result.failed += 1;
        }
    }

    if (result.saved) {
        await DriveConnection.updateOne(
            { key: DriveConnection.SINGLETON_KEY },
            { $set: { lastSavedAt: new Date() } }
        ).catch(() => {});
    }
    return result;
};

module.exports = { saveReportsToDrive, archiveReadiness, datePrefix };
