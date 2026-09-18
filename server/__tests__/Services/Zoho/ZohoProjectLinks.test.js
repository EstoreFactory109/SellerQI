/**
 * Tests for connecting an ESF client to an existing Zoho project.
 *
 * The pieces pinned here are the ones that fail quietly rather than loudly:
 * suggestion matching (a bad scorer just shows the wrong six projects), the
 * "already linked to someone else" annotation, and the rule that a project's
 * stored name comes from Zoho rather than from the request body.
 */

jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
    listProjects: jest.fn(),
}));

jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({
    getConnection: jest.fn(),
}));

// Redis is a cache only — force a miss so every test exercises the real path.
jest.mock('../../../config/redisConn.js', () => ({
    connectRedis: jest.fn(),
    getRedisClient: jest.fn(() => { throw new Error('no redis in tests'); }),
}));

jest.mock('../../../models/user-auth/userModel.js', () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
}));

jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: jest.fn(),
}));

const ZohoProjectsService = require('../../../Services/Zoho/ZohoProjectsService.js');
const ZohoAuth = require('../../../Services/Zoho/ZohoAuth.js');
const UserModel = require('../../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../../models/user-auth/sellerCentralModel.js');
const Links = require('../../../Services/Zoho/ZohoProjectLinks.js');

const CLIENT_ID = '6a9ac3afa1cec42f0bc83988';

/** Mirrors real Zoho payloads (see the live shapes in ZohoProjectsService). */
const project = (id, name, extra = {}) => ({
    id, name, status: 'Active', ownerName: 'Henil Modi',
    openTaskCount: 3, taskCount: 5, createdAt: '2026-09-01T00:00:00.000Z', url: null, ...extra,
});

const PROJECTS = [
    project('1', 'Kravox Sports', { createdAt: '2026-09-05T00:00:00.000Z' }),
    project('2', 'Biogenic Health (Bathox Australasia) - Vendor Central - AU', { createdAt: '2026-09-04T00:00:00.000Z' }),
    project('3', 'ESFI3624 - Barbier Robin', { createdAt: '2026-09-03T00:00:00.000Z' }),
    project('4', 'Alpha Omega Derma - 11th June - Graphics', { createdAt: '2026-09-02T00:00:00.000Z' }),
    project('5', 'Nee V - AU', { createdAt: '2026-09-01T00:00:00.000Z' }),
    project('6', 'Best Connections and Deteck USA', { createdAt: '2026-08-31T00:00:00.000Z' }),
    project('7', 'Zenwell Home', { createdAt: '2026-08-30T00:00:00.000Z' }),
];

/** UserModel.findOne(...).select(...).lean() / .exec() style chain. */
const mockClient = (doc) => {
    UserModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) }),
    });
};
const mockLinkedElsewhere = (docs) => {
    UserModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) }),
    });
};
const mockBrand = (brand) => {
    SellerCentralModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(brand ? { brand } : null) }),
    });
};

beforeEach(() => {
    ZohoProjectsService.listProjects.mockResolvedValue(PROJECTS);
    ZohoAuth.getConnection.mockResolvedValue({ portalId: '851273093', portalName: 'estorefactory' });
    mockClient({ _id: CLIENT_ID, firstName: 'Nitesh', lastName: 'Kumar', email: 'nitesh@example.com', zohoProject: null });
    mockLinkedElsewhere([]);
    mockBrand(null);
    UserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('scoreProject', () => {
    const score = (name, needle) => Links.scoreProject({ name }, [{ value: needle, weight: 1 }]);

    test('a brand contained in the project name outranks a mere token overlap', () => {
        const contained = score('Biogenic Health (Bathox Australasia) - Vendor Central - AU', 'Bathox');
        const overlap = score('Health Supplies Direct', 'Bathox Health');
        expect(contained).toBeGreaterThan(overlap);
        expect(overlap).toBeGreaterThan(0);
    });

    test('matches regardless of punctuation and case', () => {
        expect(score('ESFI3624 - Barbier Robin', 'barbier robin')).toBeGreaterThan(0);
        expect(score('Nee V - AU', 'nee-v')).toBeGreaterThan(0);
    });

    test('ignores noise words that would otherwise match half the portal', () => {
        // "Vendor"/"Central"/"Amazon" appear in many project names; matching on
        // them alone would make every suggestion list identical.
        expect(score('Biogenic Health - Vendor Central - AU', 'Vendor Central')).toBe(0);
    });

    test('short fragments do not match', () => {
        expect(score('Kravox Sports', 'au')).toBe(0);
    });
});

describe('getProjectOptions — suggestions', () => {
    test('suggests the project whose name carries the client brand', async () => {
        mockBrand('Kravox');
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID });

        expect(options.matchedByName).toBe(true);
        expect(options.suggestions[0].name).toBe('Kravox Sports');
        expect(options.zohoConnected).toBe(true);
        expect(options.portalName).toBe('estorefactory');
    });

    test('falls back to the newest projects when nothing resembles the client', async () => {
        mockBrand('Completely Unrelated Brand');
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID });

        expect(options.matchedByName).toBe(false);
        // Newest first, so an empty panel is never shown just because the name
        // does not match — a just-created project is the likeliest target.
        expect(options.suggestions[0].name).toBe('Kravox Sports');
        expect(options.suggestions).toHaveLength(6);
    });

    test('marks a project already connected to a different client', async () => {
        mockBrand('Kravox');
        mockLinkedElsewhere([{ firstName: 'Asha', lastName: 'Patel', zohoProject: { projectId: '1' } }]);

        const options = await Links.getProjectOptions({ clientId: CLIENT_ID });
        const kravox = options.suggestions.find((p) => p.id === '1');

        // Surfaced, not blocked — the portal makes the collision visible and
        // lets the operator decide.
        expect(kravox.linkedToClientName).toBe('Asha Patel');
    });

    test('reports the client\'s own current link', async () => {
        mockClient({
            _id: CLIENT_ID, firstName: 'Nitesh', lastName: 'Kumar', email: 'n@example.com',
            zohoProject: { projectId: '2', projectName: 'Biogenic Health' },
        });
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID });
        expect(options.linked.projectId).toBe('2');
    });
});

