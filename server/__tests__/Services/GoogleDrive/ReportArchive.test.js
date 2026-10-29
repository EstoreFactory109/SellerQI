/**
 * Saving a client's report PDFs to Drive.
 *
 * Pinned: a dated name, a re-run replaces rather than duplicates, and nothing ever throws
 * into the mailer — a Drive failure is counted and remembered for the portal card.
 */

const mockState = { files: [], connection: null, folderError: null, uploadError: null, calls: { upload: 0, update: 0 } };

jest.mock('../../../utils/Logger.js', () => ({ info: () => {}, warn: () => {}, error: () => {} }));

jest.mock('../../../Services/GoogleDrive/ReportFolders.js', () => ({
    ensureClientFolder: async () => {
        if (mockState.folderError) throw mockState.folderError;
        return { folderId: 'weekly-folder', brandName: 'Blue Mug Co' };
    },
}));

jest.mock('../../../Services/GoogleDrive/DriveClient.js', () => ({
    findFileByName: async (folderId, name) => mockState.files.find((f) => f.folderId === folderId && f.name === name) || null,
    uploadPdf: async ({ folderId, name, buffer }) => {
        if (mockState.uploadError) throw mockState.uploadError;
        mockState.calls.upload += 1;
        const file = { id: `file${mockState.files.length + 1}`, folderId, name, content: buffer };
        mockState.files.push(file);
        return file;
    },
    updatePdf: async (id, buffer) => {
        mockState.calls.update += 1;
        mockState.files.find((f) => f.id === id).content = buffer;
        return { id };
    },
}));

jest.mock('../../../models/system/DriveConnectionModel.js', () => {
    const model = {
        findOne: () => {
            const run = async () => mockState.connection;
            return { select: () => ({ lean: run }), lean: run };
        },
        updateOne: async (_q, { $set }) => { Object.assign(mockState.connection || {}, $set); },
    };
    model.SINGLETON_KEY = 'gdrive_reports';
    return model;
});

const { saveReportsToDrive, archiveReadiness } = require('../../../Services/GoogleDrive/ReportArchive.js');

const PDFS = [
    { filename: 'Weekly Buybox Report - US.pdf', content: Buffer.from('%PDF-1') },
    { filename: 'Weekly Account Overview - US.pdf', content: Buffer.from('%PDF-2') },
];
const RUN_DATE = new Date('2026-10-31T08:00:00Z');

beforeEach(() => {
    mockState.files = [];
    mockState.connection = { key: 'gdrive_reports', refreshToken: 'rt' };
    mockState.folderError = null;
    mockState.uploadError = null;
    mockState.calls = { upload: 0, update: 0 };
    delete process.env.GDRIVE_REPORTS_ENABLED;
});

describe('saveReportsToDrive', () => {
    it('uploads every PDF under a dated name', async () => {
        const result = await saveReportsToDrive({ client: { _id: 'u1' }, cadence: 'weekly', attachments: PDFS, runDate: RUN_DATE });

        expect(result).toEqual({ saved: 2, failed: 0, folder: 'Blue Mug Co' });
        expect(mockState.files.map((f) => f.name)).toEqual([
            '2026-10-31 Weekly Buybox Report - US.pdf',
            '2026-10-31 Weekly Account Overview - US.pdf',
        ]);
        expect(mockState.connection.lastSavedAt).toBeInstanceOf(Date);
    });

    it('replaces the file on a re-run the same day instead of adding a duplicate', async () => {
        await saveReportsToDrive({ client: { _id: 'u1' }, cadence: 'weekly', attachments: PDFS, runDate: RUN_DATE });
        const rerun = [{ ...PDFS[0], content: Buffer.from('%PDF-new') }];
        await saveReportsToDrive({ client: { _id: 'u1' }, cadence: 'weekly', attachments: rerun, runDate: RUN_DATE });

        expect(mockState.files).toHaveLength(2);
        expect(mockState.calls.update).toBe(1);
        expect(mockState.files[0].content.toString()).toBe('%PDF-new');
    });

    it('counts a folder failure for every PDF and never throws', async () => {
        mockState.folderError = new Error('Drive folder create: Insufficient permissions');

        const result = await saveReportsToDrive({ client: { _id: 'u1' }, cadence: 'weekly', attachments: PDFS, runDate: RUN_DATE });

        expect(result).toEqual({ saved: 0, failed: 2, folder: null });
        expect(mockState.connection.lastError).toMatch(/Insufficient permissions/);
    });

    it('counts an upload failure and still tries the rest', async () => {
        mockState.uploadError = new Error('Drive upload: quota');

        const result = await saveReportsToDrive({ client: { _id: 'u1' }, cadence: 'weekly', attachments: PDFS, runDate: RUN_DATE });

        expect(result.failed).toBe(2);
        expect(result.saved).toBe(0);
    });
});

describe('archiveReadiness', () => {
    it('is off unless GDRIVE_REPORTS_ENABLED is true', async () => {
        expect((await archiveReadiness()).ready).toBe(false);
    });

    it('is off when no Drive is connected', async () => {
        process.env.GDRIVE_REPORTS_ENABLED = 'true';
        mockState.connection = null;
        expect(await archiveReadiness()).toEqual({ ready: false, reason: 'no Google Drive is connected' });
    });

    it('is on when enabled and connected', async () => {
        process.env.GDRIVE_REPORTS_ENABLED = 'true';
        expect((await archiveReadiness()).ready).toBe(true);
    });
});
