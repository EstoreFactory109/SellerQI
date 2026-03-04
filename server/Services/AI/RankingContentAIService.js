const OpenAI = require('openai');
const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const {
  checkTitle,
  checkBulletPoints,
  checkDescription,
  BackendKeyWordOrAttributesStatus
} = require('../Calculations/Rankings.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const { getListingItemsData } = require('../products/ListingItemsService.js');

// ─── Exact copy from server/Services/Calculations/Rankings.js (do not summarize) ───
// Special characters: regex /[!$?_{}^¬¦~#<>*]/g
const RANKING_SPECIAL_CHARS = '! $ ? _ { } ^ ¬ ¦ ~ # < > *';

// Restricted words list: exact order and spelling from containsRestrictedWords() in Rankings.js
const RANKING_RESTRICTED_WORDS = [
  'cure', 'treat', 'diagnose', 'prevent', 'mitigate', 'covid-19', 'coronavirus', 'pandemic',
  'cancer', 'diabetes', 'hiv', 'arthritis', 'asthma', "alzheimer's", 'fda-approved', 'clinically proven',
  'doctor recommended', 'anti-bacterial', 'anti-fungal', 'antimicrobial', 'antiviral', 'infection',
  'virus', 'germs', 'bacteria', 'detoxify', 'detox', 'cleanse', 'sanitizes', 'disinfects', 'sterilizes',
  'kills germs', 'cbd', 'cannabinoid', 'thc', 'hemp oil', 'marijuana', 'full spectrum', 'delta-8',
  'delta-9', 'cocaine', 'opioid', 'methamphetamine', 'bong', 'one hitter', 'dab rig', 'weed',
  'picamilon', 'phenibut', 'dmt', 'ayahuasca', 'clenbuterol', 'ephedrine', 'minoxidil',
  'guarantee', 'guaranteed', '100% guaranteed', "best seller", "amazon's choice", "amazon's favorite",
  'works better than', 'fastest shipping', 'instant fix', 'magic solution', 'free shipping',
  '100% quality guaranteed', 'sale', 'discount', 'promo', 'deal', 'today only', 'limited time',
  'last chance', 'buy with confidence', 'unlike other brands', 'certified', 'tested', 'approved',
  'validated', 'epa registered', 'non-toxic', 'hypoallergenic', 'kills 99.9% of germs', 'bpa-free',
  'lead-free', 'eco-friendly', 'biodegradable', 'fda-registered facility', 'kills', 'eliminates',
  'destroys', 'repels', 'repellent', 'pesticide', 'insecticide', 'fungicide', 'mold', 'mildew remover',
  'germ-free', 'brightening', 'whitening', 'lightening', 'anti-aging', 'wrinkle-free', 'removes wrinkles',
  'permanent results', 'antimicrobial', 'antibacterial', 'antifungal', 'sanitize', 'disinfect',
  'sterilizes', 'heal', 'antiseptic', 'germ', 'fungal', 'insecticide', 'pesticides', 'repel',
  'repelling', 'viruses', 'detoxification', 'treatment', 'fungus', 'contaminants', 'compostable',
  'decomposable', 'proven', 'recommended', 'viruses', 'fungicides', 'toxin', 'toxins', 'viral',
  'remedy', 'remedies', 'diseases', 'fda approved', 'covid', 'toxic', 'mildew', 'mould', 'spores',
  'n95', 'kn95', 'cystic fibrosis', 'sanitize', 'weight loss', 'chlamydia', 'hepatitis', 'hiv',
  'aids', 'mononucleosis', 'mono', 'pelvic inflammatory', 'scabies', 'trichomoniasis', 'liver',
  'multiple sclerosis', 'kidney', "alzheimer's", 'dementia', 'stroke', "parkinson's", 'parkinson',
  'flu', 'influenza', 'meningitis', 'glaucoma', 'cataract', 'adhd', 'concussion', 'tumor',
  'depression', 'lupus', 'muscular dystrophy', 'als', 'anxiety', 'stress', 'clenbuterol',
  'ephedrine', 'kratom', 'psilocybin', 'syphilis', 'gonorrhea', 'gout', "crohn's", 'celiac',
  'epilepsy', 'seizures', 'seizure', 'obesity', 'autism',
  'covid19', 'covid 19', 'delta8', 'delta 8', 'delta9', 'delta 9',
  'nontoxic', 'non toxic', 'bpafree', 'bpa free', 'leadfree', 'lead free',
  'ecofriendly', 'eco friendly', 'germfree', 'germ free', 'antiaging', 'anti aging',
  'wrinklefree', 'wrinkle free', 'fda registered facility', 'anti microbial', 'anti fungal', 'anti bacterial'
];

const RESTRICTED_WORDS_FOR_PROMPT = RANKING_RESTRICTED_WORDS.join(', ');

let openaiClient = null;

function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAPI_KEY;
  if (!apiKey) {
    logger.error('[RankingContentAI] OPENAPI_KEY is not set in environment variables');
    throw new ApiError(500, 'AI configuration error: OPENAPI_KEY is missing');
  }

  try {
    openaiClient = new OpenAI({ apiKey });
    return openaiClient;
  } catch (err) {
    logger.error('[RankingContentAI] Failed to initialize OpenAI client', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to initialize AI client');
  }
}

/**
 * Normalize bullet points input into a clean array of strings.
 * Accepts array of strings or single newline-separated string.
 */
function normalizeBulletPointsInput(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(b => String(b || '').trim()).filter(Boolean);
  }
  return String(input)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Fetch current listing content from NumberOfProductReviews model.
 * Uses the most recent document for a given user + country + region + asin.
 * This is used when the frontend does not send title/bulletpoints/description.
 */
async function getListingContentFromReviewsModel({ userId, asin, country, region }) {
  if (!userId || !asin) return null;

  try {
    const query = { User: userId, 'Products.asin': asin };
    if (country && region) {
      query.country = country;
      query.region = region;
    }
    const doc = await NumberOfProductReviews
      .findOne(query)
      .sort({ createdAt: -1 })
      .lean();

    if (!doc || !Array.isArray(doc.Products)) return null;

    const product = doc.Products.find(p => p.asin === asin);
    if (!product) return null;

    const title = product.product_title || null;
    const bulletpoints = Array.isArray(product.about_product)
      ? product.about_product.filter(Boolean)
      : [];
    const description = Array.isArray(product.product_description)
      ? product.product_description.filter(Boolean).join(' ')
      : (product.product_description || '');

    return { title, bulletpoints, description };
  } catch (err) {
    logger.warn('[RankingContentAI] Failed to read NumberOfProductReviewsModel', {
      asin,
      userId,
      country,
      region,
      message: err.message
    });
    return null;
  }
}

/**
 * Fetch current backend keywords from ListingItems using the service layer.
 * The service handles both old format (embedded array) and new format (separate collection).
 */
async function getBackendKeywordsFromListingItems({ userId, asin, country, region }) {
  if (!userId || !asin) {
    logger.warn('[RankingContentAI] getBackendKeywordsFromListingItems called without userId or asin', { userId, asin });
    return null;
  }

  try {
    logger.info('[RankingContentAI] Fetching ListingItems via service', {
      userId,
      asin,
      country,
      region
    });

    // Use the service which handles both old and new storage formats
    const listingItemsData = await getListingItemsData(userId, country, region);

    if (!listingItemsData) {
      logger.info('[RankingContentAI] No ListingItems data found via service', { asin, userId, country, region });
      return null;
    }
    
    if (!Array.isArray(listingItemsData.GenericKeyword)) {
      logger.info('[RankingContentAI] ListingItems data has no GenericKeyword array', { asin, userId });
      return null;
    }
    
    logger.info('[RankingContentAI] Found ListingItems data via service', {
      asin,
      userId,
      genericKeywordCount: listingItemsData.GenericKeyword.length,
      asinsInDoc: listingItemsData.GenericKeyword.slice(0, 5).map(k => k.asin).join(', ') + 
        (listingItemsData.GenericKeyword.length > 5 ? '...' : '')
    });

    // Find the keyword entry for the specific ASIN
    const keywordEntry = listingItemsData.GenericKeyword.find(k => k.asin === asin);
    if (!keywordEntry) {
      logger.info('[RankingContentAI] No matching ASIN in GenericKeyword array', { 
        asin,
        availableAsins: listingItemsData.GenericKeyword.slice(0, 10).map(k => k.asin)
      });
      return null;
    }
    
    if (!keywordEntry.value) {
      logger.info('[RankingContentAI] Keyword entry has no value', { asin, keywordEntry });
      return null;
    }
    
    logger.info('[RankingContentAI] Found backend keywords', {
      asin,
      valueLength: keywordEntry.value.length,
      preview: keywordEntry.value.substring(0, 100)
    });

    return keywordEntry.value;
  } catch (err) {
    logger.error('[RankingContentAI] Failed to read ListingItems for backend keywords', {
      asin,
      userId,
      country,
      region,
      message: err.message,
      stack: err.stack
    });
    return null;
  }
}

/**
 * Determine the specific error type for backend keywords.
 * Returns: 'duplicate' | 'too_long' | 'too_short' | null
 */
function determineBackendKeywordsErrorType(keywords) {
  if (!keywords || typeof keywords !== 'string') return 'too_short';
  
  const validation = BackendKeyWordOrAttributesStatus(keywords);
  
  if (validation?.dublicateWords?.status === 'Error') {
    return 'duplicate';
  }
  if (validation?.charLim?.status === 'Error') {
    const byteLength = new TextEncoder().encode(keywords).length;
    if (byteLength > 250) return 'too_long';
  }
  if (validation?.charLim?.status === 'Warning' || validation?.charLim?.status === 'Error') {
    const byteLength = new TextEncoder().encode(keywords).length;
    if (byteLength < 200) return 'too_short';
  }
  return null;
}

/**
 * Remove duplicate words from a keyword string while preserving order.
 */
function removeDuplicateWords(str) {
  const words = str.toLowerCase().match(/\b\w+\b/g) || [];
  const seen = new Set();
  const result = [];
  
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      result.push(word);
    }
  }
  return result.join(' ');
}

