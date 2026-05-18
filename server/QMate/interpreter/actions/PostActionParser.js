const fs = require("fs");
const path = require("path");

const patternsPath = path.join(__dirname, "..", "config", "patterns.json");
let patterns;
try {
  const raw = fs.readFileSync(patternsPath, "utf8");
  patterns = JSON.parse(raw);
} catch (e) {
  patterns = { postActions: {} };
}

function normalize(text) {
  return (text || "").toLowerCase();
}

function detectActionType(prompt) {
  const p = normalize(prompt);
  const postActions = patterns.postActions || {};

  let bestType = null;
  let bestScore = 0;

  Object.entries(postActions).forEach(([type, keywords]) => {
    let score = 0;
    (keywords || []).forEach((kw) => {
      if (!kw) return;
      if (p.includes(kw.toLowerCase())) {
        score += 1;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  });

  // Heuristic fallback for common phrasing not captured in config.
  if (!bestType) {
    const hasPauseVerb = /\b(pause|stop|disable|turn off)\b/i.test(p);
    const hasNegativeVerb = /\b(add as negative|add to negative|negative)\b/i.test(p);
    const hasKeywordNoun = /\b(keyword|keywords|search term|search terms|term|terms)\b/i.test(p);
    const hasBlockVerb = /\b(block|pause|stop|exclude|negative)\b/i.test(p);
    if (hasKeywordNoun && hasPauseVerb && hasNegativeVerb) {
      bestType = "pause_and_add_to_negative";
    } else if (hasKeywordNoun && hasNegativeVerb) {
      bestType = "add_to_negative";
    } else if (hasKeywordNoun && hasBlockVerb) {
      bestType = "block_keywords";
    } else if (/\b(pause|stop|disable|turn off)\b/i.test(p) && /\bcampaign|campaigns|ad group|adgroup\b/i.test(p)) {
      bestType = "pause_campaigns";
    }
  }

  return bestType;
}

function extractKeywordTargets(prompt) {
  // Primary heuristic: quoted phrases.
  const targets = [];
  const quoteRegex = /"([^"]+)"/g;
  let match = quoteRegex.exec(prompt);
  while (match) {
    targets.push(match[1]);
    match = quoteRegex.exec(prompt);
  }

  // Secondary heuristic: comma-separated list after action verbs.
  if (targets.length === 0) {
    const lower = normalize(prompt);
    const patterns = [
      /(?:block|pause|stop|exclude|add as negative)\s+(?:keywords?|terms?)\s*[:\-]?\s*(.+)$/i,
      /(?:block|pause|stop bidding on|exclude)\s+(.+)$/i
    ];
    for (const p of patterns) {
      const m = lower.match(p);
      if (!m || !m[1]) continue;
      m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 120)
        .forEach((s) => targets.push(s));
      if (targets.length > 0) break;
    }
  }

  return targets;
}

function inferScope(prompt) {
  const p = normalize(prompt);
  if (p.includes("campaign")) return "campaign";
  if (p.includes("ad group") || p.includes("adgroup")) return "ad_group";
  return "account";
}

function parseMatchType(prompt) {
  const p = normalize(prompt);
  if (/\bnegative exact\b|\bexact\b/.test(p)) return "negativeExact";
  if (/\bnegative phrase\b|\bphrase\b/.test(p)) return "negativePhrase";
  return null;
}

function parseAdType(prompt) {
  const p = normalize(prompt);
  if (/\bsponsored brands?\b|\bsb\b/.test(p)) return "SB";
  if (/\bsponsored display\b|\bsd\b/.test(p)) return "SD";
  if (/\bsponsored products?\b|\bsp\b/.test(p)) return "SP";
  return null;
}

function isBulk(prompt, targets) {
  const p = normalize(prompt);
  return /\bbulk\b|\ball\b|\bmultiple\b/.test(p) || (Array.isArray(targets) && targets.length > 1);
}

function parse(prompt) {
  let actionType = detectActionType(prompt);
  const p = normalize(prompt);
  const hasPauseVerb = /\b(pause|stop|disable|turn off)\b/i.test(p);
  const hasNegativeVerb = /\b(add as negative|add to negative|negative)\b/i.test(p);
  if (hasPauseVerb && hasNegativeVerb) actionType = "pause_and_add_to_negative";
  else if (hasNegativeVerb && actionType === "block_keywords") actionType = "add_to_negative";
  if (!actionType) {
    return {
      type: null,
      targets: [],
      scope: "account"
    };
  }

  let targets = [];
  if (actionType === "block_keywords" || actionType === "add_to_negative" || actionType === "pause_and_add_to_negative") {
    targets = extractKeywordTargets(prompt);
  }

  const scope = inferScope(prompt);
  const matchType = parseMatchType(prompt);
  const adType = parseAdType(prompt);
  const bulk = isBulk(prompt, targets);

  return {
    type: actionType,
    targets,
    scope,
    mode: "preview",
    matchType: matchType || "negativePhrase",
    adType: adType || "SP",
    bulk
  };
}

module.exports = {
  parse
};

