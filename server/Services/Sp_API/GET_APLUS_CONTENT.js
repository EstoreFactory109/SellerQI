/**
 * A+ Content, read from Amazon's own API.
 *
 * WHAT THIS REPLACES, AND WHAT IT DOES NOT
 * A+ status currently comes from a third-party scraper
 * (real-time-amazon-data.p.rapidapi.com, called inside NumberOfProductReviews.js)
 * which returns a single `has_aplus` boolean. That is why every stored record
 * says "APPROVED" and why Standard cannot be told from Premium.
 *
 * This service asks Amazon directly and records the badge set, which is where
 * the Premium tier actually lives. It writes to its OWN collection
 * (APlusPremium) and touches nothing the scraper owns, so every existing reader
 * of APlusContent keeps working exactly as before. Retiring the scraper is a
 * separate decision this does not force.
 *
 * SHAPE OF THE CALLS
 *   GET /aplus/2020-11-01/contentDocuments?marketplaceId=…
 *       -> contentMetadataRecords[]: { contentReferenceKey, contentMetadata:
 *          { name, status, badgeSet, marketplaceId } }
 *   GET /aplus/2020-11-01/contentDocuments/{key}/asins?marketplaceId=…
 *       -> publishRecordList[]: which ASINs that document is live on
 *
 * The badge field could not be confirmed against a live response — the machine
 * this was written on has no working SP-API credentials, every account returns
 * 401 invalid_client. So several spellings are accepted and anything
 * unrecognised is preserved rather than dropped. If none of them match, the
 * service says so in the log instead of quietly reporting "no Premium
 * anywhere", which would read as a finding rather than a parsing gap.
 *
 * Rate limit: 10 req/sec burst 10 — generous next to most SP-API endpoints, but
 * the ASIN lookup is one call per content document, so a large catalogue is
 * paced and capped.
 */
const https = require('https');
const logger = require('../../utils/Logger.js');
const APlusPremium = require('../../models/seller-performance/APlusPremiumModel.js');

/** 10 req/sec allowed; 150ms keeps a margin under it. */
const RATE_LIMIT_MS = Number(process.env.APLUS_RATE_LIMIT_MS || 150);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.APLUS_REQUEST_TIMEOUT_MS || 30000);
/** One ASIN lookup per content document; a cap keeps a huge catalogue bounded. */
const MAX_DOCUMENTS = Number(process.env.APLUS_MAX_DOCUMENTS || 500);

/** Badge values that mean the Premium tier. */
const PREMIUM_BADGES = new Set(['PREMIUM', 'PREMIUM_APLUS', 'A_PLUS_PREMIUM']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Raw https with an explicit timeout, mirroring AsinRelationshipService — a
 * request with no timeout can hang forever and freeze the phase that awaits it.
 */
function httpsRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ statusCode: res.statusCode, body }); }
            });
            res.on('error', reject);
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(Object.assign(new Error(`A+ request timed out after ${REQUEST_TIMEOUT_MS}ms`), { code: 'ETIMEDOUT' }));
        });
        req.on('error', reject);
        req.end();
    });
}

