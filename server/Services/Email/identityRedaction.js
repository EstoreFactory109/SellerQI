/**
 * identityRedaction.js — remove a client's identity from text ESF staff will read.
 *
 * This is the deterministic half of the boundary, and it is the half that must never
 * depend on a model being available. Services/AI/EmailRedactionService.js layers an
 * LLM on top to catch what regex cannot see and to repair the sentences this module
 * breaks; if that call fails, what this module produced is what ships.
 *
 * TWO PASSES, AND BOTH ARE NECESSARY:
 *
 *   redactKnown()       identifiers we hold on the user record — their name, their
 *                       addresses, their phone. Precise, and the only way to catch a
 *                       name, since no pattern describes "this is a person".
 *   redactStructural()  anything SHAPED like contact detail, whether or not we hold
 *                       it — an address, a URL, a long digit run. Catches the second
 *                       phone number they mention, the colleague's address, the
 *                       WhatsApp they typed in prose.
 *
 * Running only the first would miss every identifier we do not already store, which
 * is most of what appears in a real email. Running only the second cannot see names.
 *
 * DIRECTION MATTERS. Services/AI/ZohoTaskSummaryService.js does the mirror image —
 * hiding STAFF names from clients — and its ROLE_ACCOUNT_WORDS stoplist exists
 * because that portal has a Zoho user called "Support" and redacting it mangled
 * "Contact Amazon support". That stoplist would INVERT the guarantee here: a client's
 * own address is very often sales@ or info@ or accounts@, and those must be removed.
 * Hence the rule below that the stoplist applies to bare words only and never to
 * anything adjacent to an "@".
 *
 * Replacements are TYPED — [name], [email], [phone], [link] — not a single opaque
 * marker, so the AI repair step knows what was removed and can rebuild the sentence,
 * and so tests can assert on placeholder counts rather than on prose.
 */

const PLACEHOLDER = {
    name: '[name]',
    email: '[email]',
    phone: '[phone]',
    link: '[link]',
};

/**
 * Bare words that are roles rather than people.
 *
 * Applied ONLY to standalone name matching — never to an email local part. A client
 * genuinely called "Bill" is handled by the AI repair step, not by this list; adding
 * real first names here would leak them by design.
 */
const ROLE_WORDS = new Set([
    'support', 'team', 'admin', 'sales', 'info', 'help', 'service', 'services',
    'accounts', 'billing', 'office', 'contact', 'hello', 'noreply', 'no-reply',
]);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Everything we know that identifies this client.
 *
 * Drawn from the user record rather than the email, so it covers an assignee who
 * never wrote anything in this particular message.
 */
const buildIdentityBundle = (user = {}) => {
    const names = new Set();
    const emails = new Set();
    const phones = new Set();

    const addName = (value) => {
        const trimmed = String(value || '').trim();
        if (trimmed.length >= 3) names.add(trimmed);
    };

    addName(`${user.firstName || ''} ${user.lastName || ''}`.trim());
    addName(user.firstName);
    addName(user.lastName);

    const addEmail = (value) => {
        const normalised = String(value || '').trim().toLowerCase();
        if (normalised.includes('@')) emails.add(normalised);
    };

    addEmail(user.email);
    (user.additionalEmails || []).forEach((entry) => addEmail(entry && entry.email));

    // Unverified addresses are still redacted. Verification governs whether an address
    // may be used to authenticate — it says nothing about whether printing it leaks.
    [user.phone, user.whatsapp].forEach((value) => {
        const digits = String(value || '').replace(/\D/g, '');
        // 7 is the shortest a real subscriber number gets; below that we would be
        // matching years and quantities.
        if (digits.length < 7) return;

        phones.add(digits);

        /*
         * Also match the number WITHOUT its country code.
         *
         * A record stores "+1-913-269-8400" and the client signs off "9132698400".
         * The pattern is built from the stored digits, so it would look for a leading
         * "1" that is not there and match nothing — the national form is how people
         * actually write their own number, so missing it misses the common case.
         * The reverse (stored national, written international) is already covered by
         * the optional prefix inside phonePattern.
         */
        if (digits.length > 10) phones.add(digits.slice(-10));
    });

    return {
        names: [...names].sort((a, b) => b.length - a.length),
        emails: [...emails].sort((a, b) => b.length - a.length),
        phones: [...phones],
    };
};

/**
 * A pattern matching a digit sequence however it is punctuated.
 *
 * Real bodies contain "913 269 8400", "(913) 269-8400", "+1 913.269.8400" and
 * "913-269-8400" for one number. Matching the stored string literally finds none of
 * them, so the digits are matched with optional separators between each.
 */
const phonePattern = (digits) => {
    const body = digits.split('').map(escapeRegExp).join('[\\s.\\-()]{0,3}');
    /*
     * The leading "+" is consumed by the match, not left behind. The stored value
     * usually already carries the country code, so the optional prefix group matches
     * nothing and "+1 913…" would otherwise redact to "+[phone]" — a dangling sign
     * that tells a reader a number was there and roughly where it came from.
     *
     * The second group stays optional for the reverse case: a stored number with no
     * country code appearing in the body with one. A leading "(" is consumed for the
     * same reason as the "+": "(913) 269-8400" must not redact to "([phone]".
     */
    return new RegExp(`(?<![\\d+])\\+?\\(?(?:\\d{1,3}[\\s.\\-()]{0,3})?${body}(?!\\d)`, 'g');
};

