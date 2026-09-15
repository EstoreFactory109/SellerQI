/**
 * Tests for the Zoho Projects client + service layer.
 *
 * The properties pinned here are the ones that would otherwise only surface against a
 * live portal: the Zoho-oauthtoken auth scheme, the 401 refresh-and-replay-once path,
 * and the bounds on the N+1 comment fetch in getProjectTaskUpdates.
 */

// The global setup.js mocks axios as a plain object ({get, post, ...}), which is fine for
// the token calls but not here: ZohoProjectsClient invokes axios as a FUNCTION —
// axios({method, url, ...}) — so it needs a callable mock. This factory overrides the
// global one for this suite only.
jest.mock('axios', () => {
    const instance = jest.fn();
    instance.get = jest.fn();
    instance.post = jest.fn();
    instance.put = jest.fn();
    instance.delete = jest.fn();
    return instance;
});

jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({
    getAccessToken: jest.fn().mockResolvedValue('access-token-1'),
    invalidateAccessToken: jest.fn().mockResolvedValue(undefined),
    getConnection: jest.fn().mockResolvedValue({
        apiDomain: 'https://projectsapi.zoho.com',
        portalId: 'portal-1'
    })
}));

const axios = require('axios');
const ZohoAuth = require('../../../Services/Zoho/ZohoAuth.js');
const { zohoRequest } = require('../../../Services/Zoho/ZohoProjectsClient.js');
const ZohoProjectsService = require('../../../Services/Zoho/ZohoProjectsService.js');

/** Build an axios-shaped rejection. */
const httpError = (status, data = {}, headers = {}) => {
    const error = new Error(`Request failed with status code ${status}`);
    error.response = { status, data, headers };
    return error;
};

beforeEach(() => {
    ZohoAuth.getAccessToken.mockResolvedValue('access-token-1');
    ZohoAuth.getConnection.mockResolvedValue({
        apiDomain: 'https://projectsapi.zoho.com',
        portalId: 'portal-1'
    });
});