/**
 * Clean and validate keywords output from AI.
 * - Removes any punctuation, commas, semicolons
 * - Ensures all lowercase
 * - Warns about potentially concatenated words (words > 15 chars that look like compounds)
 * - Splits obvious concatenations using common patterns
 */
function cleanKeywordsOutput(str, asin) {
  if (!str) return '';
  
  // Remove any quotes, commas, semicolons, periods, and other punctuation
  let cleaned = str
    .toLowerCase()
    .replace(/[",;:.!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split into words
  const words = cleaned.split(' ').filter(Boolean);
  const processedWords = [];
  const suspiciousWords = [];
  
  // Common suffixes/prefixes that indicate concatenation
  const commonSuffixes = ['socks', 'sock', 'wear', 'proof', 'free', 'resistant', 'control', 'wicking', 'length', 'cut', 'blend', 'fabric', 'footwear', 'accessories', 'holder', 'case', 'cover', 'bottle', 'mat', 'bag', 'box', 'pack', 'set'];
  const commonPrefixes = ['anti', 'non', 'quick', 'fast', 'multi', 'water', 'moisture', 'odor', 'sweat', 'breath', 'light', 'heavy', 'soft', 'hard', 'thick', 'thin', 'long', 'short', 'high', 'low', 'mens', 'women', 'kids', 'adult', 'gym', 'sport', 'athletic', 'casual', 'formal'];
  
  for (const word of words) {
    // If word is very long (>15 chars), it might be concatenated
    if (word.length > 15) {
      suspiciousWords.push(word);
      
      // Try to split on common patterns
      let split = false;
      for (const suffix of commonSuffixes) {
        if (word.endsWith(suffix) && word.length > suffix.length + 2) {
          const prefix = word.slice(0, -suffix.length);
          if (prefix.length >= 2) {
            processedWords.push(prefix, suffix);
            split = true;
            break;
          }
        }
      }
      
      if (!split) {
        for (const prefix of commonPrefixes) {
          if (word.startsWith(prefix) && word.length > prefix.length + 2) {
            const rest = word.slice(prefix.length);
            if (rest.length >= 2) {
              processedWords.push(prefix, rest);
              split = true;
              break;
            }
          }
        }
      }
      
      if (!split) {
        // Keep the word as-is but log warning
        processedWords.push(word);
      }
    } else {
      processedWords.push(word);
    }
  }
  
  if (suspiciousWords.length > 0) {
    logger.warn('[RankingContentAI] Detected potentially concatenated words in AI output', {
      asin,
      suspiciousWords,
      note: 'These words may be incorrectly merged. Consider checking AI prompts.'
    });
  }
  
  return processedWords.join(' ');
}

async function generateTitleSuggestion({ asin, currentTitle }) {
  if (!currentTitle || typeof currentTitle !== 'string') {
    throw new ApiError(400, 'Current title is required for title suggestions');
  }

  const client = getOpenAIClient();

  const systemPrompt = `
You are an expert Amazon listing copywriter. Your output must satisfy the EXACT ranking rules below; any violation will cause the title to be rejected.

=== TITLE RULES (every condition is mandatory) ===

1. CHARACTER LENGTH
   - The product title MUST be at least 80 characters and at most 200 characters.
   - Under 80 characters is an error: "The product title is under 80 characters, which can limit its visibility and effectiveness in search results."
   - Extend to between 80 and 200 characters; include brand, size, color, and unique features.

2. RESTRICTED WORDS (banned entirely; word-boundary match, case-insensitive)
   You must NOT use any of these words or phrases in the title:
   ${RESTRICTED_WORDS_FOR_PROMPT}

3. SPECIAL CHARACTERS (prohibited)
   Do NOT use any of these characters in the title: ${RANKING_SPECIAL_CHARS}
   (These characters violate Amazon's guidelines and can lead to listing suppression.)

4. ADDITIONAL
   - Keep the brand name at the start if it exists in the current title.
   - Keep the same product type and key attributes (size, color, pack size); improve clarity and keyword coverage.
   - Do NOT mention discounts, promotions, time-limited offers, or compare to other brands.

CRITICAL — COMMON REJECTIONS: Do NOT use "non-toxic", "toxic", "hypoallergenic", "eco-friendly", "bpa-free", "lead-free", "guarantee/guaranteed", "safe/safety" in a way that implies certification. If the current title uses any restricted word (e.g. "Non-Toxic Adhesive"), rephrase without it (e.g. "adhesive", "child-safe adhesive", or describe the material instead). Every word in the RESTRICTED WORDS list above is banned; do not use any of them in any form.

Return a JSON object with a single array field "titles" containing exactly three title strings, e.g. { "titles": ["title 1", "title 2", "title 3"] }.
`;

  const userPrompt = `
ASIN: ${asin}
Current title:
${currentTitle}

Generate three improved titles that obey all rules.
`;

  function extractRestrictedWordsFromValidation(validation) {
    const msg = validation?.RestictedWords?.Message || '';
    const match = msg.match(/(?:Characters|words) used are:\s*(.+?)(?:\.|$)/i);
    if (!match) return [];
    return match[1].split(',').map(s => s.trim()).filter(Boolean);
  }

  function runTitleGeneration(messages) {
    return client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages
    }).then(c => c.choices?.[0]?.message?.content || '{}');
  }

  let raw;
  try {
    raw = await runTitleGeneration([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (title)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI title suggestions');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error('[RankingContentAI] Failed to parse title JSON', {
      raw: raw?.slice(0, 300),
      message: err.message
    });
    throw new ApiError(500, 'Invalid AI response format for titles');
  }

  let titles = Array.isArray(parsed.titles) ? parsed.titles : [];
  let cleanTitles = titles
    .map(t => String(t || '').trim())
    .filter(Boolean);

  if (!cleanTitles.length) {
    throw new ApiError(500, 'AI did not return any title suggestions');
  }

  // Validate each candidate; collect validation errors for retry
  let validTitles = [];
  const rejectedWords = new Set();
  for (const t of cleanTitles) {
    const validation = checkTitle(t);
    if (!validation || validation.NumberOfErrors === 0) {
      validTitles.push(t);
    } else {
      logger.warn('[RankingContentAI] Discarding non-compliant title', {
        asin,
        title: t,
        errors: validation
      });
      extractRestrictedWordsFromValidation(validation).forEach(w => rejectedWords.add(w));
    }
  }

  // If all failed and we have specific restricted words, retry once with that feedback
  if (validTitles.length === 0 && rejectedWords.size > 0) {
    const avoidList = [...rejectedWords].join(', ');
    const retryUserPrompt = `
ASIN: ${asin}
Current title:
${currentTitle}

Your previous suggestions were REJECTED because they contained these restricted words (do not use them in any form): ${avoidList}.
Generate exactly 3 NEW alternative titles that:
- Are 80–200 characters.
- Do NOT contain any of: ${avoidList}.
- Do NOT use "non-toxic", "toxic", "hypoallergenic", "eco-friendly", "bpa-free", "lead-free", or any other word from the full restricted list.
- Use neutral phrasing (e.g. "adhesive", "child-safe adhesive", material names) instead of restricted claims.
`;
    try {
      raw = await runTitleGeneration([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'user', content: retryUserPrompt }
      ]);
      parsed = JSON.parse(raw);
      titles = Array.isArray(parsed.titles) ? parsed.titles : [];
      cleanTitles = titles.map(t => String(t || '').trim()).filter(Boolean);
      validTitles = [];
      for (const t of cleanTitles) {
        const validation = checkTitle(t);
        if (!validation || validation.NumberOfErrors === 0) {
          validTitles.push(t);
        } else {
          logger.warn('[RankingContentAI] Discarding non-compliant title (retry)', {
            asin,
            title: t,
            errors: validation
          });
        }
      }
    } catch (retryErr) {
      logger.warn('[RankingContentAI] Retry failed for title suggestions', {
        asin,
        message: retryErr.message
      });
    }
  }

  if (!validTitles.length) {
    throw new ApiError(
      422,
      'AI could not generate compliant titles. Please try refining your current title manually.'
    );
  }

  return validTitles.slice(0, 3);
}

