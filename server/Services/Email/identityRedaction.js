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

/* ------------------------------------------------------------------ */
/* Phone shapes, and the identifiers that must survive them            */
/* ------------------------------------------------------------------ */

/**
 * Gmail's plain-text rendering of an auto-linked number or address.
 *
 * Gmail writes "+1 (818) 308-1444<tel:(818)%20308-1444>" into the text/plain part. The
 * visible number is redacted by the patterns below, but the artifact carries a second
 * copy — and one beginning with "(" defeated the scheme-link rule, whose character class
 * excluded parentheses. The result was "[phone]<tel:(818)%20308-1444>": a placeholder
 * sitting next to the number it was supposed to replace.
 *
 * Stripping the whole wrapper is better than redacting inside it, because "<[link]>" left
 * in the middle of a signature is noise a staff member has to read past.
 */
const cleanGmailArtifacts = (text) => String(text)
    .replace(/[ \t]?<tel:[^>]*>/gi, '')
    .replace(/[ \t]?<mailto:[^>]*>/gi, '')
    .replace(/[ \t]?<callto:[^>]*>/gi, '')
    // "+1 (818) 308-1444 <(818)%20308-1444>" — the same thing without the scheme.
    .replace(/[ \t]?<\+?\(?\d[\d()%+\-. ]*>/g, '');

const SENTINEL_OPEN = '⟦';
const SENTINEL_CLOSE = '⟧';
const SENTINEL_RE = /⟦ID(\d+)⟧/g;

/**
 * Labels that introduce a business identifier. The value after one is protected.
 *
 * ── WHY PROTECTION EXISTS AT ALL ──
 * A case number, a SKU and a UPC are 9-14 digits, which is exactly a phone number. No
 * pattern can tell them apart by shape, so the only way to redact aggressively without
 * eating them is to take them out of the text first and put them back afterwards.
 *
 * Over-redaction here is not cosmetic. This module's own history records what it costs:
 * matching a bare email local part rewrote "hold the Walmart listings until Friday" as
 * "hold the [email] listings until Friday", destroying the meaning of nearly every
 * message about the channel the client's project exists to serve. An eaten order number
 * does the same thing to a task brief.
 */
const ID_LABEL = '(?:asins?|fnskus?|skus?|upcs?|eans?|gtins?|isbns?|msku|'
    + 'items?(?:\\s*(?:no\\.?|number|#))?|models?(?:\\s*(?:no\\.?|number))?|'
    + 'orders?(?:\\s*(?:id|no\\.?|number|#))?|cases?(?:\\s*(?:id|no\\.?|number|#))?|'
    + 'tickets?(?:\\s*(?:id|no\\.?|#))?|shipments?(?:\\s*id)?|'
    + 'tracking(?:\\s*(?:no\\.?|number|id|#))?|invoices?(?:\\s*(?:no\\.?|number|#))?|'
    + 'po(?:\\s*(?:no\\.?|number|#))?|batch(?:\\s*id)?|'
    + 'ref(?:erence)?(?:\\s*(?:no\\.?|number|#))?|licen[cs]e(?:\\s*(?:no\\.?|number))?|'
    + 'account\\s*(?:id|no\\.?|number)|seller\\s*id|merchant\\s*(?:id|token))';
const ID_VALUE = '(?=[A-Za-z0-9\\-_/.]*\\d)[A-Za-z0-9][A-Za-z0-9\\-_/.]*[A-Za-z0-9]';
const LABELLED_ID_RE = new RegExp(`\\b${ID_LABEL}\\s*(?:#|:|=|\\bis\\b|-)?\\s*(?:#\\s*)?(${ID_VALUE})`, 'gi');
/** "Cases 13157354022 and 13186582392" — the values after the first. */
const LIST_CONTINUATION_RE = new RegExp(`^\\s*(?:,|and|&|or|/)\\s*(${ID_VALUE})`, 'i');

/** Identifiers distinctive enough to protect with no label in front of them. */
const STANDALONE_IDS = [
    /\bB0[A-Z0-9]{8}\b/g,                       // ASIN
    /\bX0[A-Z0-9]{8}\b/g,                       // FNSKU
    /\b\d{3}-\d{7}-\d{7}\b/g,                   // Amazon order id
    /\bFBA[A-Z0-9]{8,12}\b/g,                   // FBA shipment id
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,             // IPv4
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/g,  // ISO date/time
    /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,       // 10/09/2026
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,            // 14:05:22
    /(?:[$€£₹]|\b(?:USD|EUR|GBP|AUD|CAD|INR)\s?)\d[\d,]*(?:\.\d+)?/g,
    /\b\d[\d,]*(?:\.\d+)?\s?(?:%|oz|fl\s?oz|lbs?|kg|g|mg|ml|l|units?|sets?|ct|pack|pk|pcs|pieces|days?|hrs?|hours?|weeks?|months?|years?|inch(?:es)?|in|cm|mm|ft)\b/gi,
    /\b\d+(?:\.\d+)?\s?x\s?\d+(?:\.\d+)?(?:\s?x\s?\d+(?:\.\d+)?)?\b/gi,  // 13 x 8 x 13
];

const protectIdentifiers = (text, store) => {
    const keep = (value) => {
        store.push(value);
        return `${SENTINEL_OPEN}ID${store.length - 1}${SENTINEL_CLOSE}`;
    };

    // Labelled values, including lists that continue with "and" or a comma.
    let out = '';
    let last = 0;
    let match;
    LABELLED_ID_RE.lastIndex = 0;
    while ((match = LABELLED_ID_RE.exec(text)) !== null) {
        const value = match[1];
        const valueStart = match.index + match[0].lastIndexOf(value);
        out += text.slice(last, valueStart) + keep(value);
        let cursor = match.index + match[0].length;
        let continuation;
        while ((continuation = text.slice(cursor).match(LIST_CONTINUATION_RE)) !== null) {
            const segment = continuation[0];
            out += segment.slice(0, segment.lastIndexOf(continuation[1])) + keep(continuation[1]);
            cursor += segment.length;
        }
        last = cursor;
        LABELLED_ID_RE.lastIndex = cursor;
    }
    let result = out + text.slice(last);

    for (const pattern of STANDALONE_IDS) {
        result = result.replace(pattern, (hit) => (hit.includes(SENTINEL_OPEN) ? hit : keep(hit)));
    }
    return result;
};

const restoreIdentifiers = (text, store) =>
    text.replace(SENTINEL_RE, (_, index) => store[Number(index)] ?? '');

/**
 * The same text with business identifiers taken out and NOT put back.
 *
 * For callers that want to ask "is there a digit run here that is not an identifier?" —
 * messagePresenter's leak scan is the one. It cannot use `redactPhoneShapes`, because
 * that both restores the identifiers (so they still trip a digit scan) and replaces the
 * leaked numbers (so a real leak stops being visible). Scanning text that has been put
 * through a redactor tells you what the redactor would do, not what the payload holds.
 *
 * The replacement carries no digits on purpose, so it cannot itself look like a run.
 */
const withoutBusinessIdentifiers = (text) => {
    const store = [];
    return protectIdentifiers(String(text), store).replace(SENTINEL_RE, '[id]');
};

/**
 * Digit runs that are a telephone number rather than an identifier.
 *
 * Narrow ON PURPOSE. A blanket "9 to 15 digits" rule would be simpler and would eat every
 * UPC and case number in the inbox; these three require a shape a dialable number has and
 * an identifier usually does not — a separator, a leading "+", or a leading "0".
 *
 * Each consumes its own "+" or "(". Leaving one behind produces "+[phone]", which tells a
 * reader both that a number was removed and roughly where it came from.
 */
const PHONE_SHAPES = [
    // Separated: "913 269 8400", "(913) 269-8400", "+1 913.269.8400".
    /(?<![\w.])(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]){1,4}\d{2,6}(?![\w.])/g,
    // International with no separators at all: "+61424812404".
    /(?<![\w+])\+\d{8,15}(?![\w])/g,
    // National mobile/landline with no separators: "0412841105".
    /(?<![\w\-+])0\d{8,14}(?![\w\-])/g,
];

