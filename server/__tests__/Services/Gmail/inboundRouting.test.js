/**
 * Routing a message Gmail handed us.
 *
 * The suite is built around the defect this module exists for: a reply the admin sent
 * from Gmail must become part of the conversation record, not vanish. Everything below
 * the first block guards the ways that rescue could turn into a different hole —
 * ingesting drafts, trusting a forged `From`, or duplicating our own writes.
 */

const { routeMessage, normalizeAddress, authenticationPassed } = require('../../../Services/Gmail/inboundRouting.js');

const INBOX = 'hello@estorefactory.com';
const opts = { inboxAddress: INBOX };

/** A received message that passed Gmail's checks — the ordinary inbound case. */
const inbound = (over = {}) => ({
    labelIds: ['INBOX', 'UNREAD'],
    fromEmail: 'walmart@morgansrepellent.com',
    toEmails: [INBOX],
    gmailThreadId: 'thread-1',
    authenticationResults: 'mx.google.com; dkim=pass header.i=@morgansrepellent.com; spf=pass',
    ...over,
});

/** A reply the admin sent from Gmail. Note: no Authentication-Results — see below. */
const adminReply = (over = {}) => ({
    labelIds: ['SENT'],
    fromEmail: `"eStore Factory" <${INBOX}>`,
    toEmails: ['walmart@morgansrepellent.com'],
    gmailThreadId: 'thread-1',
    ...over,
});

describe('a reply the admin sent from Gmail', () => {
    test('is ingested as outbound, not dropped as an unmatched sender', async () => {
        // The whole point. Matching on the sender finds our own address, matches no
        // client, and files this as unmatched — losing a message the client has
        // already received and leaving the thread on "Needs a reply".
        const decision = routeMessage(adminReply(), opts);

        expect(decision.action).toBe('ingest');
        expect(decision.direction).toBe('outbound');
    });

    test('finds the client through the thread, never through the sender', async () => {
        const { lookup } = routeMessage(adminReply(), opts);

        expect(lookup[0]).toEqual({ by: 'thread', value: 'thread-1' });
    });

    test('is recorded as origin email, distinct from a portal reply', async () => {
        // The distinction is load-bearing downstream: this one never passed through
        // the portal, so its quoted chain still holds the client's raw signature.
        expect(routeMessage(adminReply(), opts).origin).toBe('email');
    });

    test('does not need Gmail to vouch for the sender, because it cannot', async () => {
        // Authentication-Results is stamped by the RECEIVING server, so our own sent
        // mail has none. Requiring it here would reject every message this module
        // exists to rescue.
        const decision = routeMessage(adminReply({ authenticationResults: undefined }), opts);

        expect(decision.action).toBe('ingest');
    });

    test('a fresh email the admin composes falls back to the recipient', async () => {
        // No thread yet. Dropping this would recreate the silent gap for every
        // conversation the admin starts rather than continues.
        const { lookup } = routeMessage(adminReply({ gmailThreadId: null }), opts);

        expect(lookup).toEqual([{ by: 'address', value: 'walmart@morgansrepellent.com' }]);
    });

    test('our own address is never a lookup candidate', async () => {
        const { lookup } = routeMessage(
            adminReply({ gmailThreadId: null, toEmails: [INBOX, 'walmart@morgansrepellent.com'] }),
            opts
        );

        expect(lookup.map((l) => l.value)).not.toContain(INBOX);
    });

    test('with nothing to match on it is skipped rather than guessed at', async () => {
        const decision = routeMessage(adminReply({ gmailThreadId: null, toEmails: [] }), opts);

        expect(decision.action).toBe('skip');
        expect(decision.reason).toBe('outbound-no-recipient');
    });
});

describe('the label decides direction, not the From address', () => {
    test('a forged From claiming to be us cannot post as ESF', async () => {
        // The reason this module routes on SENT. `From` is attacker-controlled; the
        // label is assigned by the mailbox we authenticated to. Routing on the address
        // would turn a spoofed header into "this is an official ESF reply".
        const spoof = inbound({ fromEmail: INBOX, labelIds: ['INBOX'] });

        const decision = routeMessage(spoof, opts);

        expect(decision.action).toBe('skip');
        expect(decision.reason).toBe('spoofed-self');
        expect(decision.direction).toBeUndefined();
    });

    test('a display name on our own address does not defeat the outbound path', async () => {
        expect(routeMessage(adminReply(), opts).direction).toBe('outbound');
    });
});

