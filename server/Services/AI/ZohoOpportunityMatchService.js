/**
 * ZohoOpportunityMatchService.js
 *
 * Decides which of the Dashboard's "Top things to fix" the ESF team is NOT already
 * working on, so only those reach the client's "Coming up" list.
 *
 * Why this needs a model at all: the two sides describe the same work in completely
 * different vocabularies. The Dashboard says "12 listings are missing bullet points —
 * $1,840 recoverable"; the Zoho task is called "Content Phase 1 — Morgan's". No
 * keyword rule connects those, and getting it wrong is visible to the client in both
 * directions — a duplicate makes the team look disorganised, a wrong match hides a
 * real problem they are paying to have found.
 *
 * Bias: when in doubt, DO NOT mark it covered. A duplicate in Coming up is a minor
 * annoyance the account manager can explain. Silently swallowing the biggest issue on
 * the account because a task name looked vaguely similar is the failure that matters.
 *
 * Follows the same rules as ZohoTaskSummaryService: one call per project, never on
 * page load, always a deterministic fallback, and an unchanged pairing is never
 * re-matched.
 */

const crypto = require('crypto');
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');

const MODEL = 'gpt-4o-mini';
// Bump when the prompt changes, so stored matches made by an older prompt are redone
// rather than served forever on an unchanged hash.
const PROMPT_VERSION = 1;

const MAX_TASKS_IN_PROMPT = 60;
const MAX_OPPORTUNITIES_IN_PROMPT = 12;
const MAX_TASK_NAME_CHARS = 120;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/** Stable across reordering: the same set of opportunities and tasks hashes the same. */
const hashInputs = (opportunities, tasks) => {
    const left = (opportunities || []).map((o) => `${o.candidateId}|${o.title}`).sort();
    const right = (tasks || []).map((t) => `${t.taskId}|${t.name}`).sort();
    return crypto.createHash('sha1').update(JSON.stringify({ left, right })).digest('hex');
};

const NOISE_WORDS = new Set([
    'the', 'and', 'for', 'with', 'your', 'from', 'that', 'this', 'are', 'not',
    'phase', 'task', 'new', 'update', 'updates', 'fix', 'fixes', 'review', 'client',
    'amazon', 'listing', 'listings', 'product', 'products',
]);

const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const meaningfulTokens = (value) => normalise(value).split(' ').filter((t) => t.length > 3 && !NOISE_WORDS.has(t));

/**
 * Deterministic fallback used when there is no API key or the call fails.
 *
 * Intentionally strict — it requires several distinctive words in common, because a
 * loose word-overlap rule is exactly how "Inventory restock" would swallow "Inventory
 * is unfulfillable". Most runs of this return nothing covered, which is the safe
 * direction: the client sees a duplicate rather than losing a real issue.
 */
const deterministicMatch = (opportunities, tasks) => (opportunities || []).map((opportunity) => {
    const wanted = new Set(meaningfulTokens(`${opportunity.title} ${opportunity.action || ''}`));
    if (wanted.size === 0) {
        return { candidateId: opportunity.candidateId, covered: false, matchedBy: 'tokens' };
    }

    for (const task of tasks || []) {
        const taskTokens = meaningfulTokens(task.name);
        const shared = taskTokens.filter((token) => wanted.has(token));

        // Two distinctive words, and they must be a real share of the task's own name
        // rather than one generic word inside a long title.
        if (shared.length >= 2 && shared.length / Math.max(taskTokens.length, 1) >= 0.4) {
            return {
                candidateId: opportunity.candidateId,
                covered: true,
                coveredByTaskId: task.taskId,
                coveredByTaskName: task.name,
                matchedBy: 'tokens',
            };
        }
    }

    return { candidateId: opportunity.candidateId, covered: false, matchedBy: 'tokens' };
});

const SYSTEM_PROMPT = [
    'You decide whether an agency is ALREADY working on a problem found on a seller\'s Amazon account.',
    '',
    'You are given a list of PROBLEMS found by an automated audit, and a list of TASKS the agency',
    'currently has open for this client. For each problem, say whether an open task already covers it.',
    '',
    'A task covers a problem only when doing that task would actually resolve that problem.',
    'The wording will differ — "Content Phase 1" may well cover "listings missing bullet points".',
    'Judge by the work involved, not by shared words.',
    '',
    'Be conservative. If you are unsure, answer covered: false. A duplicate suggestion is harmless;',
    'wrongly hiding a real problem the seller is paying to have found is not.',
    '',
    'Respond ONLY with JSON: {"matches":[{"candidateId":"<id>","covered":true|false,',
    '"taskId":"<the task id, or null>","confidence":"high"|"medium"|"low"}]}',
    'Include every candidateId exactly once. Use covered: true only at high or medium confidence.',
].join('\n');

