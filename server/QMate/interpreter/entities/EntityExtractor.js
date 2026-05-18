const fs = require("fs");
const path = require("path");

function loadJson(relativePath, fallback) {
  try {
    const fullPath = path.join(__dirname, "..", "config", relativePath);
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

const metricsConfig = loadJson("metrics.json", { metrics: [] });
const dimensionsConfig = loadJson("dimensions.json", { dimensions: [] });

const METRICS = new Set((metricsConfig.metrics || []).map((m) => m.toLowerCase()));
const DIMENSIONS = new Set((dimensionsConfig.dimensions || []).map((d) => d.toLowerCase()));
const METRIC_ALIASES = {
  sales: "revenue",
  "total sales": "revenue",
  "gross profit": "profit",
  "net profit": "profit",
  profit: "profit",
  "ad spend": "ppc spend",
  "ppc sales": "revenue",
  "money wasted": "wasted spend",
  expenses: "expenses",
  expense: "expenses",
  expences: "expenses",
  expence: "expenses",
  "total expenses": "expenses",
  "amazon fees": "expenses",
  refunds: "refunds",
  "fba fees": "fba fees",
  "storage fees": "storage fees",
  reimbursement: "reimbursement",
  recoverable: "recoverable reimbursement"
};

function normalize(text) {
  return (text || "").toLowerCase();
}

function extractTimeRange(prompt) {
  const p = normalize(prompt);

  // Explicit ISO-like absolute range: from YYYY-MM-DD to YYYY-MM-DD
  const isoRange = p.match(/\bfrom\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\b/);
  if (isoRange) {
    return {
      type: "absolute_range",
      startDate: isoRange[1],
      endDate: isoRange[2],
      raw: isoRange[0]
    };
  }

  // Natural language absolute range: from 10th april to 14th april
  const monthMap = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const absRange = p.match(/\bfrom\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s*,?\s*(\d{4}))?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s*,?\s*(\d{4}))?\b/);
  if (absRange) {
    const nowYear = new Date().getFullYear();
    const d1 = Number(absRange[1]);
    const m1 = monthMap[absRange[2]];
    const y1 = Number(absRange[3] || absRange[6] || nowYear);
    const d2 = Number(absRange[4]);
    const m2 = monthMap[absRange[5]];
    const y2 = Number(absRange[6] || absRange[3] || nowYear);
    if (m1 && m2 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      const startDate = `${y1}-${String(m1).padStart(2, "0")}-${String(d1).padStart(2, "0")}`;
      const endDate = `${y2}-${String(m2).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
      return {
        type: "absolute_range",
        startDate,
        endDate,
        raw: absRange[0]
      };
    }
  }

  if (p.includes("today")) {
    return { type: "relative", value: "today", raw: "today" };
  }
  if (p.includes("yesterday")) {
    return { type: "relative", value: "yesterday", raw: "yesterday" };
  }
  const lastXDaysMatch = p.match(/last\s+(\d+)\s+days?/);
  if (lastXDaysMatch) {
    return {
      type: "relative",
      value: `last_${lastXDaysMatch[1]}_days`,
      raw: lastXDaysMatch[0]
    };
  }
  if (p.includes("last week")) {
    return { type: "relative", value: "last_7_days", raw: "last week" };
  }
  if (p.includes("last month")) {
    return { type: "relative", value: "last_30_days", raw: "last month" };
  }
  if (p.includes("this month")) {
    return { type: "relative", value: "this_month", raw: "this month" };
  }

  // Default: backend can decide the actual window; we still record raw phrase if any.
  return null;
}

function extractMetrics(prompt) {
  const p = normalize(prompt);
  const found = new Set();
  METRICS.forEach((metric) => {
    if (p.includes(metric)) {
      found.add(metric);
    }
  });
  Object.entries(METRIC_ALIASES).forEach(([phrase, metric]) => {
    if (p.includes(phrase)) found.add(metric);
  });
  return Array.from(found);
}

function extractDimensions(prompt) {
  const p = normalize(prompt);
  const found = [];
  DIMENSIONS.forEach((dim) => {
    if (p.includes(dim)) {
      found.push(dim);
    }
  });
  return found;
}

function extractFilters(prompt) {
  const p = normalize(prompt);
  const filters = {};

  if (p.includes("us marketplace") || p.includes("marketplace us") || p.includes("us market")) {
    filters.marketplace = "US";
  } else if (p.includes("uk marketplace") || p.includes("marketplace uk") || p.includes("uk market")) {
    filters.marketplace = "UK";
  }

  return filters;
}

function extractAsins(prompt) {
  const matches = String(prompt || "").match(/\bB0[A-Z0-9]{8,9}\b/gi) || [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, fifty: 50, hundred: 100,
};

function parseTopN(p) {
  const digitMatch = p.match(/\btop\s+(\d+)\b/);
  if (digitMatch) return Math.max(1, Math.min(100, Number(digitMatch[1])));
  const wordMatch = p.match(/\btop\s+([a-z]+)\b/);
  if (wordMatch && WORD_NUMBERS[wordMatch[1]]) return WORD_NUMBERS[wordMatch[1]];
  return null;
}

function extractProductQuery(prompt) {
  const p = normalize(prompt);
  const asksTopSelling =
    /\b(top|best)\s+(selling|seller)\b/.test(p) ||
    /\btop\s+\d+\s+(selling|products?)\b/.test(p) ||
    /\btop\s+selling\s+products?\b/.test(p);

  const asksTopProducts =
    /\btop\s+products?\b/.test(p) ||
    /\bbest\s+products?\b/.test(p) ||
    /\bhighest\s+selling\s+products?\b/.test(p) ||
    /\bhighest\s+sales\s+products?\b/.test(p);

  // Profit-oriented rankings
  const asksMostProfitableSingle =
    /\bmost\s+profit(able)?\b/.test(p) ||
    /\bhighest\s+profit\b/.test(p) ||
    /\bbest\s+profit\b/.test(p) ||
    /\bhighest\s+grossing\s+product\b/.test(p) ||
    /\bwhich\s+product.*profit/.test(p);

  const asksTopProfitProducts =
    /\btop\s+\w+\s+(most\s+)?profit(able)?\s+products?\b/.test(p) ||
    /\btop\s+\w+\s+highest\s+profit\s+products?\b/.test(p) ||
    /\btop\s+\w+\s+grossing\s+products?\b/.test(p) ||
    /\b(highest|best)\s+profit\s+products?\b/.test(p) ||
    /\bmost\s+profitable\s+products?\b/.test(p);

  const topN = parseTopN(p);
  const asins = extractAsins(prompt);

  if (asksTopProfitProducts) {
    const limit = topN || 10;
    return { type: "top_n_products", metric: "profit", limit };
  }
  if (asksMostProfitableSingle) {
    return { type: "best_selling_product", metric: "profit", limit: 1 };
  }

  if (asksTopSelling || asksTopProducts) {
    const limit = topN || (asksTopProducts ? 10 : 1);
    const type = topN || asksTopProducts ? "top_n_products" : "best_selling_product";
    return {
      type,
      metric: "sales",
      limit
    };
  }

  if (asins.length > 0 && /\bsales?|revenue|profit|acos|roas\b/.test(p)) {
    return {
      type: "asin_metric_lookup",
      metric: /\bprofit\b/.test(p) ? "profit" : "sales",
      asins
    };
  }

  if (asins.length >= 2 && /\b(compare|comparison|vs|versus)\b/.test(p)) {
    return {
      type: "asin_compare",
      metric: /\bprofit\b/.test(p) ? "profit" : "sales",
      asins: asins.slice(0, 5)
    };
  }

  return null;
}

function extractQueryShape(prompt, productQuery) {
  const p = normalize(prompt);
  if (productQuery?.type) return productQuery.type;
  if (/\b(compare|comparison|vs|versus)\b/.test(p)) return "comparison";
  if (/\b(top|best)\b/.test(p)) return "ranking";
  if (/\bwhy|reason|root cause|how does\b/.test(p)) return "explanation";
  if (/\b(block|pause|disable|negative|add as negative|stop bidding)\b/.test(p)) return "action";
  if (/\bhow much|what is|tell me|give me\b/.test(p)) return "single_metric_lookup";
  return "generic";
}

function extract(prompt, classification) {
  const timeRange = extractTimeRange(prompt);
  const metrics = extractMetrics(prompt);
  const dimensions = extractDimensions(prompt);
  const filters = extractFilters(prompt);
  const asins = extractAsins(prompt);
  const productQuery = extractProductQuery(prompt);
  const queryShape = extractQueryShape(prompt, productQuery);

  const entities = {
    metrics,
    dimensions,
    asins: asins.length ? asins : undefined,
    productQuery: productQuery || undefined,
    queryShape,
    filters: Object.keys(filters).length ? filters : undefined,
    timeRange: timeRange || undefined
  };

  return entities;
}

module.exports = {
  extract
};

