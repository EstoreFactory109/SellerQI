/**
 * inboundRouting.js — what to do with a message Gmail just handed us.
 *
 * A pure decision, taken BEFORE any database lookup, returning a plan rather than
 * performing one. Kept separate from ingestion because this is where the conversation
 * record is won or lost, and because a decision with no I/O can be tested exhaustively
 * against the awkward cases rather than against a live mailbox.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ──
 * Only the admin can access the shared inbox, and they will often just hit Reply in
 * Gmail rather than open the portal. A matcher-first design looks that message up by
 * its sender, finds our own address, matches no client, files it as an unmatched
 * sender and DROPS IT. The thread then sits on "Needs a reply" after it was answered,
 * the client's portal shows ESF going silent on a conversation they have already had,
 * and nothing anywhere reveals the loss. Direction has to be settled first.
 *
 * ── WHY THE LABEL DECIDES, NOT THE `From` ADDRESS ──
 * The obvious rule is `From === inboxAddress → outbound`. It is wrong in both
 * directions:
 *
 *   - `From` is trivially forged. Treating it as proof of "this came from us" makes an
 *     authorization decision out of an attacker-controlled string: spoof it and you
 *     post into any client's thread as ESF.
 *   - The usual answer — require DKIM — cannot work here. `Authentication-Results` is
 *     stamped by the RECEIVING server, so our own sent mail does not carry one at all.
 *     Requiring it would reject exactly the messages this module exists to rescue.
 *
 * The `SENT` label is the honest signal. Gmail applies it only to mail this account
 * actually sent; a spoofed message claiming to be from us arrives in `INBOX` like any
 * other. It is assigned by the mailbox we authenticated to, not by the sender.
 */

/** Strip a display name and normalise: `"Nitesh Kumar" <A@B.com>` → `a@b.com`. */
const normalizeAddress = (value) => {
    if (typeof value !== 'string') return '';
    const angled = value.match(/<([^>]+)>/);
    return (angled ? angled[1] : value).trim().toLowerCase();
};

const normalizeList = (values) => (Array.isArray(values) ? values : [values])
    .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
    .map(normalizeAddress)
    .filter(Boolean);

/**
 * Gmail's own verdict on whether the sender is who they claim.
 *
 * `dkim=pass` OR `spf=pass` — not both. Requiring both breaks legitimately forwarded
 * mail and mailing lists, which is a real pattern for a client looping in the agency,
 * and rejecting those would recreate the silent-loss problem in a different place.
 */
const authenticationPassed = (header) => {
    if (typeof header !== 'string' || !header) return false;
    return /\b(dkim|spf)\s*=\s*pass\b/i.test(header);
};

const skip = (reason) => ({ action: 'skip', reason });

/**
 * Decide how a message should be recorded.
 *
 * @param {object} message
 * @param {string[]} [message.labelIds]        Gmail's labels — the direction signal.
 * @param {string}   [message.fromEmail]
 * @param {string[]} [message.toEmails]
 * @param {string}   [message.gmailThreadId]
 * @param {string}   [message.originHeader]    X-SellerQI-Origin, if we sent it ourselves.
 * @param {string}   [message.authenticationResults]
 * @param {object} options
 * @param {string} options.inboxAddress        The connected shared inbox.
 *
 * @returns {object} `{action:'skip', reason}` or `{action:'ingest', direction, origin,
 *   lookup}`. `lookup` is an ordered list of strategies for finding the client; the
 *   ingest service takes the first that resolves.
 */
const routeMessage = (message = {}, { inboxAddress } = {}) => {
    const inbox = normalizeAddress(inboxAddress);
    if (!inbox) throw new Error('[inboundRouting] inboxAddress is required');

    const labels = new Set(message.labelIds || []);

    /**
     * A draft is a reply the admin is still typing — Gmail saves it every few seconds
     * and it appears in history like any other message. Ingesting one publishes
     * half-written text to the client, and the client's page has no concept of an edit.
     * Checked first because a draft also carries SENT-adjacent labels and would
     * otherwise fall straight through the outbound branch.
     */
    if (labels.has('DRAFT')) return skip('draft');

    // Deleted or junked upstream. Recording them would resurrect, in the portal, mail
    // the admin has already dealt with in Gmail.
    if (labels.has('TRASH')) return skip('trashed');
    if (labels.has('SPAM')) return skip('spam');

    /**
     * Our own write, echoed back.
     *
     * Both portal paths put a message INTO Gmail — the client's reply by insert, the
     * staff reply by send — and both come back through the watch looking like new
     * mail. We already wrote them to Mongo directly, so re-ingesting duplicates every
     * portal message. The header is the first of two guards; the second is Message-ID
     * reconciliation in the ingest service, which covers the race where the
     * notification arrives before our own write has landed.
     */
    if (message.originHeader) {
        /**
         * A task-request email is a NOTIFICATION, not part of a conversation — it has no
         * EmailMessage row and never will.
         *
         * That distinction matters because the caller defers 'portal-echo' when it finds
         * no local copy, on the assumption that our own write is merely late. Here there
         * is nothing to be late: deferring one would re-queue it on every sync forever
         * and grow the retry backlog until it raised an alarm about a message that was
         * never meant to be stored.
         */
        if (message.originHeader === 'portal-task-request') return skip('task-request-notification');
        return skip('portal-echo');
    }

    const from = normalizeAddress(message.fromEmail);
    const recipients = normalizeList(message.toEmails || []);

    /**
     * OUTBOUND — the admin replied from Gmail.
     *
     * The client is identified from the THREAD, never from the sender: Gmail keeps a
     * reply in its conversation, so `gmailThreadId` already points at a thread we know
     * the owner of. The sender never has to be identified at all, only recognised as
     * not being a client.
     */
    if (labels.has('SENT')) {
        const lookup = [];
        if (message.gmailThreadId) {
            lookup.push({ by: 'thread', value: message.gmailThreadId });
        }
        /**
         * No known thread means the admin composed a fresh email to a client from
         * Gmail, so fall back to the recipient. Dropping this case would recreate the
         * silent gap for every conversation the admin starts rather than continues.
         */
        recipients
            .filter((address) => address !== inbox)
            .forEach((address) => lookup.push({ by: 'address', value: address }));

        if (lookup.length === 0) return skip('outbound-no-recipient');

        return {
            action: 'ingest',
            direction: 'outbound',
            // Distinct from 'portal-staff': this one never passed through the portal,
            // which is why its quoted chain still holds the client's raw signature.
            origin: 'email',
            lookup,
        };
    }

    // INBOUND from here down.

    if (!from) return skip('no-sender');

    /**
     * Claims to be us but is not in SENT — so it was received, not sent. Either a
     * spoof or the inbox mailing itself; neither should open a thread, and a thread
     * matched against our own address would be a thread against ourselves.
     */
    if (from === inbox) return skip('spoofed-self');

    /**
     * `From` is only trustworthy once Gmail has checked it. Without this, anyone can
     * inject messages into a client's thread by putting the client's address in `From`
     * — and those messages are then shown to staff as the client's own words.
     */
    if (!authenticationPassed(message.authenticationResults)) {
        return skip('authentication-failed');
    }

    return {
        action: 'ingest',
        direction: 'inbound',
        origin: 'email',
        lookup: [{ by: 'address', value: from }],
    };
};

module.exports = { routeMessage, normalizeAddress, normalizeList, authenticationPassed };
