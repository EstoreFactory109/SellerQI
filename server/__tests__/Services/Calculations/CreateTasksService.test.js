/**
 * Tests for CreateTasksService
 *
 * Covers the read-time rendering refactor: profitability, sponsoredAds, and
 * Buy-Box tasks now store `renderData` (raw numbers) instead of a baked-in
 * `error`/`solution` string, and getUserTasks renders that text on the way out.
 */

// Constructor + static, because the first-ever-task-set path does `new Task({...})`
// and `.save()` rather than going through findOne. The implementation is attached in
// beforeEach, not here — jest.config sets resetMocks, which strips it otherwise.
jest.mock('../../../models/MCP/TaskModel.js', () => {
    const Task = jest.fn();
    Task.findOne = jest.fn();
    return Task;
});
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({
    findByUserId: jest.fn(),
    countByStatus: jest.fn(),
    deleteByUserId: jest.fn(),
    bulkInsertTasks: jest.fn(),
}));

const Task = require('../../../models/MCP/TaskModel.js');
const TaskItem = require('../../../models/MCP/TaskItemModel.js');
const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');

describe('CreateTasksService renderers', () => {
    describe('renderProfitabilityTaskText', () => {
        it('renders negative_profit using sales/netProfit (not the always-undefined revenue/totalCosts fields)', () => {
            const { error, solution } = CreateTaskService.renderProfitabilityTaskText('negative_profit', {
                netProfit: -50,
                sales: 200,
                profitMargin: -25,
            });
            expect(error).toContain('-$50.00');
            expect(error).toContain('Revenue: $200.00');
            expect(error).toContain('Total Costs: $250.00'); // sales - netProfit = 200 - (-50)
            expect(solution).toMatch(/Review and optimize your cost structure/);
        });

        it('renders low_margin with the tailored message (fixes the low_profit_margin typo)', () => {
            const { error, solution } = CreateTaskService.renderProfitabilityTaskText('low_margin', {
                netProfit: 30,
                sales: 1000,
                profitMargin: 3,
            });
            expect(error).toContain('Low Margin');
            expect(error).toContain('3.0%');
            expect(error).toContain('$30.00');
            expect(solution).toMatch(/Improve profit margins/);
        });

        it('falls back to the generic message for an unrecognized errorType', () => {
            const { error } = CreateTaskService.renderProfitabilityTaskText('something_else', { message: 'custom note' });
            expect(error).toBe('Profitability | Issue: custom note');
        });
    });

    describe('renderSponsoredAdsTaskText', () => {
        it('renders high_acos with campaign context', () => {
            const { error } = CreateTaskService.renderSponsoredAdsTaskText('high_acos', {
                acos: 55, spend: 100, sales: 180, campaignName: 'Summer Sale',
            });
            expect(error).toContain('Campaign "Summer Sale"');
            expect(error).toContain('55.0%');
        });

        it('renders wasted_spend_keyword with the keyword name', () => {
            const { error } = CreateTaskService.renderSponsoredAdsTaskText('wasted_spend_keyword', {
                spend: 42, clicks: 10, sales: 0, keyword: 'blue widget',
            });
            expect(error).toContain('"blue widget"');
            expect(error).toContain('$42.00');
        });

        it('renders search_term_zero_sales with the search term', () => {
            const { error, solution } = CreateTaskService.renderSponsoredAdsTaskText('search_term_zero_sales', {
                spend: 10, clicks: 15, searchTerm: 'cheap widget',
            });
            expect(error).toContain('"cheap widget"');
            expect(solution).toContain('"cheap widget"');
        });

        it('renders auto_campaign_migration_needed with search term + campaign name', () => {
            const { error } = CreateTaskService.renderSponsoredAdsTaskText('auto_campaign_migration_needed', {
                sales: 45, searchTerm: 'widget pro', campaignName: 'Auto Campaign 1',
            });
            expect(error).toContain('"widget pro"');
            expect(error).toContain('"Auto Campaign 1"');
        });

        it('renders the real click count (not a hardcoded 0) for a wasted-spend keyword', () => {
            const { error } = CreateTaskService.renderSponsoredAdsTaskText('wasted_spend_keyword', {
                spend: 187.41, clicks: 34, sales: 0, keyword: 'blue widget',
            });
            expect(error).toContain('with 34 clicks');
            expect(error).not.toContain('with 0 clicks');
        });

        it('falls back to ppc_optimization text for an unrecognized errorType', () => {
            const { error } = CreateTaskService.renderSponsoredAdsTaskText('unknown_type', { acos: 20, spend: 5, sales: 25 });
            expect(error).toContain('Optimization Needed');
        });

        // These errorTypes are no longer produced by any code path; 174 legacy docs
        // carry them but all have baked-in text, so the renderer never runs for them.
        // They must degrade to the generic message rather than throw.
        it.each(['extreme_high_acos', 'no_sales_high_spend', 'marginal_profit', 'low_ctr', 'keyword_no_sales'])(
            'degrades retired errorType %s to the generic message without throwing',
            (retired) => {
                const { error, solution } = CreateTaskService.renderSponsoredAdsTaskText(retired, { spend: 10, sales: 0, clicks: 3 });
                expect(error).toContain('Optimization Needed');
                expect(solution).toBeTruthy();
            }
        );
    });

    describe('renderBuyBoxTaskText', () => {
        it('renders the "no ownership" tier at 0%', () => {
            const { error } = CreateTaskService.renderBuyBoxTaskText({ buyBoxPercentage: 0, pageViews: 100, sessions: 40 });
            expect(error).toContain('0% Buy Box ownership');
        });

        // Upstream only ever flags buyBoxPercentage === 0, so any other value
        // falls through to the generic message.
        it('falls back to the source message for any non-zero percentage', () => {
            const { error } = CreateTaskService.renderBuyBoxTaskText({ buyBoxPercentage: 32.4, message: 'Custom buybox note' });
            expect(error).toBe('Custom buybox note');
        });

        it('falls back to a safe default when there is no source message either', () => {
            const { error, solution } = CreateTaskService.renderBuyBoxTaskText({ buyBoxPercentage: 60 });
            expect(error).toContain('not winning the Buy Box');
            expect(solution).toBeTruthy();
        });
    });
});

