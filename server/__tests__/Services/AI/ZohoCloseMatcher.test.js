/**
 * Which open SellerQI tasks did a closed Zoho task fix?
 * Pinned: the shortlist needs a real link (ASIN/SKU, product word + kind of problem, or the
 * kind for account-level tasks) — a kind alone never shortlists every product's task; the AI
 * may return several, but only high-confidence answers for ids we offered count.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => function OpenAI() { this.chat = { completions: { create: (...a) => mockCreate(...a) } }; });
const { shortlist, matchClosedTask, _reset } = require('../../../Services/AI/ZohoCloseMatcher.js');

const t = (taskId, productName, asin, errorCategory, errorType, error = 'x') => ({ taskId, productName, asin, errorCategory, errorType, error });
const TASKS = [
  t('a1', 'Blue Ceramic Mug', 'B0BLUEMUG1', 'conversion', 'missing_aplus_content'),
  t('a2', 'Red Ceramic Mug', 'B0REDMUG01', 'conversion', 'missing_aplus_content'),
  t('a3', 'Green Teapot', 'B0GREENTP1', 'conversion', 'missing_aplus_content'),
  t('p1', 'Blue Ceramic Mug', 'B0BLUEMUG1', 'profitability', 'negative_profit'),
  t('o1', 'Account Health', 'ACCOUNT', 'account', 'orderWithDefectsStatus'),
];

beforeEach(() => { process.env.OPENAPI_KEY = 'sk-test'; _reset(); mockCreate.mockReset(); });

describe('shortlist', () => {
  it('A+ for the blue and red mugs: those two, not the teapot, not the mug\'s pricing', () => {
    const ids = shortlist({ name: 'Upload A+ content for Blue mug and Red mug' }, TASKS).map((x) => x.taskId);
    expect(ids).toEqual(expect.arrayContaining(['a1', 'a2']));
    expect(ids).not.toContain('a3');
    expect(ids).not.toContain('o1');
  });

  it('an ASIN in the task or its comments is enough', () => {
    const ids = shortlist({ name: 'Pricing fix', comments: [{ content: 'Done for B0BLUEMUG1' }] }, TASKS).map((x) => x.taskId);
    expect(ids).toContain('p1');
  });

  it('account-level tasks match on the kind of problem', () => {
    expect(shortlist({ name: 'Bring ODR back under 1%' }, TASKS).map((x) => x.taskId)).toEqual(['o1']);
  });

  it('nothing in common: empty', () => {
    expect(shortlist({ name: 'Monthly report call' }, TASKS)).toEqual([]);
  });
});

describe('matchClosedTask', () => {
  const answer = (matches) => ({ choices: [{ message: { content: JSON.stringify({ matches }) } }] });

  it('several matches, high confidence and offered ids only', async () => {
    mockCreate.mockResolvedValue(answer([
      { issue: 'a1', confidence: 'high', reason: 'A+ for blue mug' },
      { issue: 'a2', confidence: 'high', reason: 'A+ for red mug' },
      { issue: 'p1', confidence: 'medium' },
      { issue: 'zz', confidence: 'high' },
    ]));
    const out = await matchClosedTask({ name: 'A+ for blue and red mugs' }, TASKS.slice(0, 4));
    expect(out).toEqual([{ taskId: 'a1', reason: 'A+ for blue mug' }, { taskId: 'a2', reason: 'A+ for red mug' }]);
  });

  it('no candidates, no key, or an error: no match and no call', async () => {
    expect(await matchClosedTask({ name: 'x' }, [])).toEqual([]);
    mockCreate.mockRejectedValue(new Error('down'));
    expect(await matchClosedTask({ name: 'x' }, TASKS)).toEqual([]);
    delete process.env.OPENAPI_KEY; _reset(); mockCreate.mockClear();
    expect(await matchClosedTask({ name: 'x' }, TASKS)).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
