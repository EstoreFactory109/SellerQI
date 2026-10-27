/**
 * Which existing Zoho project is this brand's. A wrong link shows a client another company's
 * work, so: only a HIGH-confidence answer from the model counts, an id we did not offer is
 * ignored, and without the model (no key, an error, a malformed answer) only an exact name does.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => function OpenAI() { this.chat = { completions: { create: (...a) => mockCreate(...a) } }; });

const Matcher = require('../../../Services/AI/FixItProjectMatcher.js');

const CANDIDATES = [
  { id: '100', name: 'ACME | Seller Central US' },
  { id: '300', name: 'Acme Pets' },
];
const seller = { brand: 'Acme Goods', clientName: 'Ann Lee', email: 'ann@acmegoods.com' };
const answer = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

beforeEach(() => {
  process.env.OPENAPI_KEY = 'sk-test';
  Matcher._reset();
});

it('links on a high-confidence answer, returning our project, not the model\'s echo', async () => {
  mockCreate.mockResolvedValue(answer({ projectId: '100', confidence: 'high', reason: 'ACME is the brand' }));
  const out = await Matcher.matchProject(seller, CANDIDATES);
  expect(out).toMatchObject({ project: CANDIDATES[0], matchedBy: 'ai' });
  const prompt = mockCreate.mock.calls[0][0].messages[1].content;
  expect(prompt).toContain('Seller brand: Acme Goods');
  expect(prompt).toContain('id 300: Acme Pets');
  expect(prompt).not.toContain('ann@'); // only the domain goes to the model
});

it('a medium or low answer is not a match', async () => {
  mockCreate.mockResolvedValue(answer({ projectId: '300', confidence: 'medium' }));
  expect((await Matcher.matchProject(seller, CANDIDATES)).project).toBeNull();
});

it('an id that was not offered is ignored', async () => {
  mockCreate.mockResolvedValue(answer({ projectId: '999', confidence: 'high' }));
  expect((await Matcher.matchProject(seller, CANDIDATES)).project).toBeNull();
});

it('without the model, only an exact name counts', async () => {
  const exact = [...CANDIDATES, { id: '400', name: 'Acme-Goods' }];
  mockCreate.mockRejectedValue(new Error('timeout'));
  expect(await Matcher.matchProject(seller, exact)).toMatchObject({ project: { id: '400' }, matchedBy: 'exact' });
  expect((await Matcher.matchProject(seller, CANDIDATES)).project).toBeNull();

  delete process.env.OPENAPI_KEY;
  Matcher._reset();
  expect(await Matcher.matchProject(seller, exact)).toMatchObject({ project: { id: '400' }, matchedBy: 'exact' });
});

it('a malformed answer falls back to the exact name', async () => {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
  expect((await Matcher.matchProject(seller, CANDIDATES)).project).toBeNull();
});

it('nothing to choose from, or no brand: no call at all', async () => {
  expect((await Matcher.matchProject(seller, [])).project).toBeNull();
  expect((await Matcher.matchProject({ brand: '' }, CANDIDATES)).project).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
});
