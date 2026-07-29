/**
 * spApiErrors.js — classification of SP-API failure responses.
 *
 * WHY THIS EXISTS
 * SP-API answers an EXPIRED access token with HTTP **403**, not 401 — the same status it
 * uses for a genuine authorization denial, and the same status the Solicitations API uses
 * for the perfectly normal "you already sent this review request" case. Treating all 403s
 * alike is what caused the `reviewOrderIngestion` bug:
 *
 *   - `Orders API failed: 403` after exactly 61 min  → the access token / STS creds aged out
 *     mid-pagination. Recoverable: refresh and retry the same page.
 *   - `Orders API failed: 403` after 0–2 min         → the seller never granted (or revoked)
 *     the Orders restricted-data role. NOT recoverable: refreshing just burns an hour of
 *     pointless calls, so we must fail fast.
 *   - 403 + "not available for this amazonOrderId"   → solicitation already sent. This is
 *     business logic, not an auth problem, and must never trigger a refresh or a retry.
 *
 * DESIGN
 * This module is a deliberate **zero-dependency leaf**: it is required by
 * `Services/review/orders.js`, which is currently free of any mongoose/model imports, and
 * we want to keep it that way. Do not add requires here.
 *
 * It is also **pure** — no occurrence counting, no I/O. The bare-403 tie-breaker (see
 * AUTH_AMBIGUOUS below) is deliberately left to the caller, which owns the per-call-site
 * attempt state.
 *
 * NOTE ON DUPLICATION
 * The predicates below intentionally mirror the semantics of
 * `Services/Sp_API/FinanceService.js`'s `isAccessTokenExpiredError` /
 * `isAuthorizationDeniedError` (see FinanceService.js:63-89). They are NOT imported from
 * there on purpose: requiring FinanceService registers 4 finance mongoose models and pulls
 * in Expences.js as a side effect, and its predicates only inspect `err.message` — they
 * cannot see `errors[0].code`, which this fix needs. A later refactor can make
 * FinanceService delegate to this module; until then ~30 duplicated lines is the right
 * trade against editing a business-critical file.
 */

/**
 * Classification results.
 *
 * AUTH_AMBIGUOUS is the important one: a bare 403 with no usable body. Amazon returns this
 * for BOTH an expired token and a permanent denial, so it cannot be resolved from a single
 * response. The convention callers follow is: treat the FIRST occurrence at a given call
 * site as recoverable (refresh + retry once), and a SECOND occurrence as AUTH_DENIED. That
 * costs a permanently-denied account exactly one wasted refresh (~5s) while still letting a
 * genuinely-expired token recover.
 */
const FAILURE = {
    THROTTLE: 'throttle',
    BUSINESS: 'business',
    TOKEN_EXPIRED: 'token_expired',
    CREDS_EXPIRED: 'creds_expired',
    AUTH_DENIED: 'auth_denied',
    AUTH_AMBIGUOUS: 'auth_ambiguous',
    OTHER: 'other',
};

/**
 * Thrown when SP-API has denied authorization in a way that refreshing cannot fix (role not
 * granted, or the seller revoked the grant). Callers should abort the run immediately rather
 * than retry, and surface this for reconnection.
 */
class SpApiAuthDeniedError extends Error {
    constructor(message, { amazonMessage = '', country = null, region = null, status = 403 } = {}) {
        super(message);
        this.name = 'SpApiAuthDeniedError';
        this.code = 'SP_API_AUTH_DENIED';
        this.amazonMessage = amazonMessage;
        this.country = country;
        this.region = region;
        this.status = status;
    }
}

// Collect every scrap of text Amazon gave us into one lowercased haystack. Handles the
// SP-API `{errors:[{code,message,details}]}` shape, the plain `{message}` / `{Message}`
// shapes used by the AWS-side (SigV4/STS) errors, and a raw string body.
function buildBlob(body, message) {
    const parts = [];

    if (typeof message === 'string') parts.push(message);

    if (typeof body === 'string') {
        parts.push(body);
    } else if (body && typeof body === 'object') {
        if (Array.isArray(body.errors)) {
            for (const e of body.errors) {
                if (!e) continue;
                parts.push(e.code || '', e.message || '', e.details || '');
            }
        }
        parts.push(body.message || '', body.Message || '', body.code || '', body.__type || '');
    }

    return parts.filter(Boolean).join(' | ').toLowerCase();
}

