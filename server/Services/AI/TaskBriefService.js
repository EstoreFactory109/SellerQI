/**
 * TaskBriefService.js — turning what a client wrote into something the team can work from.
 *
 * Runs once, when a request is accepted, on its way into Zoho. Two jobs:
 *
 *   1. Remove the client's contact details.
 *   2. Make the description clear enough to act on without going back and asking.
 *
 * ── THE SECOND JOB IS THE DANGEROUS ONE, AND THE DESIGN IS BUILT AROUND THAT ──
 * EmailRedactionService states the rule this service deliberately bends: "a model asked
 * to rewrite freely will eventually drop a negation, and an operational incident is a
 * worse outcome than a leaked surname." That was right there and is still right here —
 * the difference is that clarity is the point of this call rather than a side effect, so
 * the guard has to be structural rather than a refusal to rewrite.
 *
 * Three things hold it:
 *
 *   - Every identifier in the input must survive verbatim. ASINs, SKUs, URLs, dates,
 *     quantities and prices are extracted before the call and checked after it. A brief
 *     that lost one is discarded, not shipped.
 *   - Negations are checked. "Do NOT publish yet" losing its NOT is the exact failure
 *     that makes a rewrite worse than no rewrite.
 *   - THE CLIENT'S OWN WORDS GO INTO THE TASK TOO, below the brief. That is what makes a
 *     bad rewrite recoverable instead of silent: the person doing the work can always
 *     see what was actually asked for. It costs a few lines in a Zoho description and it
 *     is the only mitigation that works when the model is subtly rather than obviously
 *     wrong.
 *
 * ── CONTACTS GO, LINKS STAY ──
 * identityRedaction.redactStructural strips URLs along with contact details, which is
 * right for a message shown to staff and wrong here: "update amazon.com/dp/B08XYZ" is
 * the single most useful line in a task. So this does its own structural pass — emails,
 * phone-shaped digit runs, and tel:/mailto: links go; http links stay.
 *
 * ── FAILS CLOSED ON CONTACTS, OPEN ON CLARITY ──
 * If the model is unavailable or its output fails validation, the deterministically
 * cleaned text ships: less readable, still safe. The contact removal never depends on
 * the model.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const { redactKnown, containsIdentity, PLACEHOLDER } = require('../Email/identityRedaction.js');

const MODEL = process.env.TASK_BRIEF_MODEL || 'gpt-4o-mini';
const BRIEF_VERSION = 1;

const MAX_INPUT_CHARS = 6000;
const MAX_OUTPUT_TOKENS = 900;

/** A brief may expand — bullets add lines — but not by this much. */
const MAX_GROWTH_RATIO = 2.5;
/** Nor may it collapse into a one-line summary that drops half the ask. */
const MIN_RETENTION_RATIO = 0.3;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/**
 * Contact details out, links in.
 *
 * Deliberately NOT redactStructural: that also removes every URL, and a product link is
 * the most actionable thing a task description can contain.
 */
const stripContacts = (text, bundle) => {
    // Everything we actually hold for this client — their name, addresses, numbers.
    let out = redactKnown(String(text || ''), bundle).text;

    out = out
        // Any address, including ones we hold nothing for: a colleague's, a supplier's.
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, PLACEHOLDER.email)
        // Contact links specifically. http/https are left alone on purpose.
        .replace(/\b(?:tel|mailto|callto|sms):[^\s<>()]+/gi, PLACEHOLDER.phone);

    /**
     * Phone-shaped digit runs. Same grammar as identityRedaction's: a 9-digit floor plus
     * a separator or a leading +, which is what tells a dialable number from an order id
     * or a SKU. Anything tighter eats identifiers the team needs.
     */
    out = out.replace(
        /(?<![\w.])(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]){1,4}\d{2,6}(?![\w.])/g,
        (match) => {
            const digits = match.replace(/\D/g, '');
            return digits.length >= 9 && digits.length <= 15 ? PLACEHOLDER.phone : match;
        }
    );

    return out;
};

/**
 * The things that must come back out the other side unchanged.
 *
 * Losing any one of these is what separates a clearer brief from a wrong one, so they
 * are extracted before the model sees the text and checked against its answer.
 */
const IDENTIFIER_PATTERNS = [
    /\bB0[A-Z0-9]{8}\b/gi,                       // ASIN
    /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi,       // links the team needs
    /**
     * Bare domains with a path — "amazon.com/dp/B08XYZ1234", which is how people
     * actually paste a listing. Without this the pattern above misses them entirely and
     * a rewrite could drop the link with nothing to catch it. The required "/" and path
     * is what keeps it from matching ordinary prose and email domains.
     */
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>()]+/gi,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,        // 10/07/2026
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/gi,
    /[£$€]\s?\d[\d,.]*/g,                        // prices
    /\b\d+\s?%/g,                                // percentages
];

const identifiersIn = (text) => {
    const found = new Set();
    IDENTIFIER_PATTERNS.forEach((pattern) => {
        (String(text || '').match(pattern) || []).forEach((hit) => found.add(hit.toLowerCase()));
    });
    return [...found];
};

