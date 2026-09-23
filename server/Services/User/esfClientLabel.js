/**
 * esfClientLabel.js — how a client is named to someone who must not learn who they are.
 *
 * One implementation, because there are already four inlined copies of
 * `seller?.brand || null` across the codebase and this adds a rule they do not have.
 *
 * PRECEDENCE, and why it is this order:
 *
 *   1. the linked Zoho project name   the label staff already use for this client's
 *                                     work, so the inbox matches the task board
 *   2. the Seller brand               often absent, and sometimes junk — the live
 *                                     account's only populated brand is the literal
 *                                     string "Generic", which is why it is not first
 *   3. a stored reference             "EF-1184". The only genuinely anonymous option,
 *                                     and the only one guaranteed to exist
 *
 * Measured on the live data when this was written: 2 of 3 ESF clients had neither a
 * project nor a brand, so without step 3 most threads would be unlabelable.
 *
 * ── THE REFERENCE MUST BE STORED, NEVER DERIVED ──
 * It is a random value persisted on the user. It must never be a hash or truncation
 * of the email, name or id, because staff can list every client's email from the
 * Clients page — and a derived code could then be computed for all of them and joined
 * back to the inbox in a single script, de-anonymising every thread at once.
 *
 * ── WHAT THIS DOES NOT HIDE ──
 * Steps 1 and 2 identify the COMPANY. "Morgan's Repellent" resolves to
 * morgansrepellent.com and from there to an address. The individual is hidden; the
 * business is not. Only step 3 is anonymous. This was decided knowingly — a staff
 * inbox labelled entirely with EF-#### is very hard to work in — but it must not be
 * described as full anonymity.
 */

const crypto = require('crypto');

const REFERENCE_PREFIX = 'EF-';

/**
 * A fresh reference. Random, not derived — see the header.
 *
 * Four digits read like the ticket numbers the design mock used ("EF-1184") while the
 * underlying value has far more entropy than four digits would, so two clients
 * colliding is a stored-uniqueness question rather than a birthday problem.
 */
const generateClientReference = () => {
    const n = crypto.randomInt(1000, 1000000);
    return `${REFERENCE_PREFIX}${n}`;
};

/**
 * What to call this client.
 *
 * @param {object} user    needs zohoProject and esfClientRef
 * @param {object} [seller] the Seller document, if the caller already loaded it
 * @returns {{ label: string, source: 'project'|'brand'|'reference' }}
 */
const esfClientLabel = (user = {}, seller = null) => {
    const project = user?.zohoProject?.projectName;
    if (project && String(project).trim()) {
        return { label: String(project).trim(), source: 'project' };
    }

    const brand = seller?.brand;
    if (brand && String(brand).trim()) {
        return { label: String(brand).trim(), source: 'brand' };
    }

    // Never invent one here — an unsaved reference would differ between requests and
    // the same client would appear under two labels. Callers persist it once.
    return {
        label: user?.esfClientRef || `${REFERENCE_PREFIX}unknown`,
        source: 'reference',
    };
};

module.exports = { esfClientLabel, generateClientReference, REFERENCE_PREFIX };
