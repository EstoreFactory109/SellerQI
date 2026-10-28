/**
 * FixItProjectMatcher.js — which existing Zoho project belongs to this client's brand.
 *
 * Used when an ESF client with no linked project buys a Fix it package: if their project
 * already exists in Zoho it is linked to their account, otherwise a new one is created.
 *
 * ── A WRONG MATCH IS WORSE THAN NO MATCH ──
 * Linking the wrong project shows a client another company's work on their Status page and
 * files their paid task under someone else. A missed match only creates a new project the
 * team can merge. So the bias runs the other way from TasklistRouterService: only a HIGH
 * confidence answer counts, and without the model only an exact name match does.
 *
 * Same defences as the other choose-from-candidates services:
 *   1. an id not in the candidate set is a hallucination, not a choice
 *   2. anything short of high confidence is "no match"
 *   3. the real project comes out of OUR map, never the model's echo of it
 *   4. a missing or malformed answer, no key or a dead endpoint fall back to exact name only
 *   5. the bias is stated in the prompt
 * And it never throws.
 */
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');

const MODEL = process.env.FIXIT_PROJECT_MATCH_MODEL || 'gpt-4o-mini';
const MAX_OUTPUT_TOKENS = 150;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey, timeout: 20000, maxRetries: 1 });
    return client;
};

/** "Acme Goods, LLC" and "acme goods llc" are the same name. */
const sameName = (a, b) => {
    const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return Boolean(n(a)) && n(a) === n(b);
};

const exactMatch = (brand, candidates) => candidates.find((p) => sameName(p.name, brand)) || null;

const SYSTEM_PROMPT = [
    'You match an Amazon seller to their project in an agency\'s project management tool.',
    'Each project is usually named after the client\'s brand or company, sometimes with extra words',
    '(for example "Acme Goods - Amazon", "ACME | Seller Central", "Acme Goods US").',
    'Pick a project ONLY if you are sure it is this seller\'s. Similar words are not enough:',
    '"Acme Pets" is not "Acme Goods". Linking the wrong project shows a client another company\'s work,',
    'so when in doubt answer null.',
    'Reply as JSON: {"projectId": "<id from the list>" or null, "confidence": "high"|"medium"|"low", "reason": "<short>"}.',
].join(' ');

const buildPrompt = ({ brand, clientName, email }, candidates) => [
    `Seller brand: ${brand || '(unknown)'}`,
    `Seller name: ${clientName || '(unknown)'}`,
    `Seller email domain: ${String(email || '').split('@')[1] || '(unknown)'}`,
    '',
    'Projects:',
    ...candidates.map((p) => `- id ${p.id}: ${p.name}`),
].join('\n');

/**
 * @param {{ brand: string, clientName?: string, email?: string }} seller
 * @param {Array<{ id: string, name: string }>} candidates  already shortlisted, never linked elsewhere
 * @returns {Promise<{ project: object|null, matchedBy: 'ai'|'exact'|'none', reason?: string }>}
 */
const matchProject = async (seller, candidates = []) => {
    const list = (candidates || []).filter((p) => p && p.id && p.name);
    const none = { project: null, matchedBy: 'none' };
    if (!list.length || !seller?.brand) return none;

    const exact = exactMatch(seller.brand, list);
    const fallback = exact ? { project: exact, matchedBy: 'exact' } : none;

    const ai = getClient();
    if (!ai) return fallback;

    const byId = new Map(list.map((p) => [String(p.id), p]));
    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            temperature: 0,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildPrompt(seller, list) },
            ],
        });
        const parsed = JSON.parse(completion?.choices?.[0]?.message?.content || 'null');
        if (!parsed || typeof parsed !== 'object') return fallback;

        const project = parsed.confidence === 'high' && parsed.projectId != null ? byId.get(String(parsed.projectId)) : null;
        if (project) return { project, matchedBy: 'ai', reason: String(parsed.reason || '').slice(0, 200) };
        // The model said no (or was unsure): an exact name match still stands.
        return fallback;
    } catch (error) {
        logger.warn(`[FixItProjectMatcher] model call failed: ${String(error.message).slice(0, 200)}`);
        return fallback;
    }
};

module.exports = { matchProject, sameName, exactMatch, _reset: () => { client = null; } };