/** "do not publish", "don't change", "never use" — the words a rewrite must not lose. */
const NEGATION = /\b(?:not|never|don'?t|do not|avoid|without|except|must not|cannot|can'?t)\b/gi;
const countNegations = (text) => (String(text || '').match(NEGATION) || []).length;

const SYSTEM_PROMPT = [
    'You rewrite a client request so the agency team can act on it without asking',
    'questions back. You are not summarising and you are not advising.',
    '',
    'Answer with JSON only: {"description": str}',
    '',
    'RULES, in order of importance:',
    '',
    '1. NEVER change what is being asked for. Not the scope, not the quantity, not the',
    '   deadline, not the products. If the client asked for three things, the brief has',
    '   three things.',
    '',
    '2. NEVER drop a negation. "Do not publish yet", "without changing the price",',
    '   "everything except the bundle" — these invert the task if lost, and losing one is',
    '   worse than leaving the text untouched.',
    '',
    '3. Reproduce every identifier EXACTLY: ASINs, SKUs, URLs, dates, prices, quantities,',
    '   percentages. Do not reformat a date, shorten a link, or tidy a code.',
    '',
    '4. Add nothing. No suggested approach, no assumed context, no "presumably they mean".',
    '   If something is unclear, leave it unclear — say what they said.',
    '',
    'WITHIN those rules, make it easy to work from: plain sentences, no filler, and',
    'bullet points when there is genuinely more than one thing to do. A single simple',
    'request should stay a single short sentence — bullets for their own sake make a',
    'one-line task look like a project.',
    '',
    'The text may contain [name], [email] or [phone] placeholders where contact details',
    'were removed. Leave them exactly as they are; do not guess what they stood for.',
].join('\n');

const parseResponse = (content) => {
    try {
        const parsed = JSON.parse(content);
        return typeof parsed?.description === 'string' ? parsed.description.trim() : null;
    } catch {
        return null;
    }
};

/**
 * Everything that must be true of a brief before it is allowed to reach Zoho.
 *
 * @returns {string|null} the reason it was rejected, or null when it passes
 */
const leaksContact = (text, bundle) => {
    const { found } = containsIdentity(text, bundle);
    /**
     * 'link' is excluded deliberately, and this is the whole reason this wrapper exists.
     *
     * containsIdentity was written for messages shown to staff, where every URL is a
     * leak. Here a product link is the most useful line in the brief, so counting it as
     * identity would reject every rewrite that did its job. Names, addresses and numbers
     * are still disqualifying.
     *
     * It returns { clean, found } — an OBJECT, which is truthy even when clean. Reading
     * it as a boolean rejected every single rewrite and the AI layer silently never ran.
     */
    return found.some((kind) => kind !== 'link');
};

const rejectionReason = (brief, source, bundle) => {
    if (!brief) return 'empty';

    // The contact guarantee is not the model's to make. If anything it produced looks
    // like the client, the brief is discarded whatever else it got right.
    if (leaksContact(brief, bundle)) return 'contains identity';

    const missing = identifiersIn(source).filter((id) => !brief.toLowerCase().includes(id));
    if (missing.length > 0) return `dropped identifiers: ${missing.slice(0, 3).join(', ')}`;

    // Fewer negations out than in means a "do NOT" became a "do".
    if (countNegations(brief) < countNegations(source)) return 'dropped a negation';

    if (brief.length > source.length * MAX_GROWTH_RATIO) return 'grew beyond the source';
    if (brief.length < source.length * MIN_RETENTION_RATIO) return 'collapsed the source';

    return null;
};

/**
 * Build the brief that goes into the Zoho task.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.description   the client's raw words
 * @param {object} args.bundle        identityRedaction.buildIdentityBundle(client)
 * @returns {{ title, description, original, generatedBy, version }}
 */
const buildTaskBrief = async ({ title, description, bundle }) => {
    // Deterministic first, always. Nothing below can undo this, and nothing below is
    // required for it to have happened.
    const safeTitle = stripContacts(title, bundle);
    const safeDescription = stripContacts(description, bundle);

    const result = {
        title: safeTitle,
        description: safeDescription,
        original: safeDescription,
        generatedBy: 'deterministic',
        version: BRIEF_VERSION,
    };

    const ai = getClient();
    if (!ai || !safeDescription) return result;

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            // Low but not zero: this is a rewrite, and zero produces stilted output that
            // is harder to read than what it replaced.
            temperature: 0.2,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Title: ${safeTitle}\n\nRequest:\n${safeDescription.slice(0, MAX_INPUT_CHARS)}` },
            ],
        });

        const brief = parseResponse(completion?.choices?.[0]?.message?.content);
        const reason = rejectionReason(brief, safeDescription, bundle);

        if (reason) {
            // Logged with the REASON but never the text: Logger.js writes unrotated to
            // logs.txt, and this content is the client's own words.
            logger.warn(`[TaskBrief] rewrite rejected (${reason}) — using the cleaned original`);
            return result;
        }

        return { ...result, description: brief, generatedBy: 'ai' };
    } catch (error) {
        logger.warn(`[TaskBrief] model call failed: ${error.message?.slice(0, 200)}`);
        return result;
    }
};

module.exports = {
    buildTaskBrief,
    stripContacts,
    identifiersIn,
    countNegations,
    rejectionReason,
    leaksContact,
    BRIEF_VERSION,
};
