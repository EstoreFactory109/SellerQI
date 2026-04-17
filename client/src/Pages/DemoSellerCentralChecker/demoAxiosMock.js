import axios from 'axios';
import axiosInstance from '../../config/axios.config.js';

import {
  DEMO_USER,
  DEMO_NAVBAR,
  DEMO_NOTIFICATIONS,
  DEMO_TASKS,
  DEMO_REIMBURSEMENT,
  DEMO_PRODUCTS,
  DEMO_DASHBOARD_SUMMARY,
  DEMO_PPC,
  DEMO_PROFITABILITY,
  DEMO_ISSUES_BY_ASIN,
  DEMO_KEYWORD_ANALYSIS,
  DEMO_QMATE
} from './demoMockData.js';

import { DEMO_RECENT_ORDERS, DEMO_ACCOUNT_HISTORY } from './demoMockDataMore.js';

const DEMO_PREFIX = '/seller-central-checker-demo';

let initialized = false;

// In-memory demo state (mutations should reflect immediately during the session)
let tasksState = null;
let notificationState = null;
let reviewAuthState = null;
let qmateChatsState = null;
let cogsState = null;

const deepClone = (v) => JSON.parse(JSON.stringify(v));

// ================================================================
// Shared demo payload builders (frontend-only, no Amazon calls)
// ================================================================
const mkPlaceholderImage = (label) => {
  const safeLabel = String(label || 'Demo').slice(0, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="22" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="14" fill="#e5e7eb" font-weight="700">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const mkPagination = (page, limit, totalItems) => {
  const total = Math.max(0, Number(totalItems) || 0);
  const safeLimit = Math.max(1, Number(limit) || 10);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    page: Number(page) || 1,
    limit: safeLimit,
    total,
    totalPages,
    hasMore: (Number(page) || 1) < totalPages
  };
};

const DEMO_PROFITABILITY_SERIES = [
  { date: '2026-02-17', totalSales: 3510, totalExpenses: 1520, ppcSpend: 590 },
  { date: '2026-02-18', totalSales: 4680, totalExpenses: 1980, ppcSpend: 840 },
  { date: '2026-02-19', totalSales: 4020, totalExpenses: 1725, ppcSpend: 690 },
  { date: '2026-02-20', totalSales: 3895, totalExpenses: 1680, ppcSpend: 660 },
  { date: '2026-02-21', totalSales: 2780, totalExpenses: 1325, ppcSpend: 420 },
  { date: '2026-02-22', totalSales: 0, totalExpenses: 0, ppcSpend: 0 },
  { date: '2026-02-23', totalSales: 4910, totalExpenses: 2090, ppcSpend: 905 },
  { date: '2026-02-24', totalSales: 4345, totalExpenses: 1840, ppcSpend: 735 },
  { date: '2026-02-25', totalSales: 5230, totalExpenses: 2240, ppcSpend: 980 },
  { date: '2026-02-26', totalSales: 4090, totalExpenses: 1755, ppcSpend: 700 },
  { date: '2026-02-27', totalSales: 4625, totalExpenses: 1970, ppcSpend: 810 },
  { date: '2026-02-28', totalSales: 3055, totalExpenses: 1430, ppcSpend: 470 },
  { date: '2026-03-01', totalSales: 0, totalExpenses: 0, ppcSpend: 0 },
  { date: '2026-03-02', totalSales: 5385, totalExpenses: 2310, ppcSpend: 1025 },
  { date: '2026-03-03', totalSales: 4410, totalExpenses: 1865, ppcSpend: 750 },
  { date: '2026-03-04', totalSales: 4760, totalExpenses: 2030, ppcSpend: 845 },
  { date: '2026-03-05', totalSales: 3720, totalExpenses: 1605, ppcSpend: 620 },
  { date: '2026-03-06', totalSales: 4580, totalExpenses: 1960, ppcSpend: 805 },
  { date: '2026-03-07', totalSales: 3110, totalExpenses: 1420, ppcSpend: 495 },
  { date: '2026-03-08', totalSales: 0, totalExpenses: 0, ppcSpend: 0 },
  { date: '2026-03-09', totalSales: 4890, totalExpenses: 2095, ppcSpend: 890 },
  { date: '2026-03-10', totalSales: 4270, totalExpenses: 1805, ppcSpend: 710 },
  { date: '2026-03-11', totalSales: 5340, totalExpenses: 2280, ppcSpend: 980 },
  { date: '2026-03-12', totalSales: 3985, totalExpenses: 1710, ppcSpend: 655 },
  { date: '2026-03-13', totalSales: 4715, totalExpenses: 2010, ppcSpend: 820 },
  { date: '2026-03-14', totalSales: 2860, totalExpenses: 1365, ppcSpend: 430 },
  { date: '2026-03-15', totalSales: 5160, totalExpenses: 2215, ppcSpend: 935 },
  { date: '2026-03-16', totalSales: 0, totalExpenses: 0, ppcSpend: 0 },
  { date: '2026-03-17', totalSales: 5470, totalExpenses: 2360, ppcSpend: 1015 },
  { date: '2026-03-18', totalSales: 4395, totalExpenses: 1840, ppcSpend: 730 }
];

const parseDateKey = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getSeriesForCalendar = ({ startDate, endDate, periodType } = {}) => {
  const all = DEMO_PROFITABILITY_SERIES.slice();
  if (!all.length) return [];

  const mode = String(periodType || 'last30').toLowerCase();
  // Preset modes should be deterministic and distinct regardless of passed range.
  if (mode === 'last7') return all.slice(-7);
  if (mode === 'last14') return all.slice(-14);
  if (mode === 'last30' || mode === 'default') return all.slice(-30);

  const useRange = Boolean(startDate && endDate);
  if (useRange) {
    const s = parseDateKey(startDate);
    const e = parseDateKey(endDate);
    const ranged = all.filter((row) => row.date >= s && row.date <= e);
    if (ranged.length) return ranged;
  }

  return all.slice(-30);
};

const toSalesOnlyRows = (rows) => rows.map((row) => ({
  interval: `${row.date}T00:00:00.000Z--${row.date}T23:59:59.999Z`,
  TotalAmount: Number(row.totalSales) || 0
}));

const DEMO_PPC_CAMPAIGN_AUDIT_SERIES = [
  { date: '2026-02-17', spend: 280, sales: 760, impressions: 7200, clicks: 205 },
  { date: '2026-02-18', spend: 640, sales: 1910, impressions: 12400, clicks: 388 },
  { date: '2026-02-19', spend: 330, sales: 860, impressions: 7600, clicks: 228 },
  { date: '2026-02-20', spend: 720, sales: 2080, impressions: 13100, clicks: 412 },
  { date: '2026-02-21', spend: 260, sales: 690, impressions: 6900, clicks: 196 },
  { date: '2026-02-22', spend: 590, sales: 1750, impressions: 11750, clicks: 360 },
  { date: '2026-02-23', spend: 0, sales: 0, impressions: 0, clicks: 0 },
  { date: '2026-02-24', spend: 350, sales: 990, impressions: 8200, clicks: 246 },
  { date: '2026-02-25', spend: 690, sales: 2010, impressions: 12800, clicks: 405 },
  { date: '2026-02-26', spend: 300, sales: 810, impressions: 7400, clicks: 218 },
  { date: '2026-02-27', spend: 610, sales: 1825, impressions: 12000, clicks: 374 },
  { date: '2026-02-28', spend: 245, sales: 640, impressions: 6650, clicks: 188 },
  { date: '2026-03-01', spend: 570, sales: 1680, impressions: 11300, clicks: 348 },
  { date: '2026-03-02', spend: 780, sales: 2280, impressions: 13800, clicks: 430 },
  { date: '2026-03-03', spend: 325, sales: 900, impressions: 7700, clicks: 230 },
  { date: '2026-03-04', spend: 665, sales: 1960, impressions: 12500, clicks: 398 },
  { date: '2026-03-05', spend: 0, sales: 0, impressions: 0, clicks: 0 },
  { date: '2026-03-06', spend: 285, sales: 780, impressions: 7250, clicks: 210 },
  { date: '2026-03-07', spend: 630, sales: 1880, impressions: 12100, clicks: 382 },
  { date: '2026-03-08', spend: 310, sales: 840, impressions: 7500, clicks: 222 },
  { date: '2026-03-09', spend: 740, sales: 2160, impressions: 13400, clicks: 418 },
  { date: '2026-03-10', spend: 265, sales: 710, impressions: 7000, clicks: 198 },
  { date: '2026-03-11', spend: 605, sales: 1800, impressions: 11900, clicks: 370 },
  { date: '2026-03-12', spend: 355, sales: 980, impressions: 8150, clicks: 244 },
  { date: '2026-03-13', spend: 700, sales: 2050, impressions: 12900, clicks: 408 },
  { date: '2026-03-14', spend: 290, sales: 770, impressions: 7300, clicks: 214 },
  { date: '2026-03-15', spend: 640, sales: 1920, impressions: 12300, clicks: 390 },
  { date: '2026-03-16', spend: 0, sales: 0, impressions: 0, clicks: 0 },
  { date: '2026-03-17', spend: 760, sales: 2230, impressions: 13600, clicks: 424 },
  { date: '2026-03-18', spend: 340, sales: 920, impressions: 7900, clicks: 236 }
];

const PPC_DATE_WISE_METRICS = DEMO_PPC_CAMPAIGN_AUDIT_SERIES.map((row) => {
  const spend = Number(row.spend) || 0;
  const sales = Number(row.sales) || 0;
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const acos = sales > 0 ? (spend / sales) * 100 : 0;
  const tacos = sales > 0 ? (spend / sales) * 100 : 0;
  return {
    date: String(row.date),
    spend,
    sales,
    impressions,
    clicks,
    acos,
    tacos
  };
});

const PPC_DATE_WISE_UNITS_SOLD = DEMO_PPC_CAMPAIGN_AUDIT_SERIES.map((row, idx) => {
  const unitsSold = row.sales > 0 ? Math.max(0, Math.round((Number(row.sales) || 0) / (44 + (idx % 5) * 3))) : 0;
  return { date: row.date, unitsSold };
});

const computePpcSummary = (rows) => {
  const totalSpend = rows.reduce((s, x) => s + (Number(x.spend) || 0), 0);
  const totalSales = rows.reduce((s, x) => s + (Number(x.sales) || 0), 0);
  const overallAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  return { totalSpend, totalSales, overallAcos };
};

const PPC_SUMMARY_ALL = computePpcSummary(PPC_DATE_WISE_METRICS);
const PPC_TOTAL_SPEND = PPC_SUMMARY_ALL.totalSpend;
const PPC_TOTAL_SALES = PPC_SUMMARY_ALL.totalSales;
const PPC_OVERALL_ACOS = PPC_SUMMARY_ALL.overallAcos;
const PPC_TOTAL_UNITS_SOLD = PPC_DATE_WISE_UNITS_SOLD.reduce((s, x) => s + (Number(x.unitsSold) || 0), 0);

const getPpcMetricsForRange = ({ startDate, endDate } = {}) => {
  const all = PPC_DATE_WISE_METRICS.slice();
  if (!all.length) return [];
  if (!startDate || !endDate) return all;
  const s = parseDateKey(startDate);
  const e = parseDateKey(endDate);
  const ranged = all.filter((row) => row.date >= s && row.date <= e);
  return ranged.length ? ranged : all;
};

const getPpcUnitsForRange = ({ startDate, endDate } = {}) => {
  const all = PPC_DATE_WISE_UNITS_SOLD.slice();
  if (!all.length) return [];
  if (!startDate || !endDate) return all;
  const s = parseDateKey(startDate);
  const e = parseDateKey(endDate);
  const ranged = all.filter((row) => row.date >= s && row.date <= e);
  return ranged.length ? ranged : all;
};

const mkPPCMetricsModelPayload = (metricsRows = PPC_DATE_WISE_METRICS) => {
  const rows = Array.isArray(metricsRows) && metricsRows.length ? metricsRows : PPC_DATE_WISE_METRICS;
  const summary = computePpcSummary(rows);
  const startDate = rows[0]?.date || PPC_DATE_WISE_METRICS[0]?.date || '2026-02-17';
  const endDate = rows[rows.length - 1]?.date || PPC_DATE_WISE_METRICS[PPC_DATE_WISE_METRICS.length - 1]?.date || '2026-03-18';
  return ({
  found: true,
  data: {
    summary: {
      totalSpend: summary.totalSpend,
      totalSales: summary.totalSales,
      overallAcos: summary.overallAcos,
      tacos: summary.overallAcos
    },
    dateRange: { mode: 'last30', startDate, endDate },
    dateWiseMetrics: rows,
    campaignTypeBreakdown: {
      sponsoredBrands: { spend: summary.totalSpend * 0.25, sales: summary.totalSales * 0.22 },
      sponsoredProducts: { spend: summary.totalSpend * 0.65, sales: summary.totalSales * 0.68 },
      sponsoredDisplay: { spend: summary.totalSpend * 0.1, sales: summary.totalSales * 0.1 }
    }
  }
});
};

const mkPPCUnitsSoldModelPayload = (unitsRows = PPC_DATE_WISE_UNITS_SOLD) => {
  const rows = Array.isArray(unitsRows) && unitsRows.length ? unitsRows : PPC_DATE_WISE_UNITS_SOLD;
  const totalUnits = rows.reduce((s, x) => s + (Number(x.unitsSold) || 0), 0);
  return ({
  found: true,
  data: {
    totalUnits,
    dateWiseUnits: rows
  }
});
};

const mkError = (message, howToSolve) => ({
  status: 'Error',
  Message: String(message || 'Demo error'),
  HowTOSolve: String(howToSolve || 'Review listing and update the relevant fields.')
});

const mkWarning = (message, howToSolve) => ({
  status: 'Warning',
  Message: String(message || 'Demo warning'),
  HowTOSolve: String(howToSolve || 'Review and adjust the listing content.')
});

const mkFixedAttributes = () => ({
  title: { fixed: false },
  bulletpoints: { fixed: false },
  description: { fixed: false },
  generic_keyword: { fixed: false }
});

const mkRankingDetails = (asin) => {
  const idx = Math.abs(String(asin || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 9;
  const charLimMsg = `Character limit issue detected for ${asin}.`;
  const restrictedMsg = `Restricted words found in ${asin}.`;
  const specialCharMsg = `Special characters detected in ${asin}.`;
  const howTo = 'Update the listing text to comply with Amazon character and policy requirements.';
  return {
    data: {
      TitleResult: {
        charLim: mkError(charLimMsg, howTo),
        RestictedWords: mkError(restrictedMsg, 'Remove restricted terms and re-check compliance.'),
        checkSpecialCharacters: mkError(specialCharMsg, 'Remove special characters and validate the final text.')
      },
      BulletPoints: {
        charLim: mkWarning('Bullet point length out of bounds for the target marketplace.', howTo),
        RestictedWords: mkError(restrictedMsg, 'Remove restricted terms and re-check compliance.'),
        checkSpecialCharacters: mkError(specialCharMsg, 'Remove special characters and validate the final text.')
      },
      Description: {
        charLim: mkError(charLimMsg, howTo),
        RestictedWords: mkError('Duplicate or restricted wording detected in description.', howTo),
        checkSpecialCharacters: idx % 2 === 0 ? mkError(specialCharMsg, 'Remove special characters.') : mkWarning(specialCharMsg, 'Consider simplifying punctuation and formatting.')
      },
      charLim: mkError('Backend keywords character limit issue.', 'Shorten or split keyword phrases to fit limits.'),
      dublicateWords: mkError('Backend keywords contain duplicate words.', 'Remove duplicates and keep the most relevant terms.')
    }
  };
};

const mkConversionErrors = (asin) => {
  const msgBase = `Conversion optimization issue for ${asin}.`;
  return {
    imageResultErrorData: mkError(`${msgBase} Images may be missing or not policy-compliant.`, 'Upload compliant primary image(s) and ensure the main image matches the product.'),
    videoResultErrorData: mkError(`${msgBase} Video requirements are not met.`, 'Add a compliant product video to improve engagement.'),
    productStarRatingResultErrorData: mkError(`${msgBase} Star rating quality signals need improvement.`, 'Ensure product reviews comply and address customer experience drivers.'),
    productsWithOutBuyboxErrorData: mkError(`${msgBase} Buy Box ownership is unstable.`, 'Improve pricing, fulfillment/shipping, and seller health metrics to secure Buy Box.'),
    aplusErrorData: mkError(`${msgBase} A+ content is missing or non-compliant.`, 'Add A+ modules that follow formatting and policy guidelines.'),
    brandStoryErrorData: mkError(`${msgBase} Brand story content needs update.`, 'Ensure brand story text and assets are accurate and policy-compliant.')
  };
};

const mkInventoryErrors = (asin, sku) => ({
  inventoryPlanningErrorData: {
    longTermStorageFees: mkError(`Long-term storage fee risk for ${asin}.`, 'Reduce storage duration or optimize inventory replenishment cycles.'),
    unfulfillable: mkError(`Unfulfillable inventory flagged for ${asin}.`, 'Check inbound shipment/receiving status and ensure correct prep requirements.')
  },
  strandedInventoryErrorData: {
    Message: `Stranded inventory detected for ${asin}.`,
    HowToSolve: 'Resolve listing/eligibility issues and update inventory placement to make units sellable.'
  },
  inboundNonComplianceErrorData: {
    Message: `Inbound non-compliance issue for ${asin}.`,
    HowToSolve: 'Review shipment compliance requirements and fix any prep/labeling problems.'
  },
  replenishmentErrorData: {
    sku: sku || 'SKU-DEMO',
    Message: `Low inventory risk detected for ${asin}.`,
    HowToSolve: 'Plan replenishment based on sell-through and ensure inventory arrives before stockout.',
    recommendedReplenishmentQty: 25
  }
});

// ================================================================
// Issue count helpers — derived from the SAME mock builders that
// Product Details iterates, so totals always match.
// ================================================================
const countRankingErrorsForAsin = (asin) => {
  const details = mkRankingDetails(asin);
  const d = details?.data || {};
  let count = 0;
  const check = (obj) => { if (obj?.status === 'Error') count++; };
  // Title
  check(d.TitleResult?.charLim);
  check(d.TitleResult?.RestictedWords);
  check(d.TitleResult?.checkSpecialCharacters);
  // BulletPoints
  check(d.BulletPoints?.charLim);
  check(d.BulletPoints?.RestictedWords);
  check(d.BulletPoints?.checkSpecialCharacters);
  // Description
  check(d.Description?.charLim);
  check(d.Description?.RestictedWords);
  check(d.Description?.checkSpecialCharacters);
  // Backend Keywords
  check(d.charLim);
  return count;
};

const countConversionErrorsForAsin = (asin) => {
  const errors = mkConversionErrors(asin);
  let count = 0;
  const check = (obj) => { if (obj?.status === 'Error') count++; };
  check(errors.imageResultErrorData);
  check(errors.videoResultErrorData);
  check(errors.productStarRatingResultErrorData);
  check(errors.productsWithOutBuyboxErrorData);
  check(errors.aplusErrorData);
  check(errors.brandStoryErrorData);
  return count;
};

const countInventoryErrorsForAsin = (asin, sku) => {
  const errors = mkInventoryErrors(asin, sku);
  let count = 0;
  const planning = errors.inventoryPlanningErrorData || {};
  if (planning.longTermStorageFees?.status === 'Error') count++;
  if (planning.unfulfillable?.status === 'Error') count++;
  if (errors.strandedInventoryErrorData) count++;
  if (errors.inboundNonComplianceErrorData) count++;
  if (errors.replenishmentErrorData) {
    if (Array.isArray(errors.replenishmentErrorData)) count += errors.replenishmentErrorData.length;
    else count++;
  }
  return count;
};

const getDemoTotalErrorsForAsin = (asin) => {
  const prod = DEMO_PRODUCTS.find((p) => p.asin === String(asin || '').trim().toUpperCase());
  const sku = prod?.sku || 'SKU-DEMO';
  return countRankingErrorsForAsin(asin) + countConversionErrorsForAsin(asin) + countInventoryErrorsForAsin(asin, sku);
};

const getDemoErrorCountsByCategory = () => {
  let rankingTotal = 0;
  let conversionTotal = 0;
  let inventoryTotal = 0;
  DEMO_PRODUCTS.forEach((p) => {
    rankingTotal += countRankingErrorsForAsin(p.asin);
    conversionTotal += countConversionErrorsForAsin(p.asin);
    inventoryTotal += countInventoryErrorsForAsin(p.asin, p.sku);
  });
  return { rankingTotal, conversionTotal, inventoryTotal };
};

const getDemoProductLifecycleStatus = (product, idx) => {
  if ((Number(product?.quantity) || 0) <= 0) return 'Zero Availability';
  if (idx % 9 === 0 && idx > 0) return 'Inactive';
  if (idx % 7 === 0 && idx > 0) return 'Incomplete';
  return 'Active';
};

const mkYourProductsBaseRecord = (product, idx) => {
  const status = getDemoProductLifecycleStatus(product, idx);
  const starRatings = Math.max(3.1, Math.min(4.8, 4.6 - (idx % 8) * 0.18));
  return {
    asin: product.asin,
    sku: product.sku,
    title: product.name,
    name: product.name,
    status,
    price: Number(product.price) || 0,
    quantity: Number(product.quantity) || 0,
    issueCount: getDemoTotalErrorsForAsin(product?.asin),
    hasVideo: idx % 3 !== 1,
    has_b2b_pricing: idx % 4 !== 0,
    numRatings: 180 + idx * 73,
    starRatings,
    hasAPlus: idx % 5 !== 0,
    isTargetedInAds: idx % 4 !== 1
  };
};

const mkBuyBoxDetails = (asin, sku, title) => ({
  asin,
  sku,
  Title: title || asin,
  buyBoxPercentage: 34.2,
  pageViews: 8200,
  sessions: 1450
});

const mkPPCMetricKeywords = () => {
  const baseWasted = (DEMO_PPC?.tabs?.wastedSpend?.rows || []).map((r) => ({
    ...r,
    matchType: r.matchType || 'EXACT',
    keywordId: r.keywordId || `kw-w-${r.keyword}-${Math.random().toString(16).slice(2, 6)}`
  }));
  const extraWasted = [
    { keywordId: 'kw-w-3', keyword: 'standing desk mat', campaignName: 'SP - Office', campaignId: 'c4', adGroupName: 'AG - Broad', adGroupId: 'ag4', sales: 0, spend: 47.2, matchType: 'BROAD' },
    { keywordId: 'kw-w-4', keyword: 'laptop riser', campaignName: 'SP - Office', campaignId: 'c4', adGroupName: 'AG - Phrase', adGroupId: 'ag5', sales: 0, spend: 32.9, matchType: 'PHRASE' },
    { keywordId: 'kw-w-5', keyword: 'back posture support', campaignName: 'SD - Posture', campaignId: 'c5', adGroupName: 'AG - SD', adGroupId: 'ag6', sales: 0, spend: 28.5, matchType: 'EXACT' },
    { keywordId: 'kw-w-6', keyword: 'drawer organizer tray', campaignName: 'SP - Home', campaignId: 'c6', adGroupName: 'AG - Broad', adGroupId: 'ag7', sales: 0, spend: 26.7, matchType: 'BROAD' },
    { keywordId: 'kw-w-7', keyword: 'meal prep container', campaignName: 'SP - Kitchen', campaignId: 'c7', adGroupName: 'AG - Exact', adGroupId: 'ag8', sales: 0, spend: 35.4, matchType: 'EXACT' },
    { keywordId: 'kw-w-8', keyword: 'travel neck support', campaignName: 'SP - Travel', campaignId: 'c8', adGroupName: 'AG - Phrase', adGroupId: 'ag9', sales: 0, spend: 30.3, matchType: 'PHRASE' }
  ];
  const wastedRows = [...baseWasted, ...extraWasted];

  const baseTop = (DEMO_PPC?.tabs?.topPerforming?.rows || []).map((r) => ({
    ...r,
    keywordId: r.keywordId || `kw-t-${r.keyword}-${Math.random().toString(16).slice(2, 6)}`,
    impressions: r.impressions || 5600
  }));
  const extraTop = [
    { keywordId: 'kw-t-2', keyword: 'ergonomic mouse wireless', campaignName: 'SP - Top', campaignId: 'c1', adGroupName: 'AG - Exact', adGroupId: 'ag1', sales: 312.4, spend: 52.1, acos: 16.7, impressions: 7400 },
    { keywordId: 'kw-t-3', keyword: 'desk lamp dimmable', campaignName: 'SD - Lux', campaignId: 'c2', adGroupName: 'AG - SD', adGroupId: 'ag3', sales: 286.7, spend: 49.3, acos: 17.2, impressions: 6800 },
    { keywordId: 'kw-t-4', keyword: 'insulated bottle 1l', campaignName: 'SP - Fitness', campaignId: 'c9', adGroupName: 'AG - Exact', adGroupId: 'ag10', sales: 358.9, spend: 63.5, acos: 17.7, impressions: 9200 },
    { keywordId: 'kw-t-5', keyword: 'vacuum storage bags', campaignName: 'SP - Home', campaignId: 'c6', adGroupName: 'AG - Phrase', adGroupId: 'ag11', sales: 271.3, spend: 46.9, acos: 17.3, impressions: 6100 },
    { keywordId: 'kw-t-6', keyword: 'wrist rest keyboard', campaignName: 'SP - Office', campaignId: 'c4', adGroupName: 'AG - Exact', adGroupId: 'ag12', sales: 224.6, spend: 39.8, acos: 17.7, impressions: 5700 },
    { keywordId: 'kw-t-7', keyword: 'lunch tote insulated', campaignName: 'SP - Kitchen', campaignId: 'c7', adGroupName: 'AG - Broad', adGroupId: 'ag13', sales: 248.2, spend: 43.2, acos: 17.4, impressions: 5900 }
  ];
  const topRows = [...baseTop, ...extraTop];

  const baseZeroSales = (DEMO_PPC?.tabs?.searchTermsZeroSales?.rows || []).map((r) => ({
    ...r,
    keywordId: r.keywordId || `kw-z-${r.searchTerm}-${Math.random().toString(16).slice(2, 6)}`,
    adGroupName: r.adGroupName || 'AG - Demo'
  }));
  const extraZeroSales = [
    { searchTerm: 'cheap desk organizer', campaignId: 'c6', campaignName: 'SP - Home', keyword: 'desk organizer', keywordId: 'kw-z-2', adGroupName: 'AG - Broad', clicks: 24, spend: 26.4 },
    { searchTerm: 'pillow for flights', campaignId: 'c8', campaignName: 'SP - Travel', keyword: 'travel pillow', keywordId: 'kw-z-3', adGroupName: 'AG - Phrase', clicks: 21, spend: 24.8 },
    { searchTerm: 'book light kids', campaignId: 'c10', campaignName: 'SP - Reading', keyword: 'book lamp', keywordId: 'kw-z-4', adGroupName: 'AG - Broad', clicks: 16, spend: 17.9 },
    { searchTerm: 'water bottle with straw lid', campaignId: 'c9', campaignName: 'SP - Fitness', keyword: 'water bottle', keywordId: 'kw-z-5', adGroupName: 'AG - Broad', clicks: 19, spend: 23.6 },
    { searchTerm: 'food clip bag sealer', campaignId: 'c7', campaignName: 'SP - Kitchen', keyword: 'food clips', keywordId: 'kw-z-6', adGroupName: 'AG - Exact', clicks: 17, spend: 20.1 }
  ];
  const zeroSalesRows = [...baseZeroSales, ...extraZeroSales];
  return { wastedRows, topRows, zeroSalesRows };
};

const { wastedRows: DEMO_WASTED_SPEND_ROWS, topRows: DEMO_TOP_KEYWORDS_ROWS, zeroSalesRows: DEMO_ZERO_SALES_ROWS } = mkPPCMetricKeywords();

const mkHighAcosRows = () => ([
  { campaignName: 'SP - Top', spend: 420.5, sales: 820.0, acos: 51.2 },
  { campaignName: 'SD - Lux', spend: 360.2, sales: 695.0, acos: 51.8 },
  { campaignName: 'SP - Others', spend: 285.1, sales: 510.0, acos: 55.9 },
  { campaignName: 'SP - Office', spend: 310.8, sales: 548.0, acos: 56.7 },
  { campaignName: 'SP - Kitchen', spend: 276.4, sales: 487.0, acos: 56.8 },
  { campaignName: 'SD - Retarget', spend: 240.6, sales: 422.0, acos: 57.0 },
  { campaignName: 'SP - Travel', spend: 198.9, sales: 345.0, acos: 57.7 },
  { campaignName: 'SP - Reading', spend: 172.3, sales: 296.0, acos: 58.2 },
  { campaignName: 'SP - Fitness', spend: 334.5, sales: 573.0, acos: 58.4 },
  { campaignName: 'SD - Competitor', spend: 211.0, sales: 358.0, acos: 58.9 }
]);

const mkNoNegativesRows = () => ([
  { campaignName: 'SP - Top', adGroupName: 'AG - Exact', negatives: 0 },
  { campaignName: 'SP - Others', adGroupName: 'AG - Broad', negatives: 0 },
  { campaignName: 'SD - Lux', adGroupName: 'AG - SD', negatives: 0 },
  { campaignName: 'SP - Office', adGroupName: 'AG - Phrase', negatives: 0 },
  { campaignName: 'SP - Home', adGroupName: 'AG - Broad', negatives: 0 },
  { campaignName: 'SP - Kitchen', adGroupName: 'AG - Exact', negatives: 0 },
  { campaignName: 'SP - Travel', adGroupName: 'AG - Phrase', negatives: 0 },
  { campaignName: 'SP - Fitness', adGroupName: 'AG - Broad', negatives: 0 },
  { campaignName: 'SD - Competitor', adGroupName: 'AG - SD', negatives: 0 },
  { campaignName: 'SP - Reading', adGroupName: 'AG - Exact', negatives: 0 }
]);

const mkAutoInsightsRows = () => ([
  { searchTerm: 'wireless mouse', campaignName: 'SP - Top', adGroupName: 'AG - Exact', sales: 180.0, acos: 24.1 },
  { searchTerm: 'desk lamp', campaignName: 'SD - Lux', adGroupName: 'AG - SD', sales: 250.0, acos: 18.4 },
  { searchTerm: 'stainless mug 500ml', campaignName: 'SP - Others', adGroupName: 'AG - Demo', sales: 0.01, acos: 300.0 },
  { searchTerm: 'ergonomic office mouse', campaignName: 'SP - Office', adGroupName: 'AG - Exact', sales: 212.4, acos: 20.5 },
  { searchTerm: 'under cabinet lamp', campaignName: 'SP - Home', adGroupName: 'AG - Phrase', sales: 194.8, acos: 21.7 },
  { searchTerm: 'vacuum bag set', campaignName: 'SP - Home', adGroupName: 'AG - Broad', sales: 229.3, acos: 19.6 },
  { searchTerm: 'travel neck pillow', campaignName: 'SP - Travel', adGroupName: 'AG - Phrase', sales: 161.7, acos: 23.9 },
  { searchTerm: 'book clip light', campaignName: 'SP - Reading', adGroupName: 'AG - Exact', sales: 139.2, acos: 22.8 },
  { searchTerm: 'running belt hydration', campaignName: 'SP - Fitness', adGroupName: 'AG - Broad', sales: 176.5, acos: 24.4 },
  { searchTerm: 'food bag clips', campaignName: 'SP - Kitchen', adGroupName: 'AG - Exact', sales: 208.1, acos: 20.2 }
]);

const getDemoProfitabilityErrorTotal = () => {
  const rows = DEMO_PROFITABILITY?.tableRows || [];
  return rows.filter((r) => String(r?.status || '').toLowerCase() !== 'good').length;
};

const getDemoSponsoredAdsErrorTotal = () => {
  return (
    (mkHighAcosRows().length || 0) +
    (DEMO_WASTED_SPEND_ROWS.length || 0) +
    (mkNoNegativesRows().length || 0) +
    (DEMO_ZERO_SALES_ROWS.length || 0)
  );
};

const getDemoAccountErrorTotal = () => 10;

const isDemoPath = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith(DEMO_PREFIX);
};

const extractPathname = (url) => {
  if (!url) return '';
  // If absolute URL, take pathname; otherwise strip query.
  try {
    const u = new URL(url, 'http://localhost');
    return u.pathname;
  } catch {
    return String(url).split('?')[0];
  }
};

const extractQuery = (url) => {
  if (!url) return '';
  const s = String(url);
  const idx = s.indexOf('?');
  return idx >= 0 ? s.slice(idx + 1) : '';
};

const makeNestedDataResponse = (config, payload) => ({
  data: { data: payload },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
  request: {}
});

const makeRawResponse = (config, rawData) => ({
  data: rawData,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
  request: {}
});

const upsertChatInState = (chat) => {
  qmateChatsState = qmateChatsState || [];
  const idx = qmateChatsState.findIndex((c) => c.id === chat.id);
  if (idx >= 0) qmateChatsState[idx] = chat;
  else qmateChatsState.unshift(chat);
};

export const initDemoAxiosMock = () => {
  if (initialized) return;
  if (!isDemoPath()) return;
  initialized = true;

  // Seed demo state once
  tasksState = deepClone(DEMO_TASKS);
  notificationState = deepClone(DEMO_NOTIFICATIONS);
  reviewAuthState = { reviewRequestAuthStatus: !!DEMO_RECENT_ORDERS?.reviewRequestAuthStatus };

  // Seed QMate chats (store chat objects + messages)
  const initialChats = (DEMO_QMATE?.suggestedChats || []).map((c, i) => ({
    id: c.id,
    title: c.title,
    date: new Date(Date.now() - i * 86400000).toISOString(),
    messages: [
      {
        id: `m-${c.id}-1`,
        role: 'user',
        content: c.seed,
        date: new Date().toISOString()
      },
      {
        id: `m-${c.id}-2`,
        role: 'assistant',
        content: `Mock response for "${c.title}".`,
        wastedKeywords: [],
        wastedKeywordsTotal: 0,
        date: new Date().toISOString()
      }
    ]
  }));

  qmateChatsState = initialChats;

  cogsState = deepClone(DEMO_PROFITABILITY?.cogs || {});

  const handleRequest = (config) => {
    const method = (config.method || 'get').toLowerCase();
    const pathname = extractPathname(config.url);
    const query = extractQuery(config.url);
    const params = new URLSearchParams(query);
    // Calendar default fetch (used by Calendar "Last 30 days" apply)
    if (method === 'get' && pathname === '/api/pagewise/dashboard') {
      const periodRows = getSeriesForCalendar({ periodType: 'last30' });
      const startDate = periodRows[0]?.date || DEMO_PROFITABILITY?.dateRange?.startDate || '2026-02-17';
      const endDate = periodRows[periodRows.length - 1]?.date || DEMO_PROFITABILITY?.dateRange?.endDate || '2026-03-18';
      const totalSales = periodRows.reduce((s, r) => s + (Number(r.totalSales) || 0), 0);
      return makeNestedDataResponse(config, {
        dashboardData: {
          ...DEMO_DASHBOARD_SUMMARY,
          startDate,
          endDate,
          calendarMode: 'default',
          TotalWeeklySale: totalSales,
          TotalSales: toSalesOnlyRows(periodRows),
          GetOrderData: []
        }
      });
    }

    // Calendar custom/last7/last14 fetch
    if (method === 'get' && pathname === '/app/analyse/getDataFromDate') {
      const periodType = params.get('periodType') || 'custom';
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');
      const rows = getSeriesForCalendar({ startDate, endDate, periodType });
      const salesRows = toSalesOnlyRows(rows);
      const totalSales = rows.reduce((s, r) => s + (Number(r.totalSales) || 0), 0);
      const resolvedStartDate = rows[0]?.date || startDate || DEMO_PROFITABILITY?.dateRange?.startDate || '2026-02-17';
      const resolvedEndDate =
        rows[rows.length - 1]?.date || endDate || DEMO_PROFITABILITY?.dateRange?.endDate || '2026-03-18';

      // Keep non-sales dashboard cards static in demo mode.
      const tableRows = DEMO_PROFITABILITY?.tableRows || [];
      const totalFees = tableRows.reduce((sum, r) => sum + (Number(r.fees) || 0), 0);
      const fbaFees = totalFees * 0.45;
      const otherAmazonFees = totalFees - fbaFees;
      const staticTotalSales = Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0;
      const staticTotalPpc = Number(DEMO_PPC?.kpiSummary?.totalSpend) || 0;
      const staticGrossProfit = Number(DEMO_PROFITABILITY?.summary?.totalGrossProfit) || 0;
      return makeRawResponse(config, {
        data: {
          startDate: resolvedStartDate,
          endDate: resolvedEndDate,
          FinanceData: {
            Gross_Profit: staticGrossProfit,
            ProductAdsPayment: staticTotalPpc,
            FBA_Fees: fbaFees,
            Other_Amazon_Fees: otherAmazonFees,
            Refunds: staticTotalSales * 0.03
          },
          reimburstmentData: DEMO_REIMBURSEMENT?.summary || {},
          TotalSales: {
            totalSales,
            dateWiseSales: salesRows
          },
          GetOrderData: []
        }
      });
    }


    // Navbar
    if (method === 'get' && pathname === '/api/pagewise/navbar') {
      return makeNestedDataResponse(config, DEMO_NAVBAR);
    }

    // Reimbursements (ReimbursementDashboard)
    if (method === 'get' && pathname === '/app/reimbursements/summary') {
      return makeNestedDataResponse(config, DEMO_REIMBURSEMENT?.summary || {});
    }

    // Alerts (TopNav dropdown)
    if (method === 'get' && pathname === '/api/alerts/latest') {
      return makeNestedDataResponse(config, { alerts: notificationState });
    }

    // Notifications listing page
    if (method === 'get' && pathname === '/api/alerts') {
      const limit = Math.max(1, Number(params.get('limit') || 20));
      const skip = Math.max(0, Number(params.get('skip') || 0));
      const sourceNotifications = Array.isArray(notificationState) && notificationState.length
        ? notificationState
        : (Array.isArray(DEMO_NOTIFICATIONS) ? DEMO_NOTIFICATIONS : []);
      const sorted = [...sourceNotifications].sort((a, b) => {
        const aTime = new Date(a?.timestamp || a?.createdAt || 0).getTime();
        const bTime = new Date(b?.timestamp || b?.createdAt || 0).getTime();
        return bTime - aTime;
      });
      const page = sorted.slice(skip, skip + limit);
      const alerts = page.map((n) => ({
        _id: n.alertId || n.id,
        alertType: n.alertType || (n.type === 'analysis_complete' ? 'Analysis' : 'Alert'),
        message: n.message || n.title || '',
        createdAt: n.timestamp || n.createdAt || new Date().toISOString(),
        viewed: Boolean(n.viewed || n.isRead),
        products: Array.isArray(n.products) ? n.products : [],
        metadata: n.metadata || {}
      }));
      return makeNestedDataResponse(config, {
        alerts,
        total: sorted.length
      });
    }

    // Notification details page
    if (method === 'get' && /^\/api\/alerts\/([^/]+)$/.test(pathname)) {
      const [, alertId] = pathname.match(/^\/api\/alerts\/([^/]+)$/);
      const hit = notificationState.find((n) => String(n.alertId || n.id) === String(alertId));
      if (!hit) {
        return makeErrorResponse(config, 404, 'Notification not found');
      }
      return makeNestedDataResponse(config, {
        _id: hit.alertId || hit.id,
        alertType: hit.alertType || 'Alert',
        message: hit.message || hit.title || '',
        createdAt: hit.timestamp || hit.createdAt || new Date().toISOString(),
        viewed: Boolean(hit.viewed || hit.isRead),
        products: Array.isArray(hit.products) ? hit.products : [],
        conversionRates: Array.isArray(hit.conversionRates) ? hit.conversionRates : [],
        metadata: hit.metadata || {}
      });
    }

    if (method === 'patch' && /^\/api\/alerts\/([^/]+)\/viewed$/.test(pathname)) {
      const [, alertId] = pathname.match(/^\/api\/alerts\/([^/]+)\/viewed$/);
      notificationState = notificationState.map((a) => (String(a.id) === String(alertId) ? { ...a, isRead: true, viewed: true } : a));
      return makeNestedDataResponse(config, { ok: true });
    }

    // Also support /api/alerts/:alertId/viewed (alertId passed as alertId, id passed to markAsRead)
    if (method === 'patch' && /^\/api\/alerts\/([^/]+)$/.test(pathname)) {
      return makeNestedDataResponse(config, { ok: true });
    }

    // Tasks
    if (method === 'get' && pathname === '/api/pagewise/tasks') {
      return makeNestedDataResponse(config, tasksState);
    }

    if (method === 'put' && pathname === '/api/pagewise/tasks/status') {
      const body = config.data || {};
      const taskId = body.taskId;
      const status = body.status;
      if (taskId && status && Array.isArray(tasksState?.tasks)) {
        tasksState.tasks = tasksState.tasks.map((t) => (String(t.taskId) === String(taskId) ? { ...t, status } : t));
      }
      return makeNestedDataResponse(config, tasksState);
    }

    // Dashboard phases (multi-phase parallel fetch)
    if (method === 'get' && pathname === '/api/pagewise/dashboard-phase1') {
      const { rankingTotal, conversionTotal, inventoryTotal } = getDemoErrorCountsByCategory();

      const totalIssuesCore = rankingTotal + conversionTotal + inventoryTotal;
      const totalProfitabilityErrors = getDemoProfitabilityErrorTotal();
      const totalSponsoredAdsErrors = getDemoSponsoredAdsErrorTotal();
      const totalErrorInAccount = getDemoAccountErrorTotal();
      const totalIssues = totalIssuesCore + totalProfitabilityErrors + totalSponsoredAdsErrors + totalErrorInAccount;
      return makeNestedDataResponse(config, {
        dashboardData: {
          totalProfitabilityErrors,
          totalSponsoredAdsErrors,
          totalInventoryErrors: inventoryTotal,
          TotalRankingerrors: rankingTotal,
          totalErrorInConversion: conversionTotal,
          totalErrorInAccount,
          totalIssues,
          numberOfProductsWithIssues: DEMO_PRODUCTS.length,
          totalProductCount: DEMO_PRODUCTS.length,
          activeProductCount: Math.max(1, DEMO_PRODUCTS.length - 1),
          calendarMode: 'default',
          startDate: null,
          endDate: null,
          Country: DEMO_NAVBAR?.Country || 'US',
          hasPrecomputedIssues: true
        }
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/dashboard-phase2') {
      const tableRows = DEMO_PROFITABILITY?.tableRows || [];
      const totalFees = tableRows.reduce((sum, r) => sum + (Number(r.fees) || 0), 0);
      const fbaFees = totalFees * 0.45;
      const otherAmazonFees = totalFees - fbaFees;
      const refunds = (Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0) * 0.03;
      const grossProfit = Number(DEMO_PROFITABILITY?.summary?.totalGrossProfit) || 0;

      const AccountErrors = {
        CancellationRate: mkError(
          'Cancellation rate is higher than expected.',
          'Ensure inventory availability and verify order handling processes.'
        ),
        NCX: mkWarning(
          'NCX-related signals require monitoring.',
          'Investigate NCX flags and improve listing accuracy and customer satisfaction.'
        ),
        PolicyViolations: mkError(
          'Potential policy violation signals found for the catalog.',
          'Review listings for restricted content and ensure policy compliance.'
        ),
        orderWithDefectsStatus: mkWarning(
          'Order defect rate is close to the threshold.',
          'Reduce defect drivers by improving packaging and defect prevention.'
        )
      };

      return makeNestedDataResponse(config, {
        dashboardData: {
          accountHealthPercentage: {
            Percentage: DEMO_DASHBOARD_SUMMARY?.accountHealthPercent || 0,
            status: 'Healthy'
          },
          AccountErrors,
          TotalWeeklySale: DEMO_PPC?.kpiSummary?.totalSales || 0,
          accountFinance: {
            // Keys used by `client/src/Components/Dashboard/SamePageComponents/TotalSales.jsx`
            FBA_Fees: fbaFees,
            Other_Amazon_Fees: otherAmazonFees,
            Refunds: refunds,
            Gross_Profit: grossProfit,
            // Keep some additional legacy-ish keys to avoid undefined access
            grossProfit: grossProfit,
            netProfit: Number(DEMO_PROFITABILITY?.summary?.totalNetProfit) || 0,
            ProductAdsPayment: Number(DEMO_PPC?.kpiSummary?.totalSpend) || 0
          },
          ppcSummary: DEMO_PPC?.kpiSummary || {},
          sponsoredAdsMetrics: DEMO_PPC?.kpiSummary || {},
          buyBoxSummary: {}
        }
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/dashboard-phase3') {
      const ppc = DEMO_PPC?.kpiSummary || {};

      // Used by DemoDashboard's quick stat "Money Wasted in Ads"
      // (filters: cost > 0 && attributedSales30d < 0.01)
      const adsKeywordsPerformanceData = [
        ...DEMO_WASTED_SPEND_ROWS.map((row, idx) => ({
          date: `2026-03-${String(18 - (idx % 7)).padStart(2, '0')}`,
          keyword: row.keyword,
          keywordId: row.keywordId || `kw-waste-${idx + 1}`,
          campaignName: row.campaignName,
          campaignId: row.campaignId || `c-waste-${idx + 1}`,
          adGroupName: row.adGroupName || 'AG - Demo',
          adGroupId: row.adGroupId || `ag-waste-${idx + 1}`,
          matchType: row.matchType || 'EXACT',
          cost: Number(row.spend) || 0,
          attributedSales30d: 0.0,
          impressions: 1800 + idx * 750,
          clicks: 10 + idx * 3,
          adKeywordStatus: 'enabled'
        })),
        // Keep a few converting keywords so PPC sections stay realistic
        {
          date: '2026-03-15',
          keyword: 'usb c cable 2m',
          keywordId: 'kw-104',
          campaignName: 'SP - Top',
          campaignId: 'c-101',
          adGroupName: 'AG - Exact',
          adGroupId: 'ag-101',
          matchType: 'EXACT',
          cost: 85.12,
          attributedSales30d: 140.0,
          impressions: 19000,
          clicks: 340,
          adKeywordStatus: 'enabled'
        },
        {
          date: '2026-03-14',
          keyword: 'gaming keyboard mechanical',
          keywordId: 'kw-105',
          campaignName: 'SP - Top',
          campaignId: 'c-101',
          adGroupName: 'AG - Exact',
          adGroupId: 'ag-101',
          matchType: 'PHRASE',
          cost: 61.0,
          attributedSales30d: 95.3,
          impressions: 12000,
          clicks: 210,
          adKeywordStatus: 'enabled'
        },
        {
          date: '2026-03-13',
          keyword: 'water bottle stainless',
          keywordId: 'kw-106',
          campaignName: 'SD - Lux',
          campaignId: 'c-102',
          adGroupName: 'AG - SD',
          adGroupId: 'ag-102',
          matchType: 'EXACT',
          cost: 22.4,
          attributedSales30d: 35.7,
          impressions: 6400,
          clicks: 98,
          adKeywordStatus: 'enabled'
        }
      ];

      const moneyWastedInAds = DEMO_WASTED_SPEND_ROWS.reduce((sum, row) => {
        return sum + (Number(row?.spend) || 0);
      }, 0);
      return makeNestedDataResponse(config, {
        dashboardData: {
          TotalSales: [{ date: 'Mar 18', sales: 0 }],
          TotalProduct: DEMO_PRODUCTS.map((p) => ({ asin: p.asin, name: p.name, status: 'Active' })),
          ActiveProducts: DEMO_PRODUCTS.slice(0, 2).map((p) => ({ asin: p.asin, name: p.name })),
          GetOrderData: [],
          totalOrdersCount: 0,
          ppcDateWiseMetrics: [
            { date: '2026-03-18', spend: 100, sales: 200, acos: 50, tacos: 45, units: 10 }
          ],
          dateWiseTotalCosts: [],
          adsKeywordsPerformanceData,
          moneyWastedInAds,
          // legacy helpers sometimes referenced
          totalOrders: 0,
          ppcSpend: ppc.totalSpend || 0
        }
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/top4-products') {
      const products = DEMO_PRODUCTS;
      const toIssueProduct = (p) => {
        const issues = DEMO_ISSUES_BY_ASIN?.[p?.asin];
        const totalErrors = issues?.totalErrors ?? 0;
        return {
          asin: p.asin,
          sku: p.sku,
          name: p.name,
          errors: totalErrors,
          totalErrors,
          status: 'Active'
        };
      };
      return makeNestedDataResponse(config, {
        first: products[0] ? toIssueProduct(products[0]) : null,
        second: products[1] ? toIssueProduct(products[1]) : null,
        third: products[2] ? toIssueProduct(products[2]) : null,
        fourth: products[3] ? toIssueProduct(products[3]) : null
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/top-priority-products') {
      const products = DEMO_PRODUCTS.slice(0, 4).map((p, idx) => {
        const issues = DEMO_ISSUES_BY_ASIN?.[p?.asin];
        const totalErrors = issues?.totalErrors ?? 0;
        const pseudoSales = Math.max(0, (Number(p?.sales) || 0) + (4 - idx) * 1000);
        return {
          asin: p.asin,
          name: p.name || p.itemName || p.asin,
          errors: totalErrors,
          issues: issues?.issues || [],
          sales: pseudoSales,
          quantity: Number(p?.unitsSold || 0)
        };
      });

      return makeNestedDataResponse(config, {
        total: products.length,
        products
      });
    }

    // =====================================================================
    // Issues By Product (used by ProductDetails to populate totals + tables)
    // =====================================================================
    if (method === 'get' && pathname === '/api/pagewise/issues-by-product') {
      const params = new URLSearchParams(query);
      const comparison = params.get('comparison') || 'none';

      const { rankingTotal, conversionTotal, inventoryTotal } = getDemoErrorCountsByCategory();

      const totalProfitabilityErrors = getDemoProfitabilityErrorTotal();
      const totalSponsoredAdsErrors = getDemoSponsoredAdsErrorTotal();
      const totalErrorInAccount = getDemoAccountErrorTotal();
      const totalIssuesCore = rankingTotal + conversionTotal + inventoryTotal;
      const totalIssues = totalIssuesCore + totalProfitabilityErrors + totalSponsoredAdsErrors + totalErrorInAccount;

      const lastPpc = PPC_DATE_WISE_METRICS[PPC_DATE_WISE_METRICS.length - 1] || {};
      const profitRows = DEMO_PROFITABILITY?.tableRows || [];
      const perfByAsin = DEMO_PRODUCTS.map((p, idx) => {
        const prof = profitRows.find((r) => String(r.asin) === String(p.asin)) || {};
        const perfScale = 0.85 + idx * 0.08;

        const sessions = Math.round((Number(lastPpc.clicks) || 0) * 6.5 * perfScale);
        const pageViews = Math.round((Number(lastPpc.impressions) || 0) * 0.42 * perfScale);
        const conversionRate = 2.1 + idx * 0.35;

        const ppcSpend = Math.round((Number(lastPpc.spend) || 0) * perfScale);
        const ppcSales = Math.max(1, Math.round((Number(prof.sales) || 0) * 0.22 * perfScale));
        const acos = ppcSpend > 0 ? (ppcSpend / ppcSales) * 100 : 0;

        return {
          asin: p.asin,
          sku: p.sku,
          name: p.name,
          performance: {
            sessions,
            pageViews,
            conversionRate,
            buyBoxPercentage: 28 + idx * 8.5,
            grossProfit: Number(prof.grossProfit) || 0,
            ppcSpend,
            ppcSales,
            acos
          },
          profitibility: {
            sales: Number(prof.sales) || 0,
            quantity: Number(prof.units) || 0,
            grossProfit: Number(prof.grossProfit) || 0
          }
        };
      });

      const productWiseError = DEMO_PRODUCTS.map((p) => {
        const idx = DEMO_PRODUCTS.findIndex((x) => x.asin === p.asin);
        const perf = perfByAsin[idx] || {};
        const prof = profitRows.find((r) => String(r.asin) === String(p.asin)) || {};

        return {
          asin: p.asin,
          sku: p.sku,
          name: p.name,
          totalErrors: getDemoTotalErrorsForAsin(p.asin),
          // ProductDetails renders these into the issues tables
          conversionErrors: mkConversionErrors(p.asin),
          inventoryErrors: mkInventoryErrors(p.asin, p.sku),
          // ProductDetails uses `performance` for the performance suggestions section
          performance: perf.performance || null,
          sales: Number(prof.sales) || 0,
          quantity: Number(prof.units) || 0
        };
      });

      const rankingProductWiseErrors = DEMO_PRODUCTS.map((p) => ({
        asin: p.asin,
        sku: p.sku,
        name: p.name,
        ...mkRankingDetails(p.asin)
      }));

      const profitibilityData = profitRows.map((r) => ({
        asin: r.asin,
        sku: r.sku,
        name: r.name,
        sales: Number(r.sales) || 0,
        quantity: Number(r.units) || 0,
        grossProfit: Number(r.grossProfit) || 0,
        netProfit: Number(r.netProfit) || 0,
        fees: Number(r.fees) || 0,
        status: r.status || 'good'
      }));

      return makeNestedDataResponse(config, {
        // Keep the dashboard category totals consistent on ProductDetails route
        totalProfitabilityErrors,
        totalSponsoredAdsErrors,
        totalInventoryErrors: inventoryTotal,
        TotalRankingerrors: rankingTotal,
        totalErrorInConversion: conversionTotal,
        totalErrorInAccount,
        totalIssues,
        numberOfProductsWithIssues: DEMO_PRODUCTS.length,
        totalProductCount: DEMO_PRODUCTS.length,
        activeProductCount: Math.max(1, DEMO_PRODUCTS.length - 1),

        // Products-by-issues data
        productWiseError,
        rankingProductWiseErrors,
        profitibilityData,

        comparisonMeta: {
          comparison
        }
      });
    }

    // Filtered total-sales (used when calendar mode != 'default')
    if (method === 'get' && pathname === '/api/total-sales/filter') {
      const periodType = params.get('periodType') || 'custom';
      const startDate = params.get('startDate') || DEMO_PROFITABILITY?.dateRange?.startDate || '';
      const endDate = params.get('endDate') || DEMO_PROFITABILITY?.dateRange?.endDate || '';
      const rows = getSeriesForCalendar({ startDate, endDate, periodType });
      const totalSales = rows.reduce((sum, r) => sum + (Number(r.totalSales) || 0), 0);
      const ppcSpent = rows.reduce((sum, r) => sum + (Number(r.ppcSpend) || 0), 0);
      const totalExpenses = rows.reduce((sum, r) => sum + (Number(r.totalExpenses) || 0), 0);
      const grossProfit = totalSales - totalExpenses - ppcSpent;
      const datewiseChartData = rows.map((r) => ({
        date: new Date(`${r.date}T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        originalDate: r.date,
        totalSales: Number(r.totalSales) || 0,
        grossProfit: (Number(r.totalSales) || 0) - (Number(r.totalExpenses) || 0) - (Number(r.ppcSpend) || 0),
      }));

      const tableRows = DEMO_PROFITABILITY?.tableRows || [];
      const totalFees = tableRows.reduce((sum, r) => sum + (Number(r.fees) || 0), 0);
      const fbaFees = totalFees * 0.45;
      const otherAmazonFees = totalFees - fbaFees;
      const refunds = (Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0) * 0.03;

      return makeNestedDataResponse(config, {
        dateRange: { mode: periodType, startDate, endDate },
        grossProfit: { amount: grossProfit },
        totalSales: { amount: totalSales },
        ppcSpent: { amount: ppcSpent },
        fbaFees: { amount: fbaFees },
        otherAmazonFees: { amount: otherAmazonFees },
        refunds: { amount: refunds },
        datewiseChartData
      });
    }

    // New profitability + expenses endpoints (used by updated profitability UI)
    if (method === 'get' && (pathname === '/api/profitability/summary' || pathname === '/api/profitability/summary/date-range')) {
      const isDateRange = pathname.endsWith('/date-range');
      const from = params.get('from');
      const to = params.get('to');
      const period = Number(params.get('period') || 30);
      const periodType = period === 7 ? 'last7' : period === 14 ? 'last14' : 'last30';
      const rows = isDateRange
        ? getSeriesForCalendar({ startDate: from, endDate: to, periodType: 'custom' })
        : getSeriesForCalendar({ periodType });
      const totals = rows.reduce((acc, row) => {
        acc.totalSales += Number(row.totalSales) || 0;
        acc.totalExpenses += Number(row.totalExpenses) || 0;
        acc.ppcSpend += Number(row.ppcSpend) || 0;
        return acc;
      }, { totalSales: 0, totalExpenses: 0, ppcSpend: 0 });
      const amazonFees = totals.totalExpenses * 0.68;
      const fbaFees = totals.totalExpenses * 0.41;
      const refunds = totals.totalSales * 0.028;
      return makeNestedDataResponse(config, {
        totalSales: totals.totalSales,
        totalExpenses: totals.totalExpenses,
        amazonFees,
        fbaFees,
        refunds,
      });
    }

    if (method === 'get' && (pathname === '/api/profitability/chart' || pathname === '/api/profitability/chart/date-range')) {
      const isDateRange = pathname.endsWith('/date-range');
      const from = params.get('from');
      const to = params.get('to');
      const period = Number(params.get('period') || 30);
      const periodType = period === 7 ? 'last7' : period === 14 ? 'last14' : 'last30';
      const rows = isDateRange
        ? getSeriesForCalendar({ startDate: from, endDate: to, periodType: 'custom' })
        : getSeriesForCalendar({ periodType });
      return makeNestedDataResponse(config, rows.map((row) => ({
        date: row.date,
        totalSales: row.totalSales,
      })));
    }

    if (method === 'get' && (pathname === '/api/expenses/total' || pathname === '/api/expenses/total/date-range')) {
      const isDateRange = pathname.endsWith('/date-range');
      const from = params.get('from');
      const to = params.get('to');
      const period = Number(params.get('period') || 30);
      const periodType = period === 7 ? 'last7' : period === 14 ? 'last14' : 'last30';
      const rows = isDateRange
        ? getSeriesForCalendar({ startDate: from, endDate: to, periodType: 'custom' })
        : getSeriesForCalendar({ periodType });
      return makeNestedDataResponse(config, {
        datewise: rows.map((row) => ({
          date: row.date,
          totalAmount: row.totalExpenses,
        })),
      });
    }

    if (method === 'get' && pathname === '/api/expenses/snapshot') {
      const totalExpenses = DEMO_PROFITABILITY_SERIES.reduce((sum, row) => sum + (Number(row.totalExpenses) || 0), 0);
      const totalAmazonFees = totalExpenses * 0.68;
      const last7Expenses = DEMO_PROFITABILITY_SERIES.slice(-7).reduce((sum, row) => sum + (Number(row.totalExpenses) || 0), 0);
      const last7AmazonFees = last7Expenses * 0.68;
      const last14Expenses = DEMO_PROFITABILITY_SERIES.slice(-14).reduce((sum, row) => sum + (Number(row.totalExpenses) || 0), 0);
      const last14AmazonFees = last14Expenses * 0.68;
      return makeNestedDataResponse(config, {
        totalAmazonFees: { total: totalAmazonFees },
        totalExpenses: { total: totalExpenses },
        totalAmazonFeesLast7Days: { total: last7AmazonFees },
        totalExpensesLast7Days: { total: last7Expenses },
        totalAmazonFeesLast14Days: { total: last14AmazonFees },
        totalExpensesLast14Days: { total: last14Expenses },
        dateWiseAmazonFees: DEMO_PROFITABILITY_SERIES.map((row) => ({ date: row.date, totalAmount: row.totalExpenses * 0.68 })),
        dateWiseExpenses: DEMO_PROFITABILITY_SERIES.map((row) => ({ date: row.date, totalAmount: row.totalExpenses })),
      });
    }

    if (method === 'get' && (pathname === '/api/profitability/table' || pathname === '/api/profitability/table/date-range')) {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const rows = (DEMO_PROFITABILITY?.tableRows || []).map((r, idx) => {
        const adSpend = Number(r.adSpend) || 0;
        const amazonFees = Number(r.fees) || 0;
        const totalExpenses = adSpend + amazonFees;
        const type = idx % 5;
        let breakdown = [];
        if (type === 0) {
          breakdown = [
            { category: 'Amazon Referral Fees', amount: amazonFees * 0.52 },
            { category: 'FBA Fulfillment', amount: amazonFees * 0.33 },
            { category: 'PPC Spend', amount: adSpend * 0.85 },
            { category: 'Promo Discounts', amount: adSpend * 0.15 }
          ];
        } else if (type === 1) {
          breakdown = [
            { category: 'FBA Storage', amount: amazonFees * 0.24 },
            { category: 'Amazon Closing Fees', amount: amazonFees * 0.41 },
            { category: 'Sponsored Products', amount: adSpend * 0.58 },
            { category: 'Sponsored Brands', amount: adSpend * 0.42 }
          ];
        } else if (type === 2) {
          breakdown = [
            { category: 'Returns & Refund Handling', amount: amazonFees * 0.19 },
            { category: 'Amazon Variable Fees', amount: amazonFees * 0.81 },
            { category: 'Auto Campaign Spend', amount: adSpend * 0.36 },
            { category: 'Manual Campaign Spend', amount: adSpend * 0.64 }
          ];
        } else if (type === 3) {
          breakdown = [
            { category: 'FBA Pick & Pack', amount: amazonFees * 0.47 },
            { category: 'Inventory Placement Fees', amount: amazonFees * 0.18 },
            { category: 'Long-Term Storage Reserve', amount: amazonFees * 0.35 },
            { category: 'Top-of-Search Bids', amount: adSpend * 0.49 },
            { category: 'Product Targeting Ads', amount: adSpend * 0.51 }
          ];
        } else {
          breakdown = [
            { category: 'Referral + FBA Core Fees', amount: amazonFees * 0.74 },
            { category: 'Policy/Adjustment Fees', amount: amazonFees * 0.26 },
            { category: 'Keyword Bids', amount: adSpend * 0.67 },
            { category: 'Placement Multipliers', amount: adSpend * 0.21 },
            { category: 'Budget Overrun Buffer', amount: adSpend * 0.12 }
          ];
        }
        return {
          asin: r.asin,
          sku: r.sku,
          productName: r.name,
          unitsSold: Number(r.units) || 0,
          totalSales: Number(r.sales) || 0,
          adSpend,
          amazonFees,
          totalExpenses,
          grossProfit: Number(r.grossProfit) || 0,
          netProfit: Number(r.netProfit) || 0,
          breakdown: breakdown.map((b) => ({ category: b.category, amount: Number(b.amount.toFixed(2)) })),
          status: r.status || 'good',
        };
      });
      const start = (page - 1) * limit;
      const pageRows = rows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        rows: pageRows,
        pagination: {
          page,
          limit,
          totalItems: rows.length,
          totalPages: Math.max(1, Math.ceil(rows.length / limit)),
          hasMore: page < Math.ceil(rows.length / limit),
        },
      });
    }

    // Profitability phases
    if (method === 'get' && pathname === '/api/pagewise/profitability/metrics') {
      const tableRows = DEMO_PROFITABILITY?.tableRows || [];
      const totalFees = tableRows.reduce((sum, r) => sum + (Number(r.fees) || 0), 0);
      const fbaFees = totalFees * 0.45; // split for demo visibility
      const otherAmazonFees = totalFees - fbaFees;
      const refunds = (Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0) * 0.03;

      const totalSales = Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0;
      const totalPpcSales = Number(DEMO_PPC?.kpiSummary?.totalSales) || 0;
      const totalAdSpend = Number(DEMO_PPC?.kpiSummary?.totalSpend) || 0;
      const acos = Number(DEMO_PPC?.kpiSummary?.acos) || 0;
      const grossProfit = Number(DEMO_PROFITABILITY?.summary?.totalGrossProfit) || 0;

      return makeNestedDataResponse(config, {
        accountFinance: {
          // Used by TotalSales / pie chart segments in DemoProfitibilityDashboard
          FBA_Fees: fbaFees,
          Other_Amazon_Fees: otherAmazonFees,
          Refunds: refunds,
          // Used for gross profit KPI (gross profit is computed as Gross_Profit - PPC)
          Gross_Profit: grossProfit
        },
        // Used by KPI cards in phased mode
        totalSales,
        totalPpcSales,
        totalAdSpend,
        acos,
        amazonFees: totalFees,
        grossProfit,
        Country: DEMO_NAVBAR?.Country || 'US'
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/profitability/chart') {
      const tableRows = DEMO_PROFITABILITY?.tableRows || [];
      const totalFees = tableRows.reduce((sum, r) => sum + (Number(r.fees) || 0), 0);
      const refundsTotal = (Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0) * 0.03;

      // Generate a fuller 7-point time series with visible fluctuations.
      const points = (PPC_DATE_WISE_METRICS || []).slice(-7);

      const salesSum = points.reduce((s, p) => s + (Number(p.sales) || 0), 0) || 1;
      const targetSalesSum = Number(DEMO_PROFITABILITY?.summary?.totalSales) || 0;
      const salesScale = targetSalesSum > 0 ? targetSalesSum / salesSum : 1;

      const spendSum = points.reduce((s, p) => s + (Number(p.spend) || 0), 0) || 1;
      const targetSpendSum = Number(DEMO_PPC?.kpiSummary?.totalSpend) || 0;
      const spendScale = targetSpendSum > 0 ? targetSpendSum / spendSum : 1;

      const feePerDay = totalFees / points.length;
      const refundPerDay = refundsTotal / points.length;

      const chartData = points.map((p, idx) => {
        const baseSales = Number(p.sales) || 0;
        const baseSpend = Number(p.spend) || 0;

        const totalSales = Math.max(0, Math.round(baseSales * salesScale));
        const spend = Math.max(0, baseSpend * spendScale);

        // Deterministic curve shaping: alternate positive/negative wiggles.
        const wigglePct = idx % 2 === 0 ? 0.12 : -0.08;
        const wiggle = totalSales * wigglePct;

        const grossProfitRaw = totalSales - (spend + feePerDay + refundPerDay) + wiggle;
        const grossProfit = Math.max(0, Math.round(grossProfitRaw * 100) / 100);

        return {
          date: p.date,
          totalSales: Math.round(totalSales * 100) / 100,
          grossProfit
        };
      });

      return makeNestedDataResponse(config, {
        chartData,
        dateRange: DEMO_PROFITABILITY?.dateRange || { mode: 'last30' }
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/profitability/table') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);

      const rows = DEMO_PROFITABILITY?.tableRows || [];
      const start = (page - 1) * limit;
      const pageRows = rows.slice(start, start + limit);

      // ProfitTable (phased loading mode) expects server-like keys:
      // - quantity (not units)
      // - ads (not adSpend)
      // - totalFees / amazonFees / amzFee (not fees)
      const normalizedRows = pageRows.map((r) => {
        const ads = r.ads ?? r.adSpend ?? 0;
        const quantity = r.quantity ?? r.units ?? 0;
        const amazonFees = r.amazonFees ?? r.totalFees ?? r.amzFee ?? r.fees ?? 0;
        const totalFees = r.totalFees ?? r.amzFee ?? r.fees ?? amazonFees;

        return {
          ...r,
          itemName: r.itemName ?? r.name,
          quantity,
          ads,
          totalFees,
          amazonFees,
          amzFee: r.amzFee ?? amazonFees,
          // Preserve legacy-ish fields so other UI sections don't break
          // (ProfitTable transformProduct still checks product.name/itemName)
          name: r.name ?? r.itemName
        };
      });

      return makeNestedDataResponse(config, {
        profitibilityData: normalizedRows,
        pagination: {
          page,
          limit,
          total: rows.length,
          totalPages: Math.max(1, Math.ceil(rows.length / limit)),
          hasMore: page < Math.ceil(rows.length / limit)
        },
        totalProfitabilityErrors: getDemoProfitabilityErrorTotal(),
        profitabilityErrorDetails: [],
        totalParents: rows.length,
        totalChildren: 0,
        totalProducts: rows.length
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/profitability/issues') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const buildIssue = (row, variantIdx) => {
        const sales = Number(row.sales) || 0;
        const adsSpend = Number(row.adSpend) || 0;
        const amazonFees = Number(row.fees) || 0;
        const netProfit = Number(row.netProfit) || 0;
        const profitMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
        const issueType = netProfit < 0 ? 'negative_profit' : 'low_profit_margin';
        const recommendationDesc =
          issueType === 'negative_profit'
            ? `Reduce losses by re-checking fees (est. ${amazonFees.toFixed(0)}), tightening PPC spend, and improving conversion for ${row.asin}.`
            : `Improve profitability by targeting higher-converting keywords, reviewing ad spend (${adsSpend.toFixed(0)}), and optimizing fees for ${row.asin}.`;

        const suffix = variantIdx % 3 === 0 ? 'Urgent' : variantIdx % 3 === 1 ? 'High impact' : 'Quick win';
        return {
          asin: row.asin,
          productName: row.name,
          issueType,
          netProfit,
          profitMargin,
          sales,
          adsSpend,
          amazonFees,
          recommendation: {
            title: `Demo recommendation (${suffix})`,
            description: recommendationDesc
          }
        };
      };

      const allSeedRows = (DEMO_PROFITABILITY?.tableRows || []).slice();
      const flaggedRows = allSeedRows.filter((row) => {
        const sales = Number(row?.sales) || 0;
        const netProfit = Number(row?.netProfit) || 0;
        const margin = sales > 0 ? (netProfit / sales) * 100 : 0;
        return netProfit < 0 || margin < 12;
      });
      const sourceRows = flaggedRows.length > 0 ? flaggedRows : allSeedRows;
      const allIssues = sourceRows.map((row, i) => buildIssue(row, i));

      const total = allIssues.length;
      const start = (page - 1) * limit;
      const issues = allIssues.slice(start, start + limit);

      return makeNestedDataResponse(config, {
        issues,
        summary: { totalIssues: total },
        pagination: mkPagination(page, limit, total)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/profitability-summary') {
      return makeNestedDataResponse(config, DEMO_DASHBOARD_SUMMARY);
    }

    if (method === 'get' && pathname === '/api/pagewise/profitability') {
      return makeNestedDataResponse(config, DEMO_PROFITABILITY);
    }

    // PPC metrics & tabs
    if (method === 'get' && pathname === '/api/pagewise/ppc-metrics/latest') {
      return makeNestedDataResponse(config, mkPPCMetricsModelPayload());
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc-metrics/filter') {
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');
      const rows = getPpcMetricsForRange({ startDate, endDate });
      return makeNestedDataResponse(config, mkPPCMetricsModelPayload(rows));
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc-metrics/graph') {
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');
      const rows = getPpcMetricsForRange({ startDate, endDate });
      return makeNestedDataResponse(config, {
        graphData: rows.map((d) => ({
          date: d.date,
          spend: d.spend,
          sales: d.sales,
          acos: d.acos,
          impressions: d.impressions,
          clicks: d.clicks
        }))
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc-units-sold/latest') {
      return makeNestedDataResponse(config, mkPPCUnitsSoldModelPayload());
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc-units-sold/filter') {
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');
      const rows = getPpcUnitsForRange({ startDate, endDate });
      return makeNestedDataResponse(config, mkPPCUnitsSoldModelPayload(rows));
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc-units-sold/summary') {
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');
      const rows = getPpcUnitsForRange({ startDate, endDate });
      const totalUnits = rows.reduce((s, x) => s + (Number(x.unitsSold) || 0), 0);
      return makeNestedDataResponse(config, { totalUnitsSold: totalUnits, totalUnits });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/summary') {
      const ks = DEMO_PPC?.kpiSummary || {};
      const spend = Number(ks.totalSpend) || 0;
      const sales = Number(ks.totalSales) || 0;
      const acos = Number(ks.acos) || 0;
      const tacos = Number(ks.tacOs) || Number(ks.tacos) || 0; // backend fixture uses `tacOs`

      const totalIssues =
        Number(ks.totalIssues) ||
        // Mirror the demo tab counts used by /api/pagewise/ppc/tab-counts
        (3 + (DEMO_WASTED_SPEND_ROWS.length || 2) + 3 + (DEMO_TOP_KEYWORDS_ROWS.length || 2) + (DEMO_ZERO_SALES_ROWS.length || 2) + 3);

      return makeNestedDataResponse(config, {
        spend,
        sales,
        acos,
        tacos,
        unitsSold: PPC_TOTAL_UNITS_SOLD,
        totalIssues
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/tab-counts') {
      const highAcosRows = mkHighAcosRows();
      const noNegativeRows = mkNoNegativesRows();
      const autoInsightRows = mkAutoInsightsRows();
      return makeNestedDataResponse(config, {
        highAcos: highAcosRows.length,
        wastedSpend: DEMO_WASTED_SPEND_ROWS.length || 2,
        noNegatives: noNegativeRows.length,
        topKeywords: DEMO_TOP_KEYWORDS_ROWS.length || 2,
        zeroSales: DEMO_ZERO_SALES_ROWS.length || 2,
        autoInsights: autoInsightRows.length
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/high-acos') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = mkHighAcosRows();
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/wasted-spend') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = DEMO_WASTED_SPEND_ROWS;
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length),
        totalWastedSpend: DEMO_PPC?.tabs?.wastedSpend?.totalWastedSpend || allRows.reduce((s, x) => s + (Number(x.spend) || 0), 0)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/no-negatives') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = mkNoNegativesRows();
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/top-keywords') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = DEMO_TOP_KEYWORDS_ROWS.length ? DEMO_TOP_KEYWORDS_ROWS.map((r) => ({
        keyword: r.keyword,
        keywordId: r.keywordId,
        campaignName: r.campaignName,
        campaignId: r.campaignId,
        adGroupName: r.adGroupName,
        adGroupId: r.adGroupId,
        sales: r.sales,
        spend: r.spend,
        acos: r.acos || (r.sales > 0 ? (r.spend / r.sales) * 100 : 0),
        impressions: r.impressions || 1000
      })) : [];
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/zero-sales') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = DEMO_ZERO_SALES_ROWS.length ? DEMO_ZERO_SALES_ROWS.map((r) => ({
        searchTerm: r.searchTerm,
        keyword: r.keyword,
        keywordId: r.keywordId,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adGroupId: r.adGroupId || null,
        adGroupName: r.adGroupName || 'AG - Demo',
        clicks: r.clicks || 0,
        sales: r.sales || 0,
        spend: r.spend || 0,
        acos: r.sales > 0 ? (r.spend / r.sales) * 100 : 999
      })) : [];
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      const totalWastedSpend = allRows.reduce((s, x) => s + (Number(x.spend) || 0), 0);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length),
        totalWastedSpend
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/ppc/auto-insights') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allRows = mkAutoInsightsRows();
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, allRows.length)
      });
    }

    // Issues paginated (used by Issues_pages/Category)
    if (method === 'get' && pathname === '/api/pagewise/issues/summary') {
      const { rankingTotal, conversionTotal, inventoryTotal } = getDemoErrorCountsByCategory();

      return makeNestedDataResponse(config, {
        totalRankingErrors: rankingTotal,
        totalConversionErrors: conversionTotal,
        totalInventoryErrors: inventoryTotal,
        totalAccountErrors: 6
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/issues/ranking') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allProducts = DEMO_PRODUCTS.slice(0, 3).map((p) => ({
        asin: p.asin,
        sku: p.sku,
        Title: p.name,
        fixedAttributes: mkFixedAttributes(),
        data: mkRankingDetails(p.asin).data
      }));
      const total = allProducts.length;
      const start = (page - 1) * limit;
      const rows = allProducts.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, total)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/issues/conversion') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allProducts = DEMO_PRODUCTS.slice(0, 3).map((p) => ({
        asin: p.asin,
        sku: p.sku,
        Title: p.name,
        ...mkConversionErrors(p.asin)
      }));
      const allBuyBoxData = DEMO_PRODUCTS.slice(0, 3).map((p) => mkBuyBoxDetails(p.asin, p.sku, p.name));
      const total = allProducts.length;
      const start = (page - 1) * limit;
      const rows = allProducts.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        buyBoxData: allBuyBoxData,
        pagination: mkPagination(page, limit, total)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/issues/inventory') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const allProducts = DEMO_PRODUCTS.slice(0, 3).map((p) => ({
        asin: p.asin,
        sku: p.sku,
        Title: p.name,
        ...mkInventoryErrors(p.asin, p.sku)
      }));
      const total = allProducts.length;
      const start = (page - 1) * limit;
      const rows = allProducts.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, total)
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/issues/account') {
      const AccountErrors = {
        accountStatus: mkError('Account health score decreased due to recent policy events.', 'Review account notifications, confirm compliance, and resolve any outstanding issues.'),
        negativeFeedbacks: mkError('Negative seller feedback detected in the last review window.', 'Improve customer support response times and address item quality concerns.'),
        NCX: mkWarning('NCX-related signals require monitoring.', 'Investigate NCX flags and improve listing accuracy and customer satisfaction.'),
        PolicyViolations: mkError('Potential policy violation signals found for the catalog.', 'Review listings for restricted content and ensure policy compliance.'),
        validTrackingRateStatus: mkError('Valid tracking rate is below target threshold.', 'Verify carrier scan events and resolve shipping workflow delays.'),
        orderWithDefectsStatus: mkWarning('Order defect rate is close to the threshold.', 'Reduce defect drivers by improving packaging and defect prevention.'),
        lateShipmentRateStatus: mkError('Late shipment rate exceeds acceptable level.', 'Optimize fulfillment timelines and confirm handling SLAs.'),
        a_z_claims: mkWarning('A-to-Z guarantee claims trend needs review.', 'Improve customer communication and resolution steps.'),
        CancellationRate: mkError('Cancellation rate is higher than expected.', 'Ensure inventory availability and verify order handling processes.'),
        responseUnder24HoursCount: mkError('Customer responses are slower than 24 hours on average.', 'Improve support routing and add response templates for common cases.')
      };

      return makeNestedDataResponse(config, {
        accountHealthPercentage: { Percentage: 68 },
        AccountErrors
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/issues/products') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 6);
      const productsAll = DEMO_PRODUCTS.slice(0, 3).map((p, idx) => {
        const rankingDetails = mkRankingDetails(p.asin);
        return {
          asin: p.asin,
          sku: p.sku,
          name: p.name,
          MainImage: mkPlaceholderImage(p.asin),
          price: p.price,
          status: 'Active',
          performance: {
            sessions: 1200 + idx * 180,
            pageViews: 7600 + idx * 900,
            conversionRate: 2.6 + idx * 0.35,
            buyBoxPercentage: 34.2 + idx * 2.1,
            unitsSold: 90 + idx * 25,
            sales: (p.price * (p.quantity || 10)) * 0.85,
            grossProfit: 220 + idx * 55,
            ppcSpend: 180 + idx * 45,
            ppcSales: 600 + idx * 120,
            acos: 42 + idx * 3.1,
            hasPPC: true
          },
          comparison: { hasComparison: false, changes: {} },
          primaryRecommendation: {
            type: idx % 2 === 0 ? 'optimize_keywords' : 'fix_listing',
            shortLabel: idx % 2 === 0 ? 'Optimize keywords' : 'Fix listing content',
            message: 'Demo recommendation based on detected issue patterns.'
          },
          rankingDetails,
          fixedAttributes: mkFixedAttributes(),
          conversionErrors: mkConversionErrors(p.asin),
          buyBoxDetails: mkBuyBoxDetails(p.asin, p.sku, p.name),
          inventoryErrors: mkInventoryErrors(p.asin, p.sku)
        };
      });

      const total = productsAll.length;
      const start = (page - 1) * limit;
      const rows = productsAll.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: mkPagination(page, limit, total),
        filters: { sort: 'issues' }
      });
    }

    // Product details (ASIN)
    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/info$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/pagewise\/product\/([^/]+)\/info$/);
      const asin = asinRaw.toUpperCase();
      const prod = DEMO_PRODUCTS.find((p) => p.asin === asin) || DEMO_PRODUCTS[0];
      const sales = (Number(prod.price) || 0) * (Number(prod.quantity) || 0) * 0.85;
      return makeNestedDataResponse(config, {
        asin: prod.asin,
        sku: prod.sku,
        name: prod.name,
        Title: prod.name,
        price: Number(prod.price) || 0,
        unitsSold: Number(prod.quantity) || 0,
        sales: sales || 0,
        mainImage: mkPlaceholderImage(prod.asin),
        mainImageUrl: mkPlaceholderImage(prod.asin)
      });
    }

    // FBA inventory (ProductDetails — FbaInventorySection)
    if (method === 'get' && /^\/api\/fba-inventory\/asin\/([^/]+)$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/fba-inventory\/asin\/([^/]+)$/);
      const asinU = String(asinRaw || '').toUpperCase();
      const prod = DEMO_PRODUCTS.find((p) => p.asin === asinU) || DEMO_PRODUCTS[0];
      const baseQty = Math.max(0, Math.round(Number(prod.quantity) || 24));
      const fulfillable = Math.max(0, Math.round(baseQty * 0.55));
      const nowIso = new Date().toISOString();
      const item = {
        asin: prod.asin,
        fnSku: `X000${prod.asin.replace(/[^A-Z0-9]/gi, '').slice(0, 6)}`,
        sellerSku: prod.sku,
        productName: prod.name,
        condition: 'NewItem',
        lastUpdatedTime: nowIso,
        totalQuantity: fulfillable + 18,
        fulfillableQuantity: fulfillable,
        inboundWorkingQuantity: 2,
        inboundShippedQuantity: 10,
        inboundReceivingQuantity: 6,
        totalReservedQuantity: 5,
        pendingCustomerOrderQuantity: 3,
        pendingTransshipmentQuantity: 1,
        fcProcessingQuantity: 1,
        totalUnfulfillableQuantity: 2,
        customerDamagedQuantity: 0,
        warehouseDamagedQuantity: 1,
        distributorDamagedQuantity: 0,
        carrierDamagedQuantity: 0,
        defectiveQuantity: 1,
        expiredQuantity: 0,
        totalResearchingQuantity: 0,
        researchingQuantityInShortTerm: 0,
        researchingQuantityInMidTerm: 0,
        researchingQuantityInLongTerm: 0,
        fetchedAt: nowIso,
      };
      const inboundSum =
        item.inboundWorkingQuantity + item.inboundShippedQuantity + item.inboundReceivingQuantity;
      const summary = {
        skuCount: 1,
        totalFulfillable: item.fulfillableQuantity,
        totalQuantity: item.totalQuantity,
        totalReserved: item.totalReservedQuantity,
        totalInbound: inboundSum,
        totalUnfulfillable: item.totalUnfulfillableQuantity,
        latestFetchedAt: item.fetchedAt,
      };
      return makeNestedDataResponse(config, {
        asin: asinU,
        country: 'US',
        region: 'NA',
        marketplaceId: 'ATVPDKIKX0DER',
        items: [item],
        summary,
      });
    }

    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/performance/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/pagewise\/product\/([^/]+)\/performance/);
      const asin = asinRaw.toUpperCase();
      const prod = DEMO_PRODUCTS.find((p) => p.asin === asin) || DEMO_PRODUCTS[0];
      const sku = prod.sku;
      const title = prod.name;

      const points = PPC_DATE_WISE_METRICS.map((d, idx) => ({
        date: d.date,
        sessions: Math.round(d.clicks * 2.2 + idx * 12),
        pageViews: Math.round(d.impressions + idx * 120),
        conversionRate: 2.1 + idx * 0.12,
        buyBoxPercentage: 32 + idx * 0.8,
        unitsSold: Math.round(d.sales / 8 + idx * 2),
        sales: Math.round(d.sales * (0.75 + idx * 0.02)),
        grossProfit: Math.round(120 + idx * 18),
        ppcSpend: Math.round(d.spend * (0.8 + idx * 0.01)),
        ppcSales: Math.round(d.sales * 0.62),
        acos: d.acos + idx * 0.4
      }));

      const last = points[points.length - 1] || {};
      return makeNestedDataResponse(config, {
        asin,
        performance: {
          sessions: last.sessions || 0,
          pageViews: last.pageViews || 0,
          conversionRate: last.conversionRate || 0,
          buyBoxPercentage: last.buyBoxPercentage || 0,
          unitsSold: last.unitsSold || 0,
          sales: last.sales || 0,
          grossProfit: last.grossProfit || 0,
          ppcSpend: last.ppcSpend || 0,
          ppcSales: last.ppcSales || 0,
          acos: last.acos || 0
        },
        comparison: { hasComparison: false, changes: {} },
        points
      });
    }

    if (method === 'get' && /^\/api\/pagewise\/product-history\/([^/]+)$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/pagewise\/product-history\/([^/]+)$/);
      const asin = asinRaw.toUpperCase();
      const params = new URLSearchParams(query);
      const granularity = String(params.get('granularity') || 'daily');
      const requestedLimit = Number(params.get('limit') || 7);

      const base = PPC_DATE_WISE_METRICS;
      const pointCount = granularity === 'daily' ? requestedLimit : granularity === 'weekly' ? 4 : 6;
      const slice = base.slice(Math.max(0, base.length - pointCount));

      const history = slice.map((d, idx) => {
        const scale = 0.95 + idx * 0.04;
        const sessions = Math.round((d.clicks || 0) * 2.1 * scale + idx * 8);
        const pageViews = Math.round((d.impressions || 0) * 0.95 * scale + idx * 40);
        const sales = Math.round((d.sales || 0) * 0.9 * scale);
        const conversionRate = 2.1 + idx * 0.18; // percent
        const displayDate =
          granularity === 'daily'
            ? d.date
            : granularity === 'weekly'
              ? `Week ${idx + 1}`
              : `Month ${idx + 1}`;

        return {
          asin,
          displayDate,
          sales,
          conversionRate,
          sessions,
          pageViews
        };
      });

      const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + Number(x || 0), 0) / arr.length : 0);
      const firstSales = Number(history[0]?.sales || 0);
      const lastSales = Number(history[history.length - 1]?.sales || 0);
      const trendPct = firstSales > 0 ? ((lastSales - firstSales) / firstSales) * 100 : (lastSales > 0 ? 25 : 0);

      return makeNestedDataResponse(config, {
        granularity,
        dataPoints: history.length,
        history,
        summary: {
          hasData: history.length > 0,
          averages: {
            sessions: avg(history.map((h) => h.sessions)),
            sales: avg(history.map((h) => h.sales)),
            conversionRate: avg(history.map((h) => h.conversionRate))
          },
          trends: {
            sales: trendPct
          }
        }
      });
    }

    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/issues$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/pagewise\/product\/([^/]+)\/issues$/);
      const asin = asinRaw.toUpperCase();
      const prod = DEMO_PRODUCTS.find((p) => p.asin === asin) || DEMO_PRODUCTS[0];
      return makeNestedDataResponse(config, {
        totalErrors: getDemoTotalErrorsForAsin(asin),
        asin: prod.asin,
        sku: prod.sku,
        name: prod.name,
        MainImage: mkPlaceholderImage(prod.asin),
        rankingErrors: mkRankingDetails(asin),
        conversionErrors: mkConversionErrors(asin),
        inventoryErrors: mkInventoryErrors(asin, prod.sku)
      });
    }

    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/ppc-issues$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/pagewise\/product\/([^/]+)\/ppc-issues$/);
      const asin = asinRaw.toUpperCase();
      const last = PPC_DATE_WISE_METRICS[PPC_DATE_WISE_METRICS.length - 1] || {};
      return makeNestedDataResponse(config, {
        hasAds: true,
        ppcMetrics: {
          impressions: Number(last.impressions) || 0,
          clicks: Number(last.clicks) || 0
        },
        issues: {}
      });
    }

    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/ppc-keyword-tab-counts$/.test(pathname)) {
      return makeNestedDataResponse(config, {
        wastedSpend: { total: DEMO_WASTED_SPEND_ROWS.length || 2 },
        topPerforming: { total: DEMO_TOP_KEYWORDS_ROWS.length || 2 },
        searchTermsZeroSales: { total: DEMO_ZERO_SALES_ROWS.length || 2 }
      });
    }

    // For infinite scroll keyword loaders, return empty arrays and pagination
    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/ppc-wasted-spend$/.test(pathname)) {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);

      const allRows = DEMO_WASTED_SPEND_ROWS;
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      const totalWastedSpend = allRows.reduce((s, x) => s + (Number(x.spend) || 0), 0);

      const basePagination = mkPagination(page, limit, allRows.length);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: { ...basePagination, totalItems: allRows.length },
        totalWastedSpend
      });
    }
    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/ppc-top-keywords$/.test(pathname)) {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);

      const allRows = DEMO_TOP_KEYWORDS_ROWS;
      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);

      const basePagination = mkPagination(page, limit, allRows.length);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: { ...basePagination, totalItems: allRows.length }
      });
    }
    if (method === 'get' && /^\/api\/pagewise\/product\/([^/]+)\/ppc-zero-sales-search-terms$/.test(pathname)) {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);

      const allRows = DEMO_ZERO_SALES_ROWS.map((r) => ({
        ...r,
        sales: Number(r.sales) || 0,
        spend: Number(r.spend) || 0,
        clicks: Number(r.clicks) || 0,
        acos: r.acos || 999
      }));

      const start = (page - 1) * limit;
      const rows = allRows.slice(start, start + limit);
      const totalWastedSpend = allRows.reduce((s, x) => s + (Number(x.spend) || 0), 0);

      const basePagination = mkPagination(page, limit, allRows.length);
      return makeNestedDataResponse(config, {
        data: rows,
        pagination: { ...basePagination, totalItems: allRows.length },
        totalWastedSpend
      });
    }

    // Keyword analysis
    if (method === 'get' && pathname === '/api/pagewise/keyword-analysis') {
      return makeNestedDataResponse(config, DEMO_KEYWORD_ANALYSIS);
    }

    // =====================================================================
    // Keyword Opportunities (optimized dashboard)
    // Routes used by DemoKeywordAnalysisDashboard:
    // - /app/analyse/keywordOpportunities/initial?limit=10
    // - /app/analyse/keywordOpportunities/keywords?asin=...&page=...&limit=10&filter=...
    // - /app/analyse/keywordOpportunities/search?query=...
    // =====================================================================
    const getKeywordPoolForAsin = (asin) => {
      const product = DEMO_PRODUCTS.find((p) => String(p.asin).toUpperCase() === String(asin || '').toUpperCase());
      const name = String(product?.name || '').toLowerCase();

      if (name.includes('mouse') || name.includes('wrist') || name.includes('hub')) {
        return [
          'wireless mouse',
          'ergonomic mouse',
          'usb c hub',
          'desk wrist rest',
          'office desk accessory',
          'computer mouse silent'
        ];
      }
      if (name.includes('lamp') || name.includes('light') || name.includes('book')) {
        return [
          'desk lamp',
          'reading light',
          'clip lamp',
          'dimmable lamp',
          'night reading lamp',
          'study desk light'
        ];
      }
      if (name.includes('bottle') || name.includes('belt') || name.includes('bands')) {
        return [
          'stainless water bottle',
          'insulated bottle',
          'running belt',
          'fitness resistance bands',
          'gym workout accessory',
          'sport hydration gear'
        ];
      }
      if (name.includes('kitchen') || name.includes('food') || name.includes('coffee') || name.includes('oil') || name.includes('brush')) {
        return [
          'kitchen organizer',
          'food storage clips',
          'coffee canister',
          'oil dispenser',
          'bottle cleaning brush',
          'kitchen storage set'
        ];
      }
      if (name.includes('vacuum') || name.includes('fridge') || name.includes('bins') || name.includes('mat')) {
        return [
          'vacuum storage bags',
          'fridge organizer bins',
          'non slip mat',
          'home storage organizer',
          'space saver bags',
          'pantry storage bins'
        ];
      }
      if (name.includes('pillow') || name.includes('mask') || name.includes('blanket') || name.includes('tote')) {
        return [
          'travel neck pillow',
          'sleep eye mask',
          'pet blanket soft',
          'insulated lunch tote',
          'comfort travel accessory',
          'sleep comfort product'
        ];
      }

      // Fallback pool
      return [
        'amazon product listing',
        'top selling product',
        'premium quality item',
        'best value product',
        'daily use essential',
        'customer favorite product'
      ];
    };

    const mkKeywordOppRow = (asin, idx, filter) => {
      const seed = Math.abs(
        String(asin || '')
          .split('')
          .reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
      );

      const keywordBases = getKeywordPoolForAsin(asin);

      const base = keywordBases[(idx + seed) % keywordBases.length];
      const adjective = ['best', 'cheap', 'premium', 'lightweight', 'durable', 'compact'][((idx + seed) * 3) % 6];
      const keyword = `${base} ${adjective}`;

      // Suggested bid displayed as dollars in CSV/metrics, but range values are in cents.
      const baseCents = 180 + ((idx + seed) % 12) * 35; // ~ $1.80 to $5.35
      const rangeStart = Math.max(50, baseCents - 120);
      const rangeEnd = baseCents + 220;
      const rangeMedian = baseCents;

      const bid = rangeMedian / 100; // dollars (used by avgBid calculation)

      // Filter tuning: return values that match the filter so the table doesn't feel empty.
      let rank;
      if (filter === 'highRank') {
        rank = (idx % 10) + 1; // 1..10
      } else if (filter === 'highImpression') {
        rank = 1 + ((idx * 7 + seed) % 20); // 1..20 (not necessarily <=10)
      } else {
        rank = 2 + ((idx * 7 + seed) % 28); // 2..29
      }

      let searchTermImpressionShare;
      if (filter === 'highImpression') {
        searchTermImpressionShare = 55 + ((idx + seed) % 20); // >= 55
      } else {
        searchTermImpressionShare = 20 + ((idx * 9 + seed) % 70); // 20..89
      }

      const searchTermImpressionRank = 1 + ((idx * 11 + seed) % 100); // 1..100

      return {
        id: `kwopp-${asin}-${idx + 1}`,
        keyword,
        rank,
        searchTermImpressionShare,
        searchTermImpressionRank,
        suggestedBid: {
          rangeStart,
          rangeEnd,
          rangeMedian
        },
        bid
      };
    };

    const mkKeywordOppPagination = (page, limit, totalItems) => ({
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / (Number(limit) || 10))),
      hasMore: Number(page) + 1 <= Math.ceil(totalItems / (Number(limit) || 10))
    });

    const mkKeywordOppSummary = (keywords) => {
      const totalKeywords = keywords.length;
      const avgBid = totalKeywords > 0 ? (keywords.reduce((s, k) => s + (parseFloat(k.bid) || 0), 0) / totalKeywords) : 0;
      const highRelevanceCount = keywords.filter((k) => typeof k.rank === 'number' && k.rank <= 10).length;
      const highImpressionCount = keywords.filter((k) => typeof k.searchTermImpressionShare === 'number' && k.searchTermImpressionShare >= 50).length;
      return {
        totalKeywords,
        avgBid,
        highRelevanceCount,
        highImpressionCount
      };
    };

    if (method === 'get' && pathname === '/app/analyse/keywordOpportunities/initial') {
      const params = new URLSearchParams(query);
      const limit = Number(params.get('limit') || 10);
      const asinsList = DEMO_PRODUCTS.map((p) => ({
        asin: p.asin,
        keywordCount: 10
      }));

      const selectedAsin = asinsList[0]?.asin || DEMO_PRODUCTS[0]?.asin || '';
      const keywords = Array.from({ length: limit }).map((_, idx) =>
        mkKeywordOppRow(selectedAsin, idx, 'all')
      );

      const summary = mkKeywordOppSummary(keywords);
      const pagination = mkKeywordOppPagination(1, limit, keywords.length);
      const productInfo = DEMO_PRODUCTS.reduce((acc, p) => {
        acc[p.asin] = { sku: p.sku, name: p.name };
        return acc;
      }, {});

      return makeNestedDataResponse(config, {
        asinsList,
        selectedAsin,
        summary,
        keywords,
        pagination,
        productInfo
      });
    }

    if (method === 'get' && pathname === '/app/analyse/keywordOpportunities/keywords') {
      const params = new URLSearchParams(query);
      const asin = String(params.get('asin') || '').toUpperCase();
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 10);
      const filter = String(params.get('filter') || 'all');

      // Always generate 10 total keywords so “All Keywords” feels full.
      const allKeywords = Array.from({ length: 10 }).map((_, idx) => mkKeywordOppRow(asin, idx, filter));
      const start = (page - 1) * limit;
      const rows = allKeywords.slice(start, start + limit);

      const summary = mkKeywordOppSummary(allKeywords);
      const pagination = mkKeywordOppPagination(page, limit, allKeywords.length);

      return makeNestedDataResponse(config, {
        keywords: rows,
        pagination,
        summary
      });
    }

    if (method === 'get' && pathname === '/app/analyse/keywordOpportunities/search') {
      const params = new URLSearchParams(query);
      const q = String(params.get('query') || '').toLowerCase().trim();
      const asinsList = DEMO_PRODUCTS.filter((p) => {
        if (!q) return true;
        return (
          String(p.asin).toLowerCase().includes(q) ||
          String(p.sku).toLowerCase().includes(q) ||
          String(p.name).toLowerCase().includes(q)
        );
      }).map((p) => ({ asin: p.asin, keywordCount: 10 }));

      return makeNestedDataResponse(config, {
        asinsList
      });
    }

    // Account history
    if (method === 'get' && pathname === '/api/pagewise/account-history') {
      return makeNestedDataResponse(config, {
        accountHistory: DEMO_ACCOUNT_HISTORY?.accountHistory || []
      });
    }

    // =====================================================================
    // Your Products V3 endpoints (frontend-only, no backend)
    // =====================================================================
    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/summary') {
      const baseRows = DEMO_PRODUCTS.map((p, idx) => mkYourProductsBaseRecord(p, idx));
      const totalProducts = baseRows.length;
      const activeProducts = baseRows.filter((p) => p.status === 'Active').length;
      const inactiveProducts = baseRows.filter((p) => p.status === 'Inactive').length;
      const incompleteProducts = baseRows.filter((p) => p.status === 'Incomplete').length;
      const zeroAvailabilityProducts = baseRows.filter((p) => p.status === 'Zero Availability').length;

      return makeNestedDataResponse(config, {
        totalProducts,
        activeProducts,
        inactiveProducts,
        incompleteProducts,
        zeroAvailabilityProducts,
        productsWithoutAPlus: baseRows.filter((p) => !p.hasAPlus).length,
        productsNotTargetedInAds: baseRows.filter((p) => !p.isTargetedInAds).length,
        hasBrandStory: true
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/active') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 20);
      const search = (params.get('search') || '').toString().trim().toLowerCase();

      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => p.status === 'Active')
        .filter((p) => {
          if (!search) return true;
          return (
            (p.asin || '').toLowerCase().includes(search) ||
            (p.sku || '').toLowerCase().includes(search) ||
            (p.title || p.name || '').toLowerCase().includes(search)
          );
        });

      const start = (page - 1) * limit;
      const rows = all.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        products: rows,
        pagination: { ...mkPagination(page, limit, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/inactive') {
      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => p.status === 'Inactive');
      return makeNestedDataResponse(config, {
        products: all,
        pagination: { ...mkPagination(1, 20, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/incomplete') {
      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => p.status === 'Incomplete');
      return makeNestedDataResponse(config, {
        products: all,
        pagination: { ...mkPagination(1, 20, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/non-sellable') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 20);
      const search = (params.get('search') || '').toString().trim().toLowerCase();

      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => p.status !== 'Active')
        .map((p) => ({
          asin: p.asin,
          sku: p.sku,
          title: p.name,
          name: p.name,
          status: p.status,
          issues:
            p.status === 'Incomplete'
              ? ['Listing data incomplete', 'A+ compliance not ready']
              : p.status === 'Zero Availability'
                ? ['Zero availability / out of stock', 'Replenishment delay']
                : ['Inactive listing detected', 'Stranded inventory risk'],
          issueCount: p.issueCount,
          price: p.price,
          quantity: p.quantity
        }))
        .filter((p) => {
          if (!search) return true;
          return (
            (p.asin || '').toLowerCase().includes(search) ||
            (p.sku || '').toLowerCase().includes(search) ||
            (p.title || p.name || '').toLowerCase().includes(search)
          );
        });

      const start = (page - 1) * limit;
      const rows = all.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        products: rows,
        pagination: { ...mkPagination(page, limit, all.length), totalItems: all.length },
        counts: {
          inactive: all.filter((p) => p.status === 'Inactive').length,
          incomplete: all.filter((p) => p.status === 'Incomplete').length,
          zeroAvailability: all.filter((p) => p.status === 'Zero Availability').length
        },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/without-aplus') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 20);
      const search = (params.get('search') || '').toString().trim().toLowerCase();

      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => !p.hasAPlus)
        .filter((p) => {
          if (!search) return true;
          return (
            (p.asin || '').toLowerCase().includes(search) ||
            (p.sku || '').toLowerCase().includes(search) ||
            (p.title || p.name || '').toLowerCase().includes(search)
          );
        });

      const start = (page - 1) * limit;
      const rows = all.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        products: rows,
        pagination: { ...mkPagination(page, limit, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/not-targeted-in-ads') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 20);
      const search = (params.get('search') || '').toString().trim().toLowerCase();

      const all = DEMO_PRODUCTS
        .map((p, idx) => mkYourProductsBaseRecord(p, idx))
        .filter((p) => !p.isTargetedInAds)
        .filter((p) => {
          if (!search) return true;
          return (
            (p.asin || '').toLowerCase().includes(search) ||
            (p.sku || '').toLowerCase().includes(search) ||
            (p.title || p.name || '').toLowerCase().includes(search)
          );
        });

      const start = (page - 1) * limit;
      const rows = all.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        products: rows,
        pagination: { ...mkPagination(page, limit, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    if (method === 'get' && pathname === '/api/pagewise/your-products-v3/optimization') {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page') || 1);
      const limit = Number(params.get('limit') || 20);
      const search = (params.get('search') || '').toString().trim().toLowerCase();

      const all = DEMO_PRODUCTS.map((p, idx) => {
        const last = PPC_DATE_WISE_METRICS[PPC_DATE_WISE_METRICS.length - 1] || {};
        const perfScale = 0.85 + idx * 0.07;
        const basePerformance = {
          sessions: Math.round((last.clicks || 0) * 2.1 * perfScale),
          pageViews: Math.round((last.impressions || 0) * 1.05 * perfScale),
          conversionRate: 2.4 + idx * 0.25,
          sales: Math.round((last.sales || 0) * 0.9 * perfScale),
          ppcSpend: Math.round((last.spend || 0) * 0.85 * perfScale),
          acos: (last.acos || 0) + idx * 2.2
        };
        const recType = idx % 2 === 0 ? 'optimize_keywords' : 'fix_listing';
        return {
          asin: p.asin,
          sku: p.sku,
          name: p.name,
          title: p.name,
          performance: basePerformance,
          primaryRecommendation: {
            type: recType,
            shortLabel: recType === 'optimize_keywords' ? 'Optimize keywords' : 'Fix listing content',
            message: 'Demo recommendation derived from detected listing + PPC patterns.'
          },
          recommendations: [
            {
              type: recType,
              shortLabel: recType === 'optimize_keywords' ? 'Optimize keywords' : 'Fix listing content',
              message: 'Demo recommendation derived from detected listing + PPC patterns.'
            },
            {
              type: 'reduce_ppc',
              shortLabel: 'Reduce wasted PPC',
              message: 'Consider pausing low-performing keywords and adding negatives.'
            }
          ],
          // Extra fields used in non-optimization tabs (harmless)
          price: Number(p.price) || 0,
          quantity: Number(p.quantity) || 0,
          issueCount: getDemoTotalErrorsForAsin(p?.asin),
          hasVideo: idx % 2 === 0,
          has_b2b_pricing: idx % 2 !== 0,
          numRatings: 300 + idx * 200,
          starRatings: 3.8 + idx * 0.2,
          hasAPlus: idx % 2 === 0,
          isTargetedInAds: idx % 2 === 0
        };
      }).filter((p) => {
        if (!search) return true;
        return (
          (p.asin || '').toLowerCase().includes(search) ||
          (p.sku || '').toLowerCase().includes(search) ||
          (p.name || p.title || '').toLowerCase().includes(search)
        );
      });

      const start = (page - 1) * limit;
      const rows = all.slice(start, start + limit);
      return makeNestedDataResponse(config, {
        products: rows,
        pagination: { ...mkPagination(page, limit, all.length), totalItems: all.length },
        fromCache: false
      });
    }

    // Inventory / your products fallback - empty structures
    if (method === 'get' && pathname === '/api/pagewise/inventory') {
      const inventoryItems = DEMO_PRODUCTS.map((p) => ({
        asin: p.asin,
        sku: p.sku,
        Title: p.name,
        ...mkInventoryErrors(p.asin, p.sku)
      }));
      return makeNestedDataResponse(config, inventoryItems);
    }

    // QMate chats
    if (method === 'get' && pathname === '/api/qmate/chats') {
      return makeNestedDataResponse(config, { chats: (qmateChatsState || []).map(({ id, title, date }) => ({ id, title, date })) });
    }

    if (method === 'post' && pathname === '/api/qmate/chats') {
      const body = config.data || {};
      const title = body.title || 'New Chat';
      const id = `qc-${Math.random().toString(16).slice(2)}`;
      const chat = {
        id,
        title,
        date: new Date().toISOString(),
        messages: [
          { id: `m-${id}-1`, role: 'user', content: 'New chat created.', date: new Date().toISOString() },
          { id: `m-${id}-2`, role: 'assistant', content: 'Mock response.', wastedKeywords: [], wastedKeywordsTotal: 0, date: new Date().toISOString() }
        ]
      };
      upsertChatInState(chat);
      return makeNestedDataResponse(config, { chat });
    }

    if (method === 'get' && /^\/api\/qmate\/chats\/([^/]+)$/.test(pathname)) {
      const [, chatId] = pathname.match(/^\/api\/qmate\/chats\/([^/]+)$/);
      const chat = (qmateChatsState || []).find((c) => String(c.id) === String(chatId));
      return makeNestedDataResponse(config, { chat: chat || { id: chatId, title: '', date: new Date().toISOString(), messages: [] } });
    }

    if (method === 'delete' && /^\/api\/qmate\/chats\/([^/]+)$/.test(pathname)) {
      const [, chatId] = pathname.match(/^\/api\/qmate\/chats\/([^/]+)$/);
      qmateChatsState = (qmateChatsState || []).filter((c) => String(c.id) !== String(chatId));
      return makeNestedDataResponse(config, { ok: true });
    }

    if (method === 'patch' && /^\/api\/qmate\/chats\/([^/]+)$/.test(pathname)) {
      const [, chatId] = pathname.match(/^\/api\/qmate\/chats\/([^/]+)$/);
      const body = config.data || {};
      const chat = (qmateChatsState || []).find((c) => String(c.id) === String(chatId));
      if (chat) {
        chat.title = body.title ?? chat.title;
        if (body.messages) chat.messages = body.messages;
        upsertChatInState(chat);
      }
      return makeNestedDataResponse(config, { ok: true });
    }

    if (method === 'post' && pathname === '/api/qmate/generate-suggestion') {
      return makeNestedDataResponse(config, { suggestions: ['Mock suggestion.'] });
    }

    if (method === 'get' && /^\/api\/qmate\/lookup-sku\/([^/]+)$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/qmate\/lookup-sku\/([^/]+)$/);
      const asin = asinRaw.toUpperCase();
      const sku = DEMO_PRODUCTS.find((p) => p.asin === asin)?.sku || 'SKU-DEMO';
      return makeNestedDataResponse(config, { sku });
    }

    if (method === 'post' && pathname === '/api/qmate/apply-fix') {
      return makeNestedDataResponse(config, { applied: true });
    }

    // QMate PPC action endpoints (pause / add negatives / bulk actions)
    if (method === 'post' && pathname === '/api/qmate/ppc/pause-keyword') {
      return makeNestedDataResponse(config, { ok: true });
    }
    if (method === 'post' && pathname === '/api/qmate/ppc/add-to-negative') {
      return makeNestedDataResponse(config, { ok: true });
    }
    if (method === 'post' && pathname === '/api/qmate/ppc/pause-and-add-to-negative') {
      return makeNestedDataResponse(config, { ok: true });
    }
    if (method === 'post' && pathname === '/api/qmate/ppc/bulk-pause') {
      return makeNestedDataResponse(config, { ok: true });
    }
    if (method === 'post' && pathname === '/api/qmate/ppc/bulk-pause-and-add-to-negative') {
      return makeNestedDataResponse(config, { ok: true });
    }

    if (method === 'post' && pathname === '/api/qmate/chat') {
      const message = {
        role: 'assistant',
        content: 'Mock assistant response.',
        wasted_keywords: [],
        wasted_keywords_total: 0
      };
      // Append to the active chat if we can infer it from request; otherwise just return payload.
      return makeNestedDataResponse(config, { message });
    }

    // Review requests (RecentOrders page uses direct axios)
    if (method === 'get' && pathname === '/api/review/recent-orders') {
      return makeRawResponse(config, {
        success: true,
        orders: DEMO_RECENT_ORDERS.orders,
        hasMore: false
      });
    }

    // COGS CRUD (used by the COGS popup in Profitibility dashboard)
    if (method === 'get' && pathname === '/api/cogs') {
      return makeNestedDataResponse(config, { cogsValues: cogsState });
    }

    if (method === 'post' && pathname === '/api/cogs') {
      const body = config.data || {};
      const asin = body.asin ? String(body.asin).toUpperCase() : null;
      if (asin && Object.prototype.hasOwnProperty.call(body, 'cogs')) {
        cogsState[asin] = body.cogs;
      }
      return makeNestedDataResponse(config, { ok: true, cogsValues: cogsState });
    }

    if (method === 'post' && pathname === '/api/cogs/bulk') {
      const body = config.data || {};
      const { cogsValues } = body || {};
      if (cogsValues && typeof cogsValues === 'object') {
        Object.entries(cogsValues).forEach(([asin, v]) => {
          cogsState[String(asin).toUpperCase()] = v;
        });
      } else if (Array.isArray(body?.cogsValues)) {
        body.cogsValues.forEach((entry) => {
          const asin = entry?.asin ? String(entry.asin).toUpperCase() : null;
          if (asin) cogsState[asin] = entry?.cogs;
        });
      }
      return makeNestedDataResponse(config, { ok: true, cogsValues: cogsState });
    }

    if (method === 'delete' && /^\/api\/cogs\/([^/]+)$/.test(pathname)) {
      const [, asinRaw] = pathname.match(/^\/api\/cogs\/([^/]+)$/);
      const asin = String(asinRaw).toUpperCase();
      if (cogsState && Object.prototype.hasOwnProperty.call(cogsState, asin)) {
        delete cogsState[asin];
      }
      return makeNestedDataResponse(config, { ok: true });
    }

    if (method === 'get' && pathname === '/api/review/review-auth-status') {
      return makeRawResponse(config, { success: true, reviewRequestAuthStatus: reviewAuthState.reviewRequestAuthStatus });
    }

    if (method === 'patch' && pathname === '/api/review/review-auth-status') {
      const body = config.data || {};
      reviewAuthState.reviewRequestAuthStatus = !!body.enabled;
      return makeRawResponse(config, { success: true, reviewRequestAuthStatus: reviewAuthState.reviewRequestAuthStatus });
    }

    if (method === 'get' && /^\/api\/review\/order-items\/([^/]+)$/.test(pathname)) {
      const [, amazonOrderId] = pathname.match(/^\/api\/review\/order-items\/([^/]+)$/);
      const items = DEMO_RECENT_ORDERS.orderItemsByOrderId?.[amazonOrderId] || [];
      return makeRawResponse(config, { success: true, items, hasMore: false });
    }

    // Fallback: return empty but successful responses to avoid hard demo crashes
    return makeNestedDataResponse(config, {});
  };

  const applyToAxios = (ax) => {
    ax.interceptors.request.use((config) => {
      if (!isDemoPath()) return config;
      const reqPath = extractPathname(config.url);
      if (reqPath.startsWith('/app/demo/')) return config;
      const response = handleRequest(config);
      config.adapter = () => Promise.resolve(response);
      return config;
    });
  };

  applyToAxios(axiosInstance);
  applyToAxios(axios);
};

