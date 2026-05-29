const IntentClassifier = require("./intent/IntentClassifier");
const { classifyWithLLM } = require("./intent/LLMIntentClassifier");
const EntityExtractor = require("./entities/EntityExtractor");
const PostActionParser = require("./actions/PostActionParser");
const PresentationResolver = require("./presentation/PresentationResolver");
const logger = require("../../utils/Logger.js");

const SCHEMA_VERSION = "v1";
const ENGINE = {
  INFORMATION: "information_engine",
  SUGGESTION: "suggestion_engine",
  IMPLEMENTATION: "implementation_engine"
};

function normalizePrompt(prompt) {
  if (typeof prompt !== "string") {
    return "";
  }
  return prompt.trim();
}

function resolveEngine(classification) {
  const intent = classification?.intent || "other";
  if (intent === "post_action") return ENGINE.IMPLEMENTATION;
  if (intent === "suggestion" || intent === "detailed_explanation") return ENGINE.SUGGESTION;
  return ENGINE.INFORMATION;
}

function resolveOutputPreference(prompt, classification, presentation) {
  const p = String(prompt || "").toLowerCase();
  const style = presentation?.responseStyle || classification?.responseStyle || "text";

  if (
    /\b(single|only)\s+(number|value)\b/.test(p) ||
    /\bjust\s+(number|value)\b/.test(p) ||
    /\bhow much\b/.test(p)
  ) {
    return { format: "single_number", confidence: 0.9 };
  }
  if (/\blist\b|\bbreakdown\b|\btop\s+\d+\b/.test(p)) {
    return { format: "list", confidence: 0.85 };
  }
  if (style === "graph" || /\bgraph|chart|trend|visual(ize)?\b/.test(p)) {
    return { format: "graph", confidence: 0.9 };
  }
  if (style === "table" || /\btable|tabular\b/.test(p)) {
    return { format: "table", confidence: 0.8 };
  }
  return { format: "unspecified", confidence: 0.4 };
}

function rewriteSuggestionQuestion(prompt, entities, outputPreference) {
  const metrics = Array.isArray(entities?.metrics) && entities.metrics.length
    ? entities.metrics.join(", ")
    : "profitability and performance metrics";
  const dimensions = Array.isArray(entities?.dimensions) && entities.dimensions.length
    ? entities.dimensions.join(", ")
    : "account and product dimensions";
  const timeRange = entities?.timeRange?.raw || "default recent period";
  const output = outputPreference?.format || "unspecified";
  const productQuery = entities?.productQuery
    ? ` Product query intent: ${JSON.stringify(entities.productQuery)}.`
    : "";

  return [
    "Analyze the seller performance context and provide actionable suggestions.",
    `Primary user question: "${String(prompt || "").trim()}".`,
    `Focus metrics: ${metrics}.`,
    `Relevant dimensions: ${dimensions}.`,
    `Time range: ${timeRange}.`,
    `Preferred output: ${output}.`,
    productQuery,
    "Explain why the issue is happening, what to do next, and expected impact."
  ].join(" ");
}

// --- Phase 3 / Task 3.1: clarification options ----------------------------
// `buildClarificationPlan` now emits BOTH:
//   - `options`: structured `{ id, label, resolved_prompt, [icon], [needs_followup] }` objects
//                that the new frontend renders as clickable buttons.
//   - `questions`: a string array kept for backward compatibility (older
//                  clients and the existing layered pipeline still read this).
// Every `addOption(...)` call mutates both arrays in lockstep so the two
// representations stay in sync.

