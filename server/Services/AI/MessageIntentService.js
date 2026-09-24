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
const INTENT_VERSION = 2;

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
    '"description": str, "neededBy": "YYYY-MM-DD"|null, "hasDeliverable": bool,',
    '"hasTiming": bool}',
    '',
    'isRequest is TRUE when they are asking the agency to DO something new. How vague it',
    'is has no bearing on this — a vague ask is still an ask, and the two flags below are',
    'where vagueness is recorded.',
    '  "can you add a size chart"                                    -> true',
    '  "we need the A+ content updated before Prime Day"             -> true',
    '  "I want your team to create product images for my products"   -> true',
    '  "our images could do with a refresh at some point"            -> true',
    '',
    'isRequest is FALSE for: questions about existing work, status chasing, complaints,',
    'approvals or answers to something we asked, thanks, and anything already under way.',
    '  "how is the listing optimisation going?"                      -> false',
    '  "any update on the size chart?"                               -> false',
    '  "yes that version looks good, go ahead"                       -> false',
    '  "thanks, that looks great"                                    -> false',
    '',
    'Ambiguous means you cannot tell whether they want anything done at all. It does NOT',
    'mean the request lacks detail.',
    '',
    'title: a short imperative summary, under 80 characters, in the agency\'s words.',
    'description: what they actually want, in their own words. Keep product identifiers,',
    'ASINs, URLs and dates exactly as written — those are the useful part. Do not invent',
    'detail that is not there.',
    'neededBy: only if they state or clearly imply a date. Never guess one.',
    '',
    'The last two decide whether we have to go back and ask. Judge them strictly — the',
    'question is whether someone could START this work today without asking anything,',
    'not whether the message is reasonable.',
    '',
    'hasDeliverable: true ONLY if it is clear what to do AND which specific product,',
    'listing or ASIN it applies to.',
    '  "add a size chart to ASIN B08XYZ"      -> true',
    '  "create product images for my listed products" -> FALSE (which products?)',
    '  "refresh our images"                   -> FALSE (which ones?)',
    '',
    'hasTiming: true ONLY if the message states a date, a deadline, or a clear urgency.',
    '  "before Prime Day on 10 July"          -> true',
    '  "by Friday"                            -> true',
    '  "as soon as you can"                   -> true',
    '  no mention of when at all              -> FALSE',
    '',
    'Most short requests have neither, and that is normal — it does NOT make them any',
    'less of a request. isRequest and these two are independent judgements: a vague ask',
    'with no date is still a request, it is simply one we must go back and ask about.',
    'Doubt about these two means false; doubt about isRequest is decided by the rules',
    'above, not by these.',
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
    'reject: they decline it, refuse it, or say it is not worth doing. Deliberately given',
    'without example wording, because any phrase offered here comes back as the reason',
    'below instead of the sender\'s own.',
    'none: anything else, including asking a question back, discussing it without deciding,',
    'giving a partial or conditional answer, or talking about something unrelated.',
    '',
    'A conditional is NOT a decision. "We could, if you send the images" is none.',
    'reason: for a reject only, quote the explanation FROM THE MESSAGE ITSELF, close to',
    'verbatim. This is shown to the client, so wording they never used misrepresents',
    'them. Never reuse the example phrasings above. If the message gives no reason,',
    'return an empty string rather than inventing one. Empty for accept.',
].join('\n');

const FOLLOW_UP_PROMPT = [
    'A client of an Amazon agency already has ONE request waiting for a decision. You are',
    'shown that request, then a newer message from the same conversation.',
    '',
    'Decide what the newer message is doing.',
    '',
    'Answer with JSON only: {"relation": "answers"|"new"|"other", "confidence": 0-1}',
    '',
    'answers: it is supplying detail about the SAME piece of work — naming the products,',
    '  giving a deadline, clarifying scope, or replying to a question we asked about it.',
    '',
    'new: it is asking for a DIFFERENT piece of work. A client raising a second thing in',
    '  an existing conversation is completely normal — "also, separate thing, can you..."',
    '  or a message about different products or a different deliverable entirely.',
    '',
    'other: neither. Thanks, chit chat, a status chase, a complaint, an approval.',
    '',
    'The test for "new" is whether someone could work on it WITHOUT the first request.',
    'A message about the same products, clarifying the same job, is answers even if it is',
    'long. A message about different products or a different kind of work is new even if',
    'it arrives in the same breath as an answer.',
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

    /**
     * Derived from two booleans rather than read from an array the model composes.
     *
     * Asked for as `missing: [str]` it came back empty every single time, including for
     * "create product images for my listed products" — no product named, no date given.
     * A model asked to emit enum strings as a side note at the end of a list simply does
     * not, and the follow-up question this drives would never have fired.
     *
     * Two direct yes/no questions it must answer, turned into the list here, where an
     * invented value cannot appear at all.
     */
    const missing = [
        answer.hasDeliverable === true ? null : 'deliverable',
        answer.hasTiming === true ? null : 'timing',
    ].filter(Boolean);

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

/**
 * Is this message answering the request already waiting, or raising a different one?
 *
 * Without this, every later message on a conversation was treated as an answer, and a
 * client who raised a genuinely separate ask in an existing thread had it silently
 * swallowed — no request, no reply, nothing. Clients do this constantly; a thread is a
 * relationship, not a ticket.
 *
 * Defaults to 'answers' on any failure, because filling a gap wrongly is recoverable and
 * a duplicate request is noise in the queue.
 */
const classifyFollowUp = async ({ text, existingTitle, existingDescription }) => {
    const none = { relation: 'answers', confidence: 0, actionable: false, version: INTENT_VERSION };

    const context = [
        'REQUEST ALREADY WAITING:',
        existingTitle || '(untitled)',
        existingDescription || '',
        '',
        'NEWER MESSAGE:',
        text,
    ].join('\n');

    const answer = await ask(FOLLOW_UP_PROMPT, context);
    if (!answer) return none;

    const relation = ['answers', 'new', 'other'].includes(answer.relation) ? answer.relation : 'answers';
    const confidence = clamp(answer.confidence);

    return {
        relation,
        confidence,
        // Only a confident "new" is acted on. Anything else falls through to filling
        // gaps, which is the behaviour that cannot create noise.
        actionable: relation === 'new' && confidence >= MIN_CONFIDENCE,
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
    classifyFollowUp,
    missingDetailsQuestion,
    REQUIRED_DETAILS,
    MIN_CONFIDENCE,
    INTENT_VERSION,
};
