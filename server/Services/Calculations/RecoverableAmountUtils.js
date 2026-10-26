/**
 * Shared formulas for computing a dollar "amount" recoverable by fixing a
 * given Profitability or Sponsored Ads error. Centralized here so the
 * target-margin / target-ACOS constants aren't duplicated across
 * DashboardCalculation.js and ProfitabilityIssuesService.js.
 */

const logger = require('../../utils/Logger.js');

// Shared with detection in DashboardCalculation; see TaskRules.
const { TARGET_PROFIT_MARGIN_PERCENT, TARGET_ACOS_PERCENT } = require('./TaskRules.js');

// The long-term storage fee report is a MONTHLY snapshot (snapShotDate lands on
// the 15th), and the sync that populates it runs weekly at most. 60 days
// therefore accepts the newest legitimate snapshot with slack, while rejecting
// genuinely stale data. This matters because the LTSF sync is currently
// unregistered in ScheduleConfig.js: without an age guard, documents written by
// a long-gone sync (real ones dated Aug 2025 were still being read in Aug 2026)
// get presented to sellers as money recoverable *today*.
const LTSF_MAX_SNAPSHOT_AGE_DAYS = 60;

/** Milliseconds for a Date or a date-ish string; NaN when undatable. */
function toTime(value) {
    if (!value) return NaN;
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(t) ? t : NaN;
}

/**
 * Builds {[asin]: long-term storage fee $} from an LTSF document, summing the
 * multiple aging buckets that can appear per ASIN per snapshot, and dropping
 * rows whose snapshot is too old to describe the seller's current position.
 *
 * A row is dated by its own `snapShotDate`; if that is unparseable the
 * document's `createdAt` is used; if neither can be dated the row is dropped
 * rather than trusted, since an undated fee cannot be shown as current.
 *
 * @param {Object|null} ltsfDoc - lean LongTermStorageFees document
 * @param {Date} [now]
 * @param {number} [maxAgeDays]
 * @returns {Object} asin -> summed fee (empty when the doc is missing or stale)
 */
function buildLtsfAmountMap(ltsfDoc, now = new Date(), maxAgeDays = LTSF_MAX_SNAPSHOT_AGE_DAYS) {
    const map = {};
    if (!ltsfDoc || !Array.isArray(ltsfDoc.data) || ltsfDoc.data.length === 0) return map;

    const cutoff = toTime(now) - maxAgeDays * 24 * 60 * 60 * 1000;
    const docTime = toTime(ltsfDoc.createdAt);

    let staleRows = 0;
    let undatedRows = 0;

    ltsfDoc.data.forEach(row => {
        if (!row || !row.asin) return;

        let rowTime = toTime(row.snapShotDate);
        if (!Number.isFinite(rowTime)) rowTime = docTime;

        if (!Number.isFinite(rowTime)) { undatedRows++; return; }
        if (rowTime < cutoff) { staleRows++; return; }

        map[row.asin] = (map[row.asin] || 0) + (parseFloat(row.amount) || 0);
    });

    // Loud on purpose: dropping every row looks identical to "this seller owes
    // no storage fees", so a silent skip would hide both stale data and a
    // date-format regression in the sync's parser.
    if (staleRows > 0 || undatedRows > 0) {
        logger.warn('LTSF rows ignored when building recoverable amounts', {
            staleRows,
            undatedRows,
            keptAsins: Object.keys(map).length,
            maxAgeDays
        });
    }

    return map;
}

/**
 * @param {Object} params
 * @param {number} params.netProfit
 * @param {number} params.profitMargin
 * @param {number} params.sales
 * @param {string} params.issueType - 'negative_profit' | 'low_margin'
 * @returns {number}
 */
