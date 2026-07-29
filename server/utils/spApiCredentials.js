/**
 * spApiCredentials.js — a credential provider that stays valid across a long SP-API run.
 *
 * WHY THIS EXISTS
 * Long-running SP-API work (paginating /orders/v0/orders, then walking thousands of orders)
 * used to mint its two credentials ONCE and pass them down as frozen strings:
 *
 *   - the LWA access token   (~3600s life)
 *   - the AWS STS session    (minted with DurationSeconds: 3600 — see
 *                             utils/GenerateTemporaryCredentials.js)
 *
 * Both age out at ~60 min. A `reviewOrderIngestion` run for a high-volume account was
 * observed failing at *exactly* 61.0 minutes with `Orders API failed: 403` — SP-API answers
 * an expired token with 403, and the caller had no refresh path.
 *
 * This provider hands out credentials that are refreshed on demand, both PROACTIVELY (before
 * they go stale) and REACTIVELY (when a call is classified as an auth failure). It is
 * deliberately additive: callers that never build one keep their existing behaviour exactly.
 *
 * DEPENDENCY NOTE
 * This module requires GenerateTokens, which requires the User model. It must therefore NOT
 * be required from `Services/review/orders.js`, which is intentionally free of mongoose
 * imports — `orders.js` requires only the zero-dependency `spApiErrors.js`, and receives a
 * provider instance as an optional argument.
 */

const logger = require('./Logger.js');
const authCache = require('./authCache.js');
const { FAILURE } = require('./spApiErrors.js');
const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('./GenerateTemporaryCredentials.js');

// Refresh ahead of the real expiry so a request already in flight cannot straddle it.
// Both sit at or below authCache's own TTLs (TOKEN_TTL_SECONDS 3000s / STS_TTL_MS 50min) so
// we never serve something the cache would consider live but Amazon would not.
const TOKEN_STALE_MS = 50 * 60 * 1000; // LWA: refresh 10 min before Amazon's 60 min
const STS_STALE_MS = 45 * 60 * 1000;   // STS: refresh 15 min before DurationSeconds 3600

// An inherited credential (passed in by a caller that already minted it) has unknown age.
// Give it a short remaining life so it is tried once — avoiding a pointless immediate
// refresh — but re-minted as soon as the run does any real work. Mirrors the idiom in
// FinanceService.createTokenManager (FinanceService.js:93-96).
const INHERITED_GRACE_MS = 5 * 60 * 1000;

const KIND_TOKEN = 'token';
const KIND_STS = 'sts';

/**
 * @param {object}  args
 * @param {string}  args.userId
 * @param {string}  args.spiRefreshToken       LWA refresh token for this seller account
 * @param {string}  args.awsRegion             e.g. 'us-east-1'
 * @param {string}  [args.initialAccessToken]  already-minted token to adopt (optional)
 * @param {object}  [args.initialAwsCreds]     already-minted STS creds to adopt (optional),
 *                                             shape { AccessKey, SecretKey, SessionToken }
 * @param {string}  [args.logPrefix]
 */
