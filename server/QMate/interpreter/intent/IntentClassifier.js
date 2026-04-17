const fs = require("fs");
const path = require("path");

const patternsPath = path.join(__dirname, "..", "config", "patterns.json");
// Lazy load to avoid hard crashes if file is missing; callers can handle warnings.
let patterns;
try {
  const raw = fs.readFileSync(patternsPath, "utf8");
  patterns = JSON.parse(raw);
} catch (e) {
  patterns = { intents: {}, postActions: {} };
}

function normalize(text) {
  return (text || "").toLowerCase();
}

function keywordScore(prompt, keywords) {
  if (!keywords || !keywords.length) return 0;
  const p = normalize(prompt);
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    const idx = p.indexOf(kw.toLowerCase());
    if (idx !== -1) {
      // Weight earlier matches slightly higher.
      score += 1 + Math.max(0, 0.5 - idx / Math.max(p.length, 1));
    }
  }
  return score;
}

function classifyIntent(prompt) {
  const intents = patterns.intents || {};
  let bestIntent = "other";
  let bestScore = 0;

  Object.entries(intents).forEach(([intentKey, kws]) => {
    const s = keywordScore(prompt, kws);
    if (s > bestScore) {
      bestScore = s;
      bestIntent = intentKey;
    }
  });

  // Map internal keys to public intent values
  const intentMap = {
    graph: "graph",
    suggestion: "suggestion",
    value_lookup: "value_lookup",
    detailed_explanation: "detailed_explanation",
    post_action: "post_action"
  };

  const mappedIntent = intentMap[bestIntent] || "other";
  const confidence = Math.max(0, Math.min(1, bestScore / 3));

  return { intent: mappedIntent, confidence };
}

function inferDetailLevel(prompt, intent) {
  const p = normalize(prompt);
  if (p.includes("in detail") || p.includes("full breakdown") || p.includes("step by step")) {
    return "full";
  }
  if (p.includes("summary") || p.includes("short") || p.includes("quick")) {
    return "summary";
  }
  if (intent === "detailed_explanation") {
    return "full";
  }
  return "normal";
}

function inferResponseStyle(prompt, intent) {
  const p = normalize(prompt);
  if (intent === "graph") {
    return "graph";
  }
  if (p.includes("table") || p.includes("tabular")) {
    return "table";
  }
  if (p.includes("graph") || p.includes("chart") || p.includes("plot") || p.includes("trend")) {
    return "graph";
  }
  return "text";
}

function classify(prompt) {
  const base = classifyIntent(prompt);
  const detailLevel = inferDetailLevel(prompt, base.intent);
  const responseStyle = inferResponseStyle(prompt, base.intent);
  return {
    intent: base.intent,
    confidence: base.confidence,
    detailLevel,
    responseStyle
  };
}

module.exports = {
  classify
};