describe('CreateTasksService generators', () => {
    describe('generateProfitabilityTasks', () => {
        it('stores renderData + amount, and leaves error/solution unset', () => {
            const [task] = CreateTaskService.generateProfitabilityTasks([
                { asin: 'B001', productName: 'Widget', errorType: 'negative_profit', netProfit: -20, sales: 80, profitMargin: -25, amount: 20 },
            ]);
            expect(task.errorType).toBe('negative_profit');
            expect(task.renderData).toEqual({ netProfit: -20, sales: 80, profitMargin: -25, message: undefined });
            expect(task.amount).toBe(20);
            expect(task.error).toBeUndefined();
            expect(task.solution).toBeUndefined();
        });

        it('maps errorType "low_margin" through untouched (the source of the original typo bug)', () => {
            const [task] = CreateTaskService.generateProfitabilityTasks([
                { asin: 'B002', errorType: 'low_margin', netProfit: 5, sales: 500, profitMargin: 1, amount: 45 },
            ]);
            expect(task.errorType).toBe('low_margin');
        });
    });

    describe('generateSponsoredAdsTasks', () => {
        it('stores renderData + amount, and leaves error/solution unset', () => {
            const [task] = CreateTaskService.generateSponsoredAdsTasks([
                { errorType: 'wasted_spend_keyword', keyword: 'blue widget', spend: 42, clicks: 10, sales: 0, amount: 42 },
            ]);
            expect(task.errorType).toBe('wasted_spend_keyword');
            expect(task.renderData.keyword).toBe('blue widget');
            expect(task.amount).toBe(42);
            expect(task.error).toBeUndefined();
            expect(task.solution).toBeUndefined();
        });

        it('normalizes high_acos_campaign to high_acos for the stored errorType', () => {
            const [task] = CreateTaskService.generateSponsoredAdsTasks([
                { errorType: 'high_acos_campaign', campaignName: 'X', spend: 10, sales: 5, amount: 5 },
            ]);
            expect(task.errorType).toBe('high_acos');
        });
    });

    describe('generateConversionTasks (Buy Box)', () => {
        it('stores renderData + amount for the no_buybox task, and leaves error/solution unset', () => {
            const [task] = CreateTaskService.generateConversionTasks([
                {
                    asin: 'B003',
                    Title: 'Widget',
                    productsWithOutBuyboxErrorData: { buyBoxPercentage: 0, pageViews: 100, sessions: 40, amount: 88.5, amountIsEstimated: true },
                },
            ]);
            expect(task.errorType).toBe('no_buybox');
            expect(task.renderData.buyBoxPercentage).toBe(0);
            expect(task.amount).toBe(88.5);
            expect(task.amountIsEstimated).toBe(true);
            expect(task.error).toBeUndefined();
            expect(task.solution).toBeUndefined();
        });

        it('still populates error/solution directly for non-Buy-Box conversion checks (unaffected by this refactor)', () => {
            const [task] = CreateTaskService.generateConversionTasks([
                { asin: 'B004', Title: 'Widget', imageResultErrorData: { Message: 'Too few images', HowToSolve: 'Add more images' } },
            ]);
            expect(task.error).toContain('Too few images');
            expect(task.solution).toBe('Add more images');
            expect(task.renderData).toBeUndefined();
        });
    });

    describe('generateInventoryTasks', () => {
        it('carries LTSF as profit and unfulfillable/stranded as CAPITAL, using pre-computed Message/HowToSolve directly (no renderData)', () => {
            const tasks = CreateTaskService.generateInventoryTasks([
                {
                    asin: 'B005',
                    Title: 'Widget',
                    inventoryPlanningErrorData: {
                        longTermStorageFees: { status: 'Error', Message: 'LTSF msg', HowToSolve: 'LTSF fix', amount: 12.5 },
                        unfulfillable: { status: 'Error', Message: 'Unfulfillable msg', HowToSolve: 'Unfulfillable fix', amount: 0, capitalAmount: 30 },
                    },
                    strandedInventoryErrorData: { Message: 'Stranded msg', HowToSolve: 'Stranded fix', amount: 0, capitalAmount: 60, amountIsEstimated: true },
                },
            ]);

            const ltsfTask = tasks.find(t => t.errorType === 'long_term_storage_fees');
            const unfulfillableTask = tasks.find(t => t.errorType === 'unfulfillable_inventory');
            const strandedTask = tasks.find(t => t.errorType === 'stranded_inventory');

            // LTSF is real fees already charged -> a profit cost.
            expect(ltsfTask.amount).toBe(12.5);
            expect(ltsfTask.error).toContain('LTSF msg');
            expect(ltsfTask.renderData).toBeUndefined();

            // Unsellable stock is capital, never profit — it must not inflate a
            // profit total, so it travels in its own field.
            expect(unfulfillableTask.capitalAmount).toBe(30);
            expect(unfulfillableTask.amount).toBeFalsy();
            expect(strandedTask.capitalAmount).toBe(60);
            expect(strandedTask.amount).toBeFalsy();
            expect(strandedTask.amountIsEstimated).toBe(true);
        });
    });

    describe('generateRankingTasks / generateAccountTasks', () => {
        it('generateRankingTasks still populates error/solution directly (no amount, no renderData - no source amount exists)', () => {
            const [task] = CreateTaskService.generateRankingTasks([
                { asin: 'B006', data: { TotalErrors: 1, TitleResult: { RestictedWords: { status: 'Error', Message: 'bad word', HowTOSolve: 'remove it' } } } },
            ]);
            expect(task.error).toContain('bad word');
            expect(task.amount).toBeUndefined();
            expect(task.renderData).toBeUndefined();
        });
    });
});