describe('drafts', () => {
    test('a reply still being typed is never published to the client', async () => {
        // Gmail autosaves a draft every few seconds and it appears in history like any
        // other message. The client's page has no concept of an edit, so a draft
        // ingested is half a sentence shown to the client permanently.
        const decision = routeMessage(adminReply({ labelIds: ['DRAFT', 'SENT'] }), opts);

        expect(decision.action).toBe('skip');
        expect(decision.reason).toBe('draft');
    });
});

describe('our own writes echoing back', () => {
    test.each(['portal-client', 'portal-staff'])('%s is skipped, not duplicated', async (origin) => {
        // Both portal paths put a message into Gmail and both come back through the
        // watch looking like new mail. Without this every portal message appears twice.
        const decision = routeMessage(adminReply({ originHeader: origin }), opts);

        expect(decision.action).toBe('skip');
        expect(decision.reason).toBe('portal-echo');
    });
});

describe('inbound client mail', () => {
    test('is ingested and matched on the sender', async () => {
        const decision = routeMessage(inbound(), opts);

        expect(decision).toMatchObject({
            action: 'ingest',
            direction: 'inbound',
            lookup: [{ by: 'address', value: 'walmart@morgansrepellent.com' }],
        });
    });

    test('a spoofed client address is refused', async () => {
        // Without this, anyone can inject messages into a client's thread by putting
        // the client's address in From — and staff are then shown them as the
        // client's own words.
        const decision = routeMessage(inbound({
            authenticationResults: 'mx.google.com; dkim=fail; spf=fail; dmarc=fail',
        }), opts);

        expect(decision.action).toBe('skip');
        expect(decision.reason).toBe('authentication-failed');
    });

    test('a missing verdict is refused too, rather than assumed good', async () => {
        expect(routeMessage(inbound({ authenticationResults: undefined }), opts).reason)
            .toBe('authentication-failed');
    });

    test('forwarded mail passing only SPF is still accepted', async () => {
        // Requiring both breaks forwarding and mailing lists — a real pattern when a
        // client loops the agency in — and would lose those messages silently, which
        // is the same failure in a different place.
        const decision = routeMessage(inbound({
            authenticationResults: 'mx.google.com; dkim=fail; spf=pass smtp.mailfrom=x.com',
        }), opts);

        expect(decision.action).toBe('ingest');
    });

    test.each(['TRASH', 'SPAM'])('%s mail is left where the admin put it', async (label) => {
        expect(routeMessage(inbound({ labelIds: ['INBOX', label] }), opts).action).toBe('skip');
    });

    test('a message with no sender is skipped', async () => {
        expect(routeMessage(inbound({ fromEmail: '' }), opts).reason).toBe('no-sender');
    });
});

describe('address handling', () => {
    test.each([
        ['"Nitesh Kumar" <A@B.com>', 'a@b.com'],
        ['  Plain@Example.COM  ', 'plain@example.com'],
        ['<x@y.io>', 'x@y.io'],
    ])('%s normalises to %s', async (input, expected) => {
        expect(normalizeAddress(input)).toBe(expected);
    });

    test('a comma-separated To list is split, as Gmail returns it', async () => {
        const { lookup } = routeMessage(adminReply({
            gmailThreadId: null,
            toEmails: ['"A" <a@x.com>, b@y.com'],
        }), opts);

        expect(lookup.map((l) => l.value)).toEqual(['a@x.com', 'b@y.com']);
    });

    test('authenticationPassed is not fooled by the word pass elsewhere', async () => {
        expect(authenticationPassed('dkim=fail (passwords); spf=softfail')).toBe(false);
    });
});

describe('configuration', () => {
    test('refuses to route without a configured inbox', async () => {
        // Defaulting here would silently route every message as inbound, which is the
        // original bug wearing a different hat.
        expect(() => routeMessage(inbound(), {})).toThrow(/inboxAddress/);
    });
});