function computeProfitabilityAmount({ netProfit, profitMargin, sales, issueType }) {
    if (issueType === 'negative_profit') {
        return Math.abs(netProfit || 0);
    }
    if (issueType === 'low_margin') {
        // $ shortfall versus a healthy TARGET_PROFIT_MARGIN_PERCENT margin
        return Math.max(0, (TARGET_PROFIT_MARGIN_PERCENT / 100) * (sales || 0) - (netProfit || 0));
    }
    return 0;
}

/**
 * @param {Object} params
 * @param {string} params.errorType
 * @param {number} params.spend
 * @param {number} params.sales
 * @returns {number}
 */
function computeSponsoredAdsAmount({ errorType, spend, sales }) {
    switch (errorType) {
        case 'high_acos_campaign':
            return Math.max(0, (spend || 0) - (sales || 0) * (TARGET_ACOS_PERCENT / 100));
        case 'wasted_spend_keyword':
        case 'search_term_zero_sales':
            return spend || 0;
        // auto_campaign_migration_needed is a scaling/efficiency opportunity
        // (sales are already > $30) — not a loss, so no recoverable $ amount.
        default:
            return 0;
    }
}

/**
 * The profit opportunity for ONE product, given both levers that apply to it.
 *
 * These do not add up. `netProfit` is already `sales - adsSpend - totalFees`
 * (ProfitabilityCalculation.js), so a product's loss ALREADY has its wasted ad
 * spend subtracted — removing that waste is part of closing the gap, not extra
 * on top. Summing them produced impossible figures: a product losing $122.29
 * with $24.28 of wasted keywords was reported as $146.57 recoverable, when
 * $122.29 is breakeven and therefore the ceiling.
 *
 * Taking the larger keeps the measured gap as the anchor, while still crediting a
 * guaranteed ad saving that happens to exceed the gap (removing $50 of waste from
 * a product losing $20 really does gain $50 and turns it profitable).
 *
 * @param {Object} params
 * @param {number} params.profitGap - |netProfit| or the shortfall to target margin
 * @param {number} params.adWaste - ad waste attributed to this product
 * @returns {number}
 */
function capProfitOpportunity({ profitGap, adWaste }) {
    return Math.max(Math.max(0, profitGap || 0), Math.max(0, adWaste || 0));
}

/**
 * Unfulfillable inventory: dead CAPITAL = per-unit cost x unfulfillable units.
 *
 * NOT profit. This is money locked in stock that cannot be sold; freeing it
 * returns working capital and stops storage fees accruing, but it never lands as
 * profit. It must be reported separately — on one real account a single ASIN
 * holds $7,902 of this, which would outrank every genuine profit issue by 62x if
 * the two were mixed.
 *
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - unfulfillable_quantity
 * @returns {number} capital, not profit
 */
function computeInventoryUnfulfillableAmount({ costPerUnit, quantity }) {
    return Math.max(0, (costPerUnit || 0) * (quantity || 0));
}

/**
 * Stranded inventory: CAPITAL tied up in units that can't be sold until the
 * listing issue is fixed — not profit, same as unfulfillable above.
 *
 * `quantity` here is a proxy (the ASIN's total FBA quantity, since a stranded
 * listing makes its whole inventory unsellable, not just some units) rather than
 * a native "stranded units" field, since Amazon's Stranded Inventory report
 * doesn't expose one.
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - proxy quantity (e.g. total FBA quantity for the ASIN)
 * @returns {number} capital, not profit
 */
function computeInventoryStrandedAmount({ costPerUnit, quantity }) {
    return Math.max(0, (costPerUnit || 0) * (quantity || 0));
}

const BUYBOX_EXTRAPOLATION_DAYS = 30;

/**
 * Derives a seller's own conversion rate + average price from the ASINs
 * that currently DO have the Buy Box, so Buy Box loss can be estimated
 * without an external/generic benchmark.
 * @param {Array} asinBuyBoxData - full array (with AND without Buy Box)
 * @returns {{benchmarkCVR: number, benchmarkPrice: number}}
 */
