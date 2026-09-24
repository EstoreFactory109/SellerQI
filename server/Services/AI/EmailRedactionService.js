/**
 * EmailRedactionService.js — the model layer over deterministic redaction.
 *
 * Services/Email/identityRedaction.js has already removed every identifier we hold
 * and everything shaped like contact detail. Two things are left that regex cannot do,
 * and this service exists for exactly those:
 *
 *   1. PEOPLE WE HOLD NO IDENTIFIER FOR — the client's colleague, their supplier,
 *      their lawyer. No pattern describes "this is a person's name", and we have
 *      nothing to match against.
 *   2. REPAIRING WHAT STEP 1 BROKE — "[name] said [phone] is the best time" reads
 *      badly, and a client called Bill turns "bill of lading" into "[name] of lading".
 *      The deterministic pass is blunt on purpose; this puts the sentence back.
 *
 * IT IS NOT A REPHRASER, AND THAT DISTINCTION IS THE WHOLE DESIGN.
 * Staff act on these emails — they carry approvals, dates, ASINs, "do NOT publish
 * yet". A model asked to rewrite freely will eventually drop a negation, and an
 * operational incident is a worse outcome than a leaked surname. The prompt asks for
 * excision plus minimal repair, and §validate() enforces that the output did not
 * wander.
 *
 * THE FALLBACK INVERTS THE USUAL HOUSE RULE.
 * ZohoTaskSummaryService falls back to showing MORE raw text when the model is
 * unavailable, which is right when the fallback is merely less polished. Here that
 * would fall back to showing precisely what must be hidden. So: fail CLOSED on
 * content, OPEN on availability — an unavailable model serves the deterministic text,
 * which is safe but blunter, and never the original.
 */

const crypto = require('crypto');
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const { redactAll, containsIdentity, PLACEHOLDER } = require('../Email/identityRedaction.js');

const MODEL = process.env.EMAIL_REDACTION_MODEL || 'gpt-4o-mini';

/** Bumped when the prompt or output contract changes, so stored text is regenerated. */
const REDACTION_VERSION = 1;

const MAX_INPUT_CHARS = 6000;
const MAX_OUTPUT_TOKENS = 1200;

/**
 * How much longer than its input an acceptable output may be.
 *
 * Repair adds a word or two; it does not add a paragraph. Anything beyond this is the
 * model inventing content — including, in the worst case, a plausible-looking name to
 * replace the one it removed, which is more dangerous than the original because staff
 * would have no reason to doubt it.
 */
const MAX_GROWTH_RATIO = 1.2;

/** Below this share of the input, the model has deleted the message rather than cleaned it. */
const MIN_RETENTION_RATIO = 0.35;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/** Identity of the input, so unchanged text is never re-processed. */
const hashInput = (text) => crypto.createHash('sha1').update(String(text || '')).digest('hex');

const SYSTEM_PROMPT = [
    'You clean an email so it can be read by someone who must not learn who wrote it.',
    '',
    'The text has already had known contact details replaced with [name], [email], [phone]',
    'and [link]. Two jobs remain:',
    '',
    '1. REMOVE any remaining personal identity: names of people, job titles tied to a named',
    '   person, company letterheads that name an individual, social handles. Replace a',
    '   person with [name]. Names of COMPANIES, products, brands, marketplaces and teams',
    '   are NOT personal identity — keep them exactly as they are.',
    '2. REPAIR sentences left awkward by the replacements, so the text reads naturally.',
    '',
    'CRITICAL LIMITS:',
    '- Do NOT summarise, shorten, reorder or improve the message.',
    '- Preserve every instruction, question, decision, date, quantity, price, order number,',
    '  ASIN, SKU and negation EXACTLY. "do not publish" must never become "publish".',
    '- Do not invent a name to replace one you removed. Use [name].',
    '- Keep the original tone and sentence order.',
    '- If nothing needs changing, return the text unchanged.',
    '',
    'Respond ONLY with JSON: {"text":"<the cleaned text>","removed":<how many identities you removed>}',
].join('\n');

/**
 * Accept or reject the model's output.
 *
 * This is the guarantee, not the prompt. The same pattern as
 * ZohoTaskSummaryService, where redaction runs over the model's response regardless
 * of what it was told — a model instructed not to name people still will.
 */
