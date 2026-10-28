/**
 * Fix it work orders: the seller's SellerQI tasks as Zoho subtasks, kept in step both ways.
 *
 * Pinned: top-up takes the highest-value open tasks up to the quota and a renewal's bigger
 * quota adds the next ones; nothing is added twice (a second run, a concurrent claim, or a
 * task already in another work order); an existing subtask is adopted (our marker after a
 * crash, the same title, or an AI match) instead of creating one; closed in Zoho completes
 * the SellerQI task and the reverse closes the subtask; reopening works both ways; a change
 * is never bounced back on the next run; changed text updates the subtask; a subtask the team
 * deleted is never recreated; a cancelled work order is synced but not topped up; an ended one
 * stops after the grace period; the parent shows "N of M done".
 */
const mockZoho = { subtasks: [], seq: 0, calls: [] };
const mockStore = { subtasks: [], tasks: [], orders: [] };
const mockAi = { matches: new Map() };

const fake = (rows, { onCreate } = {}) => {
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k]);
    return String(row[k]) === String(v) || (v === null && row[k] == null);
  });
  const query = (value) => ({ select: () => query(value), lean: async () => value, then: (r, j) => Promise.resolve(value).then(r, j) });
  return {
    find: (filter = {}) => query(rows().filter((r) => matches(r, filter)).map((r) => ({ ...r }))),
    findOne: (filter) => query(rows().find((r) => matches(r, filter)) || null),
    findById: (id) => query(rows().find((r) => String(r._id) === String(id)) || null),
    create: async (doc) => {
      if (onCreate) onCreate(doc);
      const row = { _id: `m${rows().length + 1}`, ...doc };
      rows().push(row);
      return row;
    },
    updateOne: async (filter, update) => {
      const row = rows().find((r) => matches(r, filter));
      if (row) { Object.assign(row, update.$set || {}); for (const k of Object.keys(update.$unset || {})) delete row[k]; }
      return { modifiedCount: row ? 1 : 0 };
    },
    deleteOne: async (filter) => { const i = rows().findIndex((r) => matches(r, filter)); if (i >= 0) rows().splice(i, 1); return {}; },
  };
};

jest.mock('../../../models/system/FixItSubtaskModel.js', () => fake(() => mockStore.subtasks, {
  onCreate: (doc) => {
    // The unique keys that keep a task from being mirrored twice.
    if (mockStore.subtasks.some((m) => String(m.workOrderId) === String(doc.workOrderId) && m.identityKey === doc.identityKey)) {
      const e = new Error('E11000 duplicate key'); e.code = 11000; throw e;
    }
  },
}));
jest.mock('../../../models/MCP/TaskItemModel.js', () => fake(() => mockStore.tasks));
jest.mock('../../../models/system/FixItWorkOrderModel.js', () => fake(() => mockStore.orders));
jest.mock('../../../utils/mongoLock.js', () => ({ acquireLock: async () => async () => {} }));
jest.mock('../../../Services/AI/FixItSubtaskMatcher.js', () => ({ matchSubtasks: async () => new Map(mockAi.matches) }));
jest.mock('../../../Services/Calculations/CreateTasksService.js', () => ({ renderTaskIfNeeded: (t) => t }));
jest.mock('../../../Services/Calculations/TaskPrioritizationService.js', () => ({ getTaskPriorityMeta: (t) => ({ impactWeight: t.impactWeight || 0, effortMinutes: 15 }) }));
jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
  listSubtasks: async ({ parentTaskId }) => mockZoho.subtasks.filter((s) => s.parentTaskId === parentTaskId).map((s) => ({ ...s })),
  createSubtask: async ({ parentTaskId, name, description }) => {
    const s = { id: `Z${++mockZoho.seq}`, parentTaskId, name, description, statusIsClosed: false };
    mockZoho.subtasks.push(s); mockZoho.calls.push(['create', s.id]); return { ...s };
  },
  updateTask: async ({ taskId, name, description, statusId }) => {
    const s = mockZoho.subtasks.find((x) => x.id === taskId);
    if (s) { if (name) s.name = name; if (description !== undefined) s.description = description; if (statusId) s.statusIsClosed = statusId === 'S_CLOSED'; }
    mockZoho.calls.push(['update', taskId]); return s;
  },
  closeTask: async ({ taskId }) => { const s = mockZoho.subtasks.find((x) => x.id === taskId); if (s) s.statusIsClosed = true; mockZoho.calls.push(['close', taskId]); },
  reopenTask: async ({ taskId }) => { const s = mockZoho.subtasks.find((x) => x.id === taskId); if (s) s.statusIsClosed = false; mockZoho.calls.push(['reopen', taskId]); },
}));