async function generateBulletPointsSuggestion({ asin, currentBulletPoints, productTitle }) {
  const bulletsArray = normalizeBulletPointsInput(currentBulletPoints);
  const hasTitle = productTitle && typeof productTitle === 'string' && productTitle.trim();
  if (!bulletsArray.length && !hasTitle) {
    throw new ApiError(400, 'Current bullet points or product title is required. Add bullet points above or ensure product data is synced.');
  }

  const client = getOpenAIClient();

  const systemPrompt = `
You are an expert Amazon listing copywriter. Your output must satisfy the EXACT ranking rules below; any violation will cause the bullet points to be rejected.

=== BULLET POINT RULES (every condition is mandatory) ===

1. COUNT AND LENGTH
   - Return exactly 5 bullet points.
   - Each bullet point MUST be at least 150 characters long.
   - Under 150 characters per bullet is an error: "Your bullet points are under 150 characters. Short bullet points may not provide enough detail to effectively communicate the features and benefits."

2. RESTRICTED WORDS (banned entirely; word-boundary match, case-insensitive)
   You must NOT use any of these words or phrases in any bullet:
   ${RESTRICTED_WORDS_FOR_PROMPT}

3. SPECIAL CHARACTERS (prohibited)
   Do NOT use any of these characters in any bullet: ${RANKING_SPECIAL_CHARS}
   (Using these characters can lead to listing compliance issues and may prevent proper display.)

4. ADDITIONAL
   - Do NOT mention discounts, promotions, time-limited offers, or compare to other brands.
   - Focus on clear benefits, features, and use cases; articulate why customers should choose the product.

Return a JSON object containing the 5 bullet points as an array of strings, e.g. { "bullet_points": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"] }.
`;

  const userPrompt = bulletsArray.length
    ? `
ASIN: ${asin}
Current bullet points:
- ${bulletsArray.join('\n- ')}

Rewrite into 5 optimized, compliant bullet points.
`
    : `
ASIN: ${asin}
Product title: ${productTitle.trim()}

Generate 5 new bullet points for this product based on the title above. Each bullet must be at least 150 characters and follow all rules (no restricted words, no prohibited special characters).
`;

  let raw;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    raw = completion.choices?.[0]?.message?.content || '{}';
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (bulletpoints)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI bullet point suggestions');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error('[RankingContentAI] Failed to parse bulletpoints JSON', {
      raw: raw?.slice(0, 300),
      message: err.message
    });
    throw new ApiError(500, 'Invalid AI response format for bullet points');
  }

  const suggested = Array.isArray(parsed.bullet_points || parsed.suggested_bullet_points)
    ? parsed.bullet_points || parsed.suggested_bullet_points
    : [];

  let cleanBullets = normalizeBulletPointsInput(suggested);
  if (!cleanBullets.length) {
    throw new ApiError(500, 'AI did not return bullet point suggestions');
  }

  // Validate against ranking rules (expects array of strings)
  let validation = checkBulletPoints(cleanBullets);
  
  // If validation fails, try once more with explicit feedback about the errors
  if (validation?.NumberOfErrors > 0) {
    logger.warn('[RankingContentAI] Generated bullet points have ranking errors, retrying', {
      asin,
      errors: validation
    });

    // Extract problematic words from the error message
    const restrictedWordsMatch = validation?.RestictedWords?.Message?.match(/The words Used are:\s*(.+)/i);
    const problematicWords = restrictedWordsMatch ? restrictedWordsMatch[1] : '';

    const retryPrompt = `
The previous bullet points were REJECTED because they violated these rules:
${validation?.charLim?.status === 'Error' ? `- CHARACTER LIMIT: ${validation.charLim.Message}` : ''}
${validation?.RestictedWords?.status === 'Error' ? `- RESTRICTED WORDS: ${validation.RestictedWords.Message}` : ''}
${validation?.checkSpecialCharacters?.status === 'Error' ? `- SPECIAL CHARACTERS: ${validation.checkSpecialCharacters.Message}` : ''}

${problematicWords ? `CRITICAL: Do NOT use these words: ${problematicWords}` : ''}

Generate 5 NEW bullet points that strictly avoid ALL restricted words including: prevent, prevents, preventing, guaranteed, guarantee, cure, cures, heal, heals, safe, safer, safest, hypoallergenic, non-toxic, toxic, eco-friendly, bpa-free, lead-free.

Use alternative phrasing:
- Instead of "prevent" use "help reduce", "minimize", "protect against"
- Instead of "guaranteed" use "designed to", "built to"
- Instead of "safe" use "designed for", "suitable for"

Each bullet must be at least 150 characters. Return JSON: { "bullet_points": ["bullet1", "bullet2", "bullet3", "bullet4", "bullet5"] }
`;

    try {
      const retryCompletion = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: raw },
          { role: 'user', content: retryPrompt }
        ]
      });

      const retryRaw = retryCompletion.choices?.[0]?.message?.content || '{}';
      const retryParsed = JSON.parse(retryRaw);
      const retrySuggested = Array.isArray(retryParsed.bullet_points || retryParsed.suggested_bullet_points)
        ? retryParsed.bullet_points || retryParsed.suggested_bullet_points
        : [];
      
      const retryCleanBullets = normalizeBulletPointsInput(retrySuggested);
      if (retryCleanBullets.length > 0) {
        const retryValidation = checkBulletPoints(retryCleanBullets);
        if (!retryValidation || retryValidation.NumberOfErrors === 0) {
          logger.info('[RankingContentAI] Retry successful for bullet points', { asin });
          return retryCleanBullets;
        } else {
          logger.warn('[RankingContentAI] Retry bullet points still have errors', {
            asin,
            errors: retryValidation
          });
          // Fall through to return original bullets with warning
        }
      }
    } catch (retryErr) {
      logger.warn('[RankingContentAI] Retry failed for bullet points', {
        asin,
        message: retryErr.message
      });
    }

    // If retry also failed, throw the error
    throw new ApiError(
      422,
      'AI could not generate compliant bullet points. Please try refining your current bullets manually.'
    );
  }

  return cleanBullets;
}