describe('CreateTasksService.getUserTasks (read-time rendering)', () => {
    beforeEach(() => {
        Task.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ taskRenewalDate: new Date('2026-01-01') }) });
        TaskItem.countByStatus.mockResolvedValue({ total: 0, pending: 0, completed: 0, in_progress: 0 });
    });

    it('renders error/solution on the fly for a renderData-only task', async () => {
        TaskItem.findByUserId.mockResolvedValue([
            {
                taskId: 't1',
                errorCategory: 'profitability',
                errorType: 'negative_profit',
                renderData: { netProfit: -20, sales: 80, profitMargin: -25 },
                amount: 20,
            },
        ]);

        const { tasks } = await CreateTaskService.getUserTasks('user1');
        expect(tasks[0].error).toContain('Negative Profit');
        expect(tasks[0].error).toContain('-$20.00');
        expect(tasks[0].solution).toBeTruthy();
    });

    it('passes a legacy task (error/solution already baked in, no renderData) through unchanged', async () => {
        TaskItem.findByUserId.mockResolvedValue([
            { taskId: 't2', errorCategory: 'profitability', errorType: 'negative_profit', error: 'Legacy error text', solution: 'Legacy solution text' },
        ]);

        const { tasks } = await CreateTaskService.getUserTasks('user1');
        expect(tasks[0].error).toBe('Legacy error text');
        expect(tasks[0].solution).toBe('Legacy solution text');
    });

    it('does not throw for a task with neither renderData nor baked-in text, and returns a defensive fallback', async () => {
        TaskItem.findByUserId.mockResolvedValue([
            { taskId: 't3', errorCategory: 'inventory', errorType: 'long_term_storage_fees' },
        ]);

        const { tasks } = await CreateTaskService.getUserTasks('user1');
        expect(tasks[0].error).toBeTruthy();
        expect(tasks[0].solution).toBeTruthy();
    });

    it('renders a sponsoredAds renderData task correctly', async () => {
        TaskItem.findByUserId.mockResolvedValue([
            {
                taskId: 't4',
                errorCategory: 'sponsoredAds',
                errorType: 'wasted_spend_keyword',
                renderData: { keyword: 'blue widget', spend: 42, clicks: 10, sales: 0 },
                amount: 42,
            },
        ]);

        const { tasks } = await CreateTaskService.getUserTasks('user1');
        expect(tasks[0].error).toContain('"blue widget"');
    });

    it('renders a Buy-Box renderData task correctly', async () => {
        TaskItem.findByUserId.mockResolvedValue([
            {
                taskId: 't5',
                errorCategory: 'conversion',
                errorType: 'no_buybox',
                renderData: { buyBoxPercentage: 0, pageViews: 100, sessions: 40 },
                amount: 88.5,
            },
        ]);

        const { tasks } = await CreateTaskService.getUserTasks('user1');
        expect(tasks[0].error).toContain('0% Buy Box ownership');
    });
});