function createSpApiCredentialProvider({
    userId,
    spiRefreshToken,
    awsRegion,
    initialAccessToken = null,
    initialAwsCreds = null,
    logPrefix = '[spApiCreds]',
}) {
    if (!spiRefreshToken) throw new Error(`${logPrefix} spiRefreshToken is required`);
    if (!awsRegion) throw new Error(`${logPrefix} awsRegion is required`);

    let accessToken = initialAccessToken || null;
    let tokenIssuedAt = initialAccessToken ? Date.now() - TOKEN_STALE_MS + INHERITED_GRACE_MS : 0;

    let awsCreds = normaliseStsCreds(initialAwsCreds);
    let stsIssuedAt = awsCreds ? Date.now() - STS_STALE_MS + INHERITED_GRACE_MS : 0;

    // One in-flight refresh per kind, shared by all concurrent callers. Without this the
    // sender — which can see many auth failures in quick succession — would stampede
    // Amazon's token endpoint with identical requests.
    const inFlight = { [KIND_TOKEN]: null, [KIND_STS]: null };
    let refreshCount = 0;

    function normaliseStsCreds(raw) {
        if (!raw) return null;
        const AccessKey = raw.AccessKey || raw.awsAccessKeyId || null;
        const SecretKey = raw.SecretKey || raw.awsSecretAccessKey || null;
        const SessionToken = raw.SessionToken || raw.awsSessionToken || null;
        if (!AccessKey || !SecretKey || !SessionToken) return null;
        return { AccessKey, SecretKey, SessionToken };
    }

    function dedupe(kind, fn) {
        if (inFlight[kind]) return inFlight[kind];
        const p = (async () => fn())().finally(() => {
            inFlight[kind] = null;
        });
        inFlight[kind] = p;
        return p;
    }

    async function mintAccessToken(reason) {
        // On a REACTIVE refresh the cached copy is the very thing that just failed, so drop
        // it before minting — otherwise a concurrent phase could re-serve the dead token.
        // (authCache.invalidateToken existed but was never called anywhere before this.)
        if (reason !== 'proactive') {
            await authCache.invalidateToken('sp', spiRefreshToken);
        }

        const errorRef = {};
        // NOTE: generateAccessToken returns `false` on failure rather than throwing, and
        // populates errorRef.message with Amazon's actual reason. Convert to a throw so a
        // credential failure can never masquerade as a valid empty token.
        const token = await generateAccessToken(userId, spiRefreshToken, errorRef);
        if (!token) {
            throw new Error(
                `${logPrefix} failed to mint SP-API access token: ${errorRef.message || 'unknown reason'}`
            );
        }

        accessToken = token;
        tokenIssuedAt = Date.now();
        refreshCount++;
        logger.info(`${logPrefix} minted SP-API access token (reason=${reason}) for user ${userId}`);
        return accessToken;
    }

    async function mintStsCreds(reason) {
        const raw = await getTemporaryCredentials(awsRegion);
        // NOTE: getTemporaryCredentials SWALLOWS its errors and returns undefined. Left
        // unchecked that produces an awsConfig of undefined keys, a bogus SigV4 signature,
        // and a 403 that looks exactly like a genuine authorization denial. Validate hard.
        const creds = normaliseStsCreds(raw);
        if (!creds) {
            throw new Error(
                `${logPrefix} failed to obtain AWS STS credentials for region ${awsRegion} ` +
                `(AssumeRole returned no usable credentials)`
            );
        }

        awsCreds = creds;
        stsIssuedAt = Date.now();
        refreshCount++;
        // Secrets stay in authCache's in-process Map only — never the shared Redis.
        authCache.setCredentials(awsRegion, creds);
        logger.info(`${logPrefix} minted AWS STS credentials (reason=${reason}) region=${awsRegion}`);
        return awsCreds;
    }

    async function refreshAccessToken(reason = 'reactive') {
        return dedupe(KIND_TOKEN, () => mintAccessToken(reason));
    }

    async function refreshAwsCreds(reason = 'reactive') {
        return dedupe(KIND_STS, () => mintStsCreds(reason));
    }

    function tokenIsStale() {
        return !accessToken || Date.now() - tokenIssuedAt >= TOKEN_STALE_MS;
    }

    function stsIsStale() {
        return !awsCreds || Date.now() - stsIssuedAt >= STS_STALE_MS;
    }

    /**
     * Current credentials, refreshing whichever half has gone stale. Cheap to call in a hot
     * loop — it only awaits when something actually needs re-minting.
     *
     * @returns {Promise<{accessToken: string, awsConfig: object}>}
     */
    async function getValid() {
        if (tokenIsStale()) {
            // Adopt a token another phase already minted before paying for a new one.
            if (!accessToken) {
                const cached = await authCache.getToken('sp', spiRefreshToken);
                if (cached) {
                    accessToken = cached;
                    tokenIssuedAt = Date.now() - TOKEN_STALE_MS + INHERITED_GRACE_MS;
                }
            }
            if (tokenIsStale()) await refreshAccessToken('proactive');
        }

        if (stsIsStale()) {
            if (!awsCreds) {
                const cached = normaliseStsCreds(authCache.getCredentials(awsRegion));
                if (cached) {
                    awsCreds = cached;
                    stsIssuedAt = Date.now() - STS_STALE_MS + INHERITED_GRACE_MS;
                }
            }
            if (stsIsStale()) await refreshAwsCreds('proactive');
        }

        return {
            accessToken,
            awsConfig: {
                awsAccessKeyId: awsCreds.AccessKey,
                awsSecretAccessKey: awsCreds.SecretKey,
                awsRegion,
                awsSessionToken: awsCreds.SessionToken,
            },
        };
    }

    /**
     * Reactive refresh driven by a classified failure.
     * @param {string} classification one of spApiErrors.FAILURE values
     * @returns {Promise<boolean>} true if something was refreshed (caller should retry)
     */
    async function refreshFor(classification, reason = 'reactive') {
        if (classification === FAILURE.CREDS_EXPIRED) {
            await refreshAwsCreds(reason);
            return true;
        }
        if (
            classification === FAILURE.TOKEN_EXPIRED ||
            classification === FAILURE.AUTH_AMBIGUOUS
        ) {
            // An ambiguous 403 is far more often an expired token than a revoked grant, and
            // the caller caps how many times it will ask, so refreshing the token is the
            // right first move. Refresh STS too when it is also near the edge — a run that
            // has been alive ~1h is likely to have both stale.
            await refreshAccessToken(reason);
            if (stsIsStale()) await refreshAwsCreds(reason);
            return true;
        }
        return false;
    }

    return {
        getValid,
        refreshAccessToken,
        refreshAwsCreds,
        refreshFor,
        get refreshCount() {
            return refreshCount;
        },
    };
}

module.exports = { createSpApiCredentialProvider };
