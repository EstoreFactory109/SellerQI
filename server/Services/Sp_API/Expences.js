const https = require("https");
const http = require("http");
const zlib = require("zlib");
const logger = require("../../utils/Logger.js");
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require("../../controllers/config/config.js");

// ─────────────────────────────────────────────
// 1. COUNTRY -> INTERNAL REGION CONFIG
// ─────────────────────────────────────────────
const COUNTRY_TO_INTERNAL_REGION = {
  // North America
  US: "na",
  CA: "na",
  MX: "na",
  BR: "na",

  // Europe
  UK: "eu",
  DE: "eu",
  FR: "eu",
  IT: "eu",
  ES: "eu",
  NL: "eu",
  SE: "eu",
  PL: "eu",
  BE: "eu",
  IN: "eu",
  TR: "eu",
  AE: "eu",
  SA: "eu",
  EG: "eu",

  // Asia-Pacific
  AU: "apac",
  JP: "apac",
  SG: "apac",
};

const REGION_BASE_URLS = {
  na: "sellingpartnerapi-na.amazon.com",
  eu: "sellingpartnerapi-eu.amazon.com",
  apac: "sellingpartnerapi-fe.amazon.com",
};

const LWA_TOKEN_URL = "api.amazon.com";

function mapInternalRegionToSharedRegionKey(internalRegion) {
  switch (internalRegion) {
    case "na":
      return "NA";
    case "eu":
      return "EU";
    case "apac":
      return "FE";
    default:
      return null;
  }
}

function resolveMarketplaceAndRegion(countryUpper, regionOverride) {
  const internalRegionFromCountry = COUNTRY_TO_INTERNAL_REGION[countryUpper];
  if (!internalRegionFromCountry) {
    throw new Error(
      `Unsupported country: "${countryUpper}". Supported: ${Object.keys(COUNTRY_TO_INTERNAL_REGION).join(", ")}`
    );
  }

  const internalRegion = regionOverride || internalRegionFromCountry;
  const sharedRegionKey = mapInternalRegionToSharedRegionKey(internalRegion);

  const marketplaceId = sharedMarketplaceConfig?.[countryUpper];
  if (!marketplaceId) {
    throw new Error(`marketplaceId not configured for country: "${countryUpper}"`);
  }

  const baseUrlFromShared = sharedRegionKey ? URIs?.[sharedRegionKey] : null;
  const baseUrl = baseUrlFromShared || REGION_BASE_URLS[internalRegion];

  if (!baseUrl) {
    throw new Error(`Unsupported region: "${internalRegion}". Supported: na, eu, apac`);
  }

  return { marketplaceId, baseUrl, region: internalRegion };
}

// ─────────────────────────────────────────────
// 2. DATE HELPERS
// ─────────────────────────────────────────────

/**
 * Format a Date object to DD/MM/YYYY string
 */
function formatDateDDMMYYYY(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "N/A";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Calculate the overall date range from an array of settlement report objects.
 * Uses dataStartTime (earliest) and dataEndTime (latest) from report metadata.
 *
 * @param {Array} reports - Array of report objects from listSettlementReports
 * @returns {{ from: Date|null, to: Date|null, fromFormatted: string, toFormatted: string }}
 */
function calculateReportDateRange(reports) {
  let earliest = null;
  let latest = null;

  for (const report of reports) {
    if (report.dataStartTime) {
      const start = new Date(report.dataStartTime);
      if (!isNaN(start.getTime()) && (!earliest || start < earliest)) {
        earliest = start;
      }
    }
    if (report.dataEndTime) {
      const end = new Date(report.dataEndTime);
      if (!isNaN(end.getTime()) && (!latest || end > latest)) {
        latest = end;
      }
    }
  }

  return {
    from: earliest,
    to: latest,
    fromFormatted: formatDateDDMMYYYY(earliest),
    toFormatted: formatDateDDMMYYYY(latest),
  };
}

// ─────────────────────────────────────────────
// 3. HTTP HELPERS
// ─────────────────────────────────────────────

/**
 * Generic HTTPS request helper (returns parsed JSON)
 */
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Download raw content from a URL (handles gzip)
 */
function downloadContent(url, isGzip = false) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === "https:" ? https : http;

    protocol.get(url, (res) => {
      const chunks = [];
      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    }).on("error", reject);
  });
}

