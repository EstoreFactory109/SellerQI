/**
 * The Status page's read routes: ESF clients, and past Fix it buyers (history), nobody else.
 */
jest.mock('../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
const UserModel = require('../../models/user-auth/userModel.js');
const esfClientOnly = require('../../middlewares/Auth/esfClientOnly.js');

const run = (mw, user) => new Promise((resolve) => {
  UserModel.findById.mockReturnValue({ select: async () => user });
  const res = { status(c) { this.code = c; return this; }, json() { resolve({ code: this.code }); return this; } };
  mw({ userId: 'u1' }, res, () => resolve({ next: true }));
});

it('admits ESF clients and past Fix it buyers to the Status page, but not the other ESF pages', async () => {
  expect(await run(esfClientOnly.orFixItHistory, { isEsfClient: true })).toEqual({ next: true });
  expect(await run(esfClientOnly.orFixItHistory, { isEsfClient: false, fixItHistory: true })).toEqual({ next: true });
  expect(await run(esfClientOnly.orFixItHistory, { isEsfClient: false })).toEqual({ code: 403 });
  expect(await run(esfClientOnly, { isEsfClient: false, fixItHistory: true })).toEqual({ code: 403 });
});
