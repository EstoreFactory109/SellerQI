/**
 * Connecting a marketplace must not reset the others' daily-run state.
 *
 * updateUserSellerAccounts rebuilt every schedule entry with lastDailyUpdate: null, so adding one
 * marketplace wiped the others' "done today" stamp and attempt counter.
 */

jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/user-auth/UserUpdateScheduleModel.js', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));

const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const UserUpdateSchedule = require('../../../models/user-auth/UserUpdateScheduleModel.js');
const { UserSchedulingService, mergeScheduleAccounts } = require('../../../Services/BackgroundJobs/UserSchedulingService.js');

const today = new Date();
const US_DONE = { _id: 'e1', country: 'US', region: 'NA', lastDailyUpdate: today, dailyAttempts: 2 };

describe('mergeScheduleAccounts', () => {
  it('keeps an existing marketplace exactly as it was', () => {
    const merged = mergeScheduleAccounts([US_DONE], [{ country: 'US', region: 'NA' }, { country: 'UK', region: 'EU' }]);
    expect(merged[0]).toBe(US_DONE);
  });

  it('adds a new marketplace with a fresh entry', () => {
    const merged = mergeScheduleAccounts([US_DONE], [{ country: 'US', region: 'NA' }, { country: 'UK', region: 'EU' }]);
    expect(merged[1]).toEqual({ country: 'UK', region: 'EU', lastDailyUpdate: null });
  });

  it('drops a marketplace that is no longer connected', () => {
    expect(mergeScheduleAccounts([US_DONE], [{ country: 'UK', region: 'EU' }])).toEqual([
      { country: 'UK', region: 'EU', lastDailyUpdate: null },
    ]);
  });

  it('matches on country AND region', () => {
    const merged = mergeScheduleAccounts([US_DONE], [{ country: 'US', region: 'EU' }]);
    expect(merged[0].lastDailyUpdate).toBeNull();
  });

  it('copes with no schedule yet', () => {
    expect(mergeScheduleAccounts(undefined, [{ country: 'US', region: 'NA' }])).toEqual([
      { country: 'US', region: 'NA', lastDailyUpdate: null },
    ]);
  });
});

describe('updateUserSellerAccounts', () => {
  it('writes the merged list, so connecting UK leaves US done for today', async () => {
    Seller.findOne.mockResolvedValue({ sellerAccount: [{ country: 'US', region: 'NA' }, { country: 'UK', region: 'EU' }] });
    UserUpdateSchedule.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ sellerAccounts: [US_DONE] }) }) });
    UserUpdateSchedule.updateOne.mockResolvedValue({});

    await UserSchedulingService.updateUserSellerAccounts('u1');

    const [, update, options] = UserUpdateSchedule.updateOne.mock.calls[0];
    expect(update.$set.sellerAccounts[0]).toMatchObject({ country: 'US', lastDailyUpdate: today, dailyAttempts: 2 });
    expect(update.$set.sellerAccounts[1]).toMatchObject({ country: 'UK', lastDailyUpdate: null });
    expect(options).toEqual({ upsert: true });
  });
});