/**
 * The `tasksRebuilt` signal.
 *
 * Task renewal is a rolling per-account 7-day timer. Between renewals the unique
 * index rejects re-inserts, so an existing task's amount/type is never rewritten —
 * only brand-new tasks land. The derived AI views (top opportunities, top products)
 * must therefore regenerate on the REBUILD, not on a fixed weekday, or they end up
 * describing tasks that renewal deleted. This flag is how the scheduler knows.
 */
describe('CreateTasksService.createTasksFromErrors — tasksRebuilt signal', () => {
    const errorPayload = {
        userId: 'user1',
        profitabilityErrorDetails: [
            { asin: 'B01', errorType: 'negative_profit', amount: 10, grossProfit: -10, sales: 100 }
        ]
    };

    beforeEach(() => {
        Task.mockImplementation(function (doc) {
            Object.assign(this, doc);
            this.save = jest.fn().mockResolvedValue(this);
        });
        TaskItem.deleteByUserId.mockResolvedValue({ deletedCount: 5 });
        TaskItem.bulkInsertTasks.mockResolvedValue({ insertedCount: 1 });
        TaskItem.countByStatus.mockResolvedValue({ total: 1, pending: 1, completed: 0, in_progress: 0 });
    });

    const daysFromNow = (d) => new Date(Date.now() + d * 24 * 3600 * 1000);

    it('reports true when the renewal boundary is reached (full rebuild)', async () => {
        const doc = { taskRenewalDate: daysFromNow(-1), tasks: [], save: jest.fn() };
        Task.findOne.mockResolvedValue(doc);

        const result = await CreateTaskService.createTasksFromErrors(errorPayload);

        expect(result.tasksRebuilt).toBe(true);
        // Corroborate that it really was a rebuild, not just the flag being set.
        expect(TaskItem.deleteByUserId).toHaveBeenCalledWith('user1');
    });

    it('reports false inside the renewal period (insert-only run)', async () => {
        const doc = { taskRenewalDate: daysFromNow(3), tasks: [], save: jest.fn() };
        Task.findOne.mockResolvedValue(doc);

        const result = await CreateTaskService.createTasksFromErrors(errorPayload);

        // This is the case that must NOT trigger an OpenAI call: nothing the AI
        // views summarise has changed, so regenerating would only burn spend.
        expect(result.tasksRebuilt).toBe(false);
        expect(TaskItem.deleteByUserId).not.toHaveBeenCalled();
    });

    it("reports true for an account's first-ever task set", async () => {
        Task.findOne.mockResolvedValue(null);

        const result = await CreateTaskService.createTasksFromErrors(errorPayload);

        expect(result.tasksRebuilt).toBe(true);
    });
});
