/**
 * MessageIntentHandler.js — acting on what MessageIntentService read.
 *
 * Kept separate from the service that does the reading, because everything consequential
 * lives here: what gets written, what gets emailed, and above all what does NOT happen
 * without a human.
 *
 * ── THE ONE RULE ──
 * A client's request is CREATED. An admin's decision is only STAGED.
 *
 * Both are model inferences of similar reliability, and they are treated differently
 * because of where they land. A created request is a pending row in a queue a human
 * already reviews before anything reaches Zoho — the gate absorbs a false positive. A
 * decision applied automatically skips that gate and writes a real task into the live
 * portal on a client's account. Same confidence, very different blast radius.
 *
 * ── EVERY PATH HERE IS NON-FATAL ──
 * This runs inside message ingestion. A failure must never stop a client's email being
 * stored: losing the conversation to save the automation would be exactly backwards. All
 * of it is wrapped, and the worst case is a message that arrives with no intent attached,
 * which is how every message behaved before this existed.
 */

const logger = require('../../utils/Logger.js');
const TaskRequest = require('../../models/system/TaskRequestModel.js');
const { buildIdentityBundle, redactAll } = require('../Email/identityRedaction.js');
const { toPlainLabel } = require('../Email/emailRichText.js');
const MessageIntent = require('../AI/MessageIntentService.js');

/**
 * Read a client's message for a new request, and queue it if there is one.
 *
 * @param {object} args
 * @param {string} args.rawText   the message BEFORE redaction — see the service header
 * @param {object} args.user      the client, for the redaction bundle
 * @param {object} args.thread    the EmailThread it arrived on
 * @param {object} args.message   the stored EmailMessage
 */
const handleClientMessage = async ({ rawText, user, thread, message }) => {
    /**
     * One pending request per conversation, checked before spending a model call.
     *
     * A client answering our own follow-up question is still talking about the same
     * piece of work. Without this, the more detail they supplied the more duplicate
     * requests they would generate — the exact opposite of the intended behaviour.
     */
    const existing = await TaskRequest.findOne({ sourceThreadId: thread._id, status: 'pending' });
    if (existing) {
        return fillGaps({ existing, rawText, user, thread });
    }

    const intent = await MessageIntent.detectTaskRequest(rawText);
    if (!intent.actionable) {
        // Recorded at debug level only when something was seen but not trusted, so a
        // confidence floor set too high is discoverable rather than silent.
        if (intent.isRequest) {
            logger.info(`[MessageIntent] request seen below the confidence floor on thread ${thread._id}`);
        }
        return null;
    }

    const bundle = buildIdentityBundle(user);

    const request = await TaskRequest.create({
        userId: user._id,
        // Raw for Zoho, redacted for the portal — the same split every request uses.
        titleRaw: intent.title,
        descriptionRaw: intent.description || intent.title,
        title: toPlainLabel(redactAll(intent.title, bundle).text) || '(untitled request)',
        description: redactAll(intent.description || intent.title, bundle).text,
        neededBy: intent.neededBy ? new Date(intent.neededBy) : null,
        source: 'ai',
        aiConfidence: intent.confidence,
        sourceThreadId: thread._id,
        sourceMessageId: message._id,
        missingDetails: intent.missing,
        // The email the request came from IS the record, so its attachments are already
        // reachable — no separate request email is sent for an AI-detected one.
        gmailMessageId: message.gmailMessageId,
        status: 'pending',
        requestedAt: new Date(),
    });

    logger.info(`[MessageIntent] queued an AI-detected request from thread ${thread._id}`);

    if (intent.missing.length > 0) {
        await askForMissingDetails({ request, thread });
    }

    return request;
};

/**
 * A later message on a thread that already has a request waiting.
 *
 * Treated as the client answering, not asking again. Only fills gaps that are still
 * open — it never rewrites a description the admin may already have read.
 */
