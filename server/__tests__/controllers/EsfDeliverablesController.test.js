/**
 * Deliverables endpoints: who can fetch which file, and staff corrections.
 *
 * The rules that matter: a client can only reach files on their OWN project, and only ones
 * shown to them; staff (logged in as the client) can check hidden ones and flip them; nothing
 * calls Zoho before the WorkDrive scope is granted (each refused call would burn a token refresh).
 */
const { PassThrough } = require('stream');

const mockConfig = { DELIVERABLES_ENABLED: true };
jest.mock('../../Services/Zoho/config.js', () => ({ get DELIVERABLES_ENABLED() { return mockConfig.DELIVERABLES_ENABLED; } }));
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
jest.mock('../../models/system/ZohoProjectTaskModel.js', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../Services/Zoho/ZohoProjectsService.js', () => ({ canDownloadFiles: jest.fn(), downloadDeliverableFile: jest.fn() }));
jest.mock('../../Services/Activity/actor.js', () => ({ classifyActor: jest.fn() }));

const UserModel = require('../../models/user-auth/userModel.js');
const ZohoProjectTask = require('../../models/system/ZohoProjectTaskModel.js');
const { canDownloadFiles, downloadDeliverableFile } = require('../../Services/Zoho/ZohoProjectsService.js');
const { classifyActor } = require('../../Services/Activity/actor.js');
const { downloadDeliverable, downloadTaskZip, setDeliverableVisibility } = require('../../controllers/analytics/EsfDeliverablesController.js');
const { deliverablesFor } = require('../../controllers/analytics/EsfProjectStatusController.js');

const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

const TASK = {
  _id: 't-doc', taskId: 'T1', name: 'Product images', projectId: 'P1',
  comments: [{
    commentId: 'c1', content: 'Final images', authorIsClient: false, createdAt: '2026-10-20T10:00:00Z',
    attachments: [
      { fileId: '11', name: 'final.jpg', mimeType: 'image/jpeg', size: 10, downloadUrl: 'https://x/d', addedAt: '2026-10-20T10:00:00Z' },
      { fileId: '12', name: 'working.psd', mimeType: 'image/vnd.adobe.photoshop', size: 99, downloadUrl: 'https://x/e', addedAt: '2026-10-20T10:01:00Z' },
    ],
    links: ['https://drive.google.com/x'],
  }],
  deliverableDecisions: [
    { key: 'f_11', decision: 'yes', reason: 'Final image' },
    { key: 'f_12', decision: 'no', reason: 'Working file' },
  ],
  deliverableOverrides: [],
};

/** Minimal Express response; resolves when the handler finishes writing. */
const run = (handler, req) => new Promise((resolve, reject) => {
  const res = new PassThrough();
  const chunks = [];
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; resolve(res); return res; };
  res.send = (buffer) => { res.sent = buffer; resolve(res); return res; };
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => { res.sent = Buffer.concat(chunks); resolve(res); });
  handler({ userId: 'u1', params: {}, query: {}, body: {}, cookies: {}, ...req }, res, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.DELIVERABLES_ENABLED = true;
  UserModel.findById.mockReturnValue(lean({ zohoProject: { projectId: 'P1' } }));
  ZohoProjectTask.findOne.mockReturnValue(lean(TASK));
  canDownloadFiles.mockResolvedValue(true);
  downloadDeliverableFile.mockResolvedValue(Buffer.from('JPEGDATA'));
  classifyActor.mockResolvedValue({ kind: 'owner', id: null });
});

