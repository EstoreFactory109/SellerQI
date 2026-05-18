const logger = require("../../../utils/Logger.js");

// Use the same OpenAI client that QMateService uses.
// This function receives it as a parameter to avoid circular deps.

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for an Amazon seller analytics chatbot called QMate. Given the user's message and optional chat history, classify the query.

You MUST respond with ONLY a valid JSON object, no markdown, no explanation, no backticks.

The JSON schema:
{
  "intent": one of ["sales_query", "profit_query", "ppc_query", "ppc_optimization", "issue_query", "inventory_query", "reimbursement_query", "account_health", "product_query", "keyword_query", "comparison", "top_products", "value_lookup", "trend_query", "why_question", "how_to_fix", "implementation_request", "general_question", "greeting", "off_topic", "capabilities_question"],
  "confidence": number between 0.0 and 1.0,
  "engine": one of ["information_engine", "suggestion_engine", "implementation_engine"],
  "entities": {
    "metrics": array of metric names mentioned (e.g., ["sales", "gross_profit", "acos", "units_sold"]),
    "asins": array of ASIN strings found (e.g., ["B08XYZ123"]),
    "timeRange": { "type": "explicit" | "relative" | "none", "value": string or null } (e.g., {"type": "relative", "value": "last 7 days"}),
    "comparisonType": "none" | "time_period" | "asin_vs_asin" | "metric_vs_metric",
    "scope": "all_products" | "specific_asin" | "top_n" | "category"
  },
  "outputPreference": one of ["single_number", "list", "graph", "table", "detailed_explanation", "unspecified"],
  "detailLevel": one of ["brief", "standard", "detailed"]
}

RULES:
- "why" questions → intent should be "why_question", engine "suggestion_engine"
- "how to fix/improve" → intent "how_to_fix", engine "suggestion_engine"
- "pause keyword / add negative" → intent "implementation_request", engine "implementation_engine"
- Questions about a specific ASIN → include it in entities.asins
- "show me a graph/chart" → outputPreference "graph"
- "compare X to Y" → intent "comparison"
- "top 5 products" → intent "top_products"
- "what can you do" → intent "capabilities_question"
- Greetings like "hi", "hello" → intent "greeting"
- Non-Amazon-seller topics → intent "off_topic"
- Default engine for informational queries is "information_engine"
- If you're not sure, still pick the best match and set confidence lower (0.4-0.6)`;

async function classifyWithLLM(prompt, chatHistory, openAIClient) {
  try {
    if (!openAIClient || typeof openAIClient?.chat?.completions?.create !== "function") {
      // No client provided — return a soft failure so the caller falls back to regex.
      return { success: false, _classifierType: "llm", error: "openAIClient_unavailable" };
    }

    const messages = [
      { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
    ];

    // Include last 3 turns of history for context resolution
    if (chatHistory && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-6); // last 3 pairs
      messages.push({
        role: "user",
        content:
          "Recent chat history for context:\n" +
          recentHistory.map((m) => `${m.role}: ${m.content}`).join("\n") +
          "\n\n---\nNow classify this new message:",
      });
    }

    messages.push({ role: "user", content: prompt });

    const startTime = Date.now();
    const response = await openAIClient.chat.completions.create({
      model: "gpt-4o-mini", // fast + cheap, good enough for classification
      messages,
      max_tokens: 500,
      temperature: 0.0, // deterministic classification
    });
    const durationMs = Date.now() - startTime;

    const raw = response.choices?.[0]?.message?.content || "";
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    logger.info(
      `[QMate][LLMIntentClassifier] Classified in ${durationMs}ms: intent=${parsed.intent}, confidence=${parsed.confidence}, engine=${parsed.engine}`
    );

    return {
      success: true,
      ...parsed,
      _classifierType: "llm",
      _durationMs: durationMs,
    };
  } catch (err) {
    logger.error(
      "[QMate][LLMIntentClassifier] Classification failed, falling back to regex:",
      err.message
    );
    return { success: false, _classifierType: "llm", error: err.message };
  }
}

module.exports = { classifyWithLLM };
