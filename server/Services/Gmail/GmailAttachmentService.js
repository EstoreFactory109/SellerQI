/**
 * GmailAttachmentService.js — fetching the bytes behind an attachment.
 *
 * Both Messages pages have rendered attachment names since they were built, and until
 * now nothing could open them: the metadata was stored, `getAttachment` existed, and no
 * route ever called it. The names were decoration.
 *
 * ── BYTES ARE NEVER STORED, AND THAT IS WHY THIS IS INDIRECT ──
 * The models keep filename, type and size only. Gmail holds the file. So a download is
 * a live fetch, which means an attachment is only ever as available as the Gmail
 * message it belongs to — delete the mail and the link dies. That is the intended
 * trade: attachments are frequently the largest and most sensitive thing in a
 * conversation, and the one copy of them lives in one place.
 *
 * ── ADDRESSED BY POSITION, NOT BY GMAIL'S ATTACHMENT ID ──
 * Gmail assigns attachment ids when it stores a message, so anything we sent ourselves
 * has none until the message is read back. Rather than re-fetch every sent message to
 * learn ids we would then have to keep in sync, a download identifies the file by its
 * index in the message's own attachment list and resolves the id live. One rule for
 * both directions, and nothing stored that can go stale.
 *
 * ── THE KNOWN EXCEPTION THIS MAKES CONCRETE ──
 * Attachment CONTENTS cannot be redacted. A PDF letterhead, EXIF owner data, a DOCX
 * dc:creator, a photographed business card — all of it identifies the client, and staff
 * can open every one. That was decided knowingly and is restated here because this file
 * is where it stops being theoretical: the filename served below is redacted, the bytes
 * are not.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { EmailMessage } = require('../../models/system/EmailThreadModels.js');
const GmailClient = require('./GmailClient.js');
const { parseMessage } = require('./gmailMessageParser.js');

/** Anything not on this list is served as a download rather than rendered inline. */
const INLINE_SAFE = [/^image\//, /^application\/pdf$/, /^text\/plain$/];

/**
 * Resolve one attachment to its bytes.
 *
 * @param {object} args
 * @param {string} args.messageId  our EmailMessage _id
 * @param {string} args.threadId   the thread it must belong to
 * @param {number} args.index      position in that message's attachment list
 * @param {string} [args.userId]   when present, the message must also belong to them
 * @returns {{ buffer: Buffer, filename: string, mimeType: string, inline: boolean }}
 */
const fetchAttachment = async ({ messageId, threadId, index, userId = null }) => {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0) {
        throw new ApiError(400, 'Invalid attachment reference');
    }

    /**
     * Scoped in the query, not checked afterwards.
     *
     * threadId is in the filter as well as the message id so a message id alone cannot
     * be used to pull a file out of a conversation the caller is not looking at, and
     * userId is added for clients so one cannot read another's at all.
     */
    const message = await EmailMessage.findOne({
        _id: messageId,
        threadId,
        ...(userId ? { userId } : {}),
    }).select('gmailMessageId attachments').lean();

    if (!message) throw new ApiError(404, 'Attachment not found');

    const record = (message.attachments || [])[position];
    if (!record) throw new ApiError(404, 'Attachment not found');

    // Read the message back to learn Gmail's own id for this file. Also the check that
    // it still exists — a message deleted in Gmail 404s here rather than serving stale.
    const raw = await GmailClient.getMessage(message.gmailMessageId);
    const live = parseMessage(raw).attachments[position];

    if (!live?.attachmentId) {
        throw new ApiError(410, 'That file is no longer available in the mailbox');
    }

    const payload = await GmailClient.getAttachment(message.gmailMessageId, live.attachmentId);
    if (!payload?.data) throw new ApiError(502, 'Gmail returned no data for that attachment');

    return {
        buffer: Buffer.from(String(payload.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
        // The REDACTED name, never the one Gmail holds — the original can carry the
        // client's own name, which is the whole reason it was redacted at ingest.
        filename: record.filenameRedacted || 'attachment',
        mimeType: record.mimeType || 'application/octet-stream',
        inline: INLINE_SAFE.some((pattern) => pattern.test(record.mimeType || '')),
    };
};

/**
 * Write an attachment to an Express response.
 *
 * `Content-Disposition: attachment` for anything not on the inline-safe list, because a
 * browser rendering an arbitrary uploaded file in our own origin is how a stored XSS
 * arrives. `X-Content-Type-Options: nosniff` stops the browser second-guessing us.
 */
const sendAttachment = (res, { buffer, filename, mimeType, inline }) => {
    const safeName = String(filename).replace(/["\\\r\n]/g, '');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`
    );
    return res.send(buffer);
};

module.exports = { fetchAttachment, sendAttachment, INLINE_SAFE };
