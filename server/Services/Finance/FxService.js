/**
 * FxService — currency conversion for figures combined across marketplaces.
 *
 * ── WHY THIS EXISTS ──
 * Every money figure SellerQI stores is in its marketplace's own currency (see
 * utils/marketplaceCurrency.js). The combined Dashboard adds marketplaces together, so a UK
 * seller's GBP has to become, say, USD before it can be summed with their US sales. Until
 * this service there was no conversion anywhere — only symbol swaps.
 *
 * ── RATES ──
 * Daily reference rates, fetched once a day (BackgroundJobs/fxRatesStandalone.js):
 *   1. ECB via Frankfurter (keyless) — USD, GBP, CAD, MXN, BRL, SEK, PLN, TRY, JPY, AUD,
 *      SGD, INR, ZAR and more, all against EUR.
 *   2. AED and SAR from their official USD pegs (3.6725 and 3.75) — the ECB publishes neither.
 *   3. Anything still missing (EGP) from open.er-api.com (keyless), rebased through USD.
 * A figure is converted at the LATEST stored rate, not the rate on the day it was earned.
 *
 * ── THE ONE RULE ──
 * A missing or too-old rate is "cannot convert" (null), never 1. Treating GBP as USD would put
 * a wrong number on screen with no sign anything was off; callers instead leave that
 * marketplace out of the money total and say so.
 */
const axios = require('axios');
const logger = require('../../utils/Logger.js');
const FxRate = require('../../models/system/FxRateModel.js');
const { SUPPORTED_CURRENCY_CODES } = require('../../utils/marketplaceCurrency.js');

const ECB_URL = process.env.FX_ECB_URL || 'https://api.frankfurter.dev/v1/latest?base=EUR';
const FALLBACK_URL = process.env.FX_FALLBACK_URL || 'https://open.er-api.com/v6/latest/USD';
const USD_PEGS = Object.freeze({ AED: 3.6725, SAR: 3.75 });

const MEMORY_TTL_MS = 10 * 60 * 1000;
const REDIS_KEY = 'sqi:fx:latest';
const REDIS_TTL_SECONDS = 6 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
// ECB publishes on business days only, so a long weekend can leave the latest rate 4 days old.
const STALE_AFTER_DAYS = 4;
// Past this the figures are refused outright rather than shown with a warning.
const UNUSABLE_AFTER_DAYS = 14;

let memory = null; // { at, value: { date, rates, sources } }
let inflightFetch = null;

const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

const toPlain = (doc) => doc && ({
    date: doc.date,
    rates: doc.rates instanceof Map ? Object.fromEntries(doc.rates) : { ...(doc.rates || {}) },
    sources: doc.sources instanceof Map ? Object.fromEntries(doc.sources) : { ...(doc.sources || {}) },
});

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Pure: combines the three sources into one EUR-based table. Exported for tests.
 * @param {{date?: string, rates?: object}} ecb       Frankfurter response (EUR base)
 * @param {{rates?: object}|null} fallback           open.er-api response (USD base)
 */
const buildRateTable = (ecb, fallback) => {
    const rates = { EUR: 1 };
    const sources = { EUR: 'ecb' };

    for (const [code, value] of Object.entries(ecb?.rates || {})) {
        if (isPositive(value)) {
            rates[code] = value;
            sources[code] = 'ecb';
        }
    }

    if (isPositive(rates.USD)) {
        for (const [code, perUsd] of Object.entries(USD_PEGS)) {
            if (!isPositive(rates[code])) {
                rates[code] = rates.USD * perUsd;
                sources[code] = 'peg:USD';
            }
        }
    }

    const fb = fallback?.rates || {};
    const eurPerUsd = fb.EUR; // fallback rates are "units per 1 USD"
    if (isPositive(eurPerUsd)) {
        for (const code of SUPPORTED_CURRENCY_CODES) {
            if (isPositive(rates[code])) continue;
            if (isPositive(fb[code])) {
                rates[code] = fb[code] / eurPerUsd;
                sources[code] = 'open.er-api';
            }
        }
    }

    const missing = SUPPORTED_CURRENCY_CODES.filter((code) => !isPositive(rates[code]));
    return { date: ecb?.date || new Date().toISOString().slice(0, 10), rates, sources, missing };
};

const clearCaches = async () => {
    memory = null;
    const redis = tryGetRedis();
    if (redis) {
        try { await redis.del(REDIS_KEY); } catch (_) { /* fail open */ }
    }
};

