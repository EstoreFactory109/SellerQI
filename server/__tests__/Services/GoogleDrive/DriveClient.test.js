/**
 * The Drive v3 requests: query escaping, the multipart upload body, the one 401 replay,
 * and a deleted folder reading as "gone" rather than an error.
 */

jest.mock('axios', () => {
    const axiosFn = jest.fn();
    axiosFn.get = jest.fn();
    axiosFn.post = jest.fn();
    axiosFn.default = axiosFn;
    return axiosFn;
});
const axios = require('axios');

const mockAuth = { invalidated: 0 };
jest.mock('../../../Services/GoogleDrive/DriveAuth.js', () => ({
    getAccessToken: async (opts) => (opts?.forceRefresh ? 'fresh-token' : 'cached-token'),
    invalidateAccessToken: async () => { mockAuth.invalidated += 1; },
}));

const DriveClient = require('../../../Services/GoogleDrive/DriveClient.js');

const driveFailure = (status, message) => Object.assign(new Error(message), {
    response: { status, data: { error: { code: status, message } } },
});

beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.invalidated = 0;
});

it('escapes quotes and backslashes in a folder lookup', async () => {
    axios.mockResolvedValue({ data: { files: [{ id: 'f1', name: "Ann's \\ Mugs" }] } });

    const folder = await DriveClient.findChildFolder('root', "Ann's \\ Mugs");

    expect(folder).toEqual({ id: 'f1', name: "Ann's \\ Mugs" });
    const { params, headers } = axios.mock.calls[0][0];
    expect(params.q).toBe(
        "'root' in parents and name = 'Ann\\'s \\\\ Mugs' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
    expect(headers.Authorization).toBe('Bearer cached-token');
});

it('sends the metadata and the PDF in one multipart upload', async () => {
    axios.mockResolvedValue({ data: { id: 'file1' } });

    await DriveClient.uploadPdf({ folderId: 'folder1', name: '2026-10-31 Buybox.pdf', buffer: Buffer.from('%PDF-1.7 body') });

    const config = axios.mock.calls[0][0];
    expect(config.method).toBe('post');
    expect(config.url).toMatch(/upload\/drive\/v3\/files$/);
    expect(config.params.uploadType).toBe('multipart');
    const boundary = config.headers['Content-Type'].match(/boundary=(\S+)/)[1];
    const body = config.data.toString();
    expect(body).toContain(`--${boundary}`);
    expect(body).toContain('"name":"2026-10-31 Buybox.pdf","parents":["folder1"]');
    expect(body).toContain('%PDF-1.7 body');
    expect(body.endsWith(`--${boundary}--`)).toBe(true);
});

it('replays once with a fresh token on a 401', async () => {
    axios
        .mockRejectedValueOnce(driveFailure(401, 'Invalid Credentials'))
        .mockResolvedValueOnce({ data: { id: 'f2', name: 'x' } });

    await DriveClient.createFolder('root', 'x');

    expect(mockAuth.invalidated).toBe(1);
    expect(axios.mock.calls[1][0].headers.Authorization).toBe('Bearer fresh-token');
});

it("reports Drive's own message on failure", async () => {
    axios.mockRejectedValue(driveFailure(403, 'The user has exceeded their Drive storage quota'));

    await expect(DriveClient.uploadPdf({ folderId: 'f', name: 'a.pdf', buffer: Buffer.from('x') }))
        .rejects.toThrow(/storage quota/);
});

it('treats a deleted or trashed folder as gone', async () => {
    axios.mockRejectedValueOnce(driveFailure(404, 'File not found: f9'));
    expect(await DriveClient.getFolder('f9')).toBeNull();

    axios.mockResolvedValueOnce({ data: { id: 'f8', name: 'Old', trashed: true } });
    expect(await DriveClient.getFolder('f8')).toBeNull();
});
