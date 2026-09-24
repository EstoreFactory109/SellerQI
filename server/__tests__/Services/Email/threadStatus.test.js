/**
 * Thread status, and the label inversion between the two audiences.
 *
 * The bug this file exists to prevent: the design mock's labels are written from the
 * client's seat, so "Awaiting your reply" means *the client owes a reply*. Reused
 * verbatim on the staff page it tells a staff member the opposite of the truth — they
 * would read "Awaiting your reply" on a thread where the ball is in the client's court
 * and chase nothing.
 */

const { deriveThreadStatus, STATE } = require('../../../Services/Email/threadStatus.js');

const inboundLast = { lastMessageDirection: 'inbound' };
const outboundLast = { lastMessageDirection: 'outbound' };

describe('state derivation', () => {
    test('a client message last means the agency owes a reply', () => {
        expect(deriveThreadStatus(inboundLast).state).toBe(STATE.AWAITING_AGENCY);
    });

    test('an agency message last means the client owes a reply', () => {
        expect(deriveThreadStatus(outboundLast).state).toBe(STATE.AWAITING_CLIENT);
    });

    test('resolved overrides direction', () => {
        expect(deriveThreadStatus({ ...inboundLast, resolvedAt: new Date() }).state).toBe(STATE.RESOLVED);
    });

    test('an empty thread does not throw', () => {
        expect(() => deriveThreadStatus()).not.toThrow();
        expect(() => deriveThreadStatus({})).not.toThrow();
    });
});

describe('the two label maps are inverses', () => {
    test('the same thread reads oppositely to each audience', () => {
        // One state, two readings. This is the assertion that stops the mock's
        // client-seat wording being pasted onto the staff page.
        const client = deriveThreadStatus(outboundLast, { audience: 'client' });
        const staff = deriveThreadStatus(outboundLast, { audience: 'staff' });

        expect(client.label).toBe('Awaiting your reply');   // client owes
        expect(staff.label).toBe('Waiting on client');      // …said from the other side
        expect(client.state).toBe(staff.state);
    });

    test('and again in the other direction', () => {
        const client = deriveThreadStatus(inboundLast, { audience: 'client' });
        const staff = deriveThreadStatus(inboundLast, { audience: 'staff' });

        expect(client.label).toBe('Open');
        expect(staff.label).toBe('Needs a reply');
    });

    test('no label means the same thing to both audiences except Resolved', () => {
        const resolved = { ...inboundLast, resolvedAt: new Date() };
        expect(deriveThreadStatus(resolved, { audience: 'client' }).label)
            .toBe(deriveThreadStatus(resolved, { audience: 'staff' }).label);

        [inboundLast, outboundLast].forEach((thread) => {
            expect(deriveThreadStatus(thread, { audience: 'client' }).label)
                .not.toBe(deriveThreadStatus(thread, { audience: 'staff' }).label);
        });
    });
});

describe('needsAttention is audience-relative too', () => {
    test('each side is flagged only when it is the one holding things up', () => {
        // What each page sorts and badges on — the inverse of the other.
        expect(deriveThreadStatus(inboundLast, { audience: 'staff' }).needsAttention).toBe(true);
        expect(deriveThreadStatus(inboundLast, { audience: 'client' }).needsAttention).toBe(false);

        expect(deriveThreadStatus(outboundLast, { audience: 'client' }).needsAttention).toBe(true);
        expect(deriveThreadStatus(outboundLast, { audience: 'staff' }).needsAttention).toBe(false);
    });

    test('a resolved thread needs nobody', () => {
        const resolved = { ...inboundLast, resolvedAt: new Date() };
        expect(deriveThreadStatus(resolved, { audience: 'staff' }).needsAttention).toBe(false);
        expect(deriveThreadStatus(resolved, { audience: 'client' }).needsAttention).toBe(false);
    });
});

describe('unknown audience', () => {
    test('falls back to client labels rather than undefined', () => {
        expect(deriveThreadStatus(inboundLast, { audience: 'nonsense' }).label).toBe('Open');
    });
});