/** GET with 429 backoff, the same shape the catalog service uses. */
async function getWithRetry(baseUrl, path, accessToken, label) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const res = await httpsRequest({
            hostname: baseUrl,
            path,
            method: 'GET',
            headers: { 'x-amz-access-token': accessToken },
        });

        if (res.statusCode === 429) {
            if (attempt < MAX_RETRIES) {
                const delayMs = Math.min(2000 * (2 ** attempt), 15000);
                logger.warn(`[APlusContent] Throttled on ${label}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            throw new Error(`A+ throttled after ${MAX_RETRIES} retries on ${label}`);
        }

        // 403 here almost always means the SP-API application lacks the A+
        // Content role, not that the seller has no A+ — worth saying plainly,
        // the way the Orders restricted-data denial already is elsewhere.
        if (res.statusCode === 403) {
            const err = new Error('A+ Content API returned 403 — the SP-API application may not be authorised for the A+ Content role');
            err.code = 'APLUS_FORBIDDEN';
            throw err;
        }

        if (res.statusCode === 404) return null;

        if (res.statusCode >= 400) {
            throw new Error(`A+ ${label} failed with ${res.statusCode}: ${JSON.stringify(res.body).slice(0, 200)}`);
        }

        return res.body;
    }
    return null;
}

/**
 * Pull the badge list out of a content metadata record.
 *
 * Exported because this is the one piece that can be verified without a live
 * Amazon response, and the piece most likely to be silently wrong.
 *
 * @returns {{ badges: string[], isPremium: boolean, recognised: boolean }}
 *   `recognised` is false when no badge field was found at all, which is how
 *   the caller tells "this listing is not Premium" apart from "we could not
 *   see the badges".
 */
const extractBadges = (metadata) => {
    if (!metadata || typeof metadata !== 'object') {
        return { badges: [], isPremium: false, recognised: false };
    }

    const source = metadata.badgeSet
        ?? metadata.contentBadgeSet
        ?? metadata.badges
        ?? metadata.contentBadge
        ?? metadata.ContentBadge;

    if (source === undefined || source === null) {
        return { badges: [], isPremium: false, recognised: false };
    }

    const list = (Array.isArray(source) ? source : [source])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.badge || entry?.name || ''))
        .filter(Boolean)
        .map((badge) => String(badge).toUpperCase());

    return {
        badges: list,
        isPremium: list.some((badge) => PREMIUM_BADGES.has(badge)),
        recognised: true,
    };
};

/**
 * Fetch every A+ content document for one marketplace and map it to its ASINs.
 *
 * Argument order matches the other SP-API services (accessToken first) because
 * tokenManager.wrapSpApiFunction refreshes a call by rebuilding it as
 * [freshToken, ...args.slice(1)] — any other order loses the rest on a refresh.
 *
 * @param {string} accessToken
 * @param {string[]|string} marketplaceIds  the house array-of-one, or a bare id
 * @param {string} userId
 * @param {string} baseUri  hostname, with or without scheme
 * @param {string} country
 * @param {string} region
 * @returns {Promise<object|false>} the stored document, or false on failure
 */
const getAPlusContent = async (accessToken, marketplaceIds, userId, baseUri, country, region) => {
    const marketplaceId = Array.isArray(marketplaceIds) ? marketplaceIds[0] : marketplaceIds;

    if (!accessToken || !marketplaceId || !baseUri) {
        logger.error('[APlusContent] Missing credentials or marketplace', { userId, country, region });
        return false;
    }

    const host = String(baseUri).replace(/^https?:\/\//, '');
    logger.info('[APlusContent] starting', { userId, country, region });

    try {
        // ---- 1. every content document for the marketplace -----------------
        const records = [];
        let nextToken = null;
        let pages = 0;

        do {
            const query = new URLSearchParams({ marketplaceId });
            if (nextToken) query.append('pageToken', nextToken);
            const body = await getWithRetry(host, `/aplus/2020-11-01/contentDocuments?${query.toString()}`, accessToken, 'contentDocuments');
            if (!body) break;

            const page = body.contentMetadataRecords || body.ContentMetadataRecords || [];
            records.push(...page);
            nextToken = body.nextPageToken || body.NextPageToken || null;
            pages += 1;
            if (nextToken) await sleep(RATE_LIMIT_MS);
        } while (nextToken && records.length < MAX_DOCUMENTS && pages < 50);

        logger.info(`[APlusContent] ${records.length} content documents listed`, { userId, country, region });

        if (!records.length) {
            // Nothing published is a real answer, and is stored as such so the
            // report can tell it apart from "never fetched".
            return APlusPremium.create({ User: userId, region, country, documents: [], documentsListed: 0 });
        }

        // ---- 2. which ASINs each document is live on ------------------------
        const documents = [];
        let badgesNeverRecognised = true;

        for (const record of records.slice(0, MAX_DOCUMENTS)) {
            const key = record.contentReferenceKey || record.ContentReferenceKey;
            const metadata = record.contentMetadata || record.ContentMetadata || {};
            const { badges, isPremium, recognised } = extractBadges(metadata);
            if (recognised) badgesNeverRecognised = false;

            if (!key) continue;

            let asins = [];
            try {
                const body = await getWithRetry(
                    host,
                    `/aplus/2020-11-01/contentDocuments/${encodeURIComponent(key)}/asins?marketplaceId=${encodeURIComponent(marketplaceId)}`,
                    accessToken,
                    `asins for ${key}`
                );
                const publishRecords = body?.publishRecordList || body?.PublishRecordList || [];
                asins = publishRecords.map((entry) => entry.asin || entry.Asin).filter(Boolean);
            } catch (error) {
                if (error.code === 'APLUS_FORBIDDEN') throw error;
                // One document failing must not lose the rest.
                logger.warn(`[APlusContent] ASIN lookup failed for ${key}: ${error.message}`);
            }

            for (const asin of asins) {
                documents.push({
                    asin,
                    contentReferenceKey: key,
                    contentType: String(metadata.contentType || metadata.ContentType || ''),
                    badges,
                    isPremium,
                    status: String(metadata.status || metadata.Status || ''),
                    name: String(metadata.name || metadata.Name || ''),
                });
            }

            await sleep(RATE_LIMIT_MS);
        }

        // Loud rather than silent: if no record carried a badge field under any
        // name we know, every listing would be reported as not Premium, which
        // reads as a finding instead of a parsing gap.
        if (badgesNeverRecognised && records.length) {
            logger.warn(
                '[APlusContent] no badge field found on any content record under any known name; '
                + 'every listing will report as not Premium. Compare the keys below with extractBadges().',
                { sampleMetadataKeys: Object.keys(records[0]?.contentMetadata || records[0] || {}) }
            );
        }

        logger.info(`[APlusContent] ${documents.length} ASIN records, ${documents.filter((d) => d.isPremium).length} premium`, { userId, country, region });

        return APlusPremium.create({
            User: userId,
            region,
            country,
            documents,
            documentsListed: records.length,
        });
    } catch (error) {
        logger.error(`[APlusContent] failed: ${error.message}`, { userId, country, region, code: error.code });
        return false;
    }
};

module.exports = getAPlusContent;
module.exports.getAPlusContent = getAPlusContent;
// Exported for tests.
module.exports.extractBadges = extractBadges;
module.exports.PREMIUM_BADGES = PREMIUM_BADGES;
