/**
 * TasklistRouterService.js — which Zoho tasklist an approved request belongs in.
 *
 * Accepting a client's task request creates a real task in the agency's Zoho project.
 * Until this existed it was created unfiled, so every approved request landed in the
 * project's default while the team actually works out of named lists — "Seller Central
 * Task", "Walmart", "Graphics", "PPC Task". Work filed nowhere is work nobody picks up.
 *
 * This picks one of those, and says when none of them fit so the caller can make a new
 * one.
 *
 * ── IT PREFERS AN EXISTING LIST, DELIBERATELY ──
 * The asymmetry matters: choosing the slightly-wrong list is a task someone drags across
 * in five seconds, while creating a list is permanent, shared, and nothing here ever
 * deletes one. A model that invents "Product Video Requests" for one request and
 * "Video Content" for the next has quietly made the project worse in a way no single
 * accept looks responsible for. So the prompt is biased toward matching, a low-confidence
 * answer is demoted rather than acted on, and the caller re-checks any proposed name
 * against the real ones before creating anything.
 *
 * ── THE MODEL'S ANSWER IS NEVER TRUSTED DIRECTLY ──
 * The five defences from ZohoOpportunityMatchService, which is this repo's other
 * choose-from-candidates service and the reason that one can be relied on:
 *
 *   1. an id not in the candidate set is a hallucination, not a choice
 *   2. low confidence is demoted to "no match"
 *   3. the real tasklist is carried out of OUR map, never the model's echo of it
 *   4. a missing or malformed answer backfills to the safe value
 *   5. the bias is stated in the prompt, not just hoped for
 *
 * ── AND IT NEVER THROWS ──
 * No key, no candidates, a dead endpoint, unparseable JSON — all land on
 * `chosenBy: 'none'`, and the caller creates the task unfiled exactly as it did before.
 * Filing is a nicety; approving the work is not.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const { leaksContact } = require('./TaskBriefService.js');

const MODEL = process.env.TASKLIST_ROUTER_MODEL || 'gpt-4o-mini';

/** Bump when the prompt changes, so a stored choice can be told from a current one. */
const ROUTER_VERSION = 1;

const MAX_INPUT_CHARS = 1500;
const MAX_OUTPUT_TOKENS = 200;
const MAX_TASKLISTS_IN_PROMPT = 40;

/** A tasklist name longer than this is a sentence, not a label. */
const MAX_NAME_CHARS = 60;
const MIN_NAME_CHARS = 3;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/** Shared with ZohoOpportunityMatchService in spirit — same stoplist, same thresholds. */
const NOISE_WORDS = new Set([
    'the', 'and', 'for', 'with', 'your', 'from', 'that', 'this', 'are', 'not',
    'phase', 'task', 'tasks', 'new', 'update', 'updates', 'fix', 'fixes', 'review',
    'client', 'amazon', 'listing', 'listings', 'product', 'products', 'please',
]);

const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const meaningfulTokens = (value) => normalise(value).split(' ').filter((t) => t.length > 3 && !NOISE_WORDS.has(t));

/**
 * Deterministic fallback: token overlap against the tasklist NAMES.
 *
 * Strict on purpose. A tasklist name is one or two words, so a loose rule would file
 * everything mentioning "content" into "Graphics". Returning nothing is the safe
 * direction — the caller creates the task unfiled, which is where it used to go anyway.
 */
const deterministicRoute = (text, tasklists) => {
    const wanted = new Set(meaningfulTokens(text));
    if (wanted.size === 0) return null;

    let best = null;
    for (const list of tasklists) {
        const tokens = meaningfulTokens(list.name);
        if (!tokens.length) continue;
        const shared = tokens.filter((token) => wanted.has(token));
        // Every distinctive word in the list's own name must appear in the request.
        // "Walmart" matches "Walmart listing fix"; "Seller Central Task" does not match
        // on "central" alone.
        const ratio = shared.length / tokens.length;
        if (shared.length >= 1 && ratio >= 1 && (!best || tokens.length > best.weight)) {
            best = { list, weight: tokens.length };
        }
    }
    return best ? best.list : null;
};

/** A name we are willing to create a permanent, shared tasklist under. */
const isUsableName = (name, bundle) => {
    const text = String(name || '').trim();
    if (text.length < MIN_NAME_CHARS || text.length > MAX_NAME_CHARS) return false;
    // Must read as a label. A name with a full stop in it is a sentence the model wrote.
    if (/[.!?]/.test(text)) return false;
    /**
     * And it must not name the client. A tasklist is a permanent label in a shared
     * workspace that other clients' work also lives in — "Nitesh's video request" would
     * outlive the request that made it. leaksContact rather than containsIdentity so a
     * product URL does not veto an otherwise fine name.
     */
    if (bundle && leaksContact(text, bundle)) return false;
    return true;
};

