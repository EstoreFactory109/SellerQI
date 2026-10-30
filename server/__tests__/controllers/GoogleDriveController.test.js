/**
 * The Google Drive connection is one company credential: only the portal owner, admins
 * and platform superAdmins may connect or disconnect it, and status never leaks the token.
 */

jest.mock('../../utils/Logger.js', () => ({ info: () => {}, warn: () => {}, error: () => {} }));

const mockState = { connection: null, disconnected: 0, stored: [] };
jest.mock('../../Services/GoogleDrive/DriveAuth.js', () => ({
    buildAuthorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    disconnect: async () => { mockState.disconnected += 1; return true; },
}));
jest.mock('../../Services/GoogleDrive/DriveClient.js', () => ({}));
jest.mock('../../models/system/DriveConnectionModel.js', () => {
    const model = { findOne: () => ({ lean: async () => mockState.connection }) };
    model.SINGLETON_KEY = 'gdrive_reports';
    return model;
});
jest.mock('../../models/system/DriveReportFolderModel.js', () => ({ countDocuments: async () => 4 }));
jest.mock('../../config/redisConn.js', () => ({
    getRedisClient: () => ({ setEx: async (key) => { mockState.stored.push(key); } }),
}));

const {
    startDriveAuth, disconnectDrive, getDriveStatus,
} = require('../../controllers/integration/GoogleDriveController.js');

const run = async (handler, esfUser) => {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    let failure = null;
    await new Promise((resolve) => {
        handler({ esfUser, esfUserId: 'staff1', esfRole: esfUser?.esfRole }, res, (err) => { failure = err; resolve(); });
        setImmediate(resolve);
    });
    if (failure) throw failure;
    return res;
};

beforeEach(() => {
    mockState.connection = null;
    mockState.disconnected = 0;
    mockState.stored = [];
});

it('refuses a member', async () => {
    const res = await run(startDriveAuth, { esfRole: 'member' });
    expect(res.statusCode).toBe(403);
    expect(mockState.stored).toHaveLength(0);

    const off = await run(disconnectDrive, { esfRole: 'member' });
    expect(off.statusCode).toBe(403);
    expect(mockState.disconnected).toBe(0);
});

it('lets an admin start the connect flow, with a single-use state', async () => {
    const res = await run(startDriveAuth, { esfRole: 'admin' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.authorizationUrl).toMatch(/state=[0-9a-f]{64}$/);
    expect(mockState.stored[0]).toMatch(/^sqi:gdrive:oauth_state:/);
});

it('lets a platform superAdmin disconnect', async () => {
    const res = await run(disconnectDrive, { accessType: 'superAdmin' });
    expect(res.statusCode).toBe(200);
    expect(mockState.disconnected).toBe(1);
});

it('reports status without the refresh token, and only a current error as current', async () => {
    mockState.connection = {
        emailAddress: 'reports@estorefactory.com',
        rootFolderId: 'root1',
        refreshToken: 'secret',
        lastSavedAt: new Date('2026-10-31T09:00:00Z'),
        lastError: 'old failure',
        lastErrorAt: new Date('2026-10-24T09:00:00Z'),
    };

    const res = await run(getDriveStatus, { esfRole: 'member' });

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body.data).toMatchObject({
        connected: true,
        emailAddress: 'reports@estorefactory.com',
        rootFolderUrl: 'https://drive.google.com/drive/folders/root1',
        clientFolders: 4,
        lastErrorCurrent: false,
    });
});
