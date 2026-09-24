/**
 * MessageIntentService.js — reading a conversation for things that need doing.
 *
 * Two questions, asked of different messages:
 *
 *   CLIENT message  → "is this asking us to do a new piece of work?"
 *   ADMIN message   → "is this answering yes or no to a request already on the queue?"
 *
 * ── THE TWO ANSWERS CARRY VERY DIFFERENT CONSEQUENCES, AND ARE TREATED DIFFERENTLY ──
 * A detected client request becomes a PENDING row in a queue a human already reviews
 * before anything reaches Zoho. A false positive there costs one glance. So that path
 * acts on its own.
 *
 * A detected admin decision would otherwise skip that review entirely — an accept
 * creates a real task in the live Zoho portal on a client's account. Reading "I don't
 * think we should do this" as approval is a plausible model failure with an expensive,
 * hard-to-reverse result. So this service only ever STAGES a decision; confirming it is
 * a human click. Nothing here writes to Zoho.
 *
 * ── FAILURE IS SILENCE, NOT A GUESS ──
 * No API key, a malformed response, a timeout: every one returns "no intent found", and
 * the message is stored exactly as it would have been before this existed. Following the
 * house rule (ZohoTaskSummaryService) rather than EmailRedactionService's inverted one —
 * an undetected request is a mild miss, whereas a fabricated one puts words in a
 * client's mouth.
 *
 * ── IT READS THE RAW TEXT, DELIBERATELY ──
 * Called at ingest, before the redacted copy is the only one left. The redacted text has
 * every URL stripped, and "please update amazon.com/dp/B08…" is precisely the detail a
 * task request needs to be worth raising. Nothing read here is stored: the service
 * returns fields that go through the same redaction as everything else.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');

const MODEL = process.env.MESSAGE_INTENT_MODEL || 'gpt-4o-mini';

/** Bumped when the prompt changes, so a re-analysis can be told from a cached verdict. */
const INTENT_VERSION = 1;

const MAX_INPUT_CHARS = 6000;
const MAX_OUTPUT_TOKENS = 500;

/**
 * Below this, a detection is recorded but not acted on.
 *
 * Deliberately high. The cost of missing a request is that a client repeats themselves;
 * the cost of inventing one is a queue nobody trusts, and an admin who stops reading it
 * carefully is worse off than one with no assistance at all.
 */
const MIN_CONFIDENCE = 0.7;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/**
 * What a request needs before it can actually be scheduled.
 *
 * Kept as data rather than prose in the prompt so the follow-up question can name the
 * specific gaps, and so this list is one edit away from changing.
 */
const REQUIRED_DETAILS = {
    // Phrased in the second person because the only place these strings surface is a
    // question put TO the client. Describing them third-person reads as talking about
    // someone who is in the room.
    deliverable: 'exactly what you need done, and which product or listing it affects',
    timing: 'when you need it by',
};

const REQUEST_PROMPT = [
    'You read a single email from a client of an Amazon agency and decide whether it is',
    'ASKING THE AGENCY TO DO A NEW PIECE OF WORK.',
    '',
    'Answer with JSON only: {"isRequest": bool, "confidence": 0-1, "title": str,',
    '"description": str, "neededBy": "YYYY-MM-DD"|null, "missing": [str]}',
    '',
    'isRequest is TRUE only for a genuine new ask — "can you add a size chart",',
    '"we need the A+ content updated before Prime Day".',
    '',
    'isRequest is FALSE for: questions about existing work, status chasing, complaints,',
    'approvals or answers to something we asked, thanks, and anything already being done.',
    'A question is not a request. When it is genuinely ambiguous, say false.',
    '',
    'title: a short imperative summary, under 80 characters, in the agency\'s words.',
    'description: what they actually want, in their own words. Keep product identifiers,',
    'ASINs, URLs and dates exactly as written — those are the useful part. Do not invent',
    'detail that is not there.',
    'neededBy: only if they state or clearly imply a date. Never guess one.',
    'missing: which of these are absent — "deliverable" if it is unclear what to do or to',
    'which product, "timing" if no date or urgency is given. Empty array if both present.',
].join('\n');

const DECISION_PROMPT = [
    'You read a single reply written by an agency staff member, in a conversation where',
    'the client has asked for a piece of work that is awaiting a decision.',
    '',
    'Decide whether this reply ACCEPTS or REJECTS that request.',
    '',
    'Answer with JSON only: {"intent": "accept"|"reject"|"none", "confidence": 0-1,',
    '"reason": str}',
    '',
    'accept: they agree to do it — "yes we can", "I\'ll get that scheduled", "consider it done".',
    'reject: they decline it — "that is not something we can do", "not worth it", "no".',
    'none: anything else, including asking a question back, discussing it without deciding,',
    'giving a partial or conditional answer, or talking about something unrelated.',
    '',
    'A conditional is NOT a decision. "We could, if you send the images" is none.',
    'reason: for a reject, the explanation in their own words, to show the client. Empty',
    'string otherwise.',
].join('\n');

