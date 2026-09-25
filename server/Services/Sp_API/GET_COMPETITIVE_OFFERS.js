/**
 * Offer-level pricing for contested ASINs, from Amazon's Product Pricing API.
 *
 * WHAT THIS ANSWERS
 * The Weekly Buybox report knew an ASIN was losing the Buy Box but not to whom
 * or at what price, because BuyBoxData (Data Kiosk) is an aggregate with no
 * offers in it. This fills that in: the winning offer's price, its seller, and
 * therefore the gap against our own.
 *
 * WHY ONLY CONTESTED ASINS
 * getItemOffersBatch is rate limited to 0.1 requests per second — one call every
 * ten seconds — with 20 ASINs per call. Pricing a 2,000-ASIN catalogue would
 * take over sixteen minutes inside a scheduled phase, to answer a question that
 * is uninteresting on every ASIN we already win. The caller passes the ASINs
 * holding 0% Buy Box and nothing else. On the live ESF accounts that is a
 * single-digit number, so in practice this is one call.
 *
 * SHAPE OF THE CALL
 *   POST /batches/products/pricing/v0/itemOffers
 *   { "requests": [ { "uri": "/products/pricing/v0/items/{asin}/offers",
 *                     "method": "GET", "MarketplaceId": "...",
 *                     "ItemCondition": "New", "CustomerType": "Consumer" } ] }
 *   -> { "responses": [ { "status": {...}, "request": {...},
 *                         "body": { "payload": { Summary, Offers } } } ] }
 *
 * A per-ASIN failure comes back INSIDE a 200 batch response, as a non-200
 * `status` on that one entry. So a batch that "succeeded" can still carry
 * failures, and they are recorded per ASIN rather than failing the fetch.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE
 * Every SP-API account available here returns 401 invalid_client, so the field
 * names below are read under several spellings and anything unrecognised is
 * counted and logged rather than silently treated as "no competitor". The two
 * things most likely to differ in practice — the casing of the payload keys and
 * whether SellerId is returned at all — are both handled explicitly.
 */
const https = require('https');
const logger = require('../../utils/Logger.js');
const CompetitiveOffers = require('../../models/products/CompetitiveOffersModel.js');
// Read, not written, by this service: which ASINs are contested, and which
// merchant token is ours.
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

/** Amazon's documented maximum for this batch endpoint. */
const MAX_ASINS_PER_BATCH = 20;
/**
 * 0.1 requests/second, burst 1. 11s rather than 10s: the bucket refills on
 * Amazon's clock, not ours, and a 429 here costs far more than a second.
 */
const RATE_LIMIT_MS = Number(process.env.PRICING_RATE_LIMIT_MS || 11000);
/**
 * Hard ceiling on batches, so an account that suddenly loses the Buy Box on
 * hundreds of ASINs cannot stall the phase for half an hour. 10 batches = 200
 * ASINs ≈ 110s. What is dropped is reported, never silently omitted.
 */
const MAX_BATCHES = Number(process.env.PRICING_MAX_BATCHES || 10);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.PRICING_REQUEST_TIMEOUT_MS || 30000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Raw https with an explicit timeout and a request body.
 *
 * Same reasoning as AsinRelationshipService: Node's https never times out on
 * its own, and this is awaited from inside a scheduled phase, where a hang
 * keeps the BullMQ lock renewed forever and silently swallows every later run
 * of that phase.
 */