// ─────────────────────────────────────────────
// 4. SP-API AUTH & REPORT FETCHING
// ─────────────────────────────────────────────

/**
 * Get LWA access token
 */
async function getAccessToken(clientId, clientSecret, refreshToken) {
  const postData = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await httpsRequest(
    {
      hostname: LWA_TOKEN_URL,
      path: "/auth/o2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    },
    postData
  );

  if (!res.body.access_token) {
    throw new Error(`Auth failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

/**
 * List settlement reports within a date range
 */
async function listSettlementReports(accessToken, baseUrl, marketplaceId, createdSince) {
  const reports = [];
  let nextToken = null;

  do {
    let path;
    if (nextToken) {
      path = `/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`;
    } else {
      const params = new URLSearchParams({
        reportTypes: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
        marketplaceIds: marketplaceId,
        pageSize: "100",
        createdSince: createdSince.toISOString(),
      });
      path = `/reports/2021-06-30/reports?${params.toString()}`;
    }

    const res = await httpsRequest({
      hostname: baseUrl,
      path,
      method: "GET",
      headers: { "x-amz-access-token": accessToken },
    });

    if (res.body.errors) {
      throw new Error(`List reports failed: ${JSON.stringify(res.body.errors)}`);
    }

    if (res.body.reports) {
      reports.push(...res.body.reports);
    }
    nextToken = res.body.nextToken || null;
  } while (nextToken);

  return reports;
}

/**
 * Get report document download URL
 */
async function getReportDocument(accessToken, baseUrl, reportDocumentId) {
  const res = await httpsRequest({
    hostname: baseUrl,
    path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    method: "GET",
    headers: { "x-amz-access-token": accessToken },
  });

  if (res.body.errors) {
    throw new Error(`Get document failed: ${JSON.stringify(res.body.errors)}`);
  }
  return res.body;
}

/**
 * Download and parse a settlement report TSV into JSON array
 */
async function downloadAndParseReport(docInfo) {
  const isGzip = docInfo.compressionAlgorithm === "GZIP";
  const rawContent = await downloadContent(docInfo.url, isGzip);

  const lines = rawContent.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split("\t");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }

  return rows;
}

// ─────────────────────────────────────────────
// 5. DATA PARSING & NORMALIZATION
// ─────────────────────────────────────────────

/**
 * Determine if a row is an expense/fee (not revenue)
 */
function isExpenseRow(row) {
  const amountType = row["amount-type"] || "";
  const amountDesc = row["amount-description"] || "";
  const txnType = row["transaction-type"] || "";

  if (amountType === "ItemFees") return true;
  if (amountType === "ItemTCS" || amountType === "ItemTDS") return true;
  if (amountType === "other-transaction") return true;
  if (amountType === "Cost of Advertising") return true;
  if (txnType === "ServiceFee") return true;
  if (amountType === "Other Transactions" && amountDesc !== "Reimbursement for Lost packages") {
    return true;
  }
  if (amountType === "Promotion") return true;

  return false;
}

/**
 * Parse amount string to number (handles both "95.00" and "95,00" EU formats)
 */
function parseAmount(amountStr) {
  if (!amountStr || amountStr.trim() === "") return 0;

  const hasComma = amountStr.includes(",");
  const hasDot = amountStr.includes(".");

  if (hasComma && hasDot) {
    if (amountStr.lastIndexOf(",") > amountStr.lastIndexOf(".")) {
      return parseFloat(amountStr.replace(/\./g, "").replace(",", "."));
    } else {
      return parseFloat(amountStr.replace(/,/g, ""));
    }
  } else if (hasComma) {
    return parseFloat(amountStr.replace(",", "."));
  }

  return parseFloat(amountStr) || 0;
}

/**
 * Parse posted-date-time into a Date object
 * Formats: "21.03.2026 23:29:13 UTC" or "2026-03-21 23:29:13 UTC"
 */
function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === "") return null;

  const euMatch = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (euMatch) {
    return new Date(`${euMatch[3]}-${euMatch[2]}-${euMatch[1]}T${euMatch[4]}Z`);
  }

  return new Date(dateStr);
}

/**
 * Categorize an expense row into a human-readable category
 */
function categorizeExpense(row) {
  const amountType = row["amount-type"] || "";
  const amountDesc = row["amount-description"] || "";

  if (amountDesc.startsWith("Commission") || amountDesc === "Refund commission" || amountDesc === "RefundCommission") {
    return "Referral Commission";
  }
  if (amountDesc.startsWith("Refund commission")) return "Referral Commission";
  if (amountDesc.startsWith("Fixed closing fee")) return "Closing Fee";
  if (amountDesc === "FBAPerUnitFulfillmentFee") return "FBA Fulfillment Fee";
  if (amountDesc.startsWith("Amazon Easy Ship") || amountDesc.startsWith("MFNPostage")) {
    return "Shipping / Easy Ship Fee";
  }
  if (amountDesc === "ShippingChargeback" || amountDesc === "ShippingHB") {
    return "Shipping Chargeback";
  }
  if (amountDesc.startsWith("TCS")) return "TCS (Tax Collected at Source)";
  if (amountDesc.startsWith("TDS")) return "TDS (Tax Deducted at Source)";
  if (amountDesc === "Storage Fee") return "FBA Storage Fee";
  if (amountDesc === "DisposalComplete") return "FBA Disposal Fee";
  if (amountDesc === "Subscription Fee") return "Subscription Fee";
  if (amountType === "Cost of Advertising") return "Advertising / PPC";
  if (amountType === "Promotion") return "Promotions / Discounts";

  return amountDesc || amountType || "Other Fee";
}

// ─────────────────────────────────────────────
// 6. EXPENSE ANALYSIS ENGINE
// ─────────────────────────────────────────────

/**
 * Build the full expense analysis from parsed settlement rows
 */
function analyzeExpenses(allRows) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Filter expense rows and enrich with parsed data
  const expenses = [];
  for (const row of allRows) {
    if (!isExpenseRow(row)) continue;

    const amount = parseAmount(row["amount"]);
    if (amount === 0) continue;

    const postedDate = parseDate(row["posted-date-time"] || row["posted-date"]);

    expenses.push({
      amount,
      absoluteAmount: Math.abs(amount),
      category: categorizeExpense(row),
      amountType: row["amount-type"],
      amountDescription: row["amount-description"],
      sku: row["sku"] || "N/A",
      orderId: row["order-id"] || "",
      transactionType: row["transaction-type"] || "",
      postedDate,
      postedDateStr: row["posted-date"] || "",
    });
  }

  // ── Helper: aggregate by category ──
  function aggregateByCategory(filtered) {
    const catMap = {};
    let total = 0;

    for (const exp of filtered) {
      total += exp.amount;
      if (!catMap[exp.category]) {
        catMap[exp.category] = { category: exp.category, totalAmount: 0, count: 0 };
      }
      catMap[exp.category].totalAmount += exp.amount;
      catMap[exp.category].count++;
    }

    const categories = Object.values(catMap)
      .map((c) => ({
        ...c,
        totalAmount: Math.round(c.totalAmount * 100) / 100,
      }))
      .sort((a, b) => a.totalAmount - b.totalAmount);

    return { total: Math.round(total * 100) / 100, categories };
  }

  // ── Helper: aggregate by SKU ──
  function aggregateBySku(filtered) {
    const skuMap = {};

    for (const exp of filtered) {
      const sku = exp.sku;
      if (!skuMap[sku]) {
        skuMap[sku] = { sku, totalAmount: 0, count: 0, breakdown: {} };
      }
      skuMap[sku].totalAmount += exp.amount;
      skuMap[sku].count++;

      if (!skuMap[sku].breakdown[exp.category]) {
        skuMap[sku].breakdown[exp.category] = 0;
      }
      skuMap[sku].breakdown[exp.category] += exp.amount;
    }

    return Object.values(skuMap)
      .map((s) => ({
        ...s,
        totalAmount: Math.round(s.totalAmount * 100) / 100,
        breakdown: Object.entries(s.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => a.totalAmount - b.totalAmount);
  }

  // ── Helper: aggregate by SKU + Date ──
  function aggregateBySkuAndDate(filtered) {
    const map = {};

    for (const exp of filtered) {
      const dateKey = exp.postedDateStr || "Unknown";
      const sku = exp.sku;
      const key = `${sku}||${dateKey}`;

      if (!map[key]) {
        map[key] = { sku, date: dateKey, totalAmount: 0, count: 0, breakdown: {} };
      }
      map[key].totalAmount += exp.amount;
      map[key].count++;

      if (!map[key].breakdown[exp.category]) {
        map[key].breakdown[exp.category] = 0;
      }
      map[key].breakdown[exp.category] += exp.amount;
    }

    return Object.values(map)
      .map((entry) => ({
        ...entry,
        totalAmount: Math.round(entry.totalAmount * 100) / 100,
        breakdown: Object.entries(entry.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return a.sku.localeCompare(b.sku);
      });
  }

  // ── Helper: aggregate by Date (total + category breakdown per date) ──
  function aggregateByDate(filtered) {
    const dateMap = {};

    for (const exp of filtered) {
      const dateKey = exp.postedDateStr || "Unknown";

      if (!dateMap[dateKey]) {
        dateMap[dateKey] = { date: dateKey, totalAmount: 0, count: 0, breakdown: {} };
      }
      dateMap[dateKey].totalAmount += exp.amount;
      dateMap[dateKey].count++;

      if (!dateMap[dateKey].breakdown[exp.category]) {
        dateMap[dateKey].breakdown[exp.category] = 0;
      }
      dateMap[dateKey].breakdown[exp.category] += exp.amount;
    }

    return Object.values(dateMap)
      .map((entry) => ({
        ...entry,
        totalAmount: Math.round(entry.totalAmount * 100) / 100,
        breakdown: Object.entries(entry.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return 0;
      });
  }

  // ── Filter by time periods ──
  const last7 = expenses.filter((e) => e.postedDate && e.postedDate >= sevenDaysAgo);
  const last14 = expenses.filter((e) => e.postedDate && e.postedDate >= fourteenDaysAgo);

  // ── Calculate date range from expense posted dates ──
  const expenseEarliest = expenses.reduce(
    (min, e) => (e.postedDate && (!min || e.postedDate < min) ? e.postedDate : min),
    null
  );
  const expenseLatest = expenses.reduce(
    (max, e) => (e.postedDate && (!max || e.postedDate > max) ? e.postedDate : max),
    null
  );

  // ── Build the 8 sections ──
  return {
    // 1) Total expenses — all time (within fetched reports)
    totalExpenses: aggregateByCategory(expenses),

    // 2) Total expenses — last 7 days
    totalExpensesLast7Days: aggregateByCategory(last7),

    // 3) Total expenses — last 14 days
    totalExpensesLast14Days: aggregateByCategory(last14),

    // 4) SKU-wise expenses — all time
    skuWiseExpenses: aggregateBySku(expenses),

    // 5) SKU-wise expenses — last 7 days
    skuWiseExpensesLast7Days: aggregateBySku(last7),

    // 6) SKU-wise expenses — last 14 days
    skuWiseExpensesLast14Days: aggregateBySku(last14),

    // 7) SKU + date wise expenses
    skuDateWiseExpenses: aggregateBySkuAndDate(expenses),

    // 8) Total expenses date-wise (total + category breakdown per date)
    dateWiseExpenses: aggregateByDate(expenses),

    // Metadata
    metadata: {
      totalRowsProcessed: allRows.length,
      totalExpenseRows: expenses.length,
      dateRange: {
        from: expenseEarliest,
        to: expenseLatest,
        fromFormatted: formatDateDDMMYYYY(expenseEarliest),
        toFormatted: formatDateDDMMYYYY(expenseLatest),
      },
      generatedAt: now.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────
// 7. MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Main function — fetch reports, parse, and return expense analysis.
 * Supports duplicate prevention via processedReportIds parameter.
 *
 * @param {Object} config
 * @param {string} config.refreshToken       - LWA refresh token
 * @param {string} config.clientId           - LWA app client ID
 * @param {string} config.clientSecret       - LWA app client secret
 * @param {string} config.country            - Country code: AU, US, IN, UK, DE, etc.
 * @param {string} [config.region]           - Optional override: na, eu, apac (auto-detected from country)
 * @param {number} [config.daysBack=45]      - How far back to search for reports
 * @param {string} [config.accessToken]      - Optional pre-generated SP-API access token
 * @param {string[]} [config.processedReportIds=[]] - Report IDs already processed (from your DB).
 *                                                     These reports will be skipped to avoid duplicates.
 *
 * @returns {Object} result
 * @returns {Object} result.data                - Expense analysis (8 sections) or null if no new reports
 * @returns {boolean} result.hasNewData         - true if new reports were found and processed
 * @returns {string[]} result.newReportIds      - Report IDs that were processed in this run (save these to your DB)
 * @returns {string[]} result.allReportIds      - All report IDs found (including already processed ones)
 * @returns {string[]} result.skippedReportIds  - Report IDs that were skipped (already in your DB)
 */
async function getExpenseReport(config) {
  const {
    refreshToken,
    clientId,
    clientSecret,
    country,
    daysBack = 45,
    accessToken: providedAccessToken,
    processedReportIds = [],
  } = config;

  const countryUpper = country.toUpperCase();
  const { marketplaceId, baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);

  logger.info(`[Config] Country: ${countryUpper} | Region: ${region} | Marketplace: ${marketplaceId}`);
  logger.info(`[Config] Base URL: ${baseUrl}`);
  logger.info(`[Config] Searching reports from last ${daysBack} days`);
  logger.info(`[Config] Already processed report IDs: ${processedReportIds.length > 0 ? processedReportIds.join(", ") : "none (first run)"}`);

  // Step 1: Get (or reuse) access token
  let accessToken = providedAccessToken;
  if (accessToken) {
    logger.info("[Step 1] Using provided access token...");
  } else {
    logger.info("[Step 1] Getting access token...");
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    logger.info("[Step 1] Access token obtained.");
  }

  // Step 2: List settlement reports
  const createdSince = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  logger.info(`[Step 2] Listing settlement reports since ${formatDateDDMMYYYY(createdSince)}...`);
  const reports = await listSettlementReports(accessToken, baseUrl, marketplaceId, createdSince);
  logger.info(`[Step 2] Found ${reports.length} settlement report(s) from API.`);

  const allReportIds = reports.filter((r) => r.processingStatus === "DONE").map((r) => r.reportId);

  if (reports.length === 0) {
    logger.info("[Result] No reports found at all.");
    return {
      hasNewData: false,
      data: null,
      newReportIds: [],
      allReportIds: [],
      skippedReportIds: [],
      metadata: {
        country: countryUpper,
        region: region,
        marketplaceId: marketplaceId,
        daysBack: daysBack,
        message: "No settlement reports found for the given period.",
      },
    };
  }

  // Step 3: Filter out already-processed reports
  const processedSet = new Set(processedReportIds.map(String));
  const newReports = reports.filter(
    (r) => r.processingStatus === "DONE" && !processedSet.has(String(r.reportId))
  );
  const skippedReportIds = allReportIds.filter((id) => processedSet.has(String(id)));

  logger.info(`[Step 3] Report filtering:`);
  logger.info(`  Total from API:     ${reports.length}`);
  logger.info(`  Already processed:  ${skippedReportIds.length} → skipped`);
  logger.info(`  New to process:     ${newReports.length}`);

  if (newReports.length === 0) {
    logger.info("[Result] No new reports. Everything is already processed.");
    return {
      hasNewData: false,
      data: null,
      newReportIds: [],
      allReportIds,
      skippedReportIds,
      metadata: {
        country: countryUpper,
        region: region,
        marketplaceId: marketplaceId,
        daysBack: daysBack,
        message: "All reports already processed. No new data.",
      },
    };
  }

  // Calculate date range from new reports
  const reportDateRange = calculateReportDateRange(newReports);
  logger.info(`[DateRange] New reports date range: ${reportDateRange.fromFormatted} → ${reportDateRange.toFormatted}`);

  // Log each new report's period
  for (let i = 0; i < newReports.length; i++) {
    const r = newReports[i];
    const start = r.dataStartTime ? formatDateDDMMYYYY(new Date(r.dataStartTime)) : "N/A";
    const end = r.dataEndTime ? formatDateDDMMYYYY(new Date(r.dataEndTime)) : "N/A";
    logger.info(`[DateRange]   New Report ${i + 1}: ${start} → ${end} (ID: ${r.reportId})`);
  }

  // Step 4: Download and parse only NEW reports
  const allRows = [];
  const successfullyProcessedIds = [];

  for (let i = 0; i < newReports.length; i++) {
    const report = newReports[i];
    const startFmt = report.dataStartTime ? formatDateDDMMYYYY(new Date(report.dataStartTime)) : "N/A";
    const endFmt = report.dataEndTime ? formatDateDDMMYYYY(new Date(report.dataEndTime)) : "N/A";
    logger.info(
      `[Step 4] Downloading report ${i + 1}/${newReports.length} — ID: ${report.reportId} | Period: ${startFmt} → ${endFmt}`
    );

    if (!report.reportDocumentId) {
      logger.info("  ⏭  Skipping (no reportDocumentId)");
      continue;
    }

    try {
      // Get download URL
      const docInfo = await getReportDocument(accessToken, baseUrl, report.reportDocumentId);

      // Download and parse
      const rows = await downloadAndParseReport(docInfo);
      logger.info(`  ✅ Parsed ${rows.length} rows.`);
      allRows.push(...rows);
      successfullyProcessedIds.push(report.reportId);
    } catch (err) {
      logger.error(`  ❌ Failed to process report ${report.reportId}: ${err.message}`);
      // Don't add to successfullyProcessedIds — will retry next run
    }
  }

  logger.info(`[Step 5] Analyzing ${allRows.length} total rows from ${successfullyProcessedIds.length} new report(s)...`);

  // Step 5: Analyze
  const result = analyzeExpenses(allRows);

  // Add config + report date range to metadata
  result.metadata.country = countryUpper;
  result.metadata.region = region;
  result.metadata.marketplaceId = marketplaceId;
  result.metadata.reportsProcessed = successfullyProcessedIds.length;
  result.metadata.daysBack = daysBack;
  result.metadata.reportDateRange = reportDateRange;

  // Log final summary
  logger.info(`[Summary] New reports date range: ${reportDateRange.fromFormatted} → ${reportDateRange.toFormatted}`);
  logger.info(`[Summary] Expense data range: ${result.metadata.dateRange.fromFormatted} → ${result.metadata.dateRange.toFormatted}`);
  logger.info(`[Summary] Total expense rows: ${result.metadata.totalExpenseRows}`);
  logger.info(`[Summary] Total expenses: ${result.totalExpenses.total}`);
  logger.info(`[Summary] New report IDs to save to DB: [${successfullyProcessedIds.join(", ")}]`);

  return {
    hasNewData: true,
    data: result,
    newReportIds: successfullyProcessedIds,
    allReportIds,
    skippedReportIds,
    metadata: {
      country: countryUpper,
      region: region,
      marketplaceId: marketplaceId,
      daysBack: daysBack,
    },
  };
}

// ─────────────────────────────────────────────
// 8. OFFLINE MODE — Parse local CSV files
//    (for testing without SP-API credentials)
// ─────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

/**
 * Parse local settlement CSV/TSV files and return the same expense analysis
 *
 * @param {string[]} filePaths - Array of file paths to settlement report files
 * @returns {Object} Full expense analysis with 8 sections
 */
function analyzeLocalFiles(filePaths) {
  const allRows = [];

  for (const filePath of filePaths) {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const lines = rawContent.split("\n").filter((l) => l.trim());
    if (lines.length < 2) continue;

    const headers = lines[0].split("\t");

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split("\t");
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || "";
      });
      allRows.push(row);
    }

    logger.info(`Parsed ${lines.length - 1} rows from ${path.basename(filePath)}`);
  }

  logger.info(`Total rows: ${allRows.length}`);
  const result = analyzeExpenses(allRows);

  // Log summary for local mode
  logger.info(`[Summary] Expense data range: ${result.metadata.dateRange.fromFormatted} → ${result.metadata.dateRange.toFormatted}`);
  logger.info(`[Summary] Total expense rows: ${result.metadata.totalExpenseRows}`);
  logger.info(`[Summary] Total expenses: ${result.totalExpenses.total}`);

  return result;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  getExpenseReport,
  analyzeLocalFiles,
  analyzeExpenses,
  // Expose helpers for flexibility
  getAccessToken,
  listSettlementReports,
  getReportDocument,
  downloadAndParseReport,
  calculateReportDateRange,
  formatDateDDMMYYYY,
  COUNTRY_TO_INTERNAL_REGION,
  REGION_BASE_URLS,
};