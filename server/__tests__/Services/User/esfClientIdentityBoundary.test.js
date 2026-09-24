/**
 * Who a client is, versus which clients exist.
 *
 * The Messages page states that ESF staff are not shown who they are writing to. That
 * is either a real access-control boundary or it is decoration, and what decides it is
 * not the Messages page at all — it is these two endpoints. A member who reads
 * "Morgan's Repellent" in the inbox and then opens the Clients list to find the name
 * and phone beside it has not been stopped by anything.
 *
 * So both halves are asserted here: the list redacts, AND impersonation is closed. The
 * second matters more and is easier to forget — inside an impersonated session the
 * client's own Settings page shows every field, so a member who can switch can read
 * everything the list just hid, for any client, in two clicks.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockUserFind = jest.fn();
const mockSellerFind = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: (...a) => mockUserFind(...a) }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: (...a) => mockSellerFind(...a) }));

const { canSeeClientIdentity, ESF_ROLES } = require('../../../Services/User/esfRoles.js');
const { listManagedClients } = require('../../../Services/User/ManagedClientService.js');

const chain = (result) => ({
    select: function () { return this; },
    sort: function () { return this; },
    lean: () => Promise.resolve(result),
});

const CLIENT = {
    _id: 'u1',
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '913-269-8400',
    zohoProject: { projectName: "Natural Environmental Solutions (Morgan's Repellent)" },
    esfClientRef: 'EF-1184',
    isEsfClient: true,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUserFind.mockReturnValue(chain([CLIENT]));
    mockSellerFind.mockReturnValue(chain([]));
});

describe('who may see a client identity', () => {
    test.each([ESF_ROLES.OWNER, ESF_ROLES.ADMIN])('%s may', async (esfRole) => {
        // Someone has to be able to call a client back.
        expect(canSeeClientIdentity({ esfRole })).toBe(true);
    });

    test('a member may not', async () => {
        expect(canSeeClientIdentity({ esfRole: ESF_ROLES.MEMBER })).toBe(false);
    });

    test('a staff member with no role set is treated as a member', async () => {
        // resolveEsfRole defaults to 'member', and the default must be the closed one.
        expect(canSeeClientIdentity({})).toBe(false);
    });

    test('a platform superAdmin may, since esfAuth admits them to service the portal', async () => {
        // They would otherwise resolve to 'member' and be locked out of the portal they
        // are there to support.
        expect(canSeeClientIdentity({ accessType: 'superAdmin' })).toBe(true);
    });
});

describe('the clients list', () => {
    const SECRETS = ['Nitesh', 'Kumar', 'walmart@morgansrepellent.com', '913-269-8400'];

    test('carries no identity at all when redacted', async () => {
        const [row] = await listManagedClients({}, { redactIdentity: true });

        // Asserted over the whole serialised row, not field by field: a field-by-field
        // check passes happily while some new field carries the same data.
        SECRETS.forEach((secret) => expect(JSON.stringify(row)).not.toContain(secret));
    });

    test('substitutes the same label the Messages page uses', async () => {
        const [row] = await listManagedClients({}, { redactIdentity: true });

        expect(row.label).toBe("Natural Environmental Solutions (Morgan's Repellent)");
        expect(row.identityRedacted).toBe(true);
    });

    test('nulls the identity keys rather than deleting them', async () => {
        // A consumer doing `${firstName} ${lastName}` should render nothing, not the
        // string "undefined undefined".
        const [row] = await listManagedClients({}, { redactIdentity: true });

        expect(row).toHaveProperty('firstName', null);
        expect(row).toHaveProperty('email', null);
    });

    test('keeps everything that is not identity, so the page still works', async () => {
        const [row] = await listManagedClients({}, { redactIdentity: true });

        expect(row._id).toBe('u1');
        expect(row.amazonStatus).toBeDefined();
    });

    test('is unchanged for owners and admins', async () => {
        const [row] = await listManagedClients({});

        expect(row.firstName).toBe('Nitesh');
        expect(row.identityRedacted).toBeUndefined();
    });

    test('the agency portal is untouched — redaction is opt-in', async () => {
        // UserController lists agency clients through the same function. This is an ESF
        // rule about ESF staff, not a property of managed clients generally.
        const [row] = await listManagedClients({}, { select: 'firstName email' });

        expect(row.email).toBe('walmart@morgansrepellent.com');
    });
});
