/**
 * Fetching a deliverable's bytes from Zoho WorkDrive.
 *
 * Probed 2026-10-27: download_url answers 401 INVALID_OAUTHSCOPE without a WorkDrive scope, and
 * Zoho reports errors as small JSON bodies — which must never be served as the client's "file".
 */
jest.mock('../../../Services/Zoho/ZohoProjectsClient.js', () => ({
  zohoRequest: jest.fn(),
  paginate: jest.fn(),
  unwrap: jest.fn(),
  resolvePortalId: jest.fn(),
}));
jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({ getConnection: jest.fn(), getAccessToken: jest.fn() }));

const { zohoRequest } = require('../../../Services/Zoho/ZohoProjectsClient.js');
const { getConnection } = require('../../../Services/Zoho/ZohoAuth.js');
const { canDownloadFiles, downloadDeliverableFile, WORKDRIVE_READ_SCOPE } = require('../../../Services/Zoho/ZohoProjectsService.js');

const FILE = {
  downloadUrl: 'https://download-accl.zoho.com/v1/workdrive/download?x-cli-msg=abc',
  previewUrl: 'https://previewengine-accl.zoho.com/thumbnail/WD/tvvn?x-cli-msg=abc&size=xs',
  thirdPartyFileId: 'tvvn042',
};

beforeEach(() => jest.clearAllMocks());

describe('canDownloadFiles', () => {
  it('only once the connection holds the WorkDrive read scope', async () => {
    getConnection.mockResolvedValue({ scopes: ['ZohoProjects.tasks.ALL'] });
    expect(await canDownloadFiles()).toBe(false);
    getConnection.mockResolvedValue({ scopes: ['ZohoProjects.tasks.ALL', WORKDRIVE_READ_SCOPE] });
    expect(await canDownloadFiles()).toBe(true);
    getConnection.mockResolvedValue(null);
    expect(await canDownloadFiles()).toBe(false);
  });
});

describe('downloadDeliverableFile', () => {
  it('fetches the attachment\'s own download URL with our token, as binary', async () => {
    zohoRequest.mockResolvedValue(Buffer.alloc(2048, 1));
    const bytes = await downloadDeliverableFile(FILE);
    expect(bytes.length).toBe(2048);
    expect(zohoRequest).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://download-accl.zoho.com',
      path: '/v1/workdrive/download?x-cli-msg=abc',
      responseType: 'arraybuffer',
    }));
  });

  it('a preview uses the thumbnail first', async () => {
    zohoRequest.mockResolvedValue(Buffer.alloc(900, 1));
    await downloadDeliverableFile(FILE, { preview: true });
    expect(zohoRequest.mock.calls[0][0].baseUrl).toBe('https://previewengine-accl.zoho.com');
  });

  it('falls back to WorkDrive\'s download-by-id endpoint', async () => {
    zohoRequest.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }))
      .mockResolvedValueOnce(Buffer.alloc(1024, 1));
    await downloadDeliverableFile(FILE);
    expect(zohoRequest.mock.calls[1][0]).toMatchObject({ baseUrl: 'https://download.zoho.com', path: '/v1/workdrive/download/tvvn042' });
  });

  it('never returns a Zoho JSON error as if it were the file', async () => {
    zohoRequest.mockResolvedValue(Buffer.from('{"ERROR_MESSAGE":"INVALID_OAUTHSCOPE","ERROR_CODE":401}'));
    await expect(downloadDeliverableFile(FILE)).rejects.toMatchObject({ statusCode: 502 });
  });
});
