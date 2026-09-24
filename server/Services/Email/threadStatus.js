/**
 * threadStatus.js — what state a conversation is in, and what to call it.
 *
 * Status is DERIVED, not stored, except for "resolved" which is a deliberate staff
 * action. Everything else follows from the direction of the last message, so it can
 * never go stale or disagree with the thread it describes.
 *
 * ── THE LABELS ARE AUDIENCE-RELATIVE, AND THAT IS THE WHOLE POINT OF THIS FILE ──
 *
 * The design mock (client/src/Pages/ESF/EstoreFactory/Messages.jsx) is written from
 * the CLIENT's seat. On it, "Awaiting your reply" sits on a thread whose last message
 * came from the agency — meaning *the client owes a reply*.
 *
 * Reuse that string on the staff page and it says the exact opposite of the truth: a
 * staff member would read "Awaiting your reply" on a thread where the ball is in the
 * client's court, and chase nothing. One state, two label maps, and a test asserting
 * they are inverses of each other.
 */

/** The states a thread can be in. Stable keys; the labels below are presentation. */
const STATE = {
    RESOLVED: 'resolved',
    /** Last word was the client's — the agency owes a reply. */
    AWAITING_AGENCY: 'awaiting_agency',
    /** Last word was the agency's — the client owes a reply. */
    AWAITING_CLIENT: 'awaiting_client',
};

const LABELS = {
    client: {
        [STATE.RESOLVED]: 'Resolved',
        // The client sent the last message, so they are waiting on ESF.
        [STATE.AWAITING_AGENCY]: 'Open',
        // ESF sent the last message, so the client owes an answer.
        [STATE.AWAITING_CLIENT]: 'Awaiting your reply',
    },
    staff: {
        [STATE.RESOLVED]: 'Resolved',
        // Inverted from the client map: here the agency is the one who owes a reply.
        [STATE.AWAITING_AGENCY]: 'Needs a reply',
        [STATE.AWAITING_CLIENT]: 'Waiting on client',
    },
};

/**
 * @param {object} thread            needs resolvedAt and lastMessageDirection
 * @param {object} [options]
 * @param {'client'|'staff'} [options.audience]
 * @returns {{ state: string, label: string, needsAttention: boolean }}
 */
const deriveThreadStatus = (thread = {}, { audience = 'client' } = {}) => {
    const state = thread.resolvedAt
        ? STATE.RESOLVED
        : thread.lastMessageDirection === 'inbound'
            ? STATE.AWAITING_AGENCY
            : STATE.AWAITING_CLIENT;

    const labels = LABELS[audience] || LABELS.client;

    /**
     * Whether THIS audience is the one holding things up — what each page sorts and
     * badges on. Deliberately audience-relative for the same reason the labels are.
     */
    const needsAttention = state === (audience === 'staff' ? STATE.AWAITING_AGENCY : STATE.AWAITING_CLIENT);

    return { state, label: labels[state], needsAttention };
};

module.exports = { deriveThreadStatus, STATE, LABELS };