const fillGaps = async ({ existing, rawText, user, thread }) => {
    if (existing.missingDetails.length === 0) return existing;

    const intent = await MessageIntent.detectTaskRequest(rawText);
    if (!intent.isRequest) return existing;

    const bundle = buildIdentityBundle(user);
    const stillMissing = intent.missing.filter((key) => existing.missingDetails.includes(key));

    if (intent.neededBy && !existing.neededBy) existing.neededBy = new Date(intent.neededBy);

    /**
     * Appended, never replaced. The admin may already have read the original, and
     * silently swapping it underneath them would mean the queue said something different
     * from what they remembered deciding on.
     */
    if (intent.description && !existing.missingDetails.includes('timing')) {
        existing.descriptionRaw = `${existing.descriptionRaw}\n\n${intent.description}`;
        existing.description = `${existing.description}\n\n${redactAll(intent.description, bundle).text}`;
    }

    existing.missingDetails = stillMissing;
    await existing.save();

    logger.info(`[MessageIntent] filled gaps on request ${existing._id} from a follow-up`);
    return existing;
};

/**
 * Ask the client for what is missing — once, ever.
 *
 * `detailsRequestedAt` is the guard. A thread where the client keeps replying without
 * answering would otherwise be met with the same question every time, which reads as a
 * system that is not listening and is worse than not asking at all.
 *
 * Non-fatal: the request is already queued and an admin can simply ask themselves.
 */
const askForMissingDetails = async ({ request, thread }) => {
    if (request.detailsRequestedAt) return;

    const question = MessageIntent.missingDetailsQuestion(request.missingDetails);
    if (!question) return;

    try {
        const { sendAutomatedReply } = require('../Gmail/GmailSendService.js');

        await sendAutomatedReply({
            threadId: thread._id,
            body: [
                'Thanks — we have noted this down as a request.',
                '',
                question,
                '',
                'Once we have that, your account team will confirm the timeline.',
            ].join('\n'),
        });

        request.detailsRequestedAt = new Date();
        await request.save();
    } catch (error) {
        logger.warn(`[MessageIntent] could not ask for details on ${request._id}: ${error.message}`);
    }
};

/**
 * Read a staff reply for a decision on the request waiting in this conversation.
 *
 * STAGES it. Nothing here changes a status or touches Zoho — see the file header for
 * why this one path is deliberately not automatic.
 */
const handleStaffMessage = async ({ rawText, thread, message }) => {
    const pending = await TaskRequest.findOne({ sourceThreadId: thread._id, status: 'pending' });
    // No request waiting means "yes, go ahead" refers to nothing in particular, and
    // asking the model to interpret it would invite an answer about something else.
    if (!pending) return null;

    const decision = await MessageIntent.detectDecision(rawText);
    if (!decision.actionable) return null;

    pending.stagedDecision = {
        intent: decision.intent,
        reason: decision.reason || null,
        confidence: decision.confidence,
        detectedAt: new Date(),
        sourceMessageId: message._id,
    };
    await pending.save();

    logger.info(`[MessageIntent] staged a ${decision.intent} on request ${pending._id} for confirmation`);
    return pending;
};

/**
 * The ingest hook. One call, wrapped, so a failure here can never cost a message.
 *
 * @param {object} args
 * @param {string} args.direction  'inbound' (client) or 'outbound' (staff)
 * @param {string} args.origin     skipped for anything we wrote ourselves
 */
const analyseMessage = async ({ direction, origin, rawText, user, thread, message }) => {
    try {
        // Never analyse our own writing. An automated follow-up read back as a client
        // request would queue a request describing our own question.
        if (origin && origin !== 'email') return null;
        if (!rawText || !thread || !message) return null;

        return direction === 'inbound'
            ? await handleClientMessage({ rawText, user, thread, message })
            : await handleStaffMessage({ rawText, thread, message });
    } catch (error) {
        logger.error(`[MessageIntent] analysis failed (message stored regardless): ${error.message}`);
        return null;
    }
};

module.exports = { analyseMessage, handleClientMessage, handleStaffMessage, askForMissingDetails };
