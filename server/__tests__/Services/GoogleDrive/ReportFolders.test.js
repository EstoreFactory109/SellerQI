/**
 * Which Drive folder a client's reports go into.
 *
 * Pinned: folders are created once and then found by stored id (so a rename or a move in
 * Drive does not split history), a renamed brand renames the folder, a deleted folder is
 * recreated, and two clients with the same brand never share a folder.
 *
 * Fakes are plain functions over module-scope state: the jest config's resetMocks strips
 * jest.fn implementations between tests.
 */

const mockDrive = { folders: new Map(), seq: 0, calls: { create: 0, rename: 0 } };
const mockDb = { connection: null, rows: [], users: new Map(), sellers: new Map() };

jest.mock('../../../Services/GoogleDrive/DriveClient.js', () => ({
    findChildFolder: async (parent, name) => [...mockDrive.folders.values()]
        .find((f) => f.parent === parent && f.name === name && !f.trashed) || null,
    createFolder: async (parent, name) => {
        mockDrive.calls.create += 1;
        const folder = { id: `f${++mockDrive.seq}`, parent, name, trashed: false };
        mockDrive.folders.set(folder.id, folder);
        return { id: folder.id, name };
    },
    getFolder: async (id) => {
        const f = mockDrive.folders.get(id);
        return f && !f.trashed ? { id: f.id, name: f.name } : null;
    },
    renameFolder: async (id, name) => {
        mockDrive.calls.rename += 1;
        mockDrive.folders.get(id).name = name;
        return { id, name };
    },
}));

jest.mock('../../../models/system/DriveConnectionModel.js', () => {
    const model = {
        findOne: () => ({ lean: async () => mockDb.connection }),
        updateOne: async (_q, { $set }) => { Object.assign(mockDb.connection, $set); },
    };
    model.SINGLETON_KEY = 'gdrive_reports';
    return model;
});

jest.mock('../../../models/system/DriveReportFolderModel.js', () => {
    const match = (q) => mockDb.rows.find((r) => Object.entries(q).every(([k, v]) => String(r[k]) === String(v)));
    const query = (q) => {
        const run = async () => {
            const row = match(q);
            return row ? JSON.parse(JSON.stringify(row)) : null;
        };
        return { lean: run, select: () => ({ lean: run }) };
    };
    return {
        findOne: query,
        updateOne: async (q, { $set }) => {
            let row = match(q);
            if (!row) { row = { ...q, cadenceFolders: {} }; mockDb.rows.push(row); }
            for (const [k, v] of Object.entries($set)) {
                if (k.startsWith('cadenceFolders.')) row.cadenceFolders[k.split('.')[1]] = v;
                else row[k] = v;
            }
        },
    };
});

jest.mock('../../../models/user-auth/userModel.js', () => ({
    findById: (id) => ({ select: () => ({ lean: async () => mockDb.users.get(String(id)) || null }) }),
}));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: (q) => ({ select: () => ({ lean: async () => mockDb.sellers.get(String(q.User)) || null }) }),
}));

const { ensureClientFolder, brandFolderName } = require('../../../Services/GoogleDrive/ReportFolders.js');

const pathOf = (id) => {
    const parts = [];
    for (let f = mockDrive.folders.get(id); f; f = mockDrive.folders.get(f.parent)) parts.unshift(f.name);
    return parts.join(' / ');
};

const addClient = (id, user = {}, seller = null) => {
    mockDb.users.set(id, { _id: id, firstName: 'Ada', lastName: 'Lovelace', email: `${id}@example.com`, ...user });
    if (seller) mockDb.sellers.set(id, seller);
};

beforeEach(() => {
    mockDrive.folders = new Map();
    mockDrive.seq = 0;
    mockDrive.calls = { create: 0, rename: 0 };
    mockDb.connection = { key: 'gdrive_reports', rootFolderId: null };
    mockDb.rows = [];
    mockDb.users = new Map();
    mockDb.sellers = new Map();
});