function httpsRequest(options, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8');
        const req = https.request({
            ...options,
            headers: {
                ...options.headers,
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                try { resolve({ statusCode: res.statusCode, body: JSON.parse(text) }); }
                catch { resolve({ statusCode: res.statusCode, body: text }); }
            });
            res.on('error', reject);
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(Object.assign(new Error(`Pricing request timed out after ${REQUEST_TIMEOUT_MS}ms`), { code: 'ETIMEDOUT' }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** POST with 429 backoff, the same shape the other direct-API services use. */
async function postWithRetry(host, path, accessToken, body, label) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const res = await httpsRequest({
            hostname: host,
            path,
            method: 'POST',
            headers: { 'x-amz-access-token': accessToken },
        }, body);

        if (res.statusCode === 429) {
            if (attempt < MAX_RETRIES) {
                // Longer than the usual backoff on purpose: this endpoint
                // refills one token every ten seconds, so retrying in two is
                // just a second 429.
                const delayMs = Math.min(RATE_LIMIT_MS * (attempt + 1), 45000);
                logger.warn(`[CompetitiveOffers] Throttled on ${label}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            throw new Error(`Pricing throttled after ${MAX_RETRIES} retries on ${label}`);
        }

        // Almost always the SP-API application lacking the Pricing role rather
        // than anything about this seller — worth saying plainly instead of
        // letting it read as "this account has no competitors".
        if (res.statusCode === 403) {
            const err = new Error('Product Pricing API returned 403 — the SP-API application may not be authorised for the Pricing role');
            err.code = 'PRICING_FORBIDDEN';
            throw err;
        }

        if (res.statusCode >= 400) {
            throw new Error(`Pricing ${label} failed with ${res.statusCode}: ${JSON.stringify(res.body).slice(0, 300)}`);
        }

        return res.body;
    }
    return null;
}

/**
 * Pull a money amount out of the several shapes Amazon uses for one.
 * Returns null rather than 0 for "absent": a missing price and a free item are
 * not the same thing, and 0 would win every price comparison in the report.
 */
const amount = (money) => {
    if (money === null || money === undefined) return null;
    if (typeof money === 'number') return Number.isFinite(money) ? money : null;
    const raw = money.Amount ?? money.amount ?? money.value;
    const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const currencyOf = (money) => String(money?.CurrencyCode ?? money?.currencyCode ?? '') || '';

/**
 * Money, to the cent.
 *
 * 18 + 5.99 is 23.990000000000002 in binary floating point. Left alone that
 * noise is stored, then subtracted to produce a gap, then compared against a
 * threshold — so it compounds through exactly the arithmetic this report
 * exists to do. Rounded once, here, at the only place two amounts are added.
 */
const cents = (value) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Turn one ASIN's offers payload into the row we store.
 *
 * Exported because this is the piece that cannot be checked against a live
 * response and the piece most likely to be quietly wrong.
 *
 * @param {object} payload   `body.payload` from one batch response entry
 * @param {string} ourSellerId  our merchant token, '' when we do not hold one
 * @returns {object} an asinOffers row, minus the asin
 */
const parseOffersPayload = (payload, ourSellerId = '') => {
    const summary = payload?.Summary || payload?.summary || {};
    const rawOffers = payload?.Offers || payload?.offers || [];

    const offers = (Array.isArray(rawOffers) ? rawOffers : []).map((offer) => {
        const listing = amount(offer.ListingPrice ?? offer.listingPrice);
        const shipping = amount(offer.Shipping ?? offer.shipping);
        const sellerId = String(offer.SellerId ?? offer.sellerId ?? '');
        const rating = offer.SellerFeedbackRating ?? offer.sellerFeedbackRating ?? {};

        return {
            sellerId,
            // Amazon does not send a landed price per offer; it is listing
            // plus shipping, and comparing bare listing prices would call a
            // cheap item with £6 delivery the better offer.
            landedPrice: listing === null ? null : cents(listing + (shipping || 0)),
            listingPrice: listing,
            shipping,
            isBuyBoxWinner: Boolean(offer.IsBuyBoxWinner ?? offer.isBuyBoxWinner),
            // MyOffer where Amazon sets it, the merchant token otherwise. Both,
            // because MyOffer is not documented as always present on this
            // endpoint and a wrong answer here mislabels a competitor as us.
            isOurs: Boolean(offer.MyOffer ?? offer.myOffer)
                || Boolean(ourSellerId && sellerId && sellerId === ourSellerId),
            isFulfilledByAmazon: Boolean(offer.IsFulfilledByAmazon ?? offer.isFulfilledByAmazon),
            isPrime: Boolean((offer.PrimeInformation ?? offer.primeInformation)?.IsOfferPrime
                ?? (offer.PrimeInformation ?? offer.primeInformation)?.isOfferPrime),
            feedbackRating: amount(rating.SellerPositiveFeedbackRating ?? rating.sellerPositiveFeedbackRating),
            feedbackCount: amount(rating.FeedbackCount ?? rating.feedbackCount),
        };
    });

    const winner = offers.find((offer) => offer.isBuyBoxWinner) || null;
    const ours = offers.find((offer) => offer.isOurs) || null;

    // Summary.BuyBoxPrices is the authority; the winning offer is the fallback.
    // They can disagree when Amazon returns a summary but truncates the offer
    // list, and the summary is the one that is always about the Buy Box.
    const buyBoxPrices = summary.BuyBoxPrices ?? summary.buyBoxPrices ?? [];
    const summaryBuyBox = Array.isArray(buyBoxPrices) ? buyBoxPrices[0] : null;
    const summaryLanded = amount(summaryBuyBox?.LandedPrice ?? summaryBuyBox?.landedPrice);

    const lowestPrices = summary.LowestPrices ?? summary.lowestPrices ?? [];
    const summaryLowest = Array.isArray(lowestPrices) ? lowestPrices[0] : null;

    const currency = currencyOf(summaryBuyBox?.LandedPrice ?? summaryBuyBox?.landedPrice)
        || currencyOf(summaryLowest?.LandedPrice ?? summaryLowest?.landedPrice)
        || currencyOf(rawOffers?.[0]?.ListingPrice ?? rawOffers?.[0]?.listingPrice);

    return {
        currency,
        buyBoxPrice: summaryLanded ?? winner?.landedPrice ?? null,
        buyBoxSellerId: winner?.sellerId || '',
        buyBoxIsFba: Boolean(winner?.isFulfilledByAmazon),
        ourLandedPrice: ours?.landedPrice ?? null,
        lowestPrice: amount(summaryLowest?.LandedPrice ?? summaryLowest?.landedPrice),
        totalOfferCount: Number(summary.TotalOfferCount ?? summary.totalOfferCount ?? offers.length) || 0,
        offers,
        error: '',
    };
};

/** The ASIN a batch entry belongs to — from the payload, or its request uri. */
const asinOfResponse = (entry) => {
    const payload = entry?.body?.payload ?? entry?.body?.Payload;
    const direct = payload?.ASIN ?? payload?.Asin ?? payload?.asin;
    if (direct) return String(direct);
    const uri = String(entry?.request?.uri ?? entry?.request?.Uri ?? '');
    const match = uri.match(/\/items\/([^/]+)\/offers/);
    return match ? decodeURIComponent(match[1]) : '';
};

const chunk = (list, size) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

/**
 * Fetch offers for the contested ASINs of one marketplace.
 *
 * Argument order matches the other SP-API services (accessToken first) because
 * tokenManager.wrapSpApiFunction rebuilds a refreshed call as
 * [freshToken, ...args.slice(1)].
 *
 * @param {string} accessToken
 * @param {string[]|string} marketplaceIds  the house array-of-one, or a bare id
 * @param {string} userId
 * @param {string} baseUri  hostname, with or without scheme
 * @param {string} country
 * @param {string} region
 * @param {object} [options]
 * @param {string[]} [options.asins]  contested ASINs; nothing is fetched without them
 * @param {string} [options.ourSellerId]  our merchant token, to spot our own offer
 * @returns {Promise<object|false>} the stored document, or false on failure
 */
const getCompetitiveOffers = async (accessToken, marketplaceIds, userId, baseUri, country, region, options = {}) => {
    const marketplaceId = Array.isArray(marketplaceIds) ? marketplaceIds[0] : marketplaceIds;
    const asins = [...new Set((options.asins || []).filter(Boolean).map(String))];
    const ourSellerId = String(options.ourSellerId || '');

    if (!accessToken || !marketplaceId || !baseUri) {
        logger.error('[CompetitiveOffers] Missing credentials or marketplace', { userId, country, region });
        return false;
    }

    // Nothing contested is a real answer and worth storing: it is what lets the
    // report say "checked, no competitors" rather than "never checked".
    if (!asins.length) {
        logger.info('[CompetitiveOffers] no contested ASINs to price', { userId, country, region });
        return CompetitiveOffers.create({
            User: userId, region, country, items: [], asinsRequested: 0, sellerIdsReturned: false,
        });
    }

    const host = String(baseUri).replace(/^https?:\/\//, '');
    const batches = chunk(asins, MAX_ASINS_PER_BATCH).slice(0, MAX_BATCHES);
    const covered = batches.reduce((sum, batch) => sum + batch.length, 0);

    if (covered < asins.length) {
        logger.warn(
            `[CompetitiveOffers] ${asins.length} contested ASINs exceeds the ${MAX_BATCHES}-batch cap; pricing the first ${covered}`,
            { userId, country, region }
        );
    }

    logger.info(`[CompetitiveOffers] pricing ${covered} ASIN(s) in ${batches.length} batch(es)`, { userId, country, region });

    try {
        const items = [];
        let sellerIdsReturned = false;

        for (const [index, batch] of batches.entries()) {
            // Paced BEFORE the call rather than after, so a throw on the last
            // batch does not leave an eleven-second wait behind it.
            if (index > 0) await sleep(RATE_LIMIT_MS);

            const body = await postWithRetry(
                host,
                '/batches/products/pricing/v0/itemOffers',
                accessToken,
                {
                    requests: batch.map((asin) => ({
                        uri: `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
                        method: 'GET',
                        MarketplaceId: marketplaceId,
                        ItemCondition: 'New',
                        CustomerType: 'Consumer',
                    })),
                },
                `batch ${index + 1}/${batches.length}`
            );

            const responses = body?.responses || body?.Responses || [];
            const seen = new Set();

            for (const entry of responses) {
                const asin = asinOfResponse(entry);
                if (!asin) continue;
                seen.add(asin);

                // A per-ASIN failure arrives inside a 200 batch, as a non-200
                // status on this one entry. Recorded, not thrown: one dead ASIN
                // must not cost us the other nineteen.
                const status = Number(entry?.status?.statusCode ?? entry?.status?.StatusCode ?? 200);
                if (status >= 400) {
                    items.push({ asin, error: `Amazon returned ${status} for this ASIN`, offers: [] });
                    continue;
                }

                const payload = entry?.body?.payload ?? entry?.body?.Payload;
                const parsed = parseOffersPayload(payload, ourSellerId);
                if (parsed.offers.some((offer) => offer.sellerId)) sellerIdsReturned = true;
                items.push({ asin, ...parsed });
            }

            // An ASIN we asked about and heard nothing back on is a gap in the
            // report, not an ASIN without competitors. Say which.
            for (const asin of batch) {
                if (!seen.has(asin)) items.push({ asin, error: 'Amazon returned no response for this ASIN', offers: [] });
            }
        }

        // Loud rather than silent. If nothing in the entire fetch carried a
        // seller id, every competitor would show as unknown, and that reads as
        // a finding about the marketplace instead of the parsing gap it may be.
        if (!sellerIdsReturned && items.some((item) => item.offers?.length)) {
            logger.warn(
                '[CompetitiveOffers] no offer in this fetch carried a seller id; every competitor will show as unknown. '
                + 'Prices and gaps are unaffected.',
                { userId, country, region }
            );
        }

        const priced = items.filter((item) => item.buyBoxPrice !== null && item.buyBoxPrice !== undefined).length;
        logger.info(`[CompetitiveOffers] ${items.length} ASIN(s) returned, ${priced} with a Buy Box price`, { userId, country, region });

        return CompetitiveOffers.create({
            User: userId,
            region,
            country,
            items,
            asinsRequested: asins.length,
            sellerIdsReturned,
        });
    } catch (error) {
        logger.error(`[CompetitiveOffers] failed: ${error.message}`, { userId, country, region, code: error.code });
        return false;
    }
};

