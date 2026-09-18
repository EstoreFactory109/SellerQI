/**
 * The nightly tick's control flow.
 *
 * Tasks and billing are independent products that happen to share one tick. The
 * pinned property is that neither can silently stop the other — a client can be
 * invoiced without anyone having linked a Zoho project for them, and an early return
 * for "no projects" once meant their invoices stopped syncing with no error anywhere.
 */

const mockSyncAllProjects = jest.fn();
const mockLinkedProjects = jest.fn();
const mockSyncAllBilling = jest.fn();

jest.mock('../../../Services/Zoho/ZohoTaskSync.js', () => ({
    linkedProjects: mockLinkedProjects,
    syncAllProjects: mockSyncAllProjects,
}));
jest.mock('../../../Services/Zoho/ZohoBillingSync.js', () => ({ syncAllBilling: mockSyncAllBilling }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ start: jest.fn() })) }));

const ORIGINAL = process.env.ZOHO_TASK_SYNC_ENABLED;

const load = (enabled) => {
    process.env.ZOHO_TASK_SYNC_ENABLED = enabled ? 'true' : 'false';
    jest.resetModules();
    return require('../../../Services/BackgroundJobs/zohoTaskSyncStandalone.js');
};

afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ZOHO_TASK_SYNC_ENABLED;
    else process.env.ZOHO_TASK_SYNC_ENABLED = ORIGINAL;
});

beforeEach(() => {
    jest.clearAllMocks();
    mockSyncAllProjects.mockResolvedValue({ projects: 1, tasks: 5 });
    mockSyncAllBilling.mockResolvedValue({ clients: 2, linked: 1, invoices: 3 });
});

describe('runSyncTick', () => {
    test('still syncs billing when no client has a linked project', async () => {
        // The regression: billing sat behind an early return for this case, so a
        // client with invoices but no project link silently stopped updating.
        mockLinkedProjects.mockResolvedValue([]);

        const out = await load(true).runSyncTick();

        expect(mockSyncAllProjects).not.toHaveBeenCalled();
        expect(mockSyncAllBilling).toHaveBeenCalled();
        expect(out.billing.invoices).toBe(3);
    });

    test('syncs both when projects exist', async () => {
        mockLinkedProjects.mockResolvedValue([{ projectId: 'p1' }]);

        const out = await load(true).runSyncTick();

        expect(mockSyncAllProjects).toHaveBeenCalled();
        expect(mockSyncAllBilling).toHaveBeenCalled();
        expect(out.tasks).toBe(5);
    });

    test('a billing failure does not lose a task sync that already succeeded', async () => {
        mockLinkedProjects.mockResolvedValue([{ projectId: 'p1' }]);
        mockSyncAllBilling.mockRejectedValue(new Error('Zoho 500'));

        const out = await load(true).runSyncTick();

        expect(out.tasks).toBe(5);
        expect(out.billing.error).toMatch(/Zoho 500/);
    });

    test('writes nothing at all while disabled', async () => {
        mockLinkedProjects.mockResolvedValue([{ projectId: 'p1' }]);

        const out = await load(false).runSyncTick();

        // Dry run covers billing too: the flag means "write nothing", not
        // "write nothing except invoices".
        expect(out.enabled).toBe(false);
        expect(mockSyncAllProjects).not.toHaveBeenCalled();
        expect(mockSyncAllBilling).not.toHaveBeenCalled();
    });
});