async function generateDescriptionSuggestion({ asin, currentDescription }) {
  if (!currentDescription || typeof currentDescription !== 'string') {
    throw new ApiError(400, 'Current description is required for description suggestions');
  }

  const client = getOpenAIClient();

  const systemPrompt = `
You are an expert Amazon listing copywriter. Your output must satisfy the EXACT ranking rules below; any violation will cause the description to be rejected.

=== DESCRIPTION RULES (every condition is mandatory) ===

1. CHARACTER LENGTH
   - The product description MUST be at least 1700 characters.
   - Under 1700 characters is an error: "Your product description is under 1700 characters. This may not provide enough information to fully educate potential buyers."
   - Expand to at least 1700 characters; include benefits, use cases, unique features, proper formatting and keywords.

2. RESTRICTED WORDS (banned entirely; word-boundary match, case-insensitive)
   You must NOT use any of these words or phrases in the description:
   ${RESTRICTED_WORDS_FOR_PROMPT}

3. SPECIAL CHARACTERS (prohibited)
   Do NOT use any of these characters in the description: ${RANKING_SPECIAL_CHARS}
   (Restricted special characters must be removed to meet Amazon's formatting guidelines.)

4. ADDITIONAL
   - Do NOT mention discounts, promotions, time-limited offers, or compare to other brands.
   - Use clear paragraphs and natural language suitable for Amazon product descriptions.

Return ONLY the new description as raw text: no quotes, no JSON wrapper, no commentary. The response must be the description text itself, at least 1700 characters long.
`;

  const userPrompt = `
ASIN: ${asin}
Current description:
${currentDescription}

Write a single improved description that obeys all rules.
`;

  let suggestedDescription;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    suggestedDescription =
      completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (description)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI description suggestion');
  }

  if (!suggestedDescription) {
    throw new ApiError(500, 'AI did not return a description suggestion');
  }

  // Validate against ranking rules (expects array of strings)
  const validation = checkDescription([suggestedDescription]);
  if (validation?.NumberOfErrors > 0) {
    logger.warn('[RankingContentAI] Generated description still has ranking errors', {
      asin,
      errors: validation
    });
    throw new ApiError(
      422,
      'AI could not generate a compliant description. Please try refining your current description manually.'
    );
  }

  return suggestedDescription;
}

/**
 * Generate backend keyword suggestions based on the error type.
 * 
 * Logic:
 * - If keywords EXIST → MODIFY the existing keywords based on error type
 *   - 'duplicate': Remove duplicates, then add more if still too short
 *   - 'too_long': Prioritize and trim to fit under 250 bytes
 *   - 'too_short': Add more keywords to reach 200+ bytes
 * - If NO keywords exist → GENERATE a complete fresh list of keywords
 */