const buildPrompt = (opportunities, tasks) => {
    const problems = opportunities.slice(0, MAX_OPPORTUNITIES_IN_PROMPT).map((o) => (
        `- id: ${o.candidateId}\n  problem: ${o.title}\n  action: ${o.action || 'n/a'}`
    )).join('\n');

    const open = tasks.slice(0, MAX_TASKS_IN_PROMPT).map((t) => (
        `- id: ${t.taskId} | ${String(t.name || '').slice(0, MAX_TASK_NAME_CHARS)}`
        + `${t.tasklist ? ` | list: ${t.tasklist}` : ''}`
    )).join('\n');

    return `PROBLEMS FOUND:\n${problems}\n\nTASKS THE AGENCY HAS OPEN:\n${open || '(none)'}`;
};

/** Keep only well-formed matches that name a task we actually sent. */
const sanitiseMatches = (parsed, opportunities, tasks) => {
    const byTaskId = new Map((tasks || []).map((t) => [String(t.taskId), t]));
    const validIds = new Set((opportunities || []).map((o) => String(o.candidateId)));
    const seen = new Map();

    for (const match of Array.isArray(parsed?.matches) ? parsed.matches : []) {
        const candidateId = String(match?.candidateId || '');
        if (!validIds.has(candidateId) || seen.has(candidateId)) continue;

        // A low-confidence "covered" is treated as not covered — see the bias note above.
        const covered = match?.covered === true && match?.confidence !== 'low';
        const task = covered ? byTaskId.get(String(match?.taskId)) : null;

        seen.set(candidateId, task
            ? { candidateId, covered: true, coveredByTaskId: task.taskId, coveredByTaskName: task.name, matchedBy: 'ai' }
            // Claimed covered but named a task that was not in the list: treat as a
            // hallucinated id and keep the problem visible.
            : { candidateId, covered: false, matchedBy: 'ai' });
    }

    // Anything the model omitted stays visible rather than silently disappearing.
    for (const opportunity of opportunities || []) {
        const id = String(opportunity.candidateId);
        if (!seen.has(id)) seen.set(id, { candidateId: id, covered: false, matchedBy: 'ai' });
    }

    return [...seen.values()];
};

/**
 * Work out which opportunities are already covered by open tasks.
 *
 * @param {Array}  opportunities  [{ candidateId, title, action }]
 * @param {Array}  tasks          open Zoho tasks [{ taskId, name, tasklist }]
 * @param {Object} previous       { hash, version, matches } from the last run
 * @returns {Object} { matches, generatedBy, sourceHash, promptVersion, reused }
 */
const matchOpportunities = async ({ opportunities = [], tasks = [], previous = {} } = {}) => {
    const sourceHash = hashInputs(opportunities, tasks);
    const base = { sourceHash, promptVersion: PROMPT_VERSION, reused: false };

    if (opportunities.length === 0) {
        return { ...base, matches: [], generatedBy: 'fallback' };
    }

    // Both must match: a prompt change has to invalidate stored matches whose inputs
    // never moved, or this change would never reach the accounts that need it most.
    if (previous.hash === sourceHash && previous.version === PROMPT_VERSION && Array.isArray(previous.matches)) {
        return { ...base, matches: previous.matches, generatedBy: 'reused', reused: true };
    }

    // Nothing open to collide with, so nothing can be covered. Saves a call on every
    // project whose task list is empty.
    if (tasks.length === 0) {
        return {
            ...base,
            matches: opportunities.map((o) => ({ candidateId: o.candidateId, covered: false, matchedBy: 'none' })),
            generatedBy: 'fallback',
        };
    }

    const ai = getClient();
    if (!ai) {
        return { ...base, matches: deterministicMatch(opportunities, tasks), generatedBy: 'fallback' };
    }

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildPrompt(opportunities, tasks) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 700,
        });

        const content = completion?.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
            return { ...base, matches: deterministicMatch(opportunities, tasks), generatedBy: 'fallback' };
        }

        return {
            ...base,
            matches: sanitiseMatches(JSON.parse(content), opportunities, tasks),
            generatedBy: 'ai',
            model: MODEL,
        };
    } catch (error) {
        // Never fatal: a failed match must not stop the nightly sync or empty the page.
        logger.warn(`[ZohoOpportunityMatch] Falling back to token matching: ${error.message}`);
        return { ...base, matches: deterministicMatch(opportunities, tasks), generatedBy: 'fallback' };
    }
};

module.exports = {
    matchOpportunities,
    hashInputs,
    deterministicMatch,
    sanitiseMatches,
    PROMPT_VERSION,
    MODEL,
};
