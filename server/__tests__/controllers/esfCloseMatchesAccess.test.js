/**
 * The ESF portal's "Auto-closed tasks" review: owner, admins and super admins only, with the
 * clients' names, the matches, and the trial-run / applied / re-opened state.
 */
jest.mock('../../models/system/ZohoCloseMatchModel.js', () => ({
  find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [
    { _id: 'r1', userId: 'u1', zohoTaskName: 'A+ for blue mug', closedAt: new Date('2026-10-28'), mode: 'on', appliedAt: new Date(), considered: 3,
      matches: [{ taskId: 't1', taskTitle: 'A+ missing — Blue mug', reason: 'same product' }], undoneTaskIds: ['t1'] },
  ] }) }) }),
}));
jest.mock('../../models/user-auth/userModel.js', () => ({ find: () => ({ select: () => ({ lean: async () => [{ _id: 'u1', firstName: 'Ann', lastName: 'Lee', zohoProject: { projectName: 'Acme' } }] }) }) }));
jest.mock('../../Services/Zoho/ZohoCloseSync.js', () => ({ modeOf: () => 'on' }));
const { getCloseMatches } = require('../../controllers/esf/esfCloseMatches.js');

const run = (esfUser) => new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); return this; } };
  getCloseMatches({ esfUser }, res, () => {});
});

it('members are refused', async () => {
  expect((await run({ accessType: 'esfUser', esfRole: 'member' })).code).toBe(403);
});

it('owners see each close, its matches and what clients re-opened', async () => {
  const { code, body } = await run({ accessType: 'esfUser', esfRole: 'owner' });
  expect(code).toBe(200);
  expect(body.data.mode).toBe('on');
  expect(body.data.items[0]).toMatchObject({ client: { name: 'Ann Lee', projectName: 'Acme' }, applied: true, matches: [{ taskId: 't1', undone: true }] });
  expect(body.data.stats).toEqual({ closedTasks: 1, withMatches: 1, matched: 1, undone: 1 });
});