describe('zohoRequest', () => {
    test('authenticates with Zoho-oauthtoken, not Bearer', async () => {
        axios.mockResolvedValue({ data: { projects: [] } });

        await zohoRequest({ path: '/portal/portal-1/projects' });

        // `Bearer` here fails with an opaque 401 — this is the single most common
        // cause of a valid Zoho token being rejected.
        expect(axios.mock.calls[0][0].headers.Authorization).toBe('Zoho-oauthtoken access-token-1');
    });

    test('resolves v3 and v2 base paths distinctly', async () => {
        axios.mockResolvedValue({ data: {} });

        await zohoRequest({ path: '/portals', version: 'v3' });
        expect(axios.mock.calls[0][0].url).toBe('https://projectsapi.zoho.com/api/v3/portals');

        await zohoRequest({ path: '/portal/portal-1/projects/1/activities/', version: 'v2' });
        expect(axios.mock.calls[1][0].url).toBe(
            'https://projectsapi.zoho.com/restapi/portal/portal-1/projects/1/activities/'
        );
    });

    test('sets an explicit timeout on every request', async () => {
        axios.mockResolvedValue({ data: {} });

        await zohoRequest({ path: '/portals' });

        // axios has no default timeout; a connected-but-silent socket would hang forever.
        expect(axios.mock.calls[0][0].timeout).toBeGreaterThan(0);
    });

    test('refreshes the token and replays once on 401', async () => {
        axios.mockRejectedValueOnce(httpError(401, { error: 'invalid token' }));
        axios.mockResolvedValueOnce({ data: { projects: [] } });
        ZohoAuth.getAccessToken.mockResolvedValueOnce('stale-token').mockResolvedValueOnce('fresh-token');

        await zohoRequest({ path: '/portal/portal-1/projects' });

        expect(ZohoAuth.invalidateAccessToken).toHaveBeenCalledTimes(1);
        expect(axios).toHaveBeenCalledTimes(2);
        // The replay must carry the newly minted token, and be forced past the cache.
        expect(ZohoAuth.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
        expect(axios.mock.calls[1][0].headers.Authorization).toBe('Zoho-oauthtoken fresh-token');
    });

    test('gives up after a single 401 replay rather than looping', async () => {
        axios.mockRejectedValue(httpError(401, { error: 'invalid token' }));

        await expect(zohoRequest({ path: '/portal/portal-1/projects' })).rejects.toMatchObject({ statusCode: 401 });
        expect(axios).toHaveBeenCalledTimes(2);
    });

    test('sends v2 writes form-encoded', async () => {
        axios.mockResolvedValue({ data: {} });

        await zohoRequest({ method: 'POST', path: '/p', version: 'v2', data: { name: 'x' }, form: true });

        const call = axios.mock.calls[0][0];
        expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(call.data).toBeInstanceOf(URLSearchParams);
    });

    test('surfaces a 404 as a 404, not a generic 502', async () => {
        axios.mockRejectedValue(httpError(404, { error: { message: 'no such project' } }));

        await expect(zohoRequest({ path: '/portal/portal-1/projects/999' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('listProjects', () => {
    test('pages until a short page and normalises the payload', async () => {
        // Fixture mirrors a real v3 payload: status/owner/tasks are nested objects, not
        // flat *_name strings. An earlier flat fixture hid a mapping bug that only showed
        // up against a live portal ("[object Object]" for every project status).
        const page = (n) => Array.from({ length: n }, (_, i) => ({
            id: i,
            name: `P${i}`,
            status: { id: '20089', name: 'Active', color: '#2cc8ba' },
            project_type: 'active',
            owner: { full_name: 'Henil Modi', email: 'henil@example.com' },
            tasks: { open_count: 18, closed_count: 2 },
        }));

        // 200 is the documented max page size, so a full page means "keep going".
        axios.mockResolvedValueOnce({ data: { projects: page(200) } });
        axios.mockResolvedValueOnce({ data: { projects: page(3) } });

        const projects = await ZohoProjectsService.listProjects();

        expect(axios).toHaveBeenCalledTimes(2);
        expect(projects).toHaveLength(203);
        expect(projects[0]).toMatchObject({
            id: '0',
            name: 'P0',
            status: 'Active',            // unwrapped from status.name
            projectType: 'active',
            ownerName: 'Henil Modi',     // from owner.full_name, not owner_name
            taskCount: 20,               // open_count + closed_count
            openTaskCount: 18,
        });
    });

    test('stops at an explicit limit', async () => {
        axios.mockResolvedValue({ data: { projects: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } });

        const projects = await ZohoProjectsService.listProjects({ limit: 2 });

        expect(projects).toHaveLength(2);
        expect(axios).toHaveBeenCalledTimes(1);
    });
});

describe('listPortals', () => {
    test('maps the real v3 portal keys, including the caller profile', async () => {
        // portal_name / is_default_portal / profile.name — NOT name / default / role.
        // Getting this wrong left portalName null after the first successful connect.
        axios.mockResolvedValue({ data: [{
            id: '851273093',
            portal_name: 'estorefactory',
            org_name: 'eStore Factory',
            is_default_portal: false,
            profile: { name: 'Read Only', id: 123 },
            portal_url: 'https://projects.zoho.com/portal/estorefactory',
        }] });

        const portals = await ZohoProjectsService.listPortals();

        expect(portals[0]).toMatchObject({
            id: '851273093',
            name: 'estorefactory',
            isDefault: false,
            role: 'Read Only',
            url: 'https://projects.zoho.com/portal/estorefactory',
        });
    });
});

describe('createProject', () => {
    test('rejects a blank name before calling Zoho', async () => {
        await expect(ZohoProjectsService.createProject({ name: '   ' })).rejects.toMatchObject({ statusCode: 400 });
        expect(axios).not.toHaveBeenCalled();
    });

    test('POSTs the trimmed name and returns the normalised project', async () => {
        axios.mockResolvedValue({ data: { projects: [{ id: 42, name: 'New Project', status: 'active' }] } });

        const project = await ZohoProjectsService.createProject({ name: '  New Project  ', description: 'd' });

        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('POST');
        expect(call.data).toMatchObject({ name: 'New Project', description: 'd' });
        expect(project).toMatchObject({ id: '42', name: 'New Project' });
    });
});

describe('getProjectTaskUpdates', () => {
    /** Route each request by URL so the N+1 comment fan-out can be asserted. */
    const routeByUrl = (handlers) => {
        axios.mockImplementation(async ({ url }) => {
            const match = Object.keys(handlers).find((key) => url.includes(key));
            return { data: match ? handlers[match] : {} };
        });
    };

    test('attaches comments to each task and returns the activity and status feeds', async () => {
        routeByUrl({
            '/comments': { comments: [{ id: 9, content: 'looks good', added_by_name: 'Dev' }] },
            '/tasks': { tasks: [{ id: 1, name: 'Task A', status: { name: 'Open' } }] },
            '/activities/': { activities: [{ id: 5, name: 'status changed', activity_by: 'Dev' }] },
            '/statuses/': { statuses: [{ id: 7, content: 'on track' }] }
        });

        const result = await ZohoProjectsService.getProjectTaskUpdates('project-1');

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]).toMatchObject({ id: '1', name: 'Task A', status: 'Open' });
        expect(result.tasks[0].comments).toEqual([
            expect.objectContaining({ id: '9', content: 'looks good', authorName: 'Dev' })
        ]);
        expect(result.activities).toEqual([expect.objectContaining({ id: '5' })]);
        expect(result.statuses).toEqual([expect.objectContaining({ id: '7', content: 'on track' })]);
        expect(result.truncated).toBe(false);
    });

    test('caps the task list at maxTasks and flags truncation', async () => {
        routeByUrl({
            '/comments': { comments: [] },
            '/tasks': { tasks: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `T${i}` })) },
            '/activities/': { activities: [] },
            '/statuses/': { statuses: [] }
        });

        const result = await ZohoProjectsService.getProjectTaskUpdates('project-1', { maxTasks: 3 });

        expect(result.tasks).toHaveLength(3);
        expect(result.taskCount).toBe(3);
        // More tasks exist than were returned — the caller needs to know the list is partial.
        expect(result.truncated).toBe(true);
    });

    test('skips the comment fan-out entirely when includeComments is false', async () => {
        routeByUrl({
            '/tasks': { tasks: [{ id: 1, name: 'Task A' }] },
            '/activities/': { activities: [] },
            '/statuses/': { statuses: [] }
        });

        const result = await ZohoProjectsService.getProjectTaskUpdates('project-1', { includeComments: false });

        expect(result.tasks[0].comments).toEqual([]);
        expect(axios.mock.calls.some(([{ url }]) => url.includes('/comments'))).toBe(false);
    });

    test('returns null feeds rather than failing when activities are unavailable', async () => {
        axios.mockImplementation(async ({ url }) => {
            if (url.includes('/activities/') || url.includes('/statuses/')) {
                throw httpError(404, { error: 'not available on this plan' });
            }
            if (url.includes('/comments')) return { data: { comments: [] } };
            return { data: { tasks: [{ id: 1, name: 'Task A' }] } };
        });

        const result = await ZohoProjectsService.getProjectTaskUpdates('project-1');

        // The tasks are what the caller asked for; a missing feed must not sink the call.
        expect(result.tasks).toHaveLength(1);
        // null, not [] — "the feed failed" is different from "the feed is empty".
        expect(result.activities).toBeNull();
        expect(result.statuses).toBeNull();
    });

    test('one unreadable task does not lose the rest of the response', async () => {
        axios.mockImplementation(async ({ url }) => {
            if (url.includes('/tasks/2/comments')) throw httpError(403, { error: 'no access' });
            if (url.includes('/comments')) return { data: { comments: [{ id: 1, content: 'ok' }] } };
            if (url.includes('/activities/') || url.includes('/statuses/')) return { data: {} };
            return { data: { tasks: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } };
        });

        const result = await ZohoProjectsService.getProjectTaskUpdates('project-1');

        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0].comments).toHaveLength(1);
        expect(result.tasks[1].comments).toEqual([]);
    });

    test('rejects a missing project id before calling Zoho', async () => {
        await expect(ZohoProjectsService.getProjectTaskUpdates()).rejects.toMatchObject({ statusCode: 400 });
        expect(axios).not.toHaveBeenCalled();
    });
});

describe('mapWithConcurrency', () => {
    test('never exceeds the concurrency limit and preserves input order', async () => {
        let inFlight = 0;
        let peak = 0;

        const result = await ZohoProjectsService.mapWithConcurrency(
            [1, 2, 3, 4, 5, 6, 7, 8],
            3,
            async (n) => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return n * 2;
            }
        );

        expect(peak).toBeLessThanOrEqual(3);
        expect(result).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    });

    test('handles an empty list without hanging', async () => {
        await expect(ZohoProjectsService.mapWithConcurrency([], 5, async (x) => x)).resolves.toEqual([]);
    });
});

