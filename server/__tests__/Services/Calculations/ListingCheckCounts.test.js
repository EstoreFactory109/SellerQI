/**
 * Header error counts must equal the ranking tasks generated from the same data.
 *
 * They disagreed in production for five reasons, each pinned below: a backend
 * keyword Warning counted as an error, duplicate words counted but never became a
 * task (string vs object comparison), bullets' count stuck at 1, description
 * counted per paragraph, and one ASIN with several SKUs counted once per SKU.
 */

jest.mock('../../../models/MCP/TaskModel.js', () => {
    const Task = jest.fn();
    Task.findOne = jest.fn();
    return Task;
});
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({
    OPEN_STATUSES: ['pending', 'in_progress'],
    findByUserId: jest.fn(),
    countByStatus: jest.fn(),
    deleteByUserId: jest.fn(),
    bulkInsertTasks: jest.fn(),
}));

const { getRankings, BackendKeyWordOrAttributesStatus, findDuplicateWords } = require('../../../Services/Calculations/Rankings.js');
const { analyseData } = require('../../../Services/Calculations/DashboardCalculation.js');
const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');

// 220 bytes of distinct words: neither a Warning nor a duplicate.
const goodKeywords = Array.from({ length: 40 }, (_, i) => `kw${String(i).padStart(3, '0')}`).join(' ');

describe('findDuplicateWords', () => {
    it('does not split possessives into a duplicate "s"', () => {
        expect(findDuplicateWords("men's shoes women's boots")).toEqual([]);
    });

    it('ignores stop-words and one-character tokens', () => {
        expect(findDuplicateWords('socks for men and socks for women a b a')).toEqual(['socks']);
        expect(findDuplicateWords('gift for the dad and the mom or the kid with a bow')).toEqual([]);
    });

    it('returns each repeated word once', () => {
        expect(findDuplicateWords('red mug red cup red mug')).toEqual(['red', 'mug']);
    });
});

describe('BackendKeyWordOrAttributesStatus counts', () => {
    it('does not count an under-200-byte Warning as an error', () => {
        const result = BackendKeyWordOrAttributesStatus('short keywords');
        expect(result.charLim.status).toBe('Warning');
        expect(result.NumberOfErrors).toBe(0);
    });

    it('counts duplicates as an error and names them', () => {
        const result = BackendKeyWordOrAttributesStatus('mug mug');
        expect(result.dublicateWords.status).toBe('Error');
        expect(result.dublicateWords.Message).toContain('mug');
        expect(result.NumberOfErrors).toBe(1);
    });
});

describe('dashboard ranking count == ranking tasks', () => {
    const product = (asin, overrides = {}) => ({
        asin,
        product_title: 'Acme Ceramic Coffee Mug, 12 oz, Blue',
        about_product: ['A'.repeat(160)],
        product_description: ['A'.repeat(1800)],
        ...overrides,
    });

    const run = async ({ ranking, backend, active }) => {
        const { dashboardData } = await analyseData({
            Country: 'US',
            TotalProducts: active.map((asin) => ({ asin, status: 'Active' })),
            RankingsData: {
                RankingResultArray: ranking.map((p) => ({ asin: p.asin, data: getRankings(p).finalResult })),
                BackendKeywordResultArray: backend.map(([asin, value]) => ({ asin, data: BackendKeyWordOrAttributesStatus(value) })),
            },
        }, null, { persistTasks: false });
        const tasks = CreateTaskService.generateRankingTasks(dashboardData.rankingProductWiseErrors);
        return { dashboardData, tasks };
    };

    it('counts each failing check once and creates one task for each', async () => {
        const { dashboardData, tasks } = await run({
            active: ['A1', 'A2', 'A3'],
            ranking: [
                // Bullets: short AND a claim (count used to be stuck at 1).
                product('A1', { about_product: ['Short bullet that relieves anxiety', 'Another short one'] }),
                // Description: three short paragraphs and a claim (used to count 4).
                product('A2', { product_description: ['Short one', 'Kills germs', 'Short three'] }),
                product('A3'),
            ],
            backend: [
                ['A1', 'short keywords'],             // Warning only: no error, no task
                ['A2', `${goodKeywords} kw000`],      // duplicate: error and task
                // One ASIN, two SKUs: one clean row and one over the limit.
                ['A3', goodKeywords],
                ['A3', `${goodKeywords} ${goodKeywords}`],
            ],
        });

        expect(tasks.map((t) => `${t.asin}:${t.errorType}`).sort()).toEqual([
            'A1:bulletpoints_char_limit',
            'A1:bulletpoints_restricted_words',
            'A2:backend_keywords_duplicate_words',
            'A2:description_char_limit',
            'A2:description_restricted_words',
            'A3:backend_keywords_char_limit',
            'A3:backend_keywords_duplicate_words',
        ]);
        expect(dashboardData.TotalRankingerrors).toBe(tasks.length);
    });

    it('counts a backend keyword error once in the top-4 products', async () => {
        // productWiseError already includes backend keyword errors; a later
        // block added 1 more to any top-4 slot with one.
        const { dashboardData, tasks } = await run({
            active: ['A1'],
            ranking: [product('A1', { about_product: ['Short bullet'] })],
            backend: [['A1', `${goodKeywords} kw001`]],
        });
        const row = dashboardData.productWiseError.find((p) => p.asin === 'A1');
        expect(tasks).toHaveLength(2);
        expect(row.errors).toBe(2);
        expect(dashboardData.first).toMatchObject({ asin: 'A1', errors: 2 });
    });

    it('labels the duplicate-words task as backend keywords, not title', async () => {
        const { tasks } = await run({
            active: ['A1'],
            ranking: [product('A1')],
            backend: [['A1', `${goodKeywords} kw001`]],
        });
        const task = tasks.find((t) => t.errorType === 'backend_keywords_duplicate_words');
        expect(task.error).toMatch(/^Backend Keywords \| Duplicate Words: .*kw001/);
        expect(task.error).not.toMatch(/Title/);
    });
});