/**
 * Redact phone-shaped runs, leaving business identifiers alone.
 *
 * Shared so `redactStructural` here and `stripContacts` in TaskBriefService cannot drift.
 * They held byte-identical copies of the separated pattern, and updating one without the
 * other fails silently and badly: the brief layer would reject every rewrite containing a
 * number it had itself failed to redact, then fall back to its own un-redacted text.
 *
 * Links are NOT handled here — the two callers disagree about URLs on purpose, and that
 * disagreement is the reason they are separate functions at all.
 */
const redactPhoneShapes = (text) => {
    const store = [];
    let out = protectIdentifiers(String(text), store);
    let count = 0;

    for (const pattern of PHONE_SHAPES) {
        out = out.replace(pattern, (match) => {
            if (match.includes(SENTINEL_OPEN)) return match;
            const digits = match.replace(/\D/g, '');
            if (digits.length < 9 || digits.length > 15) return match;
            count += 1;
            return PLACEHOLDER.phone;
        });
    }

    return { text: restoreIdentifiers(out, store), count };
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

    // The Gmail "<tel:…>" wrapper goes before anything else, so the number inside it is
    // not still sitting beside the placeholder that replaced its visible twin.
    let out = cleanGmailArtifacts(text)
        // Any address at all, including ones we do not hold — a colleague's, a
        // supplier's, a second address of their own.
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => { counts.email += 1; return PLACEHOLDER.email; })
        .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, () => { counts.link += 1; return PLACEHOLDER.link; })
        // The character class allows "(" and ")" — a tel: value that begins with one,
        // which is what Gmail writes for a US number, matched nothing at all before.
        .replace(/\b(?:tel|mailto|callto|sms):[^\s<>]+/gi, () => { counts.link += 1; return PLACEHOLDER.link; });

    /*
     * Phone-shaped runs, with business identifiers protected across the pass.
     *
     * Addresses and links are resolved FIRST, deliberately: protecting identifiers before
     * them would let a date or a price inside a URL become a sentinel, and the URL pattern
     * would then no longer match the thing it was meant to remove.
     */
    const phones = redactPhoneShapes(out);
    out = phones.text;
    counts.phone += phones.count;

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
    redactPhoneShapes,
    withoutBusinessIdentifiers,
    cleanGmailArtifacts,
    redactAll,
    containsIdentity,
    PLACEHOLDER,
    ROLE_WORDS,
};