describe('Zoho error messages', () => {
    test('surfaces an OAuth-scope failure instead of "[object Object]"', async () => {
        // The real body from a write attempt on read-only scopes. The old
        // extraction fell through to `data.error` — an object — and stringified
        // it, so a fixable scope problem reported itself as "[object Object]".
        axios.mockRejectedValue(httpError(401, {
            error: {
                status_code: '401',
                title: 'INVALID_OAUTHSCOPE',
                error_type: 'FIELDS_VALIDATION_ERROR',
                details: [{ message: 'Invalid OAuth scope.' }],
            },
        }));

        await expect(zohoRequest({ method: 'POST', path: '/x', context: 'Posting a comment' }))
            .rejects.toMatchObject({
                statusCode: 401,
                message: expect.stringContaining('INVALID_OAUTHSCOPE'),
            });
        await expect(zohoRequest({ method: 'POST', path: '/x', context: 'Posting a comment' }))
            .rejects.toMatchObject({ message: expect.not.stringContaining('[object Object]') });
    });

    test('still reads the simpler v2 and v3 error shapes', async () => {
        axios.mockRejectedValue(httpError(400, { error: 'plain v2 text' }));
        await expect(zohoRequest({ path: '/x', context: 'C' })).rejects.toMatchObject({
            message: expect.stringContaining('plain v2 text'),
        });

        axios.mockRejectedValue(httpError(400, { error: { code: 6500, message: 'v3 message' } }));
        await expect(zohoRequest({ path: '/x', context: 'C' })).rejects.toMatchObject({
            message: expect.stringContaining('v3 message'),
        });
    });
});