/** Redact the identifiers we hold. */
const redactKnown = (text, bundle) => {
    // Type-guarded, not just falsy-guarded: this runs over whatever a mail parser
    // produced, and a non-string reaching .replace() would take down the whole sync
    // for one malformed message.
    if (typeof text !== 'string' || !text) return { text: '', counts: { name: 0, email: 0, phone: 0 } };

    let out = text;
    const counts = { name: 0, email: 0, phone: 0 };

    // Addresses first: an address contains the name, and redacting the name first
    // would leave a half-eaten address like "[name].kumar@x.com".
    for (const email of bundle.emails) {
        const [local, domain] = email.split('@');
        /*
         * The local part is NOT matched on its own, and that is a deliberate reversal.
         *
         * The live client's address is walmart@<brand>.com, so redacting the bare local
         * part rewrote "hold the Walmart listings until Friday" as "hold the [email]
         * listings until Friday" — destroying the operational meaning of almost every
         * message about the channel their project exists to serve. This is the same
         * class as a client named "Bill" eating "bill of lading", and local parts are
         * far more often ordinary words than surnames are.
         *
         * Nothing is lost by dropping it: a local part with no domain cannot be
         * emailed, so it is not contact detail. The full address is matched below, and
         * redactStructural independently removes anything address-shaped.
         */
        const patterns = [
            // The whole address, including a +tag the stored value lacks.
            new RegExp(`${escapeRegExp(local)}(\\+[^@\\s]*)?@${escapeRegExp(domain)}`, 'gi'),
            // The domain alone does identify — addresses at it are guessable.
            new RegExp(`(?<![\\w.@])${escapeRegExp(domain)}(?![\\w.])`, 'gi'),
        ];

        for (const pattern of patterns) {
            out = out.replace(pattern, () => { counts.email += 1; return PLACEHOLDER.email; });
        }
    }

    for (const phone of bundle.phones) {
        out = out.replace(phonePattern(phone), () => { counts.phone += 1; return PLACEHOLDER.phone; });
    }

    // Names last, longest first, so "Nitesh Kumar" is consumed before "Nitesh".
    for (const name of bundle.names) {
        if (ROLE_WORDS.has(name.toLowerCase())) continue;

        const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b(?:'s|’s)?`, 'gi');
        out = out.replace(pattern, () => { counts.name += 1; return PLACEHOLDER.name; });
    }

    return { text: out, counts };
};

/**
 * Redact anything shaped like contact detail, held or not.
 *
 * This is the pass that does not depend on knowing who the client is, and therefore
 * the one that still protects when the AI is unavailable. It is deliberately blunt:
 * an over-redacted URL costs a staff member a question, an un-redacted mobile number
 * costs the guarantee.
 */
const redactStructural = (text) => {
    if (typeof text !== 'string' || !text) return { text: '', counts: { email: 0, phone: 0, link: 0 } };

    const counts = { email: 0, phone: 0, link: 0 };

    let out = text
        // Any address at all, including ones we do not hold — a colleague's, a
        // supplier's, a second address of their own.
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => { counts.email += 1; return PLACEHOLDER.email; })
        .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, () => { counts.link += 1; return PLACEHOLDER.link; })
        .replace(/\b(?:tel|mailto|callto|sms):[^\s<>()]+/gi, () => { counts.link += 1; return PLACEHOLDER.link; });

    /*
     * Long digit runs, with separators allowed.
     *
     * Deliberately NOT a phone-number grammar: clients write numbers every way
     * imaginable and a strict pattern misses most of them. The guard against eating
     * order numbers and ASINs is the 9-digit floor plus requiring at least one
     * separator or a leading +, which is what distinguishes a dialable number from
     * an identifier. Shorter runs are left alone; a 7-digit local number we do not
     * already hold is a residual risk, and a smaller one than mangling every SKU.
     */
    out = out.replace(
        /(?<![\w.])(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]){1,4}\d{2,6}(?![\w.])/g,
        (match) => {
            const digits = match.replace(/\D/g, '');
            if (digits.length < 9 || digits.length > 15) return match;
            counts.phone += 1;
            return PLACEHOLDER.phone;
        }
    );

    return { text: out, counts };
};

/** Both passes, in the order that matters. */
const redactAll = (text, bundle) => {
    const known = redactKnown(text, bundle);
    const structural = redactStructural(known.text);

    return {
        text: structural.text,
        counts: {
            name: known.counts.name,
            email: known.counts.email + structural.counts.email,
            phone: known.counts.phone + structural.counts.phone,
            link: structural.counts.link,
        },
    };
};

/**
 * Does this text still carry identity? The gate on the AI's output.
 *
 * Re-runs both passes and reports what changed. Used to reject a model response that
 * reintroduced something — including one that hallucinated a plausible name back in.
 */
const containsIdentity = (text, bundle) => {
    if (!text) return { clean: true, found: [] };

    const found = [];
    const { counts } = redactAll(text, bundle);

    if (counts.name > 0) found.push('name');
    if (counts.email > 0) found.push('email');
    if (counts.phone > 0) found.push('phone');
    if (counts.link > 0) found.push('link');

    return { clean: found.length === 0, found };
};

module.exports = {
    buildIdentityBundle,
    redactKnown,
    redactStructural,
    redactAll,
    containsIdentity,
    PLACEHOLDER,
    ROLE_WORDS,
};
