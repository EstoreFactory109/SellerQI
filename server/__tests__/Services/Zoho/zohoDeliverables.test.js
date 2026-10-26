/**
 * Deliverables: which of the team's files and links on a task can reach the client.
 *
 * Payload shapes are the real ones, probed on 2026-10-27 (scripts/probeZohoDeliverables.js):
 * the team's files are WorkDrive attachments on task comments.
 */

jest.mock('openai', () => jest.fn());

const OpenAI = require('openai');
const { normaliseAttachment, extractShareLinks, candidatesForTask, isShown, fileKey } = require('../../../Services/Zoho/zohoDeliverables.js');
const ZohoProjectsService = require('../../../Services/Zoho/ZohoProjectsService.js');

/** A comment attachment exactly as the live v3 comments payload carries it. */
const liveAttachment = (overrides = {}) => ({
  created_time: '1768892018146',
  associated_time_long: '1768892041020',
  third_party_file_id: 'tvvn0420042f3ac3c403abdb99fc013ca4d79',
  parentFolderId: 'd73eq5d44f2ebf1e04a07a0917a0151b66bf0',
  app_domain: 'workdrive',
  type: 'image/jpeg',
  entity_id: '2294829000008540209',
  size: '145890',
  preview_url: 'https://previewengine-accl.zoho.com/thumbnail/WD/tvvn?x-cli-msg=abc&size=xs',
  attachment_id: '2294829000008540207',
  name: 'Main image.jpeg',
  associated_by_name: 'Bhavdeep Lalakiya',
  download_url: 'https://download-accl.zoho.com/v1/workdrive/download?x-cli-msg=abc',
  permanent_url: 'https://workdrive.zoho.com/file/tvvn',
  trashed: 'false',
  ...overrides,
});

describe('normaliseAttachment', () => {
  it('keeps what the Status page and the download need', () => {
    expect(normaliseAttachment(liveAttachment())).toEqual({
      fileId: '2294829000008540207',
      name: 'Main image.jpeg',
      mimeType: 'image/jpeg',
      size: 145890,
      downloadUrl: 'https://download-accl.zoho.com/v1/workdrive/download?x-cli-msg=abc',
      previewUrl: 'https://previewengine-accl.zoho.com/thumbnail/WD/tvvn?x-cli-msg=abc&size=xs',
      permanentUrl: 'https://workdrive.zoho.com/file/tvvn',
      thirdPartyFileId: 'tvvn0420042f3ac3c403abdb99fc013ca4d79',
      addedAt: new Date(1768892041020).toISOString(),
      addedByName: 'Bhavdeep Lalakiya',
    });
  });

  it('drops trashed and nameless attachments', () => {
    expect(normaliseAttachment(liveAttachment({ trashed: 'true' }))).toBeNull();
    expect(normaliseAttachment(liveAttachment({ name: '' }))).toBeNull();
  });
});

describe('extractShareLinks', () => {
  it('finds file-sharing links in hrefs and plain text, and nothing else', () => {
    const html = '<div>Final images: <a href="https://drive.google.com/drive/folders/abc">here</a>. '
      + 'See also https://www.dropbox.com/s/xyz/file.zip?dl=0 and our site '
      + '<a href="https://www.morgansrepellent.com/">morgansrepellent.com</a> and https://amazon.com/dp/B0X</div>';
    expect(extractShareLinks(html)).toEqual([
      'https://drive.google.com/drive/folders/abc',
      'https://www.dropbox.com/s/xyz/file.zip?dl=0',
    ]);
  });

  it('handles HTML-escaped ampersands and trailing punctuation', () => {
    expect(extractShareLinks('https://we.tl/t-abc?a=1&amp;b=2).')).toEqual(['https://we.tl/t-abc?a=1&b=2']);
  });
});

describe('normaliseComment', () => {
  const comment = (overrides = {}) => ({
    id: '1', comment: '<div>Images ready <a href="https://drive.google.com/x">folder</a></div>',
    created_time: '2026-01-20T06:54:00.998Z',
    created_by: { full_name: 'Team Member', is_client_user: false },
    attachments: [liveAttachment(), liveAttachment({ attachment_id: '2', trashed: 'true' })],
    ...overrides,
  });

  it('keeps the team\'s files and share links', () => {
    const c = ZohoProjectsService.normaliseComment(comment());
    expect(c.attachments).toHaveLength(1);
    expect(c.links).toEqual(['https://drive.google.com/x']);
    expect(c.authorIsClient).toBe(false);
    expect(c.attachmentCount).toBe(2);
  });

  it('marks a Zoho client user, and a reply the client sent through SellerQI', () => {
    expect(ZohoProjectsService.normaliseComment(comment({ created_by: { is_client_user: true } })).authorIsClient).toBe(true);
    const viaPortal = comment({ comment: 'Client reply from Ann (ann@x.com) — sent via the SellerQI portal\n\nHere are my photos' });
    expect(ZohoProjectsService.normaliseComment(viaPortal).authorIsClient).toBe(true);
  });
});