/**
 * Writing back to a task.
 *
 * The field names and API generations below were established by probing the live
 * portal, and both differ from what the surrounding code would suggest: comments take
 * `comment` (not `content`, the name used almost everywhere else for body text), and
 * attachments are v2-only even though comments on the same task are v3. Getting either
 * wrong fails at runtime with a validation error that reads like a bug in the caller.
 */
describe('postTaskComment', () => {
    beforeEach(() => {
        axios.mockReset();
        axios.mockResolvedValue({ status: 200, data: { comments: [{ id_string: 'c-1' }] } });
    });

    test('sends the body as `comment`, the name Zoho actually requires', async () => {
        await ZohoProjectsService.postTaskComment({
            projectId: 'proj-1', taskId: 'task-1', comment: 'Photos attached.',
        });

        const sent = axios.mock.calls[0][0];
        expect(sent.method).toBe('POST');
        expect(sent.data).toEqual({ comment: 'Photos attached.' });
        // `content` is what the read side normalises TO, and sending it back returns
        // FIELDS_VALIDATION_ERROR / Input Parameter Missing.
        expect(sent.data).not.toHaveProperty('content');
    });

    test('posts to the v3 task-comments path', async () => {
        await ZohoProjectsService.postTaskComment({ projectId: 'p', taskId: 't', comment: 'x' });

        expect(axios.mock.calls[0][0].url).toBe(
            'https://projectsapi.zoho.com/api/v3/portal/portal-1/projects/p/tasks/t/comments'
        );
    });

    test('returns the new comment id so the reply can be recorded locally', async () => {
        const out = await ZohoProjectsService.postTaskComment({ projectId: 'p', taskId: 't', comment: 'x' });
        expect(out.commentId).toBe('c-1');
    });

    test('refuses empty text rather than posting a blank comment', async () => {
        await expect(
            ZohoProjectsService.postTaskComment({ projectId: 'p', taskId: 't', comment: '   ' })
        ).rejects.toThrow(/required/i);
        expect(axios).not.toHaveBeenCalled();
    });
});