const sync = require('../../../Services/Stripe/FixItZohoSync.js');

const task = (n, amount, over = {}) => ({
  _id: `t${n}`, taskId: `task_${n}`, identityKey: `id_${n}`, userId: 'u1', country: 'US', region: 'NA',
  productName: `Mug ${n}`, asin: `B0000000${n}`, errorCategory: 'profitability', errorType: 'negative_profit',
  error: `Profitability | Selling at a loss: product ${n}`, solution: 'Raise the price', amount, status: 'pending', ...over,
});
const order = (over = {}) => ({
  _id: 'wo1', key: 'sub_1', userId: 'u1', country: 'US', region: 'NA', kind: 'subscription', packageName: 'Standard',
  tasksPerPeriod: 3, quota: 3, monthsPaid: 1, status: 'active', zohoProjectId: 'P1', portalId: 'portal',
  zohoParentTaskId: 'PARENT', zohoOpenStatusId: 'S_OPEN', ...over,
});
const run = async (over) => {
  mockStore.orders.splice(0, mockStore.orders.length, order(over));
  return sync.syncWorkOrder(mockStore.orders[0]);
};
const mappingFor = (taskId) => mockStore.subtasks.find((m) => m.taskId === taskId);
const zohoFor = (taskId) => mockZoho.subtasks.find((s) => s.id === mappingFor(taskId)?.zohoSubtaskId);

beforeEach(() => {
  mockZoho.subtasks.length = 0; mockZoho.seq = 0; mockZoho.calls.length = 0;
  mockStore.subtasks.length = 0; mockStore.orders.length = 0;
  mockAi.matches = new Map();
  mockStore.tasks.splice(0, mockStore.tasks.length, task(1, 50), task(2, 900), task(3, 10), task(4, 300), task(5, 0, { status: 'completed' }));
});

describe('top-up', () => {
  it('adds the highest-value open tasks up to the quota, each with our marker', async () => {
    const out = await run();
    expect(out.created).toBe(3);
    expect(mockStore.subtasks.map((m) => m.taskId)).toEqual(['task_2', 'task_4', 'task_1']);
    expect(zohoFor('task_2').description).toContain('[SQI:task_2]');
    expect(zohoFor('task_2').name).toMatch(/Profitability – Selling at a loss — Mug 2 \(B00000002\)/);
    expect(out).toMatchObject({ done: 0, total: 3 });
  });

  it('a second run adds nothing; a renewal\'s bigger quota adds the next ones', async () => {
    await run();
    expect((await run()).created).toBe(0);
    const renewed = await run({ quota: 6, monthsPaid: 2 });
    expect(renewed.created).toBe(1); // only task_3 is left open and unmapped
    expect(mockZoho.subtasks).toHaveLength(4);
  });

  it('never mirrors a task already in another of the seller\'s work orders', async () => {
    mockStore.subtasks.push({ _id: 'x', workOrderId: 'wo_trial', userId: 'u1', taskId: 'task_2', identityKey: 'id_2', state: 'open', zohoSubtaskId: 'ZT' });
    await run();
    expect(mockStore.subtasks.filter((m) => m.workOrderId === 'wo1').map((m) => m.taskId)).toEqual(['task_4', 'task_1', 'task_3']);
  });

  it('adopts the subtask a crashed run created (our marker) instead of creating another', async () => {
    mockZoho.subtasks.push({ id: 'Z_OLD', parentTaskId: 'PARENT', name: 'x', description: 'blah [SQI:task_2]', statusIsClosed: false });
    mockStore.subtasks.push({ _id: 'c1', workOrderId: 'wo1', userId: 'u1', taskId: 'task_2', identityKey: 'id_2', state: 'creating', claimedAt: new Date() });
    const out = await run();
    expect(mappingFor('task_2')).toMatchObject({ zohoSubtaskId: 'Z_OLD', state: 'open', adoptedBy: 'marker' });
    expect(out.created).toBe(2);
    expect(mockZoho.subtasks).toHaveLength(3);
  });

  it('adopts a subtask the team made with the same title, or one the AI matches', async () => {
    mockZoho.subtasks.push(
      { id: 'Z_SAME', parentTaskId: 'PARENT', name: 'Profitability – Selling at a loss — Mug 2 (B00000002)', description: '', statusIsClosed: false },
      { id: 'Z_HAND', parentTaskId: 'PARENT', name: 'Fix pricing on the 300 mug', description: '', statusIsClosed: false }
    );
    mockAi.matches = new Map([['task_4', 'Z_HAND']]);
    const out = await run();
    expect(mappingFor('task_2')).toMatchObject({ zohoSubtaskId: 'Z_SAME', adoptedBy: 'title' });
    expect(mappingFor('task_4')).toMatchObject({ zohoSubtaskId: 'Z_HAND', adoptedBy: 'ai' });
    expect(out).toMatchObject({ adopted: 2, created: 1 });
  });

  it('a cancelled (ending) work order is synced but never topped up', async () => {
    expect((await run({ status: 'ending' })).created).toBe(0);
  });
});

