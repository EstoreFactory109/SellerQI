const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { generateRankingContentSuggestion } = require('../../Services/AI/RankingContentAIService.js');

/**
 * Controller to generate AI suggestions for ranking-related listing content
 * (title, bullet points, description, backend keywords) for a given ASIN.
 *
 * Request body:
 * {
 *   "asin": "B07HP6VWH3",
 *   "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
 *   // For title suggestions:
 *   "title": "Current title string",
 *   // For bullet points suggestions (array or newline-separated string):
 *   "bulletpoints": ["bp1", "bp2"] | "bp1\nbp2",
 *   // For description suggestions:
 *   "description": "Current description string",
 *   // For backend keywords suggestions (optional, will fetch from DB if not provided):
 *   "backendKeywords": "current keywords string"
 * }
 *
 * Response (data field contains only the new content):
 * For titles: { "titles": ["Title 1", "Title 2", "Title 3"] }
 * For bulletpoints: { "bulletpoints": ["Bullet 1", "Bullet 2", ...] }
 * For description: { "description": "New description..." }
 * For generic_keyword: { "keywords": "optimized keywords", "errorType": "duplicate|too_long|too_short", "byteLength": 245 }
 */
const generateRankingContent = asyncHandler(async (req, res) => {
  const { asin, attribute, title, bulletpoints, description, backendKeywords } = req.body;

  const suggestion = await generateRankingContentSuggestion({
    asin,
    attribute,
    title,
    bulletpoints,
    description,
    backendKeywords,
    userId: req.userId,
    country: req.country,
    region: req.region
  });

  // Only send the suggested content back to the frontend
  const payload = {};
  if (suggestion.titles) payload.titles = suggestion.titles;
  if (suggestion.title && !payload.titles) payload.title = suggestion.title;
  if (suggestion.bulletpoints) payload.bulletpoints = suggestion.bulletpoints;
  if (suggestion.description) payload.description = suggestion.description;
  if (suggestion.keywords !== undefined) {
    payload.keywords = suggestion.keywords;
    payload.errorType = suggestion.errorType;
    payload.byteLength = suggestion.byteLength;
    payload.originalKeywords = suggestion.originalKeywords;
  }

  return res.status(200).json(
    new ApiResponse(200, payload, 'AI suggestion generated successfully')
  );
});

module.exports = {
  generateRankingContent
};