describe('brandFolderName', () => {
    it('prefers the Zoho project, then a real brand, then the name, then the email', () => {
        expect(brandFolderName({ zohoProject: { projectName: 'Blue Mug Co' } }, { brand: 'Mugs' })).toBe('Blue Mug Co');
        expect(brandFolderName({ firstName: 'Ada' }, { brand: 'Mugs' })).toBe('Mugs');
        expect(brandFolderName({ firstName: 'Ada', lastName: 'L' }, { brand: 'Generic' })).toBe('Ada L');
        expect(brandFolderName({ email: 'a@b.com' }, null)).toBe('a@b.com');
    });

    it('cleans characters that make a folder awkward', () => {
        expect(brandFolderName({ zohoProject: { projectName: '  Mugs/Cups: "Best"  ' } })).toBe('Mugs-Cups- -Best-');
    });
});

describe('ensureClientFolder', () => {
    it('creates SellerQI Reports / brand / cadence once, then reuses the stored ids', async () => {
        addClient('u1', { zohoProject: { projectName: 'Blue Mug Co' } });

        const first = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(pathOf(first.folderId)).toBe('SellerQI Reports / Blue Mug Co / Weekly');
        const created = mockDrive.calls.create;
        expect(created).toBe(3);

        const again = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(again.folderId).toBe(first.folderId);
        expect(mockDrive.calls.create).toBe(created);

        const monthly = await ensureClientFolder({ _id: 'u1' }, 'monthly');
        expect(pathOf(monthly.folderId)).toBe('SellerQI Reports / Blue Mug Co / Monthly');
        expect(mockDrive.calls.create).toBe(created + 1);
    });

    it('renames the folder when the brand changes, keeping the reports together', async () => {
        addClient('u1', { zohoProject: { projectName: 'Blue Mug Co' } });
        const before = await ensureClientFolder({ _id: 'u1' }, 'weekly');

        mockDb.users.get('u1').zohoProject.projectName = 'Blue Mug Company';
        const after = await ensureClientFolder({ _id: 'u1' }, 'weekly');

        expect(after.folderId).toBe(before.folderId);
        expect(pathOf(after.folderId)).toBe('SellerQI Reports / Blue Mug Company / Weekly');
        expect(mockDrive.calls.rename).toBe(1);

        await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(mockDrive.calls.rename).toBe(1);
    });

    it('recreates folders deleted in Drive', async () => {
        addClient('u1', { zohoProject: { projectName: 'Blue Mug Co' } });
        const first = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        const brandId = mockDrive.folders.get(first.folderId).parent;
        mockDrive.folders.get(brandId).trashed = true;
        mockDrive.folders.get(first.folderId).trashed = true;

        const again = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(again.folderId).not.toBe(first.folderId);
        expect(pathOf(again.folderId)).toBe('SellerQI Reports / Blue Mug Co / Weekly');
    });

    it('recreates the root when it was deleted', async () => {
        addClient('u1', { zohoProject: { projectName: 'Blue Mug Co' } });
        await ensureClientFolder({ _id: 'u1' }, 'weekly');
        const oldRoot = mockDb.connection.rootFolderId;
        mockDrive.folders.get(oldRoot).trashed = true;

        const again = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(mockDb.connection.rootFolderId).not.toBe(oldRoot);
        expect(pathOf(again.folderId)).toBe('SellerQI Reports / Blue Mug Co / Weekly');
    });

    it('gives a second client with the same brand its own folder', async () => {
        addClient('u1', {}, { brand: 'Mugs' });
        addClient('u2', { esfClientRef: 'EF-1184' }, { brand: 'Mugs' });

        const a = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        const b = await ensureClientFolder({ _id: 'u2' }, 'weekly');

        expect(pathOf(a.folderId)).toBe('SellerQI Reports / Mugs / Weekly');
        expect(pathOf(b.folderId)).toBe('SellerQI Reports / Mugs (EF-1184) / Weekly');
    });

    it('re-adopts its own folder when the stored mapping was lost', async () => {
        addClient('u1', {}, { brand: 'Mugs' });
        const first = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        mockDb.rows = [];

        const again = await ensureClientFolder({ _id: 'u1' }, 'weekly');
        expect(again.folderId).toBe(first.folderId);
    });
});
