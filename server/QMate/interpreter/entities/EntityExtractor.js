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

function normalize(text) {
  return (text || "").toLowerCase();
}

function extractTimeRange(prompt) {
  const p = normalize(prompt);

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
  const found = [];
  METRICS.forEach((metric) => {
    if (p.includes(metric)) {
      found.push(metric);
    }
  });
  return found;
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

function extract(prompt, classification) {
  const timeRange = extractTimeRange(prompt);
  const metrics = extractMetrics(prompt);
  const dimensions = extractDimensions(prompt);
  const filters = extractFilters(prompt);

  const entities = {
    metrics,
    dimensions,
    filters: Object.keys(filters).length ? filters : undefined,
    timeRange: timeRange || undefined
  };

  return entities;
}

module.exports = {
  extract
};