describe('getProjectOptions — search', () => {
    test('filters by name, case and punctuation insensitively', async () => {
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID, search: 'BIOGENIC' });

        expect(options.searched).toBe(true);
        expect(options.results).toHaveLength(1);
        expect(options.results[0].name).toContain('Biogenic');
        // Suggestions are suppressed while searching so the UI shows one list.
        expect(options.suggestions).toEqual([]);
    });

    test('returns an empty result set rather than falling back to suggestions', async () => {
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID, search: 'zzzznothing' });
        expect(options.results).toEqual([]);
        expect(options.searched).toBe(true);
    });
});

describe('getProjectOptions — Zoho not connected', () => {
    test('returns a renderable "not connected" state instead of throwing', async () => {
        ZohoAuth.getConnection.mockResolvedValue(null);
        const options = await Links.getProjectOptions({ clientId: CLIENT_ID });

        expect(options.zohoConnected).toBe(false);
        expect(options.suggestions).toEqual([]);
        // The picker renders an explainer for this; an exception would show a
        // generic failure instead of a fixable instruction.
        expect(ZohoProjectsService.listProjects).not.toHaveBeenCalled();
    });

    test('a non-ESF client is a 404, not an empty picker', async () => {
        mockClient(null);
        await expect(Links.getProjectOptions({ clientId: CLIENT_ID })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('linkProject', () => {
    test('stores the name resolved from Zoho, not one supplied by the caller', async () => {
        await Links.linkProject({ clientId: CLIENT_ID, projectId: '1', staffUserId: 'staff-1' });

        const { $set } = UserModel.updateOne.mock.calls[0][1];
        expect($set.zohoProject).toMatchObject({
            projectId: '1',
            projectName: 'Kravox Sports',   // from Zoho
            portalId: '851273093',          // from the stored connection
            linkedBy: 'staff-1',
        });
        expect($set.zohoProject.linkedAt).toBeInstanceOf(Date);
    });

    test('re-fetches past the cache before rejecting an unknown id', async () => {
        // A project created in Zoho moments ago is not in the cached list; one
        // stale read must not make it unlinkable.
        ZohoProjectsService.listProjects
            .mockResolvedValueOnce(PROJECTS)
            .mockResolvedValueOnce([...PROJECTS, project('99', 'Brand New Project')]);

        const stored = await Links.linkProject({ clientId: CLIENT_ID, projectId: '99' });

        expect(stored.projectName).toBe('Brand New Project');
        expect(ZohoProjectsService.listProjects).toHaveBeenCalledTimes(2);
    });

    test('rejects an id that does not exist even after a refresh', async () => {
        await expect(Links.linkProject({ clientId: CLIENT_ID, projectId: 'bogus' }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(UserModel.updateOne).not.toHaveBeenCalled();
    });

    test('refuses when Zoho is not connected', async () => {
        ZohoAuth.getConnection.mockResolvedValue(null);
        await expect(Links.linkProject({ clientId: CLIENT_ID, projectId: '1' }))
            .rejects.toMatchObject({ statusCode: 428 });
    });

    test('refuses for an id that is not an ESF client', async () => {
        UserModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
        await expect(Links.linkProject({ clientId: CLIENT_ID, projectId: '1' }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('unlinkProject', () => {
    test('clears every field rather than deleting the path', async () => {
        UserModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ zohoProject: { projectId: '1' } }) });

        await Links.unlinkProject(CLIENT_ID);

        const { $set } = UserModel.updateOne.mock.calls[0][1];
        expect($set).toEqual({
            'zohoProject.projectId': null,
            'zohoProject.projectName': null,
            'zohoProject.portalId': null,
            'zohoProject.linkedAt': null,
            'zohoProject.linkedBy': null,
        });
    });

    test('refuses for an id that is not an ESF client', async () => {
        UserModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
        await expect(Links.unlinkProject(CLIENT_ID)).rejects.toMatchObject({ statusCode: 404 });
    });
});
