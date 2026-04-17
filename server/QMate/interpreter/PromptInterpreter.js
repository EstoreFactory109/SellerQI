const IntentClassifier = require("./intent/IntentClassifier");
const EntityExtractor = require("./entities/EntityExtractor");
const PostActionParser = require("./actions/PostActionParser");
const PresentationResolver = require("./presentation/PresentationResolver");

const SCHEMA_VERSION = "v1";

function normalizePrompt(prompt) {
  if (typeof prompt !== "string") {
    return "";
  }
  return prompt.trim();
}

/**
 * Interpret a natural-language prompt into a structured contract.
 *
 * @param {{ prompt: string, context?: object }} params
 * @returns {object}
 */
function interpretPrompt(params) {
  const warnings = [];

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

  const classification = IntentClassifier.classify(normalizedPrompt);
  const entities = EntityExtractor.extract(normalizedPrompt, classification);

  if (!entities.timeRange) {
    warnings.push("Time range not specified; backend may apply a default window");
  }

  let postAction = null;
  if (classification.intent === "post_action") {
    postAction = PostActionParser.parse(normalizedPrompt);
    if (!postAction.type) {
      warnings.push("Post action intent detected but no specific action type was recognized");
    }
    if (postAction.type === "block_keywords" && (!postAction.targets || !postAction.targets.length)) {
      warnings.push("No explicit keyword targets found for block_keywords action");
    }
  }

  const presentation = PresentationResolver.resolve(normalizedPrompt, classification, entities);

  return {
    schemaVersion: SCHEMA_VERSION,
    intent: classification.intent,
    detailLevel: classification.detailLevel,
    confidence: classification.confidence,
    entities,
    postAction,
    presentation,
    raw: {
      prompt: params.prompt,
      normalizedPrompt
    },
    warnings
  };
}

module.exports = {
  interpretPrompt
};

