/**
 * Which ESF clients a staff member may see.
 *
 * Every mistake available in this module fails OPEN and fails SILENTLY — a dropped
 * filter or an unreadable list shows a restricted member every client, without throwing
 * and without logging. So the empty and absent cases are tested before the populated
 * one, because those are the two that leak.
 */

const {
    seesAllClients, allowedClientIds, scopeClientQuery, canAccessClient, sanitizeClientIds,
} = require('../../../Services/User/esfClientScope.js');

const OWNER = { accessType: 'esfUser', esfRole: 'owner' };
const ADMIN = { accessType: 'esfUser', esfRole: 'admin' };
const MEMBER = (clients) => ({ accessType: 'esfUser', esfRole: 'member', esfAllowedClients: clients });

describe('the two ways this could leak', () => {
    test('a member with an EMPTY allocation gets a query matching nothing', () => {
        /**
         * The single most important assertion here. The tempting "optimisation" — skip
         * the filter when there is nothing to filter by — turns "sees nothing" into
         * "sees everything", and looks like a working feature from the outside.
         */
        const query = scopeClientQuery({ isEsfClient: true }, MEMBER([]));

        expect(query).toEqual({ isEsfClient: true, _id: { $in: [] } });
        expect(query._id.$in).toHaveLength(0);
    });

    test('a member whose allocation was never SELECTED sees nothing, not everything', () => {
        // Exactly what esfAuth produces if the field is left out of its .select(), which
        // is a live trap: the document really has allocations, the object does not.
        expect(allowedClientIds({ accessType: 'esfUser', esfRole: 'member' })).toEqual([]);
        expect(scopeClientQuery({ isEsfClient: true }, { accessType: 'esfUser', esfRole: 'member' }))
            .toEqual({ isEsfClient: true, _id: { $in: [] } });
    });

    test.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'abc'],
        ['an object', {}],
    ])('a malformed allocation (%s) restricts rather than widens', (_label, value) => {
        expect(allowedClientIds(MEMBER(value))).toEqual([]);
        expect(canAccessClient(MEMBER(value), 'c1')).toBe(false);
    });

    test('no staff object at all is not treated as exempt', () => {
        expect(seesAllClients(null)).toBe(false);
        expect(seesAllClients(undefined)).toBe(false);
        expect(canAccessClient(null, 'c1')).toBe(false);
    });
});

describe('who is exempt', () => {
    test.each([
        ['owner', OWNER],
        ['admin', ADMIN],
        ['platform superAdmin', { accessType: 'superAdmin' }],
    ])('%s sees every client and their allocation is never consulted', (_label, staff) => {
        expect(seesAllClients(staff)).toBe(true);
        expect(allowedClientIds(staff)).toBeNull();
        // No _id filter is added at all.
        expect(scopeClientQuery({ isEsfClient: true }, staff)).toEqual({ isEsfClient: true });
        expect(canAccessClient(staff, 'any-client-at-all')).toBe(true);
    });

    test('an exempt role is exempt even with an allocation stored on it', () => {
        // Promoting a member to admin must not leave them stuck with their old list.
        const promoted = { accessType: 'esfUser', esfRole: 'admin', esfAllowedClients: ['c1'] };

        expect(allowedClientIds(promoted)).toBeNull();
        expect(canAccessClient(promoted, 'c2')).toBe(true);
    });
});

describe('a member with an allocation', () => {
    test('is narrowed to exactly their ids', () => {
        expect(scopeClientQuery({ isEsfClient: true }, MEMBER(['c1', 'c2'])))
            .toEqual({ isEsfClient: true, _id: { $in: ['c1', 'c2'] } });
    });

    test('can act on an allocated client and not on any other', () => {
        const staff = MEMBER(['c1', 'c2']);

        expect(canAccessClient(staff, 'c1')).toBe(true);
        expect(canAccessClient(staff, 'c3')).toBe(false);
        expect(canAccessClient(staff, null)).toBe(false);
        expect(canAccessClient(staff, undefined)).toBe(false);
    });

    test('ids compare as strings, so an ObjectId matches its own hex', () => {
        // Mongoose hands back ObjectIds; route params arrive as strings. Comparing them
        // raw with includes() silently never matches.
        const asObjectId = { toString: () => 'c1' };

        expect(canAccessClient(MEMBER([asObjectId]), 'c1')).toBe(true);
        expect(allowedClientIds(MEMBER([asObjectId]))).toEqual(['c1']);
    });

    test('duplicates are collapsed', () => {
        expect(allowedClientIds(MEMBER(['c1', 'c1', 'c2']))).toEqual(['c1', 'c2']);
    });

    test('the caller’s base query is never mutated', () => {
        // Callers pass the shared ESF_CLIENT_QUERY constant. Mutating it would scope
        // every later request in the process to whoever called first.
        const base = { isEsfClient: true };
        scopeClientQuery(base, MEMBER(['c1']));

        expect(base).toEqual({ isEsfClient: true });
    });

    test('other conditions in the base query survive', () => {
        expect(scopeClientQuery({ isEsfClient: true, packageType: 'PRO' }, MEMBER(['c1'])))
            .toEqual({ isEsfClient: true, packageType: 'PRO', _id: { $in: ['c1'] } });
    });
});

describe('sanitizeClientIds — validating on the way in', () => {
    const UserModel = { find: jest.fn() };
    const chain = (rows) => ({ select: () => ({ lean: () => Promise.resolve(rows) }) });
    const OID = '6a9ac3afa1cec42f0bc83988';
    const OID2 = '6a9fba7da17b1bc5b62a68ea';

    beforeEach(() => jest.clearAllMocks());

    test('keeps only ids that are really ESF clients', async () => {
        UserModel.find.mockReturnValue(chain([{ _id: OID }]));

        expect(await sanitizeClientIds([OID, OID2], UserModel)).toEqual([OID]);
        expect(UserModel.find).toHaveBeenCalledWith(
            expect.objectContaining({ isEsfClient: true })
        );
    });

    test('drops ids that are not valid ObjectIds without querying', async () => {
        expect(await sanitizeClientIds(['not-an-id', ''], UserModel)).toEqual([]);
        expect(UserModel.find).not.toHaveBeenCalled();
    });

    test('an empty or malformed input is empty, not everything', async () => {
        for (const input of [[], null, undefined, 'abc']) {
            expect(await sanitizeClientIds(input, UserModel)).toEqual([]);
        }
        expect(UserModel.find).not.toHaveBeenCalled();
    });
});
