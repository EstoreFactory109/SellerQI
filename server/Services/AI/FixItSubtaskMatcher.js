/**
 * FixItSubtaskMatcher.js — is a SellerQI task already a Zoho subtask the team made by hand?
 *
 * Before the Fix it sync adds a SellerQI task as a subtask, it adopts an existing subtask
 * that is clearly the same work: first by our marker or an exact title (FixItZohoSync),
 * then — for subtasks the team typed themselves ("Fix A+ for the blue mug") — by asking the
 * model. Adopting the wrong subtask would mark the wrong SellerQI task done when it closes,
 * so the bias is against matching:
 *   1. only subtask ids we offered count, and each is used at most once
 *   2. only a "high" confidence answer counts
 *   3. the result comes out of OUR maps, never the model's echo
 *   4. no key, a dead endpoint or a malformed answer means "no match" (the sync then
 *      creates the subtask — a duplicate the team can merge beats a wrong completion)
 * Never throws.
 */
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');

const MODEL = process.env.FIXIT_SUBTASK_MATCH_MODEL || 'gpt-4o-mini';
const MAX_CANDIDATES = 40;
const MAX_SUBTASKS = 80;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey, timeout: 20000, maxRetries: 1 });
    return client;
};

const SYSTEM_PROMPT = [
    'An Amazon seller has a list of issues to fix (from SellerQI). Their agency also has task items in its project tool.',
    'For each SellerQI issue, say which agency task item is the SAME piece of work, if any.',
    'Only match when it is clearly the same fix on the same product or the same account setting; a similar kind of fix on another product is NOT a match.',
    'When unsure, answer null. Each agency item can match at most one issue.',
    'Reply as JSON: {"matches":[{"issue":"<issue key>","item":"<item id>" or null,"confidence":"high"|"medium"|"low"}]}.',
].join(' ');

/**
 * @param {Array<{ key: string, title: string, detail?: string }>} issues  SellerQI tasks about to be added
 * @param {Array<{ id: string, name: string }>} subtasks  unmapped existing subtasks of the parent
 * @returns {Promise<Map<string, string>>} issue key -> subtask id, high confidence only
 */
const matchSubtasks = async (issues = [], subtasks = []) => {
    const result = new Map();
    const offeredIssues = (issues || []).filter((i) => i?.key && i?.title).slice(0, MAX_CANDIDATES);
    const offeredItems = (subtasks || []).filter((s) => s?.id && s?.name).slice(0, MAX_SUBTASKS);
    if (!offeredIssues.length || !offeredItems.length) return result;
    const ai = getClient();
    if (!ai) return result;

    const issueKeys = new Set(offeredIssues.map((i) => String(i.key)));
    const itemIds = new Set(offeredItems.map((s) => String(s.id)));
    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            temperature: 0,
            max_tokens: 800,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        'SellerQI issues:',
                        ...offeredIssues.map((i) => `- ${i.key}: ${i.title}${i.detail ? ` — ${String(i.detail).slice(0, 160)}` : ''}`),
                        '',
                        'Agency task items:',
                        ...offeredItems.map((s) => `- ${s.id}: ${s.name}`),
                    ].join('\n'),
                },
            ],
        });
        const parsed = JSON.parse(completion?.choices?.[0]?.message?.content || 'null');
        const used = new Set();
        for (const m of Array.isArray(parsed?.matches) ? parsed.matches : []) {
            const issue = String(m?.issue ?? '');
            const item = m?.item == null ? '' : String(m.item);
            if (m?.confidence !== 'high' || !issueKeys.has(issue) || !itemIds.has(item) || used.has(item) || result.has(issue)) continue;
            used.add(item);
            result.set(issue, item);
        }
    } catch (error) {
        logger.warn(`[FixItSubtaskMatcher] model call failed: ${String(error.message).slice(0, 200)}`);
    }
    return result;
};

module.exports = { matchSubtasks, _reset: () => { client = null; } };