function buildClarificationPlan({
  classification,
  engine,
  outputPreference,
  postAction,
  entities,
  prompt
}) {
  const options = [];
  const questions = [];
  const reasons = [];

  let optionIdCounter = 0;
  function addOption({ label, resolved_prompt, legacy, icon, needs_followup }) {
    optionIdCounter += 1;
    const opt = {
      id: `opt_${optionIdCounter}`,
      label,
      resolved_prompt,
    };
    if (icon) opt.icon = icon;
    if (needs_followup) opt.needs_followup = true;
    options.push(opt);
    // Legacy string mirror — keep "Option N: ..." prefix so the existing
    // regex fallback in QMateService.resolveClarificationChoice keeps working.
    questions.push(legacy || `Option ${optionIdCounter}: ${label}`);
  }

  function pushFreeformQuestion(text) {
    // Free-form prompts (e.g. "share exact targets") have no clickable option.
    // Still expose them as a single option for the frontend so the user has a
    // way to start typing, but mark needs_followup so the UI can prompt for
    // more input rather than auto-sending the resolved_prompt.
    addOption({
      label: text,
      resolved_prompt: text,
      legacy: text,
      needs_followup: true,
    });
  }

  const confidence = Number(classification?.confidence || 0);
  const unknownIntent = classification?.intent === "other";
  const hasMetricSignal = Array.isArray(entities?.metrics) && entities.metrics.length > 0;
  const likelyInfoValueQuery =
    hasMetricSignal &&
    engine === ENGINE.INFORMATION &&
    entities?.queryShape !== "action" &&
    entities?.queryShape !== "comparison";
  if ((unknownIntent || confidence < 0.25) && !likelyInfoValueQuery) {
    reasons.push("uncertain_intent");
    addOption({
      label: "Look up a specific number",
      resolved_prompt: "What is my total sales for the last 30 days?",
      icon: "search",
    });
    addOption({
      label: "Get suggestions or root-cause analysis",
      resolved_prompt: "Why is my profit declining and what should I do about it?",
      icon: "lightbulb",
    });
    addOption({
      label: "Make a change to my account",
      resolved_prompt: "Pause my worst-performing PPC keywords",
      icon: "wrench",
    });
  }

  if (engine === ENGINE.SUGGESTION && outputPreference?.format === "unspecified") {
    reasons.push("missing_output_format");
    addOption({
      label: "Show me a single number",
      resolved_prompt: `${String(prompt || "").trim()} — return a single number only.`,
      icon: "hash",
    });
    addOption({
      label: "Show me a list with explanation",
      resolved_prompt: `${String(prompt || "").trim()} — return a ranked list with brief reasoning.`,
      icon: "list",
    });
    addOption({
      label: "Show me a graph/trend",
      resolved_prompt: `${String(prompt || "").trim()} — return a trend chart over time.`,
      icon: "trending-up",
    });
  }

  if (engine === ENGINE.IMPLEMENTATION && postAction?.type && (!postAction.targets || !postAction.targets.length)) {
    reasons.push("missing_action_targets");
    pushFreeformQuestion(
      "Share exact targets for this change (for example keywords/campaign names) so I can proceed."
    );
  }
  if (engine === ENGINE.IMPLEMENTATION && !postAction?.type) {
    reasons.push("unsupported_action_variant");
    addOption({
      label: "Pause keyword(s)",
      resolved_prompt: "Pause my worst-performing PPC keywords",
      icon: "pause",
    });
    addOption({
      label: "Add keyword(s) to negative",
      resolved_prompt: "Add my zero-sales search terms as negative keywords",
      icon: "ban",
    });
    addOption({
      label: "Pause and add to negative",
      resolved_prompt: "Pause my wasted-spend keywords and add them as negatives",
      icon: "shield-off",
    });
    addOption({
      label: "Pause campaign(s)",
      resolved_prompt: "Pause my campaigns with ACOS above 40%",
      icon: "pause-octagon",
    });
  }

  const metricCount = Array.isArray(entities?.metrics) ? entities.metrics.length : 0;
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const hasExplicitVsConnector = /\bvs\b|\bversus\b/.test(normalizedPrompt);
  const isMetricVsMetricComparison =
    entities?.queryShape === "comparison" &&
    hasExplicitVsConnector &&
    metricCount >= 2;
  if (entities?.queryShape === "comparison" && !isMetricVsMetricComparison && (!entities?.asins || entities.asins.length < 2)) {
    reasons.push("missing_comparison_entities");
    pushFreeformQuestion("Please provide at least two ASINs for comparison.");
  }

  return {
    needed: questions.length > 0,
    reasons,
    questions,
    options
  };
}

// --- Phase 2 / Task 2.2: Reference resolution helpers ---
// Used to detect when the user is implicitly referring back to entities (an
// ASIN, a time range, etc.) that were mentioned in earlier turns of the chat.

function hasImplicitReference(prompt) {
  const referencePatterns = /\b(that product|that asin|this product|the same product|the same one|same asin|that item|this item|it|its|the product|the listing)\b/i;
  return referencePatterns.test(prompt);
}

