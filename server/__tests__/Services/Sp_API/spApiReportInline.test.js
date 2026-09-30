/**
 * runSpApiReportInline — the create/poll/download cycle the two ESF report
 * services share. Two behaviours matter enough to pin:
 *
 *  - an expired token must be THROWN, because TokenManager.wrapSpApiFunction
 *    refreshes only on a thrown 401/403; returning it as a quiet failure would
 *    leave the report failing every night on a token that could be renewed
 *  - FATAL/CANCELLED is re-requested, since Amazon fails some report types
 *    intermittently and succeeds on a fresh request
 */

// Callable as well as carrying get/post: the download is axios(config).
jest.mock('axios', () => Object.assign(jest.fn(), { get: jest.fn(), post: jest.fn() }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const axios = require('axios');
const { runSpApiReportInline } = require('../../../Services/Sp_API/spApiReportAdapter.js');

const args = (extra = {}) => ({ accessToken: 't', baseuri: 'sp.example', body: { reportType: 'X' }, pollMs: 0, maxPolls: 3, ...extra });
const status = (processingStatus, reportDocumentId = null) => ({ data: { processingStatus, reportDocumentId } });

beforeEach(() => {
    jest.resetAllMocks();
    // axios(config) is the download call.
    axios.mockResolvedValue({ data: Buffer.from('file') });
});

it('returns the downloaded document when the report is done', async () => {
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get
        .mockResolvedValueOnce(status('IN_PROGRESS'))
        .mockResolvedValueOnce(status('DONE', 'd1'))
        .mockResolvedValueOnce({ data: { url: 'https://doc' } });

    const result = await runSpApiReportInline(args());
    expect(result.status).toBe('DONE');
    expect(result.buffer.toString()).toBe('file');
});

it('reports NO_DATA as its own answer, not as a failure', async () => {
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get.mockResolvedValueOnce(status('DONE_NO_DATA'));
    expect(await runSpApiReportInline(args())).toEqual({ status: 'NO_DATA' });
});

it('re-requests a report Amazon failed, when retries allow', async () => {
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get
        .mockResolvedValueOnce(status('FATAL'))
        .mockResolvedValueOnce(status('DONE', 'd1'))
        .mockResolvedValueOnce({ data: { url: 'https://doc' } });

    const result = await runSpApiReportInline(args({ retries: 1 }));
    expect(result.status).toBe('DONE');
    expect(axios.post).toHaveBeenCalledTimes(2);
});

it('returns, rather than throws, a failure that outlasts its retries', async () => {
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get.mockResolvedValue(status('FATAL'));
    expect(await runSpApiReportInline(args({ retries: 1 }))).toEqual({ status: 'FAILED', note: 'report FATAL' });
});

it('reads CANCELLED as "no data", which is what Amazon documents it to mean', async () => {
    // Seen live: the removal-order report comes back CANCELLED for an account
    // with no removals. Retrying it would only get the same answer.
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get.mockResolvedValue(status('CANCELLED'));
    expect(await runSpApiReportInline(args({ retries: 1 }))).toEqual({ status: 'NO_DATA' });
    expect(axios.post).toHaveBeenCalledTimes(1);
});

it('throws an expired token so the refresh wrapper can act on it', async () => {
    const expired = Object.assign(new Error('Unauthorized'), { response: { status: 403 } });
    axios.post.mockRejectedValue(expired);
    await expect(runSpApiReportInline(args())).rejects.toBe(expired);
});

it('gives up when the report never finishes', async () => {
    axios.post.mockResolvedValue({ data: { reportId: 'r1' } });
    axios.get.mockResolvedValue(status('IN_QUEUE'));
    expect(await runSpApiReportInline(args())).toEqual({ status: 'FAILED', note: 'report did not complete in time' });
});