describe('uploadTaskAttachment', () => {
    const file = () => ({ buffer: Buffer.from('x'), filename: 'front.jpg', contentType: 'image/jpeg' });

    beforeEach(() => {
        axios.mockReset();
        axios.mockResolvedValue({ status: 200, data: { attachments: [{ id_string: 'a-1' }] } });
    });

    test('uploads on v2 — the v3 path rejects every multipart POST', async () => {
        await ZohoProjectsService.uploadTaskAttachment({ projectId: 'p', taskId: 't', file: file() });

        // /api/v3/...  returns 400 UPLOAD_RULE_NOT_CONFIGURED whatever the field name.
        expect(axios.mock.calls[0][0].url).toBe(
            'https://projectsapi.zoho.com/restapi/portal/portal-1/projects/p/tasks/t/attachments/'
        );
    });

    test('sends the file as `uploaddoc` in a classic multipart body', async () => {
        await ZohoProjectsService.uploadTaskAttachment({ projectId: 'p', taskId: 't', file: file() });

        const sent = axios.mock.calls[0][0];
        // The form-data package, not Node's global FormData: this endpoint answers
        // 6500 General Error to what axios makes of a native FormData/Blob.
        expect(typeof sent.data.getHeaders).toBe('function');
        expect(sent.data.getBuffer().toString()).toContain('name="uploaddoc"');
        expect(sent.data.getBuffer().toString()).toContain('filename="front.jpg"');
    });

    test('sends the multipart boundary, without which Zoho rejects the body', async () => {
        await ZohoProjectsService.uploadTaskAttachment({ projectId: 'p', taskId: 't', file: file() });

        const contentType = axios.mock.calls[0][0].headers['content-type'];
        expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    });

    test('refuses a file with no buffer', async () => {
        await expect(
            ZohoProjectsService.uploadTaskAttachment({ projectId: 'p', taskId: 't', file: { filename: 'a.jpg' } })
        ).rejects.toThrow(/file is required/i);
    });

    test('uses the caller\'s longer timeout for uploads', async () => {
        await ZohoProjectsService.uploadTaskAttachment({
            projectId: 'p', taskId: 't', file: file(), timeout: 180000,
        });

        expect(axios.mock.calls[0][0].timeout).toBe(180000);
    });

    test('refuses a missing file instead of posting an empty upload', async () => {
        await expect(
            ZohoProjectsService.uploadTaskAttachment({ projectId: 'p', taskId: 't', file: null })
        ).rejects.toThrow(/file is required/i);
        expect(axios).not.toHaveBeenCalled();
    });
});