function computeBuyBoxBenchmark(asinBuyBoxData) {
    if (!Array.isArray(asinBuyBoxData)) {
        return { benchmarkCVR: 0, benchmarkPrice: 0 };
    }

    let benchmarkSessions = 0;
    let benchmarkUnits = 0;
    let benchmarkRevenue = 0;

    // Flagged rows carry their real (partial) share now, so buyBoxLost is checked
    // too: an ASIN losing the Buy Box is not a holder whatever its %.
    asinBuyBoxData.forEach(p => {
        if (p && p.buyBoxPercentage > 0 && p.buyBoxLost !== true) {
            benchmarkSessions += p.sessions || 0;
            benchmarkUnits += p.unitsOrdered || 0;
            benchmarkRevenue += p.sales?.amount || 0;
        }
    });

    return {
        benchmarkCVR: benchmarkSessions > 0 ? benchmarkUnits / benchmarkSessions : 0,
        benchmarkPrice: benchmarkUnits > 0 ? benchmarkRevenue / benchmarkUnits : 0
    };
}

/** The data day a BuyBoxData doc covers: `date`, or dateRange.endDate on old docs. */
function buyBoxDocDay(doc) {
    return (doc && (doc.date || doc.dateRange?.endDate)) || null;
}

/**
 * Keeps the latest capture of each data day, up to `limit` days.
 *
 * BuyBoxData can hold several captures of one day (BuyBoxService saves without an
 * upsert). Reading them as separate days would let one bad re-capture count as a
 * second "day" of evidence. Input must already be newest first ({date:-1,
 * createdAt:-1}), so the first doc seen for a day is its latest capture. A doc with
 * no day at all is kept as its own day rather than merged with anything.
 *
 * @param {Array} docs - newest first
 * @param {number} [limit=Infinity] - distinct days to keep
 * @returns {Array} one doc per day, newest first
 */
function latestCapturePerBuyBoxDay(docs, limit = Infinity) {
    if (!Array.isArray(docs)) return [];
    const seen = new Set();
    const out = [];
    for (const doc of docs) {
        if (!doc) continue;
        const day = buyBoxDocDay(doc);
        if (day) {
            if (seen.has(day)) continue;
            seen.add(day);
        }
        out.push(doc);
        if (out.length >= limit) break;
    }
    return out;
}