describe('status, both ways', () => {
  beforeEach(async () => { await run(); mockZoho.calls.length = 0; });

  it('closed in Zoho -> completed in SellerQI (by the ESF team), and not bounced back', async () => {
    zohoFor('task_2').statusIsClosed = true;
    const out = await run();
    expect(out.completedInSellerQI).toBe(1);
    expect(mockStore.tasks.find((t) => t.taskId === 'task_2')).toMatchObject({ status: 'completed', completedBy: 'esf_team' });
    expect(mappingFor('task_2')).toMatchObject({ state: 'closed', closedBy: 'zoho' });
    const again = await run();
    expect(again.completedInSellerQI + again.closedInZoho + again.reopenedInZoho + again.reopenedInSellerQI).toBe(0);
  });

  it('completed or resolved in SellerQI -> the subtask is closed', async () => {
    mockStore.tasks.find((t) => t.taskId === 'task_2').status = 'completed';
    mockStore.tasks.find((t) => t.taskId === 'task_4').status = 'resolved';
    const out = await run();
    expect(out.closedInZoho).toBe(2);
    expect(zohoFor('task_2').statusIsClosed).toBe(true);
    expect(mappingFor('task_4')).toMatchObject({ state: 'closed', closedBy: 'sellerqi' });
  });

  it('a task that disappeared from SellerQI closes its subtask', async () => {
    mockStore.tasks.splice(mockStore.tasks.findIndex((t) => t.taskId === 'task_1'), 1);
    expect((await run()).closedInZoho).toBe(1);
  });

  it('reopened in Zoho -> pending in SellerQI; reopened in SellerQI -> reopened in Zoho', async () => {
    zohoFor('task_2').statusIsClosed = true;
    await run();
    zohoFor('task_2').statusIsClosed = false;
    const reopened = await run();
    expect(reopened.reopenedInSellerQI).toBe(1);
    expect(mockStore.tasks.find((t) => t.taskId === 'task_2')).toMatchObject({ status: 'pending' });

    mockStore.tasks.find((t) => t.taskId === 'task_4').status = 'completed';
    await run(); // closes Z for task_4
    mockStore.tasks.find((t) => t.taskId === 'task_4').status = 'pending';
    const back = await run();
    expect(back.reopenedInZoho).toBe(1);
    expect(zohoFor('task_4').statusIsClosed).toBe(false);
  });

  it('changed text updates the subtask; a subtask the team deleted is never recreated', async () => {
    mockStore.tasks.find((t) => t.taskId === 'task_2').error = 'Profitability | Selling at a loss: now worse';
    expect((await run()).contentUpdated).toBe(1);
    expect(zohoFor('task_2').description).toContain('now worse');

    const gone = mappingFor('task_4').zohoSubtaskId;
    mockZoho.subtasks.splice(mockZoho.subtasks.findIndex((s) => s.id === gone), 1);
    const out = await run();
    expect(out).toMatchObject({ removed: 1, created: 0 });
    expect(mappingFor('task_4').state).toBe('removed');
  });

  it('the parent shows progress', async () => {
    zohoFor('task_2').statusIsClosed = true;
    const out = await run();
    expect(out).toMatchObject({ done: 1, total: 3 });
    expect(mockZoho.calls).toContainEqual(['update', 'PARENT']);
  });
});

describe('when it stops', () => {
  it('an ended work order is left alone after the grace period', async () => {
    const out = await run({ status: 'ended', endedAt: new Date(Date.now() - 40 * 86400000) });
    expect(out.skipped).toBe('ended');
  });

  it('a work order without its parent yet does nothing', async () => {
    expect((await run({ zohoParentTaskId: null })).skipped).toBe('no parent task yet');
  });
});