const validate = (candidate, input, bundle) => {
    if (typeof candidate !== 'string' || !candidate.trim()) {
        return { ok: false, reason: 'empty' };
    }

    const identity = containsIdentity(candidate, bundle);
    if (!identity.clean) {
        return { ok: false, reason: `reintroduced ${identity.found.join('/')}` };
    }

    if (candidate.length > input.length * MAX_GROWTH_RATIO) {
        return { ok: false, reason: 'output grew — likely invented content' };
    }

    if (candidate.length < input.length * MIN_RETENTION_RATIO) {
        return { ok: false, reason: 'output shrank — message deleted rather than cleaned' };
    }

    return { ok: true };
};

const parseResponse = (content) => {
    try {
        const parsed = JSON.parse(content);
        return typeof parsed?.text === 'string' ? parsed.text : null;
    } catch {
        return null;
    }
};

/**
 * Redact one email body.
 *
 * @param {string} rawText   already HTML-flattened (see Services/Email/emailRichText.js)
 * @param {object} bundle    from identityRedaction.buildIdentityBundle(user)
 * @param {object} [options]
 * @param {string} [options.previousHash]     hash of the input the stored text came from
 * @param {string} [options.previousText]     the stored redacted text, reused when unchanged
 * @param {number} [options.previousVersion]  REDACTION_VERSION that produced it
 * @returns {{ text, generatedBy, sourceHash, redactionVersion, reused, counts }}
 */
const redactBody = async (rawText, bundle, {
    previousHash = null, previousText = null, previousVersion = null,
} = {}) => {
    const sourceHash = hashInput(rawText);
    const base = { sourceHash, redactionVersion: REDACTION_VERSION, reused: false };

    // Deterministic first, always. Everything below operates on ITS output, so the
    // model never sees the identifiers we already hold — which also means they are
    // never sent to OpenAI.
    const deterministic = redactAll(rawText, bundle);
    const safe = deterministic.text;

    if (!safe) {
        return { ...base, text: '', generatedBy: 'deterministic', counts: deterministic.counts };
    }

    // Reuse requires BOTH the input and our reading of it to be unchanged.
    if (previousHash === sourceHash && previousVersion === REDACTION_VERSION && previousText) {
        return { ...base, text: previousText, generatedBy: 'reused', reused: true, counts: deterministic.counts };
    }

    const ai = getClient();
    if (!ai) {
        return { ...base, text: safe, generatedBy: 'deterministic', counts: deterministic.counts };
    }

    // A body far past the cap is almost always a newsletter or a runaway chain; the
    // deterministic pass has already made it safe, and paying to tidy it is not worth it.
    if (safe.length > MAX_INPUT_CHARS) {
        return { ...base, text: safe, generatedBy: 'deterministic', counts: deterministic.counts };
    }

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            temperature: 0.1,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: safe },
            ],
        });

        const candidate = parseResponse(completion?.choices?.[0]?.message?.content);
        const verdict = validate(candidate, safe, bundle);

        if (!verdict.ok) {
            // Never log the text itself — see the module note in the ingest service.
            logger.warn(`[EmailRedaction] Rejected model output (${verdict.reason}); using deterministic text`);
            return { ...base, text: safe, generatedBy: 'deterministic', counts: deterministic.counts };
        }

        return {
            ...base,
            text: candidate,
            generatedBy: 'ai',
            model: MODEL,
            counts: deterministic.counts,
        };
    } catch (error) {
        /*
         * Deliberately logs only the error's own message, never the body and never the
         * provider's error object. The OpenAI SDK puts the request payload into error
         * messages on a 4xx, and utils/Logger.js appends to an unrotated server/logs.txt
         * — one 400 would otherwise write an un-redacted client email to disk.
         */
        logger.warn(`[EmailRedaction] Model call failed (${error?.message || 'unknown'}); using deterministic text`);
        return { ...base, text: safe, generatedBy: 'deterministic', counts: deterministic.counts };
    }
};

module.exports = {
    redactBody,
    validate,
    hashInput,
    REDACTION_VERSION,
    MODEL,
    PLACEHOLDER,
};