async function generateBackendKeywordsSuggestion({
  asin,
  currentKeywords,
  errorType,
  productTitle,
  bulletpoints,
  description
}) {
  const client = getOpenAIClient();
  
  const currentKw = (currentKeywords || '').trim();
  const hasExistingKeywords = currentKw.length > 0;
  const currentByteLength = new TextEncoder().encode(currentKw).length;
  
  // If NO keywords exist → generate a complete fresh list
  if (!hasExistingKeywords) {
    logger.info('[RankingContentAI] No existing keywords, generating fresh keyword list', { asin });
    return await generateFreshKeywords({
      asin,
      targetBytes: 200,
      maxBytes: 249,
      productTitle,
      bulletpoints,
      description,
      client
    });
  }
  
  // Keywords EXIST → modify based on error type
  if (errorType === 'duplicate') {
    const deduped = removeDuplicateWords(currentKw);
    const dedupedByteLen = new TextEncoder().encode(deduped).length;
    
    // After removing duplicates, check if still too short
    if (dedupedByteLen < 200) {
      logger.info('[RankingContentAI] Duplicates removed but still too short, adding more keywords', {
        asin,
        originalBytes: currentByteLength,
        dedupedBytes: dedupedByteLen
      });
      return await modifyAndExpandKeywords({
        asin,
        baseKeywords: deduped,
        targetBytes: 200,
        maxBytes: 249,
        productTitle,
        bulletpoints,
        description,
        client
      });
    }
    
    // After removing duplicates, check if too long
    if (dedupedByteLen > 249) {
      logger.info('[RankingContentAI] Duplicates removed but still too long, trimming', {
        asin,
        dedupedBytes: dedupedByteLen
      });
      return await prioritizeAndTrimKeywords({
        asin,
        currentKeywords: deduped,
        maxBytes: 249,
        productTitle,
        bulletpoints,
        description,
        client
      });
    }
    
    const validation = BackendKeyWordOrAttributesStatus(deduped);
    if (validation?.NumberOfErrors > 0) {
      logger.warn('[RankingContentAI] Deduplicated keywords still have errors', {
        asin,
        errors: validation
      });
    }
    
    return deduped;
  }
  
  if (errorType === 'too_long') {
    return await prioritizeAndTrimKeywords({
      asin,
      currentKeywords: currentKw,
      maxBytes: 249,
      productTitle,
      bulletpoints,
      description,
      client
    });
  }
  
  if (errorType === 'too_short' || errorType === 'optimize') {
    // For 'too_short': expand to reach 200+ bytes
    // For 'optimize': expand valid keywords to better utilize the 250 byte limit
    logger.info('[RankingContentAI] Expanding keywords', {
      asin,
      errorType,
      currentByteLength
    });
    return await modifyAndExpandKeywords({
      asin,
      baseKeywords: currentKw,
      targetBytes: errorType === 'optimize' ? 240 : 200,
      maxBytes: 249,
      productTitle,
      bulletpoints,
      description,
      client
    });
  }
  
  throw new ApiError(400, `Unknown error type for backend keywords: ${errorType}`);
}

/**
 * Prioritize and trim keywords to fit under maxBytes.
 * Uses AI to determine which keywords are most relevant.
 */
async function prioritizeAndTrimKeywords({
  asin,
  currentKeywords,
  maxBytes,
  productTitle,
  bulletpoints,
  description,
  client
}) {
  const currentBytes = new TextEncoder().encode(currentKeywords).length;
  const bytesToRemove = currentBytes - maxBytes;

  const systemPrompt = `
You are an Amazon backend search terms optimization expert. Your task is to TRIM and PRIORITIZE an overly long keyword list by removing low-value words.

=== CRITICAL FORMAT RULES ===

1. INDIVIDUAL WORDS ONLY - NEVER CONCATENATE
   - Each keyword must be a SINGLE word separated by spaces
   - WRONG: "mensocks anklelength cottonblend"
   - CORRECT: "mens socks ankle length cotton blend"
   - Keep words as they are in the input - do not merge them

2. SPACE-SEPARATED WORDS
   - Every word must be separated by a single space
   - No compound words, no concatenation, no hyphens

3. LOWERCASE ONLY
   - All words must be lowercase
   - No capital letters, no punctuation, no special characters

=== TRIMMING RULES ===

4. BYTE LENGTH LIMIT
   - The final keyword string MUST be 249 bytes or less (Amazon's limit is 250)
   - Current keywords are ${currentBytes} bytes - you need to remove approximately ${bytesToRemove} bytes
   - Remove low-value, redundant, or overly specific terms to fit

5. NO DUPLICATE WORDS
   - Each word should appear only ONCE
   - If a word appears multiple times, keep only the first occurrence

6. PRIORITIZATION STRATEGY - WHAT TO REMOVE
   - REMOVE: Words that appear in the title, bullet points, or description (already indexed by Amazon)
   - REMOVE: Brand names (already in the listing)
   - REMOVE: Very generic words with low search intent (e.g., "product", "item", "thing", "good", "best")
   - REMOVE: Redundant synonyms if you have too many (keep the most searched version)
   - KEEP: High-search-volume keywords
   - KEEP: Specific product attributes and features
   - KEEP: Synonyms and alternate spellings not used elsewhere in listing

=== EXAMPLES ===

Example 1 - Trimming socks keywords (needs to reduce from 280 to 249 bytes):
INPUT: "running hiking cycling warm cozy crew sport soft compression athletic cushion sock thick gym tube winter adult performance mid lightweight odor free boys resistant trainer sneaker casual dress formal boot sandal thermal merino"
GOOD OUTPUT: "hiking cycling warm cozy crew sport soft compression athletic cushion thick gym tube winter adult performance mid lightweight odor free boys resistant trainer sneaker casual dress formal thermal merino"
(Removed: "running" - likely in title, "sock" - likely in title, "boot sandal" - less relevant to socks)

Example 2 - Trimming phone case keywords:
INPUT: "protective cover slim fit clear transparent shell bumper armor defender rugged military drop shock proof resistant matte glossy silicone rubber tpu polycarbonate hard soft flexible premium quality best seller"
GOOD OUTPUT: "protective slim fit clear transparent shell bumper armor defender rugged military drop shock proof resistant matte glossy silicone rubber tpu polycarbonate hard soft flexible"
(Removed: "cover" - generic, "premium quality best seller" - promotional/generic terms)

=== OUTPUT FORMAT ===

Return ONLY the trimmed keywords as a single line of space-separated individual words.
No quotes, no JSON, no explanation, no numbering.
Keep words exactly as they appear (individual, space-separated) - do NOT concatenate them.
`;

  const bulletsText = Array.isArray(bulletpoints) 
    ? bulletpoints.filter(Boolean).join(' ') 
    : (bulletpoints || '');
  
  const userPrompt = `
ASIN: ${asin}

Current backend keywords (${currentBytes} bytes, exceeds 250-byte limit, need to reduce by ~${bytesToRemove} bytes):
${currentKeywords}

Product title: ${productTitle || 'N/A'}
Bullet points: ${bulletsText || 'N/A'}
Description: ${(description || '').substring(0, 500)}${(description || '').length > 500 ? '...' : ''}

Trim these keywords to fit within 249 bytes. Remove low-value words while keeping high-search-volume terms.

REMEMBER:
- Keep words SEPARATE (spaces between words)
- Do NOT concatenate words together
- Output should look like: "word1 word2 word3 word4" (NOT "word1word2 word3word4")
`;

  let suggestion;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
    suggestion = completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (trim keywords)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI backend keyword suggestions');
  }

  if (!suggestion) {
    throw new ApiError(500, 'AI did not return a keyword suggestion');
  }

  // Clean the AI output (removes punctuation, warns about concatenated words)
  suggestion = cleanKeywordsOutput(suggestion, asin);

  const suggestionBytes = new TextEncoder().encode(suggestion).length;
  if (suggestionBytes > maxBytes) {
    const words = suggestion.split(/\s+/).filter(Boolean);
    let trimmed = '';
    for (const word of words) {
      const test = trimmed ? `${trimmed} ${word}` : word;
      if (new TextEncoder().encode(test).length <= maxBytes) {
        trimmed = test;
      } else {
        break;
      }
    }
    suggestion = trimmed;
  }

  const validation = BackendKeyWordOrAttributesStatus(suggestion);
  if (validation?.NumberOfErrors > 0) {
    logger.warn('[RankingContentAI] Trimmed keywords still have errors', {
      asin,
      bytes: new TextEncoder().encode(suggestion).length,
      errors: validation
    });
  }

  return suggestion;
}

