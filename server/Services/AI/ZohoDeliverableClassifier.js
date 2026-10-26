/**
 * Which of the team's files and links on a task are DELIVERABLES the client should get.
 *
 * The team attaches all sorts to a Zoho task: the finished product images, but also the raw
 * photos the client sent, reference screenshots, internal drafts. Only the finished work goes
 * to the client's Status page, and an AI judges which is which from the task, the file name
 * and type, and what the comment around it says.
 *
 * Deliberately conservative:
 *   - "unsure", a failed call, or no AI key → the file stays hidden (shown to staff only),
 *   - a verdict is reused while its context is unchanged (same hash + prompt version), so an
 *     unchanged file never costs a second AI call,
 *   - a staff override (Status page, staff session) always beats the AI.
 *
 * Same model, lazy client and redaction as ZohoTaskSummaryService.
 */
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const { redactNames } = require('./ZohoTaskSummaryService.js');
const { contextHash } = require('../Zoho/zohoDeliverables.js');

const MODEL = process.env.ZOHO_DELIVERABLE_MODEL || process.env.ZOHO_TASK_SUMMARY_MODEL || 'gpt-4o-mini';

/** Bumped when the prompt or output changes, so stored verdicts are re-judged once. */
const PROMPT_VERSION = 1;
const MAX_CANDIDATES_PER_CALL = 40;

const SYSTEM_PROMPT = `You sort the files and links an Amazon marketing agency attached to a client's task.
Decide for each item whether it is a DELIVERABLE: finished work produced FOR the client that the client should receive.

Deliverables (answer "yes"): final or ready-for-review product images, photos, infographics, A+ / EBC designs, logos the agency designed, videos, listing content (titles, bullets, descriptions) documents, keyword research sheets, audit or performance reports, finished spreadsheets, zip files of final assets, share links to such work.
Not deliverables (answer "no"): files the client sent to the agency (raw photos, briefs, credentials, product data), reference or inspiration images, screenshots used to discuss a problem, internal working notes, invoices and admin, anything the comment calls internal, a draft for internal review, or a copy of the client's own material.
If the evidence is weak or mixed, answer "unsure" — unsure items are NOT shown to the client.

Reply with JSON only: {"items":[{"key":"<key>","deliverable":"yes"|"no"|"unsure","reason":"<max 12 words>"}]}. One entry per item, same keys.`;

let openaiClient = null;
const getClient = () => {
    if (openaiClient) return openaiClient;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    try {
        openaiClient = new OpenAI({ apiKey });
        return openaiClient;
    } catch (error) {
        logger.warn(`[ZohoDeliverables] OpenAI client unavailable: ${error.message}`);
        return null;
    }
};

const hashFor = (task, candidate) => `${PROMPT_VERSION}:${contextHash(task, candidate)}`;

const sanitiseDecision = (value) => (['yes', 'no', 'unsure'].includes(value) ? value : 'unsure');

/**
 * @param {{ name, status, description, ownerNames, comments }} task
 * @param {Array} candidates  from zohoDeliverables.candidatesForTask
 * @param {Array} previous    the task's stored deliverableDecisions
 * @returns {Promise<Array<{ key, decision, reason, contextHash, decidedAt, decidedBy }>>}
 */
const classifyDeliverables = async (task, candidates, previous = []) => {
    if (!candidates.length) return [];
    const prior = new Map((previous || []).map((d) => [d.key, d]));

    const results = new Map();
    const pending = [];
    for (const c of candidates) {
        const hash = hashFor(task, c);
        const old = prior.get(c.key);
        if (old && old.contextHash && old.contextHash === hash) results.set(c.key, old);
        else pending.push({ ...c, hash });
    }

    if (pending.length) {
        const decided = await askModel(task, pending);
        for (const c of pending) results.set(c.key, decided.get(c.key));
    }
    return candidates.map((c) => results.get(c.key)).filter(Boolean);
};

/** One call per task (chunked for very busy tasks). Failure → "unsure", not cached. */
const askModel = async (task, pending) => {
    const out = new Map();
    const fallback = (c, reason) => out.set(c.key, {
        key: c.key, decision: 'unsure', reason, contextHash: null, decidedAt: new Date(), decidedBy: 'fallback',
    });

    const client = getClient();
    if (!client) {
        pending.forEach((c) => fallback(c, 'AI unavailable'));
        return out;
    }

    // Staff names never leave our systems, as with the summaries.
    const names = [...new Set([
        ...(task.ownerNames || []),
        ...(task.comments || []).map((c) => c.authorName).filter(Boolean),
    ])];
    const redact = (text) => redactNames(String(text || ''), names);

    for (let i = 0; i < pending.length; i += MAX_CANDIDATES_PER_CALL) {
        const chunk = pending.slice(i, i + MAX_CANDIDATES_PER_CALL);
        const prompt = [
            `Task: ${redact(task.name)}`,
            `Task status: ${task.status || 'unknown'}`,
            task.description ? `Task description: ${redact(String(task.description).replace(/<[^>]+>/g, ' ')).slice(0, 500)}` : null,
            '',
            'Items:',
            ...chunk.map((c) => JSON.stringify({
                key: c.key,
                kind: c.kind,
                name: c.name,
                type: c.mimeType || null,
                comment: redact(c.context).slice(0, 400),
            })),
        ].filter((line) => line !== null).join('\n');

        try {
            const completion = await client.chat.completions.create({
                model: MODEL,
                temperature: 0,
                max_tokens: 60 + chunk.length * 40,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
            });
            const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
            const byKey = new Map((Array.isArray(parsed.items) ? parsed.items : []).map((item) => [item.key, item]));
            for (const c of chunk) {
                const item = byKey.get(c.key);
                if (!item) { fallback(c, 'No verdict returned'); continue; }
                out.set(c.key, {
                    key: c.key,
                    decision: sanitiseDecision(item.deliverable),
                    reason: String(item.reason || '').slice(0, 120) || null,
                    contextHash: c.hash,
                    decidedAt: new Date(),
                    decidedBy: MODEL,
                });
            }
        } catch (error) {
            logger.warn(`[ZohoDeliverables] classification failed for "${task.name}": ${error.message}`);
            chunk.forEach((c) => fallback(c, 'AI call failed'));
        }
    }
    return out;
};

module.exports = { classifyDeliverables, PROMPT_VERSION, MODEL, SYSTEM_PROMPT };