/** A Buy Box % we can reason about; null/undefined/NaN mean "no data", not 0. */
function readBuyBoxPct(row) {
    const v = row?.buyBoxPercentage;
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Decides which ASINs have genuinely lost the Buy Box, from several days of data
 * instead of one, and returns an "effective" doc shaped like a BuyBoxData doc so
 * every downstream reader (DashboardCalculation, Analyse's conversion checks, the
 * issues pages) keeps working unchanged.
 *
 * WHY
 * Judging from the newest day alone turned noise into tasks. In the 14 days to
 * 2026-10-15, 2,463 ASINs flipped between 0% and >0% across days, and 1,082 had
 * exactly one 0% day out of 3+; each of those became a "No Buy Box" task lasting
 * a week. There were 12,123 open no_buybox tasks.
 *
 * THE RULE: two traffic days in a row at 0%
 * Per childAsin, only days where it had sessions > 0 count — a 0% on a day nobody
 * visited the listing says nothing about who holds the Buy Box. The ASIN is
 * flagged iff its two most recent days-with-traffic were both 0% (the same "2 in
 * a row" rule account health uses). A single 0% blip is ignored.
 *
 * ONLY ONE TRAFFIC DAY -> NOT FLAGGED
 * With a single day of traffic there is no second observation to confirm it, and
 * an unconfirmed single day is exactly the blip this rule exists to ignore. This
 * is the cautious side of the same rule: the ASIN is flagged as soon as a second
 * traffic day also reads 0%.
 *
 * THE EFFECTIVE DOC
 * Built from the newest day. Flagged ASINs read 0%. A non-flagged ASIN that reads
 * 0% (or nothing) on the newest day takes its latest observed non-zero % instead,
 * marked `buyBoxPercentageCarriedForward` so it can be kept out of the conversion
 * benchmark (that day's sessions did not convert like a Buy Box holder's). One
 * that never showed a non-zero % in the window (typically zero traffic, or a
 * single traffic day) has no evidence either way: its % becomes null ("unknown").
 * Keeping 0% would recreate the false task via DashboardCalculation's `=== 0`
 * filter; dropping the row would lose its sessions/page views, which the product
 * performance pages read from this same doc. Every server reader of these rows
 * already does `buyBoxPercentage || 0` for display. A flagged ASIN absent from
 * the newest day (no traffic, so no row) is added from its most recent row so it
 * still gets its task. Every row carries an explicit `buyBoxLost` boolean.
 *
 * Each row also carries `zeroDays` / `trafficDays` and averages across the loaded
 * days (`avgDailySessions`, `avgDailySales`), so the lost-revenue estimate is based
 * on an average day rather than whichever day happened to be newest. An ASIN
 * absent from a day contributes 0 sessions to that day.
 *
 * @param {Array} days - BuyBoxData docs, one per day, newest first (findRecentDays)
 * @returns {Object|null} effective doc, or null when there are no days at all
 *   (= no Buy Box data, so no Buy Box issues — never "every product lost").
 */
// tasks-logics.xlsx "Products without Buy Box": Featured Offer % under 80% over the
// last 7 days, with 50+ sessions in those days (the 'Low' band starts at 80%).
const BUYBOX_LOW_PCT = 80;
const BUYBOX_MIN_SESSIONS = 50;

function classifyBuyBoxLoss(days) {
    const usable = Array.isArray(days) ? days.filter((d) => d && Array.isArray(d.asinBuyBoxData)) : [];
    if (usable.length === 0) return null;

    const observedDays = usable.length;
    const latest = usable[0];

    // childAsin -> per-day observations, newest first.
    const history = new Map();
    usable.forEach((day, dayIndex) => {
        for (const row of day.asinBuyBoxData) {
            if (!row || !row.childAsin) continue;
            let h = history.get(row.childAsin);
            if (!h) {
                h = { rows: [], totalSessions: 0, totalSales: 0 };
                history.set(row.childAsin, h);
            }
            // A day can list the same ASIN twice only if the doc is malformed;
            // keep the first so each day counts once.
            if (h.rows.length && h.rows[h.rows.length - 1].dayIndex === dayIndex) continue;
            h.rows.push({ dayIndex, row });
            h.totalSessions += Number(row.sessions) || 0;
            h.totalSales += Number(row.sales?.amount) || 0;
            // Session-weighted Buy Box share over the loaded days (up to 7).
            const pct = readBuyBoxPct(row);
            const sessions = Number(row.sessions) || 0;
            if (pct !== null && sessions > 0) {
                h.weightedPct = (h.weightedPct || 0) + pct * sessions;
                h.judgedSessions = (h.judgedSessions || 0) + sessions;
            }
        }
    });

    const verdicts = new Map();
    for (const [asin, h] of history) {
        const trafficDays = h.rows.filter(({ row }) => (Number(row.sessions) || 0) > 0 && readBuyBoxPct(row) !== null);
        const zeroDays = trafficDays.filter(({ row }) => readBuyBoxPct(row) === 0).length;
        // Was: 0% on the last two traffic days. Now the spreadsheet's rule: under
        // 80% of visits over the window, on enough traffic to mean something.
        const sevenDayPct = h.judgedSessions > 0 ? h.weightedPct / h.judgedSessions : null;
        // Two days with traffic at least (kept from the earlier fix): one day of
        // data must not raise a week-long task.
        const flagged = sevenDayPct !== null
            && trafficDays.length >= 2
            && h.judgedSessions >= BUYBOX_MIN_SESSIONS
            && sevenDayPct < BUYBOX_LOW_PCT;
        const lastNonZero = h.rows.find(({ row }) => (readBuyBoxPct(row) || 0) > 0);
        verdicts.set(asin, {
            flagged,
            sevenDayPct: sevenDayPct === null ? null : Math.round(sevenDayPct * 10) / 10,
            zeroDays,
            trafficDays: trafficDays.length,
            lastNonZeroPct: lastNonZero ? readBuyBoxPct(lastNonZero.row) : null,
            avgDailySessions: h.totalSessions / observedDays,
            avgDailySales: h.totalSales / observedDays,
            newestRow: h.rows[0].row
        });
    }

    const decorate = (row, v, buyBoxPercentage, carriedForward) => ({
        ...row,
        buyBoxPercentage,
        buyBoxLost: v.flagged,
        ...(carriedForward ? { buyBoxPercentageCarriedForward: true } : {}),
        zeroDays: v.zeroDays,
        trafficDays: v.trafficDays,
        avgDailySessions: v.avgDailySessions,
        avgDailySales: v.avgDailySales
    });

    const rows = [];
    const inLatest = new Set();
    for (const row of latest.asinBuyBoxData) {
        if (!row || !row.childAsin || inLatest.has(row.childAsin)) continue;
        inLatest.add(row.childAsin);
        const v = verdicts.get(row.childAsin);
        const pct = readBuyBoxPct(row);
        if (v.flagged) {
            // The real 7-day share (e.g. 45%), not a forced 0%: readers pick lost
            // rows by `buyBoxLost`.
            rows.push(decorate(row, v, v.sevenDayPct, false));
        } else if (pct !== null && pct > 0) {
            rows.push(decorate(row, v, pct, false));
        } else if (v.lastNonZeroPct !== null) {
            rows.push(decorate(row, v, v.lastNonZeroPct, true));
        } else {
            // Never seen with the Buy Box, never confirmed without it (see above).
            rows.push(decorate(row, v, null, false));
        }
    }
    for (const [asin, v] of verdicts) {
        if (v.flagged && !inLatest.has(asin)) rows.push(decorate(v.newestRow, v, v.sevenDayPct, false));
    }

    let productsWithBuyBox = 0;
    let productsWithoutBuyBox = 0;
    let productsWithLowBuyBox = 0;
    for (const r of rows) {
        // Lost = the verdict, whatever share it held. Unknown (null) rows count as neither.
        if (r.buyBoxLost) productsWithoutBuyBox++;
        else if (r.buyBoxPercentage > 0) productsWithBuyBox++;
        if (r.buyBoxPercentage > 0 && r.buyBoxPercentage < 50) productsWithLowBuyBox++;
    }

    return {
        ...latest,
        totalProducts: rows.length,
        productsWithBuyBox,
        productsWithoutBuyBox,
        productsWithLowBuyBox,
        asinBuyBoxData: rows,
        observedDays,
        observedDates: usable.map(buyBoxDocDay)
    };
}

/**
 * The number of Buy Box tasks the issues pipeline will create: flagged ASINs that
 * are Active in the catalogue. The dashboard count must be this, not the stored
 * productsWithoutBuyBox, or the dashboard and the task list disagree.
 * @param {Object|null} effectiveDoc - from classifyBuyBoxLoss
 * @param {Set<string>} activeAsinSet
 * @returns {number}
 */
function countActiveBuyBoxLosses(effectiveDoc, activeAsinSet) {
    if (!effectiveDoc || !Array.isArray(effectiveDoc.asinBuyBoxData) || !activeAsinSet) return 0;
    return effectiveDoc.asinBuyBoxData.filter(
        (p) => p && p.buyBoxLost === true && p.childAsin && activeAsinSet.has(p.childAsin)
    ).length;
}

/**
 * Active ASINs of a marketplace's catalogue (sellerAccount.products), the set the
 * Buy Box counts and tasks are judged over.
 * @param {Array} products
 * @returns {Set<string>}
 */
function activeAsinSetOf(products) {
    return new Set(
        (Array.isArray(products) ? products : [])
            .filter((p) => p && p.asin && p.status === 'Active')
            .map((p) => p.asin)
    );
}

/**
 * The ASINs whose Buy Box is judged: Active, and not out of stock on every active
 * listing (tasks-logics.xlsx: an out-of-stock product belongs to the out-of-stock
 * task). Used by the Buy Box task list and every Buy Box count, so they agree.
 *
 * Stock is only trusted when the account has stock data at all: a catalogue whose
 * quantities never synced reads 0 everywhere, and must not lose every Buy Box task.
 * @param {Array} products - sellerAccount.products
 * @returns {Set<string>}
 */
function buyBoxJudgedAsinSetOf(products) {
    const list = (Array.isArray(products) ? products : []).filter((p) => p && p.asin && p.status === 'Active');
    const stock = new Map();
    for (const p of list) stock.set(p.asin, (stock.get(p.asin) || 0) + (Number(p.quantity) || 0));
    const hasStockData = [...stock.values()].some((q) => q > 0);
    return new Set([...stock.keys()].filter((asin) => !hasStockData || stock.get(asin) > 0));
}

/**
 * Buy Box summary counts over ACTIVE ASINs of the effective doc (classifyBuyBoxLoss).
 *
 * WHY. The dashboard used to mix populations: totalProducts / productsWithBuyBox
 * came from the effective doc (every ASIN, inactive included) while
 * productsWithoutBuyBox was active-only, and rows with an unknown (null)
 * percentage counted in neither — so with + without never added up to the total,
 * and productsWithLowBuyBox (which the client expects) was dropped. Every count
 * here is over the same active set, and:
 *
 *   with     pct > 0
 *   without  pct === 0            (= countActiveBuyBoxLosses = the No Buy Box task count)
 *   low      0 < pct < 50         (a subset of `with`)
 *   unknown  pct === null         (never seen with the Buy Box, never confirmed without)
 *   total    with + without + unknown
 *
 * @param {Object|null} effectiveDoc - from classifyBuyBoxLoss
 * @param {Set<string>} activeAsinSet - see activeAsinSetOf
 * @returns {{totalProducts:number, productsWithBuyBox:number, productsWithoutBuyBox:number, productsWithLowBuyBox:number, productsWithUnknownBuyBox:number}}
 */
function summarizeBuyBoxCounts(effectiveDoc, activeAsinSet) {
    const counts = {
        totalProducts: 0,
        productsWithBuyBox: 0,
        productsWithoutBuyBox: 0,
        productsWithLowBuyBox: 0,
        productsWithUnknownBuyBox: 0
    };
    if (!effectiveDoc || !Array.isArray(effectiveDoc.asinBuyBoxData) || !activeAsinSet) return counts;

    // Same row filter as countActiveBuyBoxLosses (no de-dupe: classifyBuyBoxLoss
    // already emits one row per childAsin), so `without` equals it exactly.
    for (const row of effectiveDoc.asinBuyBoxData) {
        if (!row || !row.childAsin || !activeAsinSet.has(row.childAsin)) continue;
        const pct = row.buyBoxPercentage;
        if (row.buyBoxLost !== true && (typeof pct !== 'number' || Number.isNaN(pct))) {
            counts.productsWithUnknownBuyBox++;
        } else if (row.buyBoxLost === true) {
            // The verdict, whatever share it held (under 80% over 7 days).
            counts.productsWithoutBuyBox++;
        } else if (pct > 0) {
            counts.productsWithBuyBox++;
            if (pct < 50) counts.productsWithLowBuyBox++;
        }
        // A negative percentage cannot come out of classifyBuyBoxLoss; it counts nowhere.
    }
    counts.totalProducts = counts.productsWithBuyBox + counts.productsWithoutBuyBox + counts.productsWithUnknownBuyBox;
    return counts;
}

/**
 * Buy Box loss: estimated 30-day lost revenue = the seller's own
 * benchmark conversion rate/price applied to the lost ASIN's sessions,
 * minus what it actually sold, extrapolated from one day to 30. That day is
 * the ASIN's AVERAGE day over the loaded Buy Box days (avgDailySessions /
 * avgDailySales from classifyBuyBoxLoss) when available, so one unusually busy
 * or quiet day no longer sets the figure.
 * @param {Object} params
 * @param {number} params.sessions - daily sessions
 * @param {number} params.actualRevenue
 * @param {number} params.benchmarkCVR
 * @param {number} params.benchmarkPrice
 * @param {number} [params.extrapolationDays]
 * @returns {number}
 */
function computeBuyBoxLostRevenueAmount({ sessions, actualRevenue, benchmarkCVR, benchmarkPrice, extrapolationDays = BUYBOX_EXTRAPOLATION_DAYS }) {
    const potentialDailyRevenue = (sessions || 0) * (benchmarkCVR || 0) * (benchmarkPrice || 0);
    const dailyLostRevenue = Math.max(0, potentialDailyRevenue - (actualRevenue || 0));
    return dailyLostRevenue * extrapolationDays;
}

/**
 * Converts Buy Box lost REVENUE into the profit it actually represents.
 *
 * Winning the Buy Box back returns revenue, not profit — only the margin on that
 * revenue reaches the bottom line. Counting the full revenue overstated the
 * opportunity roughly tenfold at a typical 10% margin, and made Buy Box issues
 * outrank real cash losses.
 *
 * Flooring at zero is deliberate and informative: on a product that loses money
 * per unit, winning more sales loses MORE money, so the honest profit opportunity
 * is nothing until the margin is fixed first.
 *
 * @param {Object} params
 * @param {number} params.lostRevenue - from computeBuyBoxLostRevenueAmount
 * @param {number} params.profitMargin - that ASIN's margin as a percentage (e.g. 12.5)
 * @returns {number} profit-equivalent amount
 */
function computeBuyBoxProfitImpact({ lostRevenue, profitMargin }) {
    const margin = Math.max(0, Number(profitMargin) || 0);
    return Math.max(0, (Number(lostRevenue) || 0) * (margin / 100));
}

/**
 * Single source of truth for the combined recoverable total, so consumers
 * (IssueSummaryService, IssuesDataChunks metadata, opportunity ranking)
 * can't drift on which categories are included.
 * @param {Object} amounts - any object carrying the per-category total* fields
 * @returns {number}
 */
function sumRecoverableAmounts(amounts = {}) {
    return (amounts.totalProfitabilityRecoverableAmount || 0)
        + (amounts.totalSponsoredAdsRecoverableAmount || 0)
        + (amounts.totalInventoryRecoverableAmount || 0)
        + (amounts.totalConversionRecoverableAmount || 0);
}

// EconomicsMetrics stopped being written in April 2026, but findLatest still returns
// the last doc. For big accounts that doc carries a per-ASIN map, so 11 active
// marketplaces were judged on ~195-day-old finance and the live DailySkuFinance
// fallback (which only runs on an EMPTY map) never fired. Older than this = stale.
const ECONOMICS_MAX_AGE_DAYS = 14;

/** True when an EconomicsMetrics doc is recent enough to describe the seller now. */
function isEconomicsFresh(economicsMetrics, now = new Date(), maxAgeDays = ECONOMICS_MAX_AGE_DAYS) {
    if (!economicsMetrics) return false;
    const t = toTime(economicsMetrics.createdAt);
    if (!Number.isFinite(t)) return false;
    return t >= toTime(now) - maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * The single profitability rule, shared by the tasks (DashboardCalculation), the
 * Profitability page (ProfitabilityService) and the Profitability issues page
 * (ProfitabilityIssuesService), which used to carry three copies of it.
 *
 * A row with no sales has no margin to judge. The old rule read it as "0% margin"
 * (10,016 open $0 low_margin tasks in production) or as "losing money" on revenue $0.
 *
 *   sales > 0                              negative_profit / low_margin, as before
 *   no sales, ad spend > 0, finance fresh  ad_spend_no_sales (amount = the ad spend)
 *   no sales otherwise                     no verdict
 *   finance not fresh, or a 'legacy' row   no verdict (ProductWiseSales has had no
 *                                          new doc since 2025-12-04)
 *
 * @param {Object} row - { sales, ads, amzFee | totalFees, source? }
 * @param {Object} opts
 * @param {boolean} opts.financeFresh - the per-ASIN finance behind the rows is current
 * @returns {null | { errorType, amount, netProfit, profitMargin }}
 */
const LOSS_MAKING_MIN_UNITS = 10;

function classifyProfitabilityRow(row, { financeFresh, cogsMap = null } = {}) {
    if (!row || !financeFresh) return null;
    if (row.source === 'legacy') return null;

    const sales = Number(row.sales) || 0;
    const ads = Number(row.ads) || 0;
    const fees = Number(row.amzFee) || Number(row.totalFees) || 0;
    let netProfit = sales - ads - fees;

    // Tasks pass cogsMap: tasks-logics.xlsx "Loss-making product" is net profit per
    // unit below 0 over 30 days after fees, ads AND COGS, judged only on 10+ units
    // with COGS entered (no COGS -> the cogs_missing task asks for it instead).
    if (cogsMap && sales > 0) {
        const units = Number(row.quantity) || 0;
        const unitCost = Number(cogsMap[row.asin]) || 0;
        if (unitCost > 0) netProfit -= unitCost * units;
        const judged = unitCost > 0 && units >= LOSS_MAKING_MIN_UNITS;
        if (netProfit < 0 && !judged) return null;
    }

    if (sales <= 0) {
        if (ads <= 0) return null;
        return { errorType: 'ad_spend_no_sales', amount: ads, netProfit, profitMargin: 0 };
    }

    const profitMargin = (netProfit / sales) * 100;
    if (netProfit < 0) {
        return {
            errorType: 'negative_profit',
            amount: computeProfitabilityAmount({ netProfit, profitMargin, sales, issueType: 'negative_profit' }),
            netProfit,
            profitMargin,
        };
    }
    if (profitMargin < TARGET_PROFIT_MARGIN_PERCENT) {
        return {
            errorType: 'low_margin',
            amount: computeProfitabilityAmount({ netProfit, profitMargin, sales, issueType: 'low_margin' }),
            netProfit,
            profitMargin,
        };
    }
    return null;
}

module.exports = {
    LOSS_MAKING_MIN_UNITS,
    buyBoxJudgedAsinSetOf,
    BUYBOX_LOW_PCT,
    BUYBOX_MIN_SESSIONS,
    computeProfitabilityAmount,
    classifyProfitabilityRow,
    isEconomicsFresh,
    summarizeBuyBoxCounts,
    activeAsinSetOf,
    toTime,
    ECONOMICS_MAX_AGE_DAYS,
    computeSponsoredAdsAmount,
    capProfitOpportunity,
    computeBuyBoxProfitImpact,
    computeInventoryUnfulfillableAmount,
    computeInventoryStrandedAmount,
    computeBuyBoxBenchmark,
    computeBuyBoxLostRevenueAmount,
    latestCapturePerBuyBoxDay,
    classifyBuyBoxLoss,
    countActiveBuyBoxLosses,
    buildLtsfAmountMap,
    sumRecoverableAmounts,
    TARGET_PROFIT_MARGIN_PERCENT,
    TARGET_ACOS_PERCENT,
    BUYBOX_EXTRAPOLATION_DAYS,
    LTSF_MAX_SNAPSHOT_AGE_DAYS
};
