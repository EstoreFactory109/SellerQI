/**
 * A Fix it buyer is an ESF client while the team works on their tasks.
 * Pinned: buying makes a normal seller an ESF client (marked as made by Fix it) and always
 * records the history; a seller staff already added is left as they are; when nothing of
 * theirs is running they go back to a normal seller — but only if the purchase made them one.
 */
const mockUsers = new Map();
jest.mock('../../../models/user-auth/userModel.js', () => ({
  updateOne: async (filter, update) => {
    const u = mockUsers.get(filter._id);
    const ok = u && Object.entries(filter).every(([k, v]) => k === '_id' || (v && typeof v === 'object' && '$ne' in v ? u[k] !== v.$ne : u[k] === v));
    if (ok) Object.assign(u, update.$set);
    return { modifiedCount: ok ? 1 : 0 };
  },
}));
const mockRunning = { value: null };
jest.mock('../../../models/system/FixItWorkOrderModel.js', () => ({ exists: async () => mockRunning.value }));
const { enroll, release } = require('../../../Services/Stripe/FixItEsfClient.js');

beforeEach(() => { mockUsers.clear(); mockRunning.value = null; });

it('buying makes a normal seller an ESF client, marked as made by Fix it', async () => {
  mockUsers.set('u1', { isEsfClient: false });
  expect(await enroll('u1')).toBe(true);
  expect(mockUsers.get('u1')).toMatchObject({ isEsfClient: true, esfViaFixIt: true, fixItHistory: true, esfAddedBy: null });
});

it('a seller staff already added stays as they are (never released by Fix it)', async () => {
  mockUsers.set('u2', { isEsfClient: true, esfAddedBy: 'staff1' });
  expect(await enroll('u2')).toBe(false);
  expect(mockUsers.get('u2')).toMatchObject({ isEsfClient: true, esfAddedBy: 'staff1', fixItHistory: true });
  expect(mockUsers.get('u2').esfViaFixIt).toBeUndefined();
  expect(await release('u2')).toBe(false);
  expect(mockUsers.get('u2').isEsfClient).toBe(true);
});

it('when nothing is running, a Fix it-made ESF client goes back to normal and keeps the history', async () => {
  mockUsers.set('u1', { isEsfClient: false });
  await enroll('u1');
  mockRunning.value = { _id: 'wo' };
  expect(await release('u1')).toBe(false); // a subscription is still active
  mockRunning.value = null;
  expect(await release('u1')).toBe(true);
  expect(mockUsers.get('u1')).toMatchObject({ isEsfClient: false, esfViaFixIt: false, fixItHistory: true });
});