const SYSTEM_PROMPT = [
    'You file an approved piece of client work into one of an agency\'s existing Zoho tasklists.',
    '',
    'Strongly prefer an existing list. Choosing a slightly imperfect list is cheap to correct;',
    'creating a new one is permanent and clutters the project. Only say none fits when the work',
    'is genuinely unlike everything on the list.',
    '',
    'Rules:',
    '1. tasklistId must be one of the ids given, copied exactly, or null.',
    '2. confidence is "high", "medium" or "low". Use "low" if you are guessing.',
    '3. newTasklistName is only for when tasklistId is null. Give a short generic category',
    '   of 1-3 words, e.g. "Video Production". Never name a person, a company or a brand.',
    '4. If you pick a list, newTasklistName must be null.',
    '',
    'Answer with JSON only: {"tasklistId": "<id>|null", "confidence": "high"|"medium"|"low", "newTasklistName": "<name>|null"}',
].join('\n');

const buildPrompt = (text, tasklists) => {
    const lists = tasklists.slice(0, MAX_TASKLISTS_IN_PROMPT)
        .map((l) => `- id: ${l.id} | ${l.name}`)
        .join('\n');
    return `EXISTING TASKLISTS:\n${lists}\n\nTHE WORK TO FILE:\n${text.slice(0, MAX_INPUT_CHARS)}`;
};

/**
 * @param {object} args
 * @param {string} args.title        the task's title
 * @param {string} [args.description]
 * @param {Array<{id:string,name:string}>} args.tasklists  the project's real tasklists
 * @param {object} [args.bundle]     identity bundle, to veto a name that leaks it
 * @returns {{tasklistId:string|null, tasklistName:string|null,
 *            newTasklistName:string|null, chosenBy:'ai'|'tokens'|'none', version:number}}
 */
const route = async ({ title, description = '', tasklists = [], bundle = null } = {}) => {
    const none = {
        tasklistId: null, tasklistName: null, newTasklistName: null,
        chosenBy: 'none', version: ROUTER_VERSION,
    };

    const candidates = (tasklists || []).filter((l) => l && l.id && l.name);
    const text = `${title || ''}\n${description || ''}`.trim();
    if (!candidates.length || !text) return none;

    // Defence 3: the real object is only ever taken out of this map.
    const byId = new Map(candidates.map((l) => [String(l.id), l]));

    const ai = getClient();
    if (!ai) {
        const picked = deterministicRoute(text, candidates);
        return picked
            ? { ...none, tasklistId: picked.id, tasklistName: picked.name, chosenBy: 'tokens' }
            : none;
    }

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            // A choice, not composition. Same setting as the other extractors.
            temperature: 0.1,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildPrompt(text, candidates) },
            ],
        });

        const parsed = JSON.parse(completion?.choices?.[0]?.message?.content || 'null');
        if (!parsed || typeof parsed !== 'object') return none;

        // Defence 2: a guess is not an answer.
        const confident = parsed.confidence === 'high' || parsed.confidence === 'medium';
        // Defence 1: an id we did not offer is a hallucination, not a choice.
        const match = confident ? byId.get(String(parsed.tasklistId)) : null;

        if (match) {
            return { ...none, tasklistId: match.id, tasklistName: match.name, chosenBy: 'ai' };
        }

        // Nothing fitted. A proposed name is a suggestion to the caller, not a decision —
        // the caller still re-checks it against the real names before creating anything.
        const proposed = typeof parsed.newTasklistName === 'string' ? parsed.newTasklistName.trim() : '';
        if (proposed && isUsableName(proposed, bundle)) {
            return { ...none, newTasklistName: proposed, chosenBy: 'ai' };
        }

        if (proposed) {
            logger.warn(`[TasklistRouter] rejected a proposed tasklist name (${proposed.length} chars)`);
        }

        // Defence 4: fall back rather than act on a malformed answer.
        const picked = deterministicRoute(text, candidates);
        return picked
            ? { ...none, tasklistId: picked.id, tasklistName: picked.name, chosenBy: 'tokens' }
            : none;
    } catch (error) {
        // The message only — the OpenAI SDK puts the request body into its error on a 4xx
        // and Logger.js writes unrotated to logs.txt.
        logger.warn(`[TasklistRouter] model call failed: ${error.message?.slice(0, 200)}`);
        const picked = deterministicRoute(text, candidates);
        return picked
            ? { ...none, tasklistId: picked.id, tasklistName: picked.name, chosenBy: 'tokens' }
            : none;
    }
};

module.exports = {
    route,
    deterministicRoute,
    isUsableName,
    ROUTER_VERSION,
    MAX_NAME_CHARS,
};
