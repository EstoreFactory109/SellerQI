/**
 * A Zoho task the team closed marks the matching SellerQI tasks done (staff-added ESF clients).
 * Pinned: dry_run records and changes nothing; on completes them (completedBy esf_team) and
 * leaves one SellerQI message on the Zoho task; Fix it-mirrored tasks are never candidates;
 * nothing shortlisted means no AI call; a re-sync never repeats a close; a comment that fails
 * keeps the completion; a task already closed by one Zoho task is not claimed by the next; an
 * un-tick is noted.
 */
const mockStore = { tasks: [], rows: [], mirrored: [], comments: [] };
const mockAi = { matches: [], calls: 0 };
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: () => ({ select: () => ({ lean: async () => [{ _id: 'u1' }] }) }) }));
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({
  find: () => ({ lean: async () => mockStore.tasks.filter((t) => ['pending', 'in_progress'].includes(t.status)).map((t) => ({ ...t })) }),
  updateOne: async (filter, update) => {
    const t = mockStore.tasks.find((x) => x._id === filter._id && filter.status.$in.includes(x.status));
    if (t) Object.assign(t, update.$set);
    return { modifiedCount: t ? 1 : 0 };
  },
}));
jest.mock('../../../models/system/FixItSubtaskModel.js', () => ({ find: () => ({ select: () => ({ lean: async () => mockStore.mirrored.map((taskId) => ({ taskId })) }) }) }));
jest.mock('../../../models/system/ZohoCloseMatchModel.js', () => ({
  exists: async (key) => mockStore.rows.some((r) => r.zohoTaskId === key.zohoTaskId && +r.closedAt === +key.closedAt),
  create: async (doc) => { const r = { _id: `r${mockStore.rows.length + 1}`, undoneTaskIds: [], ...doc }; mockStore.rows.push(r); return r; },
  updateOne: async (filter, update) => {
    const r = filter._id ? mockStore.rows.find((x) => x._id === filter._id) : mockStore.rows.find((x) => x.mode === 'on' && x.matches.some((m) => m.taskId === filter['matches.taskId']) && !x.undoneTaskIds.includes(filter['matches.taskId']));
    if (r) { Object.assign(r, update.$set || {}); if (update.$push) r.undoneTaskIds.push(update.$push.undoneTaskIds); }
    return {};
  },
}));
jest.mock('../../../Services/AI/ZohoCloseMatcher.js', () => ({
  shortlist: (z, tasks) => tasks.filter((t) => z.name.toLowerCase().includes(t.productName.toLowerCase().split(' ')[0])),
  matchClosedTask: async (z, candidates) => { mockAi.calls++; return mockAi.matches.filter((m) => candidates.some((c) => c.taskId === m.taskId)); },
}));
jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({ postTaskComment: async (args) => { mockStore.comments.push(args); } }));
jest.mock('../../../Services/Calculations/CreateTasksService.js', () => ({ renderTaskIfNeeded: (t) => t }));
jest.mock('../../../Services/Stripe/FixItZohoSync.js', () => ({ subtaskContent: (t) => ({ title: `${t.error} — ${t.productName}` }) }));

const sync = require('../../../Services/Zoho/ZohoCloseSync.js');
const Zoho = require('../../../Services/Zoho/ZohoProjectsService.js');
const CLOSED = new Date('2026-10-28T10:00:00Z');
const zTask = (id, name) => ({ id, name, lastUpdatedAt: CLOSED });
const task = (n, productName) => ({ _id: `t${n}`, taskId: `task_${n}`, userId: 'u1', country: 'US', region: 'NA', productName, asin: `B0${n}`, error: 'A+ missing', status: 'pending' });

beforeEach(() => {
  delete process.env.ZOHO_CLOSE_MATCH_MODE;
  mockStore.tasks = [task(1, 'Blue mug'), task(2, 'Red mug'), task(3, 'Green teapot')];
  mockStore.rows = []; mockStore.mirrored = []; mockStore.comments = [];
  mockAi.matches = [{ taskId: 'task_1', reason: 'A+ for blue mug' }, { taskId: 'task_2', reason: 'A+ for red mug' }];
  mockAi.calls = 0;
});

it('trial run (the default): records what would be closed, changes nothing', async () => {
  const out = await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug and red mug')] });
  expect(out).toMatchObject({ mode: 'dry_run', recorded: 1, completed: 0 });
  expect(mockStore.rows[0]).toMatchObject({ mode: 'dry_run', zohoTaskName: 'A+ for blue mug and red mug' });
  expect(mockStore.rows[0].appliedAt).toBeUndefined();
  expect(mockStore.rows[0].matches.map((m) => m.taskId)).toEqual(['task_1', 'task_2']);
  expect(mockStore.tasks.every((t) => t.status === 'pending')).toBe(true);
  expect(mockStore.comments).toEqual([]);
});

it('on: completes the matched tasks as done by the ESF team and says so in Zoho', async () => {
  process.env.ZOHO_CLOSE_MATCH_MODE = 'on';
  const out = await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug and red mug')] });
  expect(out.completed).toBe(2);
  expect(mockStore.tasks.find((t) => t.taskId === 'task_1')).toMatchObject({ status: 'completed', completedBy: 'esf_team' });
  expect(mockStore.tasks.find((t) => t.taskId === 'task_3').status).toBe('pending');
  expect(mockStore.comments).toHaveLength(1);
  expect(mockStore.comments[0]).toMatchObject({ projectId: 'P1', taskId: 'Z1' });
  expect(mockStore.comments[0].comment).toMatch(/^SellerQI message: marked these 2 SellerQI tasks done for the client/);
});

it('never touches a task mirrored by Fix it, and asks no AI when nothing is shortlisted', async () => {
  mockStore.mirrored = ['task_1', 'task_2'];
  await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug and red mug')] });
  expect(mockAi.calls).toBe(0);
  expect(mockStore.rows[0].matches).toEqual([]);
});

it('a re-sync never repeats a close', async () => {
  await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug')] });
  await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug')] });
  expect(mockStore.rows).toHaveLength(1);
  expect(mockAi.calls).toBe(1);
});

it('a task closed by one Zoho task is not claimed by the next one in the same run', async () => {
  process.env.ZOHO_CLOSE_MATCH_MODE = 'on';
  await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug'), zTask('Z2', 'Blue mug follow-up')] });
  expect(mockStore.rows[0].matches.map((m) => m.taskId)).toEqual(['task_1']);
  expect(mockStore.rows[1].matches).toEqual([]);
});

it('a comment that fails keeps the completion; off does nothing', async () => {
  process.env.ZOHO_CLOSE_MATCH_MODE = 'on';
  const original = Zoho.postTaskComment;
  Zoho.postTaskComment = async () => { throw new Error('429'); };
  expect((await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug')] })).completed).toBe(1);
  Zoho.postTaskComment = original;
  process.env.ZOHO_CLOSE_MATCH_MODE = 'off';
  expect((await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z9', 'Red mug A+')] })).recorded).toBe(0);
});

it('an un-tick by the client is noted on the close that did it', async () => {
  process.env.ZOHO_CLOSE_MATCH_MODE = 'on';
  await sync.handleClosedTasks({ projectId: 'P1', closedTasks: [zTask('Z1', 'A+ for blue mug')] });
  await sync.noteUndone('u1', 'task_1');
  expect(mockStore.rows[0].undoneTaskIds).toEqual(['task_1']);
});