// Explicit error codes are more reliable than message text when present.
function collectCodes(body) {
    const codes = [];
    if (body && typeof body === 'object') {
        if (Array.isArray(body.errors)) {
            for (const e of body.errors) {
                if (e && e.code) codes.push(String(e.code));
            }
        }
        if (body.code) codes.push(String(body.code));
        // AWS JSON protocol puts the exception name here, e.g. "...#ExpiredTokenException"
        if (body.__type) codes.push(String(body.__type).split('#').pop());
    }
    return codes.map((c) => c.toLowerCase());
}

/**
 * Classify an SP-API failure.
 *
 * @param {object}       args
 * @param {number}       [args.status]  HTTP status code
 * @param {object|string}[args.body]    Parsed JSON body (or raw string / null if unparsable)
 * @param {string}       [args.message] Optional extra text (e.g. an Error message)
 * @returns {string} one of the FAILURE values
 */
function classifySpApiFailure({ status, body, message } = {}) {
    const blob = buildBlob(body, message);
    const codes = collectCodes(body);
    const has = (re) => re.test(blob);
    const hasCode = (...names) => names.some((n) => codes.includes(n));

    // 1. Throttling / transient unavailability. Checked first so a 429 carrying an
    //    incidentally auth-ish message is never mistaken for an auth problem.
    if (status === 429 || status === 503 || hasCode('quotaexceeded')) {
        return FAILURE.THROTTLE;
    }

    // 2. BUSINESS GUARD — must come first among the 403s. The Solicitations API returns
    //    403 + "not available for this amazonOrderId" when the request was already sent
    //    (e.g. manually via Seller Central). See Services/review/requests.js:61-65, which
    //    maps this to reviewRequestStatus:"sent". Never refresh or retry on this.
    if (status === 403 && /not available for this/.test(blob)) {
        return FAILURE.BUSINESS;
    }

    // 3. DEFINITIVE expired/invalid LWA access token → fixable with a token refresh.
    //    Deliberately narrow: it requires either a 401 (SP-API never uses 401 for a grant
    //    denial) or explicit "access token ... expired/invalid" wording. The generic
    //    code:"Unauthorized" + "access to requested resource is denied" shape is NOT matched
    //    here — Amazon uses that identical shape for both an expired token and a real
    //    denial, so it falls through to AUTH_AMBIGUOUS below. See the same caveat at
    //    FinanceService.js:120-124.
    if (
        status === 401 ||
        hasCode('invalidaccesstoken') ||
        (has(/access token/) && (has(/expired/) || has(/invalid/)))
    ) {
        return FAILURE.TOKEN_EXPIRED;
    }

    // 4. Expired AWS STS session / bad SigV4 signature → needs a fresh STS mint, NOT an
    //    LWA mint. Note "security token" (AWS) is distinct from "access token" (LWA), so
    //    predicate 3 above does not swallow this.
    if (
        hasCode('expiredtoken', 'expiredtokenexception', 'invalidsignatureexception') ||
        has(/security token .*(expired|invalid)/) ||
        has(/invalidsignature/) ||
        has(/signature we calculated/) ||
        has(/signature expired/) ||
        has(/expired token/)
    ) {
        return FAILURE.CREDS_EXPIRED;
    }

    // 5. DEFINITIVE authorization denial — wording that only ever appears for a grant/role
    //    problem, never for a merely-expired token. Refreshing is futile here; the seller
    //    must re-authorize, so callers should abort immediately.
    if (
        hasCode('unauthorized_client', 'accessdenied', 'accessdeniedexception') ||
        has(/access_denied/) ||
        has(/required role/) ||
        has(/restricted data/) ||
        has(/not authorized to perform/) ||
        has(/does not have permission/) ||
        has(/application does not have access/)
    ) {
        return FAILURE.AUTH_DENIED;
    }

    // 6. Any remaining 403 — including the generic code:"Unauthorized" /
    //    "access to requested resource is denied" shape and a bare 403 with an empty or
    //    unparsable body. Amazon uses these identically for expiry and denial, so a single
    //    response cannot tell them apart. Caller resolves via the first/second-occurrence
    //    convention documented on FAILURE.AUTH_AMBIGUOUS: one refresh + retry, then deny.
    if (status === 403) {
        return FAILURE.AUTH_AMBIGUOUS;
    }

    return FAILURE.OTHER;
}

/** True for the two classifications a credential refresh can actually fix. */
function isRefreshable(classification) {
    return (
        classification === FAILURE.TOKEN_EXPIRED ||
        classification === FAILURE.CREDS_EXPIRED
    );
}

module.exports = {
    FAILURE,
    SpApiAuthDeniedError,
    classifySpApiFailure,
    isRefreshable,
};