/**
 * Fetches today's rates from every source and stores them. Safe to re-run: upserts by date.
 * Throws only when the primary (ECB) fetch fails — a fallback failure just leaves EGP out.
 */
const fetchAndStoreDailyRates = async ({ http = axios } = {}) => {
    const ecbRes = await http.get(ECB_URL, { timeout: 15000 });
    let fallback = null;
    try {
        const fbRes = await http.get(FALLBACK_URL, { timeout: 15000 });
        if (fbRes?.data?.result === 'success' || fbRes?.data?.rates) fallback = fbRes.data;
    } catch (err) {
        logger.warn(`[FxService] fallback rate source failed: ${err.message}`);
    }

    const table = buildRateTable(ecbRes?.data, fallback);
    if (table.missing.length) {
        logger.warn(`[FxService] no rate from any source for: ${table.missing.join(', ')}`);
    }

    await FxRate.updateOne(
        { date: table.date },
        { $set: { base: 'EUR', rates: table.rates, sources: table.sources, fetchedAt: new Date() } },
        { upsert: true },
    );
    await clearCaches();
    logger.info(`[FxService] stored rates for ${table.date} (${Object.keys(table.rates).length} currencies)`);
    return table;
};

/** The newest stored rate table: memory → Redis → Mongo → (if none at all) one live fetch. */
const getLatestRates = async () => {
    if (memory && Date.now() - memory.at < MEMORY_TTL_MS) return memory.value;

    const redis = tryGetRedis();
    if (redis) {
        try {
            const cached = await redis.get(REDIS_KEY);
            if (cached) {
                const value = JSON.parse(cached);
                memory = { at: Date.now(), value };
                return value;
            }
        } catch (_) { /* fail open: treat as a miss */ }
    }

    let doc = await FxRate.findOne({}).sort({ date: -1 }).lean();
    if (!doc) {
        // First run on a fresh database: fetch once, shared by every concurrent caller.
        if (!inflightFetch) {
            inflightFetch = fetchAndStoreDailyRates()
                .catch((err) => {
                    logger.error(`[FxService] initial rate fetch failed: ${err.message}`);
                    return null;
                })
                .finally(() => { inflightFetch = null; });
        }
        await inflightFetch;
        doc = await FxRate.findOne({}).sort({ date: -1 }).lean();
        if (!doc) return null;
    }

    const value = toPlain(doc);
    memory = { at: Date.now(), value };
    if (redis) {
        try { await redis.setEx(REDIS_KEY, REDIS_TTL_SECONDS, JSON.stringify(value)); } catch (_) { /* fail open */ }
    }
    return value;
};

const ageInDays = (date, now) => (now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS;

/**
 * Pure rate lookup against a given table. Exported for tests.
 * @returns {{rate:number, asOf:string, stale:boolean}|null}
 */
const rateFromTable = (table, from, to, now = new Date()) => {
    const f = String(from || '').toUpperCase();
    const t = String(to || '').toUpperCase();
    if (!f || !t) return null;
    if (f === t) return { rate: 1, asOf: table?.date || null, stale: false };
    if (!table?.rates) return null;

    const age = ageInDays(table.date, now);
    if (!(age <= UNUSABLE_AFTER_DAYS)) return null;

    const rf = table.rates[f];
    const rt = table.rates[t];
    if (!isPositive(rf) || !isPositive(rt)) return null;
    return { rate: rt / rf, asOf: table.date, stale: age > STALE_AFTER_DAYS };
};

/** How many `to` one unit of `from` is worth, or null when it can't be known. */
const getRate = async (from, to, { now = new Date() } = {}) => {
    if (String(from || '').toUpperCase() === String(to || '').toUpperCase() && from) {
        return { rate: 1, asOf: null, stale: false };
    }
    const table = await getLatestRates();
    return rateFromTable(table, from, to, now);
};

/** Converts an amount; null when no usable rate exists. Never assumes 1:1. */
const convert = async (amount, from, to, opts) => {
    const rate = await getRate(from, to, opts);
    if (!rate) return null;
    return { value: (Number(amount) || 0) * rate.rate, ...rate };
};

module.exports = {
    fetchAndStoreDailyRates,
    getLatestRates,
    getRate,
    convert,
    // exported for tests
    buildRateTable,
    rateFromTable,
    _clearCaches: clearCaches,
    STALE_AFTER_DAYS,
    UNUSABLE_AFTER_DAYS,
};