/**
 * Modify existing keywords by adding more to reach the target byte range.
 * Used when keywords exist but are too short.
 * 
 * IMPORTANT: We programmatically preserve existing keywords by:
 * 1. Asking AI to generate ONLY new keywords to add
 * 2. Prepending the original keywords ourselves
 */
async function modifyAndExpandKeywords({
  asin,
  baseKeywords,
  targetBytes,
  maxBytes,
  productTitle,
  bulletpoints,
  description,
  client
}) {
  const currentBytes = new TextEncoder().encode(baseKeywords).length;
  const availableBytes = maxBytes - currentBytes - 1; // -1 for space separator
  const needsBytes = Math.max(0, targetBytes - currentBytes);

  // Get existing words to tell AI what NOT to repeat
  const existingWords = new Set(baseKeywords.toLowerCase().split(/\s+/).filter(Boolean));
  const existingWordsList = [...existingWords].join(', ');

  const systemPrompt = `
You are an Amazon backend search terms optimization expert. Your task is to generate ONLY NEW individual keywords to ADD to an existing keyword list.

=== CRITICAL FORMAT RULES ===

1. INDIVIDUAL WORDS ONLY - NEVER CONCATENATE
   - Each keyword must be a SINGLE word separated by spaces
   - WRONG: "mensocks anklelength cottonblend breathablefootwear"
   - CORRECT: "mens socks ankle length cotton blend breathable footwear"
   - WRONG: "quickdry moisturecontrol"
   - CORRECT: "quick dry moisture control"
   - WRONG: "gymwear sportsaccessories"
   - CORRECT: "gym wear sports accessories"

2. SPACE-SEPARATED WORDS
   - Every word must be separated by a single space
   - No compound words, no concatenation, no hyphens
   - Example output: "trainer sneaker casual dress formal boot sandal slipper"

3. LOWERCASE ONLY
   - All words must be lowercase
   - No capital letters, no punctuation, no special characters

=== CONTENT RULES ===

4. GENERATE ONLY NEW KEYWORDS
   - Do NOT include any words from the existing keyword list
   - Return ONLY the NEW keywords to be added
   - Generate approximately ${needsBytes} to ${availableBytes} bytes of new keywords

5. NO DUPLICATE WORDS
   - Do NOT repeat any word from the existing list: ${existingWordsList}
   - Each new word should appear only ONCE

6. GENERATION STRATEGY
   - Generate synonyms (e.g., "sock" → "hosiery footwear stocking")
   - Alternate spellings (e.g., "grey" vs "gray")
   - Related terms (e.g., for socks: "ankle crew quarter knee calf")
   - Common search queries buyers might use
   - Do NOT include words already in the title, bullet points, or description
   - Include common misspellings if frequently searched
   - Include related categories and use cases

=== EXAMPLES ===

Example 1 - Socks product:
EXISTING: "running hiking cycling warm cozy crew sport soft compression athletic cushion"
GOOD NEW KEYWORDS: "trainer sneaker casual dress formal boot sandal thermal merino wool bamboo cotton nylon spandex ribbed seamless arch support blister"
BAD NEW KEYWORDS: "runnersocks hikingsocks cyclingwear warmfootwear" (WRONG - concatenated words)

Example 2 - Phone case:
EXISTING: "protective cover slim fit clear transparent"
GOOD NEW KEYWORDS: "shell bumper armor defender rugged military drop shock proof resistant matte glossy silicone rubber tpu polycarbonate hard"
BAD NEW KEYWORDS: "phoneprotector casecover slimdesign clearcase" (WRONG - concatenated words)

Example 3 - Water bottle:
EXISTING: "insulated stainless steel vacuum flask"
GOOD NEW KEYWORDS: "tumbler mug cup thermos canteen jug container hydration reusable eco bpa leakproof spill portable travel gym office school"
BAD NEW KEYWORDS: "waterbottle steelbottle vacuumflask insulatedcontainer" (WRONG - concatenated words)

=== OUTPUT FORMAT ===

Return ONLY the new keywords as a single line of space-separated individual words.
No quotes, no JSON, no explanation, no numbering.
Do NOT include any existing keywords.
`;

  const bulletsText = Array.isArray(bulletpoints) 
    ? bulletpoints.filter(Boolean).join(' ') 
    : (bulletpoints || '');

  const userPrompt = `
ASIN: ${asin}

EXISTING backend keywords (DO NOT include these in your response):
${baseKeywords}

Product title: ${productTitle || 'N/A'}
Bullet points: ${bulletsText || 'N/A'}
Description: ${(description || '').substring(0, 500)}${(description || '').length > 500 ? '...' : ''}

Generate ONLY NEW individual keywords (approximately ${needsBytes}-${availableBytes} bytes) to add to the existing list.

REMEMBER:
- Each word must be SEPARATE (spaces between words)
- WRONG: "quickdry moisturewicking" 
- CORRECT: "quick dry moisture wicking"
- Do NOT repeat any existing keywords
`;

  let newKeywords;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
    newKeywords = completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (expand keywords)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI backend keyword suggestions');
  }

  if (!newKeywords) {
    throw new ApiError(500, 'AI did not return new keyword suggestions');
  }

  // Clean the AI output (removes punctuation, warns about concatenated words)
  const cleanedNewKeywords = cleanKeywordsOutput(newKeywords, asin);

  // Remove any duplicates from new keywords and filter out existing words
  const newWordsArray = cleanedNewKeywords.split(/\s+/).filter(Boolean);
  const uniqueNewWords = [];
  const seenNew = new Set();
  for (const word of newWordsArray) {
    if (!existingWords.has(word) && !seenNew.has(word)) {
      seenNew.add(word);
      uniqueNewWords.push(word);
    }
  }

  // Programmatically combine: existing keywords + new keywords
  let finalKeywords = baseKeywords;
  for (const word of uniqueNewWords) {
    const test = `${finalKeywords} ${word}`;
    if (new TextEncoder().encode(test).length <= maxBytes) {
      finalKeywords = test;
    } else {
      break;
    }
  }

  // Final deduplication and validation
  finalKeywords = removeDuplicateWords(finalKeywords);

  const validation = BackendKeyWordOrAttributesStatus(finalKeywords);
  if (validation?.NumberOfErrors > 0) {
    logger.warn('[RankingContentAI] Expanded keywords have validation errors', {
      asin,
      bytes: new TextEncoder().encode(finalKeywords).length,
      errors: validation
    });
  }

  logger.info('[RankingContentAI] Keywords expanded successfully', {
    asin,
    originalBytes: currentBytes,
    finalBytes: new TextEncoder().encode(finalKeywords).length,
    newWordsAdded: uniqueNewWords.length
  });

  return finalKeywords;
}

