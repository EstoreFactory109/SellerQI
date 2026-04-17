/**
 * Check which OpenAI models are usable with the current API key.
 *
 * Usage:
 *   node server/scripts/checkAllowedModels.js
 *
 * Notes:
 * - Reads OPENAPI_KEY (project convention) or OPENAI_API_KEY from env.
 * - Attempts a tiny chat completion against candidate models.
 * - Prints ALLOWED / DENIED with concise reason.
 */

const path = require("path");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const apiKey = process.env.OPENAPI_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("Missing API key. Set OPENAPI_KEY (or OPENAI_API_KEY) in .env");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

// Candidate list: include your requested task-oriented models plus a fallback baseline.
const CANDIDATE_MODELS = [
  "gpt-5.4-medium",
  "gpt-5.3-codex",
  "gpt-5",
  "gpt-4.1-mini",
  "gpt-4o-mini"
];

function summarizeError(err) {
  const status = err?.status || err?.response?.status || "unknown";
  const code = err?.code || err?.error?.code || "unknown_code";
  const msg =
    err?.error?.message ||
    err?.message ||
    "Unknown error";
  return `status=${status}, code=${code}, message=${msg}`;
}

async function probeModel(model) {
  // Attempt 1: Chat Completions (works for chat models)
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Ping. Reply with: ok" }],
      max_tokens: 5,
      temperature: 0
    });
    return { model, allowed: true, reason: "chat.completions succeeded" };
  } catch (err) {
    const firstError = summarizeError(err);

    // Attempt 2: Chat Completions with max_completion_tokens (some newer models)
    try {
      await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "Ping. Reply with: ok" }],
        max_completion_tokens: 16
      });
      return { model, allowed: true, reason: "chat.completions (max_completion_tokens) succeeded" };
    } catch (err2) {
      const secondError = summarizeError(err2);

      // Attempt 3: Responses API (works for many non-chat models)
      try {
        await client.responses.create({
          model,
          input: "Ping. Reply with: ok",
          max_output_tokens: 16
        });
        return { model, allowed: true, reason: "responses API succeeded" };
      } catch (err3) {
        const thirdError = summarizeError(err3);
        return {
          model,
          allowed: false,
          reason: `chat_probe=${firstError} | chat_probe_v2=${secondError} | responses_probe=${thirdError}`
        };
      }
    }
  }
}

async function main() {
  console.log("Checking model access for current API key...\n");

  const results = [];
  for (const model of CANDIDATE_MODELS) {
    // Sequential to avoid rate spikes and keep output readable.
    // This also makes per-model failure reasons easier to inspect.
    // eslint-disable-next-line no-await-in-loop
    const result = await probeModel(model);
    results.push(result);
  }

  const allowed = results.filter((r) => r.allowed);
  const denied = results.filter((r) => !r.allowed);

  console.log("=== ALLOWED MODELS ===");
  if (allowed.length === 0) {
    console.log("None from candidate list.");
  } else {
    allowed.forEach((r) => console.log(`- ${r.model}`));
  }

  console.log("\n=== DENIED MODELS ===");
  if (denied.length === 0) {
    console.log("None from candidate list.");
  } else {
    denied.forEach((r) => console.log(`- ${r.model}\n  ${r.reason}`));
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Unexpected failure:", err?.message || err);
  process.exit(1);
});