describe('candidatesForTask and visibility', () => {
  const task = {
    comments: [
      { commentId: 'c1', content: 'Final images attached', authorIsClient: false, createdAt: '2026-01-20T00:00:00Z',
        attachments: [{ fileId: '11', name: 'final.jpg', mimeType: 'image/jpeg', size: 10, addedAt: '2026-01-20T00:00:01Z' }],
        links: ['https://drive.google.com/x'] },
      { commentId: 'c2', content: 'Client reply from Ann', authorIsClient: true,
        attachments: [{ fileId: '12', name: 'raw.jpg' }], links: [] },
    ],
  };

  it('offers the team\'s files and links, never the client\'s own uploads', () => {
    const c = candidatesForTask(task);
    expect(c.map((x) => [x.kind, x.name])).toEqual([['file', 'final.jpg'], ['link', 'Google Drive link']]);
    expect(c[0].key).toBe(fileKey('11'));
    expect(c[1].key).toMatch(/^l_c1_[a-f0-9]{12}$/);
  });

  it('shows only a firm yes or a staff "show"; a staff "hide" always wins', () => {
    expect(isShown('yes', null)).toBe(true);
    expect(isShown('unsure', null)).toBe(false);
    expect(isShown('no', null)).toBe(false);
    expect(isShown(undefined, null)).toBe(false);
    expect(isShown('no', 'show')).toBe(true);
    expect(isShown('yes', 'hide')).toBe(false);
  });
});

describe('ZohoDeliverableClassifier', () => {
  const create = jest.fn();
  let classifyDeliverables;
  const task = { name: 'Product photography', status: 'Closed', comments: [{ authorName: 'Bhavdeep' }], ownerNames: ['Priya'] };
  const candidates = [
    { key: 'f_1', kind: 'file', name: 'final-main.jpg', mimeType: 'image/jpeg', context: 'Bhavdeep: final images ready' },
    { key: 'f_2', kind: 'file', name: 'client-raw.jpg', mimeType: 'image/jpeg', context: 'raw photos from client' },
  ];
  const env = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env, OPENAPI_KEY: 'test-key' };
    jest.doMock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create } } })));
    create.mockReset();
    ({ classifyDeliverables } = require('../../../Services/AI/ZohoDeliverableClassifier.js'));
  });
  afterEach(() => { process.env = { ...env }; });

  it('asks once per task and keeps each verdict with its reason', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ items: [
      { key: 'f_1', deliverable: 'yes', reason: 'Final product images' },
      { key: 'f_2', deliverable: 'no', reason: 'Client supplied raw photo' },
    ] }) } }] });
    const out = await classifyDeliverables(task, candidates, []);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.map((d) => [d.key, d.decision])).toEqual([['f_1', 'yes'], ['f_2', 'no']]);
    // Staff names never leave our systems.
    expect(create.mock.calls[0][0].messages[1].content).not.toMatch(/Bhavdeep|Priya/);
  });

  it('reuses a verdict while its context is unchanged — no second AI call', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ items: [
      { key: 'f_1', deliverable: 'yes' }, { key: 'f_2', deliverable: 'no' },
    ] }) } }] });
    const first = await classifyDeliverables(task, candidates, []);
    create.mockClear();
    const again = await classifyDeliverables(task, candidates, first);
    expect(create).not.toHaveBeenCalled();
    expect(again).toEqual(first);
  });

  it('is conservative: a failed or empty answer means unsure (hidden) and is not cached', async () => {
    create.mockRejectedValue(new Error('rate limited'));
    const out = await classifyDeliverables(task, candidates, []);
    expect(out.every((d) => d.decision === 'unsure' && d.contextHash === null)).toBe(true);

    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ items: [{ key: 'f_1', deliverable: 'definitely' }] }) } }] });
    const odd = await classifyDeliverables(task, candidates, []);
    expect(odd.find((d) => d.key === 'f_1').decision).toBe('unsure');
    expect(odd.find((d) => d.key === 'f_2').decision).toBe('unsure');
  });

  it('makes no call and hides everything without an AI key', async () => {
    delete process.env.OPENAPI_KEY;
    jest.resetModules();
    ({ classifyDeliverables } = require('../../../Services/AI/ZohoDeliverableClassifier.js'));
    const out = await classifyDeliverables(task, candidates, []);
    expect(create).not.toHaveBeenCalled();
    expect(out.every((d) => d.decision === 'unsure')).toBe(true);
  });
});

void OpenAI;