/**
 * Generate a complete fresh list of keywords when no keywords exist.
 * Used when the product has no backend keywords at all.
 */
async function generateFreshKeywords({
  asin,
  targetBytes,
  maxBytes,
  productTitle,
  bulletpoints,
  description,
  client
}) {
  const systemPrompt = `
You are an Amazon backend search terms optimization expert. Your task is to GENERATE a complete fresh list of backend search keywords for a product that currently has NO keywords.

=== CRITICAL FORMAT RULES ===

1. INDIVIDUAL WORDS ONLY - NEVER CONCATENATE
   - Each keyword must be a SINGLE word separated by spaces
   - WRONG: "mensocks anklelength cottonblend breathablefootwear moisturecontrol"
   - CORRECT: "mens socks ankle length cotton blend breathable footwear moisture control"
   - WRONG: "quickdry gymwear sportsaccessories"
   - CORRECT: "quick dry gym wear sports accessories"
   - WRONG: "phoneholder carcharger wirelessearbuds"
   - CORRECT: "phone holder car charger wireless earbuds"

2. SPACE-SEPARATED WORDS
   - EVERY word must be separated by a SINGLE SPACE
   - No compound words, no concatenation, no hyphens, no underscores
   - Think of it as: one word, space, one word, space, one word...
   - Example: "blue red green large small medium" (NOT "bluered greensmall")

3. LOWERCASE ONLY
   - All words must be lowercase
   - No capital letters, no punctuation, no special characters
   - No commas, no semicolons, no periods

=== CONTENT RULES ===

4. BYTE LENGTH TARGET
   - The final keyword string should be between 200 and 249 bytes
   - Aim for around 220-240 bytes to maximize search coverage
   - Each character is typically 1 byte

5. NO DUPLICATE WORDS
   - Each word should appear only ONCE
   - Do not repeat any word

6. DO NOT INCLUDE WORDS ALREADY IN LISTING
   - Amazon already indexes words from title, bullet points, and description
   - Focus ONLY on words that are NOT in those sections
   - This includes synonyms, related terms, alternate spellings

7. GENERATION STRATEGY
   - Synonyms: Different words for the same thing (e.g., "couch" → "sofa loveseat settee")
   - Related terms: Associated products/concepts (e.g., for lamp: "lighting fixture bulb shade")
   - Alternate spellings: (e.g., "gray grey", "color colour")
   - Use cases: Where/when the product is used (e.g., "office home travel outdoor indoor")
   - Materials: What it's made of (e.g., "cotton polyester nylon leather plastic metal")
   - Target audience: Who uses it (e.g., "men women kids teens adults seniors")
   - Common misspellings: If frequently searched

=== EXAMPLES ===

Example 1 - Athletic Socks (title mentions "running socks for men"):
GOOD: "athletic crew ankle quarter knee high cushioned padded arch support moisture wicking breathable cotton polyester nylon spandex gym workout training jogging marathon trail sports fitness exercise casual dress formal"
BAD: "athleticsocks crewsocks anklesocks moisturewicking" (WRONG - words are concatenated)

Example 2 - Phone Case (title mentions "iPhone 14 Pro case"):
GOOD: "cover shell bumper armor protective slim thin clear transparent silicone rubber tpu hard soft flexible grip matte glossy shockproof drop proof military grade rugged defender wallet card holder magnetic"
BAD: "phonecase iphonecover protectivecase slimcase clearcase" (WRONG - words are concatenated)

Example 3 - Water Bottle (title mentions "32oz insulated water bottle"):
GOOD: "tumbler flask thermos canteen jug hydration container stainless steel vacuum double wall leak proof spill proof bpa free reusable eco friendly travel gym office school camping hiking sports fitness workout"
BAD: "waterbottle steelbottle insulatedbottle travelbottle" (WRONG - words are concatenated)

Example 4 - Yoga Mat:
GOOD: "exercise fitness pilates stretching meditation workout floor padding cushion non slip grip thick thin travel portable foldable lightweight dense foam rubber pvc eco friendly home gym studio beginner professional"
BAD: "yogamat exercisemat fitnessmat workoutmat" (WRONG - words are concatenated)

=== OUTPUT FORMAT ===

Return ONLY the keywords as a single line of space-separated individual words.
No quotes, no JSON, no explanation, no numbering, no bullet points.
Each word must be separate - do NOT concatenate or combine words.

CORRECT OUTPUT FORMAT: "word1 word2 word3 word4 word5 word6 word7"
WRONG OUTPUT FORMAT: "word1word2 word3word4 word5word6"
`;

  const bulletsText = Array.isArray(bulletpoints) 
    ? bulletpoints.filter(Boolean).join(' ') 
    : (bulletpoints || '');

  const userPrompt = `
ASIN: ${asin}
Current backend keywords: (NONE - generate fresh keywords)

Product title: ${productTitle || 'N/A'}
Bullet points: ${bulletsText || 'N/A'}
Description: ${(description || '').substring(0, 500)}${(description || '').length > 500 ? '...' : ''}

Generate a complete list of backend search keywords for this product, targeting 200-249 bytes total.

CRITICAL REMINDERS:
1. Each word must be SEPARATE with spaces between them
2. WRONG: "quickdry moisturewicking breathablefabric"
3. CORRECT: "quick dry moisture wicking breathable fabric"
4. Focus on terms NOT already in the title, bullets, or description
`;

  let suggestion;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
    suggestion = completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error('[RankingContentAI] OpenAI error (generate fresh keywords)', {
      message: err.message,
      stack: err.stack
    });
    throw new ApiError(500, 'Failed to generate AI backend keyword suggestions');
  }

  if (!suggestion) {
    throw new ApiError(500, 'AI did not return a keyword suggestion');
  }

  // Clean the AI output (removes punctuation, warns about concatenated words)
  const cleanedSuggestion = cleanKeywordsOutput(suggestion, asin);

  const finalDeduped = removeDuplicateWords(cleanedSuggestion);
  let finalKeywords = finalDeduped;
  
  const finalBytes = new TextEncoder().encode(finalKeywords).length;
  if (finalBytes > maxBytes) {
    const words = finalKeywords.split(/\s+/).filter(Boolean);
    let trimmed = '';
    for (const word of words) {
      const test = trimmed ? `${trimmed} ${word}` : word;
      if (new TextEncoder().encode(test).length <= maxBytes) {
        trimmed = test;
      } else {
        break;
      }
    }
    finalKeywords = trimmed;
  }

  const validation = BackendKeyWordOrAttributesStatus(finalKeywords);
  if (validation?.NumberOfErrors > 0) {
    logger.warn('[RankingContentAI] Fresh generated keywords have validation errors', {
      asin,
      bytes: new TextEncoder().encode(finalKeywords).length,
      errors: validation
    });
  }

  return finalKeywords;
}