function hasTemporalReference(prompt) {
  const temporalPatterns = /\b(same period|same time|that period|that month|that week|same range|same dates)\b/i;
  return temporalPatterns.test(prompt);
}

function extractAsinsFromHistory(messages) {
  const asinPattern = /\b[A-Z0-9]{10}\b/g;
  const asins = new Set();
  for (const msg of messages) {
    const content = msg.content || "";
    const matches = content.match(asinPattern) || [];
    matches.forEach((a) => {
      // Basic ASIN validation: starts with B0 or is 10 alphanumeric chars
      if (/^B0[A-Z0-9]{8}$/.test(a) || /^[A-Z0-9]{10}$/.test(a)) {
        asins.add(a);
      }
    });
  }
  // Return most recently mentioned ASINs (last message first)
  return Array.from(asins).slice(0, 3);
}

function extractTimeRangeFromHistory(messages) {
  // Look for time range mentions in recent assistant messages
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "assistant") continue;
    const content = msg.content || "";
    // Match patterns like "last 7 days", "last 30 days", etc.
    const match = content.match(/(?:last|past)\s+(\d+)\s+(days?|weeks?|months?)/i);
    if (match) {
      return { type: "relative", value: match[0] };
    }
  }
  return null;
}

// Map the LLM classifier's detailLevel vocabulary to the regex classifier's
// vocabulary so downstream code that consumes `interpretation.detailLevel`
// keeps working.
function normalizeDetailLevel(level) {
  if (level === "brief") return "summary";
  if (level === "detailed") return "full";
  if (level === "standard") return "normal";
  return level || "normal";
}

// Convert the LLM classifier's flat outputPreference string to the
// `{ format, confidence }` shape used elsewhere in the interpreter contract.
function normalizeOutputPreference(value) {
  if (!value || typeof value !== "string") {
    return { format: "unspecified", confidence: 0.4 };
  }
  return { format: value, confidence: 0.85 };
}

// Derive a presentation hint from the LLM outputPreference so existing
// consumers of `interpretation.presentation.responseStyle` still get useful
// values.
function presentationFromOutputPreference(preference, prompt) {
  if (preference?.format === "graph") return { responseStyle: "graph", chartType: "auto" };
  if (preference?.format === "table") return { responseStyle: "table", chartType: "auto" };
  if (/\b(graph|chart|plot|trend|visual(ize)?)\b/i.test(prompt || "")) {
    return { responseStyle: "graph", chartType: "auto" };
  }
  if (/\b(table|tabular)\b/i.test(prompt || "")) {
    return { responseStyle: "table", chartType: "auto" };
  }
  return { responseStyle: "text", chartType: "auto" };
}

/**
 * Interpret a natural-language prompt into a structured contract.
 *
 * Phase 2 — runs the legacy regex classifier and the new LLM classifier in
 * parallel via Promise.allSettled. When the LLM result is confident
 * (confidence >= 0.6) it wins; otherwise we fall back to the regex result.
 * The LLM classifier never throws — it returns `{ success: false }` on any
 * failure so this function still completes in regex-speed when the LLM is
 * unavailable.
 *
 * @param {{ prompt: string, context?: { chatHistory?: Array, openAIClient?: object } }} params
 * @returns {Promise<object>}
 */
