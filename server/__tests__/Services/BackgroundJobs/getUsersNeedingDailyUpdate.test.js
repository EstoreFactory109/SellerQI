/**
 * Data-safety test for P4: pushing the daily-user eligibility filter into MongoDB.
 *
 * The refactor replaced `UserUpdateSchedule.find(...).populate('userId')` + a JS
 * `.filter()` (PRO/verified/agency) with a DB-side `User.find({eligible})` → `$in`
 * schedule query. This test drives the REAL getUsersNeedingDailyUpdate against mocked
 * models (with a small query matcher) and asserts it selects EXACTLY the same set of
 * users the old logic would — i.e. the daily pipeline still fetches data for the same
 * accounts (no silent inclusion of LITE/unverified users, no dropped eligible users).
 */

jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/UserUpdateScheduleModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({})); // required at module load, unused here

const User = require('../../../models/user-auth/userModel.js');
const UserUpdateSchedule = require('../../../models/user-auth/UserUpdateScheduleModel.js');
const { UserSchedulingService } = require('../../../Services/BackgroundJobs/UserSchedulingService.js');

// Minimal MongoDB-query matcher supporting exactly the operators the query uses:
// plain equality, $or, $in, $lte, $lt.
function valueMatches(fieldVal, cond) {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('$in' in cond) return cond.$in.some((v) => String(v) === String(fieldVal));
        if ('$lte' in cond) return fieldVal <= cond.$lte;
        if ('$lt' in cond) return fieldVal != null && fieldVal < cond.$lt;
        return false;
    }
    return fieldVal === cond; // handles primitives and null (e.g. lastDailyUpdate: null)
}

function matches(doc, query) {
    return Object.entries(query).every(([key, cond]) => {
        if (key === '$or') return cond.some((sub) => matches(doc, sub));
        return valueMatches(doc[key], cond);
    });
}

function makeFind(fixtures) {
    // find(query, projection?) -> { lean: async () => matchedDocs }
    return jest.fn((query = {}) => ({
        lean: async () => fixtures.filter((d) => matches(d, query)),
    }));
}

// Oracle: the ORIGINAL selection logic, computed independently in the test.
function expectedSelection(users, schedules, currentHour, startOfToday) {
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return schedules
        .filter((s) => {
            const u = byId.get(String(s.userId));
            const dueHour = s.dailyUpdateHour <= currentHour;
            const notDoneToday = s.lastDailyUpdate === null || s.lastDailyUpdate < startOfToday;
            const eligible = !!u && u.isVerified === true && (u.packageType === 'PRO' || u.isAgencyClient === true);
            return dueHour && notDoneToday && eligible;
        })
        .map((s) => String(s.userId))
        .sort();
}

describe('getUsersNeedingDailyUpdate — DB-side filter selects the same users as the old JS filter', () => {
    // Freeze time so currentHour / startOfToday are deterministic.
    const FIXED_MS = Date.UTC(2026, 0, 15, 12, 0, 0); // 12:00 UTC on 2026-01-15 (ms since epoch)
    const startOfToday = new Date(Date.UTC(2026, 0, 15, 0, 0, 0, 0));
    const yesterday = new Date(Date.UTC(2026, 0, 14, 9, 0, 0));
    const todayEarlier = new Date(Date.UTC(2026, 0, 15, 6, 0, 0));

    const users = [
        { _id: 'u1', isVerified: true, packageType: 'PRO', isAgencyClient: false }, // eligible
        { _id: 'u2', isVerified: true, packageType: 'LITE', isAgencyClient: false }, // NOT eligible (LITE)
        { _id: 'u3', isVerified: true, packageType: 'LITE', isAgencyClient: true }, // eligible (agency)
        { _id: 'u4', isVerified: false, packageType: 'PRO', isAgencyClient: false }, // NOT eligible (unverified)
        { _id: 'u5', isVerified: true, packageType: 'PRO', isAgencyClient: false }, // eligible (but not due)
        { _id: 'u6', isVerified: true, packageType: 'PRO', isAgencyClient: false }, // eligible (but done today)
    ];

    const schedules = [
        { userId: 'u1', dailyUpdateHour: 10, lastDailyUpdate: null },          // due + eligible  -> SELECT
        { userId: 'u2', dailyUpdateHour: 8, lastDailyUpdate: null },           // due, LITE       -> exclude
        { userId: 'u3', dailyUpdateHour: 12, lastDailyUpdate: yesterday },     // due + agency    -> SELECT
        { userId: 'u4', dailyUpdateHour: 5, lastDailyUpdate: null },           // due, unverified -> exclude
        { userId: 'u5', dailyUpdateHour: 15, lastDailyUpdate: null },          // eligible, NOT due (hour>12) -> exclude
        { userId: 'u6', dailyUpdateHour: 9, lastDailyUpdate: todayEarlier },   // eligible, done today        -> exclude
    ];

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(FIXED_MS);
        // resetMocks:true wipes implementations each test, so (re)install here.
        User.find.mockImplementation(makeFind(users));
        UserUpdateSchedule.find.mockImplementation(makeFind(schedules));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('returns exactly the eligible + due users (u1, u3)', async () => {
        const result = await UserSchedulingService.getUsersNeedingDailyUpdate();
        const got = result.map((s) => String(s.userId)).sort();
        expect(got).toEqual(['u1', 'u3']);
    });

    it('matches the original populate+JS-filter oracle', async () => {
        const result = await UserSchedulingService.getUsersNeedingDailyUpdate();
        const got = result.map((s) => String(s.userId)).sort();
        expect(got).toEqual(expectedSelection(users, schedules, 12, startOfToday));
    });

    it('queries User with the eligibility predicate (verified + PRO/agency)', async () => {
        await UserSchedulingService.getUsersNeedingDailyUpdate();
        const [query] = User.find.mock.calls[0];
        expect(query).toEqual({
            isVerified: true,
            $or: [{ packageType: 'PRO' }, { isAgencyClient: true }],
        });
    });

    it('returns [] (processes nobody) when no users are eligible', async () => {
        User.find.mockImplementation(makeFind([])); // no eligible users
        const result = await UserSchedulingService.getUsersNeedingDailyUpdate();
        expect(result).toEqual([]);
        // Must NOT fall back to querying/returning all schedules.
        expect(UserUpdateSchedule.find).not.toHaveBeenCalled();
    });

    it('never selects a schedule for an ineligible user even if its schedule row is due', async () => {
        const result = await UserSchedulingService.getUsersNeedingDailyUpdate();
        const got = result.map((s) => String(s.userId));
        expect(got).not.toContain('u2'); // LITE
        expect(got).not.toContain('u4'); // unverified
    });
});