/**
 * Work out what to price, then price it.
 *
 * ORDERING
 * Contested ASINs come from the Buy Box snapshot, so this has to run AFTER
 * fetchAndStoreBuyBoxData rather than alongside the other SP-API pulls. It
 * reads the stored snapshot rather than that function's return value, because
 * the stored document is the same thing the report will later be built from —
 * pricing a different set from the one the report shows would be worse than
 * not pricing at all.
 *
 * OUR OWN MERCHANT TOKEN
 * `selling_partner_id` is only populated for about two thirds of accounts —
 * the rest hold the schema's uuid default. A uuid can never match a real
 * SellerId, so passing it through would be harmless but pointless; it is
 * filtered out here so the parser falls back to Amazon's MyOffer flag instead
 * of comparing against a value that cannot match.
 *
 * Same positional signature as the fetch it wraps, so tokenManager can refresh
 * the token for it.
 *
 * @returns {Promise<object|false>} the stored document, or false
 */
const syncCompetitiveOffers = async (accessToken, marketplaceIds, userId, baseUri, country, region) => {
    try {
        const [latest, seller] = await Promise.all([
            BuyBoxData.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            Seller.findOne({ User: userId }).select('sellerAccount').lean(),
        ]);

        if (!latest) {
            logger.info('[CompetitiveOffers] no Buy Box snapshot yet; nothing to price', { userId, country, region });
            return false;
        }

        // 0% ownership over the snapshot's window — the definition the report
        // already uses for "losing", so the two cannot drift apart.
        const asins = (latest.asinBuyBoxData || [])
            .filter((row) => Number(row.buyBoxPercentage) === 0)
            .map((row) => row.childAsin)
            .filter(Boolean);

        const account = (seller?.sellerAccount || []).find((acc) => acc.region === region && acc.country === country);
        const storedId = String(account?.selling_partner_id || '');
        const ourSellerId = /^[0-9a-f-]{36}$/i.test(storedId) ? '' : storedId;

        return await getCompetitiveOffers(accessToken, marketplaceIds, userId, baseUri, country, region, {
            asins,
            ourSellerId,
        });
    } catch (error) {
        logger.error(`[CompetitiveOffers] sync failed: ${error.message}`, { userId, country, region });
        return false;
    }
};

module.exports = getCompetitiveOffers;
module.exports.syncCompetitiveOffers = syncCompetitiveOffers;
module.exports.getCompetitiveOffers = getCompetitiveOffers;
// Exported for tests.
module.exports.parseOffersPayload = parseOffersPayload;
module.exports.asinOfResponse = asinOfResponse;
module.exports.MAX_ASINS_PER_BATCH = MAX_ASINS_PER_BATCH;