async function interpretPrompt(params) {
  const warnings = [];
  const context = (params && params.context) || {};

  if (!params || typeof params.prompt !== "string" || !params.prompt.trim()) {
    return {
      schemaVersion: SCHEMA_VERSION,
      intent: "other",
      detailLevel: "summary",
      confidence: 0,
      entities: {
        metrics: [],
        dimensions: []
      },
      postAction: null,
      presentation: {
        responseStyle: "text",
        chartType: "auto"
      },
      raw: {
        prompt: params && params.prompt ? String(params.prompt) : "",
        normalizedPrompt: ""
      },
      warnings: ["Empty or invalid prompt"]
    };
  }

  const normalizedPrompt = normalizePrompt(params.prompt);

  // --- Phase 2 / Task 2.1: Dual-classifier (regex + LLM) ---
  // Wrap the sync regex call in Promise.resolve so Promise.allSettled can
  // race it against the async LLM call. If the LLM call fails it returns a
  // soft `{ success: false }` rather than throwing.
  const [regexResult, llmResult] = await Promise.allSettled([
    Promise.resolve(IntentClassifier.classify(normalizedPrompt)),
    classifyWithLLM(normalizedPrompt, context.chatHistory || [], context.openAIClient)
  ]);

  const regexClassification = regexResult.status === "fulfilled" ? regexResult.value : null;
  const llmClassification =
    llmResult.status === "fulfilled" && llmResult.value && llmResult.value.success
      ? llmResult.value
      : null;

  const useLLM = !!(llmClassification && Number(llmClassification.confidence) >= 0.6);

  // Build the unified `classification` object that downstream helpers expect.
  let classification;
  let entities;
  let outputPreference;
  let presentation;

  if (useLLM) {
    const llmEntities = llmClassification.entities || {};
    const regexEntities = regexClassification
      ? EntityExtractor.extract(normalizedPrompt, regexClassification)
      : {};

    // Merge entities: LLM entities as base, regex entities fill gaps. Prefer
    // regex-extracted ASINs because the regex pattern match is more reliable
    // than the LLM at exact ID extraction.
    entities = {
      ...regexEntities,
      ...llmEntities,
      metrics: Array.isArray(llmEntities.metrics) && llmEntities.metrics.length
        ? llmEntities.metrics
        : (regexEntities.metrics || []),
      dimensions: regexEntities.dimensions || [],
      asins:
        regexEntities && Array.isArray(regexEntities.asins) && regexEntities.asins.length > 0
          ? regexEntities.asins
          : (Array.isArray(llmEntities.asins) ? llmEntities.asins : [])
    };
    if (regexEntities.productQuery) entities.productQuery = regexEntities.productQuery;
    if (regexEntities.queryShape) entities.queryShape = regexEntities.queryShape;
    if (regexEntities.filters) entities.filters = regexEntities.filters;
    // Prefer regex timeRange (it parses absolute date ranges precisely)
    // but fall back to the LLM's value when regex has nothing.
    if (regexEntities.timeRange) {
      entities.timeRange = regexEntities.timeRange;
    } else if (llmEntities.timeRange && llmEntities.timeRange.type && llmEntities.timeRange.type !== "none") {
      entities.timeRange = llmEntities.timeRange;
    }

    classification = {
      intent: llmClassification.intent || "other",
      confidence: Number(llmClassification.confidence) || 0,
      detailLevel: normalizeDetailLevel(llmClassification.detailLevel),
      responseStyle:
        llmClassification.outputPreference === "graph"
          ? "graph"
          : llmClassification.outputPreference === "table"
            ? "table"
            : "text"
    };

    outputPreference = normalizeOutputPreference(llmClassification.outputPreference);
    presentation = presentationFromOutputPreference(outputPreference, normalizedPrompt);

    logger.info(
      `[QMate][Interpreter] Using LLM classification: ${classification.intent} (${classification.confidence})`
    );
  } else {
    classification = regexClassification || {
      intent: "other",
      confidence: 0.3,
      detailLevel: "normal",
      responseStyle: "text"
    };
    entities = EntityExtractor.extract(normalizedPrompt, classification);
    presentation = PresentationResolver.resolve(normalizedPrompt, classification, entities);
    outputPreference = resolveOutputPreference(normalizedPrompt, classification, presentation);

    logger.info(
      `[QMate][Interpreter] Using regex classification: ${classification.intent} (${classification.confidence})`
    );
  }

  // Engine selection mirrors the spec: prefer the LLM-suggested engine when
  // confident, otherwise derive it from the chosen intent.
  let engine = useLLM && llmClassification.engine
    ? llmClassification.engine
    : resolveEngine(classification);

  if (!entities.timeRange) {
    warnings.push("Time range not specified; backend may apply a default window");
  }

  let postAction = null;
  const parsedAction = PostActionParser.parse(normalizedPrompt);
  if (classification.intent === "post_action" || parsedAction?.type) {
    postAction = parsedAction;
    engine = ENGINE.IMPLEMENTATION;
    if (!postAction.type) {
      warnings.push("Post action intent detected but no specific action type was recognized");
    }
    if (postAction.type === "block_keywords" && (!postAction.targets || !postAction.targets.length)) {
      warnings.push("No explicit keyword targets found for block_keywords action");
    }
  }

  // --- Phase 2 / Task 2.2: Reference resolution from chat history ---
  // If the current query implicitly refers to an ASIN ("that product",
  // "this listing") or a previously discussed time period, pull the
  // referenced entity forward from recent turns.
  if (context && Array.isArray(context.chatHistory) && context.chatHistory.length > 0 && entities) {
    // If current query has no ASINs but refers to one implicitly
    if ((!entities.asins || entities.asins.length === 0) && hasImplicitReference(normalizedPrompt)) {
      const recentAsins = extractAsinsFromHistory(context.chatHistory.slice(-6));
      if (recentAsins.length > 0) {
        entities.asins = recentAsins;
        entities._resolvedFromHistory = true;
        logger.info(
          `[QMate][Interpreter] Resolved ASIN from history: ${recentAsins.join(", ")}`
        );
      }
    }

    // If current query has no time range but refers to one implicitly
    const noTimeRange =
      !entities.timeRange ||
      entities.timeRange === "none" ||
      entities.timeRange?.type === "none";
    if (noTimeRange && hasTemporalReference(normalizedPrompt)) {
      const recentTimeRange = extractTimeRangeFromHistory(context.chatHistory.slice(-6));
      if (recentTimeRange) {
        entities.timeRange = recentTimeRange;
        entities._timeResolvedFromHistory = true;
        logger.info(
          `[QMate][Interpreter] Resolved time range from history: ${recentTimeRange.value}`
        );
      }
    }
  }

  // --- Phase 5 / Task 5.3: Fill from structured conversation context ---
  // The structured `conversationContext` (active ASINs, active time range)
  // is a more reliable fallback than raw history scraping. Use it when the
  // chat-history pass above did not resolve the reference.
  if (context && context.conversationContext && entities) {
    const convCtx = context.conversationContext || {};

    // If still no ASINs after reference resolution, use active ASINs from context
    if (
      (!entities.asins || entities.asins.length === 0) &&
      hasImplicitReference(normalizedPrompt) &&
      Array.isArray(convCtx.activeAsins) &&
      convCtx.activeAsins.length > 0
    ) {
      entities.asins = [convCtx.activeAsins[0]]; // most recent ASIN
      entities._resolvedFromConversationContext = true;
      logger.info(
        `[QMate][Interpreter] Resolved ASIN from conversation context: ${entities.asins[0]}`
      );
    }

    // If no time range, carry forward from context
    const stillNoTimeRange =
      !entities.timeRange ||
      entities.timeRange === "none" ||
      entities.timeRange?.type === "none";
    if (stillNoTimeRange && convCtx.activeTimeRange) {
      entities.timeRange = convCtx.activeTimeRange;
      entities._timeResolvedFromConversationContext = true;
      logger.info(
        "[QMate][Interpreter] Resolved time range from conversation context"
      );
    }
  }

  const rewrittenQuestion =
    engine === ENGINE.SUGGESTION
      ? rewriteSuggestionQuestion(normalizedPrompt, entities, outputPreference)
      : normalizedPrompt;
  const clarification = buildClarificationPlan({
    classification,
    engine,
    outputPreference,
    postAction,
    entities,
    prompt: normalizedPrompt
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    intent: classification.intent,
    detailLevel: classification.detailLevel,
    confidence: classification.confidence,
    entities,
    postAction,
    presentation,
    routing: {
      engine,
      reason: useLLM
        ? `llm_classifier:${classification.intent}`
        : `intent:${classification.intent}`
    },
    outputPreference,
    rewrittenQuestion,
    clarification,
    classifier: {
      used: useLLM ? "llm" : "regex",
      llmConfidence: llmClassification ? Number(llmClassification.confidence) : null,
      regexConfidence: regexClassification ? Number(regexClassification.confidence) : null,
      llmAvailable: !!llmClassification,
      llmDurationMs: llmClassification?._durationMs ?? null
    },
    raw: {
      prompt: params.prompt,
      normalizedPrompt
    },
    warnings
  };
}

module.exports = {
  interpretPrompt,
  // Exported for unit testing / future reuse:
  hasImplicitReference,
  hasTemporalReference,
  extractAsinsFromHistory,
  extractTimeRangeFromHistory
};