async function generateRankingContentSuggestion(params) {
  const { asin, attribute, userId, country, region, backendKeywords } = params;
  let { title, bulletpoints, description } = params;

  if (!asin) {
    throw new ApiError(400, 'asin is required');
  }

  const attr = String(attribute || '').toLowerCase();
  if (!['title', 'bulletpoints', 'description', 'generic_keyword'].includes(attr)) {
    throw new ApiError(400, 'attribute must be one of: title, bulletpoints, description, generic_keyword');
  }

  // Handle backend keywords (generic_keyword) attribute
  if (attr === 'generic_keyword') {
    let currentKeywords = backendKeywords;
    
    logger.info('[RankingContentAI] Processing generic_keyword request', {
      asin,
      userId,
      country,
      region,
      backendKeywordsFromRequest: backendKeywords ? `${backendKeywords.substring(0, 50)}... (${backendKeywords.length} chars)` : 'NOT PROVIDED'
    });
    
    // Fetch from database if not provided
    if (!currentKeywords || typeof currentKeywords !== 'string' || !currentKeywords.trim()) {
      logger.info('[RankingContentAI] Fetching backend keywords from database', { asin, userId, country, region });
      currentKeywords = await getBackendKeywordsFromListingItems({ userId, asin, country, region });
      
      logger.info('[RankingContentAI] Database fetch result', {
        asin,
        keywordsFound: !!currentKeywords,
        keywordsLength: currentKeywords ? currentKeywords.length : 0,
        keywordsPreview: currentKeywords ? `${currentKeywords.substring(0, 100)}...` : 'NULL'
      });
    }
    
    // Determine the error type
    let errorType = determineBackendKeywordsErrorType(currentKeywords);
    
    const currentByteLength = currentKeywords ? new TextEncoder().encode(currentKeywords).length : 0;
    
    logger.info('[RankingContentAI] Error type determined', {
      asin,
      errorType,
      hasKeywords: !!(currentKeywords && currentKeywords.trim()),
      keywordsByteLength: currentByteLength
    });
    
    // If keywords are valid, allow optimization if there's room to add more
    if (!errorType && currentKeywords && currentKeywords.trim()) {
      if (currentByteLength < 240) {
        // Keywords are valid but could be expanded (not fully utilizing 250 byte limit)
        logger.info('[RankingContentAI] Keywords valid but not fully optimized, allowing expansion', {
          asin,
          currentByteLength,
          roomToExpand: 250 - currentByteLength
        });
        errorType = 'optimize';
      } else {
        // Keywords are fully optimized, return them as-is
        logger.info('[RankingContentAI] Keywords already fully optimized', { asin, currentByteLength });
        return {
          asin,
          attribute: attr,
          keywords: currentKeywords,
          errorType: 'none',
          originalKeywords: currentKeywords,
          byteLength: currentByteLength,
          message: 'Keywords are already optimized. No changes needed.'
        };
      }
    }
    
    // Fetch product context for AI generation
    let productTitle = title;
    let productBullets = bulletpoints;
    let productDesc = description;
    
    if (!productTitle || !productBullets || !productDesc) {
      const fromModel = await getListingContentFromReviewsModel({ userId, asin, country, region });
      if (fromModel) {
        if (!productTitle) productTitle = fromModel.title;
        if (!productBullets) productBullets = fromModel.bulletpoints;
        if (!productDesc) productDesc = fromModel.description;
      }
    }
    
    const suggestion = await generateBackendKeywordsSuggestion({
      asin,
      currentKeywords: currentKeywords || '',
      errorType,
      productTitle,
      bulletpoints: productBullets,
      description: productDesc
    });
    
    return {
      asin,
      attribute: attr,
      keywords: suggestion,
      errorType,
      originalKeywords: currentKeywords || '',
      byteLength: new TextEncoder().encode(suggestion).length
    };
  }

  // If any of the current values are missing, try to backfill from NumberOfProductReviews
  const needsTitle = attr === 'title' && (!title || typeof title !== 'string' || !title.trim());
  const hasNoBullets = !bulletpoints ||
    (Array.isArray(bulletpoints) && (bulletpoints.length === 0 || bulletpoints.every(b => !String(b || '').trim()))) ||
    (typeof bulletpoints === 'string' && !bulletpoints.trim());
  const needsBullets = attr === 'bulletpoints' && hasNoBullets;
  const needsDescription =
    attr === 'description' &&
    (!description || typeof description !== 'string' || !description.trim());

  if (needsTitle || needsBullets || needsDescription) {
    const fromModel = await getListingContentFromReviewsModel({ userId, asin, country, region });
    if (fromModel) {
      if (fromModel.title) title = fromModel.title;
      if (needsBullets && Array.isArray(fromModel.bulletpoints) && fromModel.bulletpoints.length) {
        bulletpoints = fromModel.bulletpoints;
      }
      if (needsDescription && fromModel.description) {
        description = fromModel.description;
      }
    }
  }

  if (attr === 'title') {
    const suggestion = await generateTitleSuggestion({
      asin,
      currentTitle: title
    });
    return { asin, attribute: attr, titles: suggestion };
  }

  if (attr === 'bulletpoints') {
    const suggestion = await generateBulletPointsSuggestion({
      asin,
      currentBulletPoints: bulletpoints,
      productTitle: title
    });
    return { asin, attribute: attr, bulletpoints: suggestion };
  }

  if (attr === 'description') {
    const suggestion = await generateDescriptionSuggestion({
      asin,
      currentDescription: description
    });
    return { asin, attribute: attr, description: suggestion };
  }
}

module.exports = {
  generateRankingContentSuggestion
};