describe('download a deliverable', () => {
  it('serves a shown file from the client\'s own project, images inline', async () => {
    const res = await run(downloadDeliverable, { params: { key: 'f_11' } });
    expect(ZohoProjectTask.findOne.mock.calls[0][0]).toEqual({ projectId: 'P1', 'comments.attachments.fileId': '11' });
    expect(res.sent.toString()).toBe('JPEGDATA');
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe('inline; filename="final.jpg"');
  });

  it('a hidden file is a 404 for the client, but staff can check it', async () => {
    expect((await run(downloadDeliverable, { params: { key: 'f_12' } })).statusCode).toBe(404);
    classifyActor.mockResolvedValue({ kind: 'esf_staff', id: 's1' });
    const res = await run(downloadDeliverable, { params: { key: 'f_12' } });
    expect(res.sent.toString()).toBe('JPEGDATA');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('never calls Zoho before the WorkDrive permission is granted', async () => {
    canDownloadFiles.mockResolvedValue(false);
    const res = await run(downloadDeliverable, { params: { key: 'f_11' } });
    expect(res.statusCode).toBe(503);
    expect(downloadDeliverableFile).not.toHaveBeenCalled();
  });

  it('refuses malformed keys, links, other projects and a switched-off feature', async () => {
    expect((await run(downloadDeliverable, { params: { key: '../etc' } })).statusCode).toBe(404);
    expect((await run(downloadDeliverable, { params: { key: 'l_c1_0123456789ab' } })).statusCode).toBe(404);
    ZohoProjectTask.findOne.mockReturnValue(lean(null)); // not in this client's project
    expect((await run(downloadDeliverable, { params: { key: 'f_99' } })).statusCode).toBe(404);
    ZohoProjectTask.findOne.mockReturnValue(lean(TASK));
    mockConfig.DELIVERABLES_ENABLED = false;
    expect((await run(downloadDeliverable, { params: { key: 'f_11' } })).statusCode).toBe(404);
    expect(downloadDeliverableFile).not.toHaveBeenCalled();
  });

  it('a Zoho failure is a readable 502, not a crash', async () => {
    downloadDeliverableFile.mockRejectedValue(new Error('timeout'));
    expect((await run(downloadDeliverable, { params: { key: 'f_11' } })).statusCode).toBe(502);
  });
});

describe('download all as a zip', () => {
  it('zips only the shown files', async () => {
    const res = await run(downloadTaskZip, { params: { taskId: 'T1' } });
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Product images.zip"');
    expect(downloadDeliverableFile).toHaveBeenCalledTimes(1);
    expect(downloadDeliverableFile.mock.calls[0][0].name).toBe('final.jpg');
    expect(res.sent.slice(0, 2).toString()).toBe('PK'); // a real zip
  });

  it('is scoped to the client\'s project', async () => {
    ZohoProjectTask.findOne.mockReturnValue(lean(null));
    expect((await run(downloadTaskZip, { params: { taskId: 'T9' } })).statusCode).toBe(404);
    expect(ZohoProjectTask.findOne.mock.calls[0][0]).toEqual({ projectId: 'P1', taskId: 'T9' });
  });
});

describe('staff show / hide', () => {
  it('a client cannot change what is shown', async () => {
    const res = await run(setDeliverableVisibility, { params: { key: 'f_12' }, body: { visibility: 'show' } });
    expect(res.statusCode).toBe(403);
    expect(ZohoProjectTask.updateOne).not.toHaveBeenCalled();
  });

  it('staff override replaces any earlier one; "auto" goes back to the AI', async () => {
    classifyActor.mockResolvedValue({ kind: 'esf_staff', id: 's1' });
    await run(setDeliverableVisibility, { params: { key: 'f_12' }, body: { visibility: 'show' } });
    expect(ZohoProjectTask.updateOne).toHaveBeenNthCalledWith(1, { _id: 't-doc' }, { $pull: { deliverableOverrides: { key: 'f_12' } } });
    expect(ZohoProjectTask.updateOne.mock.calls[1][1].$push.deliverableOverrides).toMatchObject({ key: 'f_12', visibility: 'show', by: 's1' });

    ZohoProjectTask.updateOne.mockClear();
    await run(setDeliverableVisibility, { params: { key: 'f_12' }, body: { visibility: 'auto' } });
    expect(ZohoProjectTask.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown visibility values', async () => {
    classifyActor.mockResolvedValue({ kind: 'super_admin', id: 'a1' });
    expect((await run(setDeliverableVisibility, { params: { key: 'f_12' }, body: { visibility: 'maybe' } })).statusCode).toBe(400);
  });
});

describe('what the Status page sends', () => {
  it('clients get only shown deliverables, with no AI details', () => {
    const items = deliverablesFor(TASK, { staffView: false });
    expect(items.map((d) => d.name)).toEqual(['final.jpg']);
    expect(items[0]).not.toHaveProperty('aiReason');
    expect(items[0]).not.toHaveProperty('downloadUrl');
  });

  it('staff also get hidden ones with the AI\'s verdict and reason', () => {
    const items = deliverablesFor(TASK, { staffView: true });
    expect(items.map((d) => [d.name, d.shown, d.aiDecision])).toEqual([
      ['final.jpg', true, 'yes'],
      ['Google Drive link', false, 'pending'], // same comment, same time as final.jpg
      ['working.psd', false, 'no'],
    ]);
    expect(items[2].aiReason).toBe('Working file');
  });

  it('a staff "show" makes a hidden file visible to the client', () => {
    const items = deliverablesFor({ ...TASK, deliverableOverrides: [{ key: 'f_12', visibility: 'show' }] }, { staffView: false });
    expect(items.map((d) => d.name)).toEqual(['final.jpg', 'working.psd']);
  });

  it('nothing at all while the feature is off', () => {
    mockConfig.DELIVERABLES_ENABLED = false;
    expect(deliverablesFor(TASK, { staffView: true })).toEqual([]);
  });
});
