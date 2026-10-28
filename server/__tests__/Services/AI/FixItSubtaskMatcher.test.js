/**
 * Is a SellerQI task already a subtask the team made by hand? A wrong yes would complete the
 * wrong SellerQI task when that subtask closes, so: high confidence only, offered ids only,
 * each subtask at most once, and anything else (no key, an error, junk) means no match.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => function OpenAI() { this.chat = { completions: { create: (...a) => mockCreate(...a) } }; });
const Matcher = require('../../../Services/AI/FixItSubtaskMatcher.js');

const issues = [{ key: 'task_1', title: 'Pricing – Selling at a loss — Blue Mug' }, { key: 'task_2', title: 'A+ content missing — Red Mug' }];
const subtasks = [{ id: 'Z1', name: 'Fix the price of the blue mug' }, { id: 'Z2', name: 'Upload A+ for red mug' }];
const answer = (matches) => ({ choices: [{ message: { content: JSON.stringify({ matches }) } }] });

beforeEach(() => { process.env.OPENAPI_KEY = 'sk-test'; Matcher._reset(); });

it('keeps only high-confidence matches to subtasks we offered, each used once', async () => {
  mockCreate.mockResolvedValue(answer([
    { issue: 'task_1', item: 'Z1', confidence: 'high' },
    { issue: 'task_2', item: 'Z1', confidence: 'high' },   // Z1 already used
    { issue: 'task_2', item: 'Z9', confidence: 'high' },   // not offered
  ]));
  const out = await Matcher.matchSubtasks(issues, subtasks);
  expect([...out]).toEqual([['task_1', 'Z1']]);
});

it('a medium answer is not a match', async () => {
  mockCreate.mockResolvedValue(answer([{ issue: 'task_2', item: 'Z2', confidence: 'medium' }]));
  expect((await Matcher.matchSubtasks(issues, subtasks)).size).toBe(0);
});

it('no key, an error or junk: no match, and nothing asked when there is nothing to compare', async () => {
  mockCreate.mockRejectedValue(new Error('timeout'));
  expect((await Matcher.matchSubtasks(issues, subtasks)).size).toBe(0);
  mockCreate.mockResolvedValue({ choices: [{ message: { content: 'nope' } }] });
  expect((await Matcher.matchSubtasks(issues, subtasks)).size).toBe(0);
  mockCreate.mockClear();
  expect((await Matcher.matchSubtasks(issues, [])).size).toBe(0);
  expect(mockCreate).not.toHaveBeenCalled();
  delete process.env.OPENAPI_KEY; Matcher._reset();
  expect((await Matcher.matchSubtasks(issues, subtasks)).size).toBe(0);
});