/** A model answer is only useful if it is the shape we asked for. */
const parseJson = (content) => {
    try {
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const ask = async (systemPrompt, text) => {
    const ai = getClient();
    if (!ai) return null;

    const body = String(text || '').trim();
    if (!body) return null;

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            // Near-zero: this is a classification, and creativity here means invention.
            temperature: 0,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: body.slice(0, MAX_INPUT_CHARS) },
            ],
        });
        return parseJson(completion?.choices?.[0]?.message?.content);
    } catch (error) {
        /**
         * The message text is NEVER passed to the logger.
         *
         * utils/Logger.js writes unrotated to logs.txt, and the OpenAI SDK puts the
         * request body into its error message on a 4xx — so logging the error object
         * whole would put an un-redacted client email on disk permanently.
         */
        logger.warn(`[MessageIntent] model call failed: ${error.message?.slice(0, 200)}`);
        return null;
    }
};

const clamp = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
};

/**
 * Does this client message ask for new work?
 *
 * @returns {{ isRequest, confidence, actionable, title, description, neededBy, missing }}
 *   `actionable` is the only field callers should branch on — it folds in the confidence
 *   floor so no caller has to remember it.
 */
const detectTaskRequest = async (text) => {
    const none = {
        isRequest: false, confidence: 0, actionable: false,
        title: null, description: null, neededBy: null, missing: [], version: INTENT_VERSION,
    };

    const answer = await ask(REQUEST_PROMPT, text);
    if (!answer) return none;

    const confidence = clamp(answer.confidence);
    const isRequest = answer.isRequest === true;
    const title = typeof answer.title === 'string' ? answer.title.trim().slice(0, 150) : '';

    /**
     * A request with no title is not a request we can act on, whatever the model said.
     * Validating the SHAPE rather than trusting the boolean is what keeps a confidently
     * empty answer out of the queue.
     */
    if (!isRequest || !title) return { ...none, confidence };

    // Only ever what we asked for, so an invented key cannot reach a page.
    const missing = Array.isArray(answer.missing)
        ? answer.missing.filter((key) => Object.keys(REQUIRED_DETAILS).includes(key))
        : [];

    return {
        isRequest: true,
        confidence,
        actionable: confidence >= MIN_CONFIDENCE,
        title,
        description: typeof answer.description === 'string' ? answer.description.trim() : '',
        // Rejected unless it is a real date. A malformed one would silently become the
        // Zoho task's due date, which is worse than having none.
        neededBy: /^\d{4}-\d{2}-\d{2}$/.test(answer.neededBy || '') ? answer.neededBy : null,
        missing,
        version: INTENT_VERSION,
    };
};

/**
 * Does this staff reply decide a request that is waiting?
 *
 * The caller must only ask this when a pending request actually exists on the thread —
 * without that context "yes, go ahead" means nothing in particular.
 *
 * Nothing here acts. The verdict is staged for a human to confirm, because an accept
 * creates a real task in the live Zoho portal and a misread would do so unasked.
 */
const detectDecision = async (text) => {
    const none = { intent: null, confidence: 0, actionable: false, reason: '', version: INTENT_VERSION };

    const answer = await ask(DECISION_PROMPT, text);
    if (!answer) return none;

    const intent = ['accept', 'reject'].includes(answer.intent) ? answer.intent : null;
    if (!intent) return none;

    const confidence = clamp(answer.confidence);

    return {
        intent,
        confidence,
        actionable: confidence >= MIN_CONFIDENCE,
        reason: typeof answer.reason === 'string' ? answer.reason.trim().slice(0, 500) : '',
        version: INTENT_VERSION,
    };
};

/** The question to put back to a client, naming only the gaps that exist. */
const missingDetailsQuestion = (missing = []) => {
    const parts = missing.map((key) => REQUIRED_DETAILS[key]).filter(Boolean);
    if (parts.length === 0) return null;
    return `Before we can schedule this, could you let us know ${parts.join(', and ')}?`;
};

module.exports = {
    detectTaskRequest,
    detectDecision,
    missingDetailsQuestion,
    REQUIRED_DETAILS,
    MIN_CONFIDENCE,
    INTENT_VERSION,
};
