const mongoose = require('mongoose');
const https = require('https');
const logger = require('../../utils/Logger.js');

const AsinRelationship = require('../../models/finance/AsinRelationshipModel.js');
const { getAccessToken, resolveMarketplaceAndRegion } = require('./Expences.js');

// ─────────────────────────────────────────────
// HTTP HELPER
// ─────────────────────────────────────────────
function httpsRequest(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─────────────────────────────────────────────
// CATALOG ITEMS API — FETCH RELATIONSHIPS
//
// GET /catalog/2022-04-01/items/{asin}
// Query: marketplaceIds={id}&includedData=relationships
//
// Rate limit: 2 requests/sec, burst 2
//
// Response:
// {
//   "asin": "B07ZQ2QKSR",
//   "relationships": [
//     {
//       "marketplaceId": "A21TJRUUN4KGV",
//       "relationships": [
//         {
//           "parentAsins": ["B07ZQ1M5H2"],
//           "childAsins": ["B07ZQ2QKSR", "B07ZQ3ABCD"],  // only if querying the parent
//           "type": "VARIATION",
//           "variationTheme": {
//             "attributes": ["color", "size"],
//             "theme": "SIZE_NAME/COLOR_NAME"
//           }
//         }
//       ]
//     }
//   ]
// }
// ─────────────────────────────────────────────
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 550; // 2 req/sec = 500ms + buffer

async function fetchAsinRelationship(accessToken, baseUrl, asin, marketplaceId) {
  const path = `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?marketplaceIds=${encodeURIComponent(marketplaceId)}&includedData=relationships`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await httpsRequest({
      hostname: baseUrl,
      path,
      method: 'GET',
      headers: { 'x-amz-access-token': accessToken },
    });

    if (res.statusCode === 429) {
      if (attempt < MAX_RETRIES) {
        const delayMs = Math.min(3000 * Math.pow(2, attempt), 15000);
        logger.warn(`[AsinRelationship] Throttled on ${asin}, attempt ${attempt + 1}. Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(`Throttled after ${MAX_RETRIES} retries for ${asin}`);
    }

    if (res.statusCode === 404) {
      // ASIN not found in catalog — standalone
      return null;
    }

    if (res.body.errors) {
      throw new Error(`Catalog API error for ${asin}: ${JSON.stringify(res.body.errors)}`);
    }

    return res.body;
  }

  return null;
}

/**
 * Parse the Catalog API response to extract parent-child relationship.
 *
 * Returns:
 *   { parentAsin, relationshipType, variationTheme, variationAttributes, childAsins, role }
 */
function parseRelationshipResponse(response, marketplaceId) {
  if (!response || !response.relationships) {
    return { parentAsin: '', relationshipType: '', variationTheme: '', variationAttributes: [], childAsins: [], role: 'standalone' };
  }

  // Find relationships for the specific marketplace
  const marketplaceRelationships = response.relationships.find(
    (r) => r.marketplaceId === marketplaceId
  );

  if (!marketplaceRelationships || !marketplaceRelationships.relationships || marketplaceRelationships.relationships.length === 0) {
    return { parentAsin: '', relationshipType: '', variationTheme: '', variationAttributes: [], childAsins: [], role: 'standalone' };
  }

  // Take the first relationship (usually VARIATION)
  const rel = marketplaceRelationships.relationships[0];
  const type = rel.type || '';
  const theme = rel.variationTheme?.theme || '';
  const attributes = rel.variationTheme?.attributes || [];

  // Determine role: child has parentAsins, parent has childAsins
  const parentAsins = rel.parentAsins || [];
  const childAsins = rel.childAsins || [];

  if (parentAsins.length > 0) {
    // This ASIN is a CHILD — it has a parent
    return {
      parentAsin: parentAsins[0], // Take the first parent (almost always just one)
      relationshipType: type,
      variationTheme: theme,
      variationAttributes: attributes,
      childAsins: [],
      role: 'child',
    };
  }

  if (childAsins.length > 0) {
    // This ASIN is a PARENT — it has children
    return {
      parentAsin: '',
      relationshipType: type,
      variationTheme: theme,
      variationAttributes: attributes,
      childAsins,
      role: 'parent',
    };
  }

  return { parentAsin: '', relationshipType: type, variationTheme: theme, variationAttributes: attributes, childAsins: [], role: 'standalone' };
}

// ─────────────────────────────────────────────
// MAIN: SYNC RELATIONSHIPS FOR A SET OF ASINs
//
// Called after finance sync with the list of unique ASINs.
// Only fetches relationships for ASINs not already in the DB
// (or stale ones older than refreshAfterDays).
// ─────────────────────────────────────────────
async function syncAsinRelationships({
  userId,
  country,
  regionModel,
  asins,                     // Array of ASIN strings to check
  accessToken,
  refreshToken,
  clientId = process.env.SPAPI_CLIENT_ID,
  clientSecret = process.env.SPAPI_CLIENT_SECRET,
  refreshAfterDays = 7,      // Re-fetch relationships older than this
}) {
  if (!asins || asins.length === 0) return { fetched: 0, skipped: 0, errors: 0 };

  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const countryUpper = country.toUpperCase();
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(countryUpper);

  // Find which ASINs already have fresh relationship data
  const staleThreshold = new Date(Date.now() - refreshAfterDays * 24 * 60 * 60 * 1000);
  const existingRecords = await AsinRelationship.find({
    User: userObjectId,
    country: countryUpper,
    region: regionModel,
    asin: { $in: asins },
    lastFetchedAt: { $gte: staleThreshold },
  }).select('asin').lean();

  const existingAsins = new Set(existingRecords.map((r) => r.asin));
  const asinsToFetch = asins.filter((a) => !existingAsins.has(a));

  if (asinsToFetch.length === 0) {
    logger.info(`[AsinRelationship] All ${asins.length} ASINs have fresh relationships. Skipping.`);
    return { fetched: 0, skipped: asins.length, errors: 0 };
  }

  logger.info(`[AsinRelationship] Fetching relationships for ${asinsToFetch.length} ASINs (${existingAsins.size} skipped as fresh).`);

  // Get access token
  let token = accessToken;
  if (!token) {
    token = await getAccessToken(clientId, clientSecret, refreshToken);
  }

  let fetchedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < asinsToFetch.length; i++) {
    const asin = asinsToFetch[i];

    try {
      const response = await fetchAsinRelationship(token, baseUrl, asin, marketplaceId);
      const parsed = parseRelationshipResponse(response, marketplaceId);

      await AsinRelationship.findOneAndUpdate(
        { User: userObjectId, country: countryUpper, region: regionModel, asin },
        {
          User: userObjectId,
          country: countryUpper,
          region: regionModel,
          marketplaceId,
          asin,
          parentAsin: parsed.parentAsin,
          relationshipType: parsed.relationshipType,
          variationTheme: parsed.variationTheme,
          variationAttributes: parsed.variationAttributes,
          childAsins: parsed.childAsins,
          role: parsed.role,
          lastFetchedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      fetchedCount++;

      if ((i + 1) % 20 === 0) {
        logger.info(`[AsinRelationship] Progress: ${i + 1}/${asinsToFetch.length}`);
      }
    } catch (error) {
      errorCount++;
      logger.error(`[AsinRelationship] Failed for ${asin}: ${error.message}`);
    }

    // Rate limit: 2 req/sec
    if (i < asinsToFetch.length - 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // After fetching all children, backfill the parent's childAsins list
  // For every child that has a parentAsin, add this child to the parent's childAsins
  await backfillParentChildAsins({ userId: userObjectId, country: countryUpper, regionModel });

  logger.info(`[AsinRelationship] Done. Fetched: ${fetchedCount}, Errors: ${errorCount}, Skipped: ${existingAsins.size}`);
  return { fetched: fetchedCount, skipped: existingAsins.size, errors: errorCount };
}

/**
 * After individual ASIN lookups, build the parent's childAsins[]
 * by querying all children that reference the same parentAsin.
 */
async function backfillParentChildAsins({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  // Find all unique parentAsins
  const children = await AsinRelationship.find({
    User: userObjectId,
    country,
    region: regionModel,
    role: 'child',
    parentAsin: { $ne: '' },
  }).select('asin parentAsin').lean();

  // Group children by parent
  const parentToChildren = new Map();
  for (const child of children) {
    if (!parentToChildren.has(child.parentAsin)) {
      parentToChildren.set(child.parentAsin, []);
    }
    parentToChildren.get(child.parentAsin).push(child.asin);
  }

  // Update each parent's childAsins and role
  for (const [parentAsin, childAsins] of parentToChildren) {
    await AsinRelationship.findOneAndUpdate(
      { User: userObjectId, country, region: regionModel, asin: parentAsin },
      {
        User: userObjectId,
        country,
        region: regionModel,
        asin: parentAsin,
        parentAsin: '',
        role: 'parent',
        childAsins: [...new Set(childAsins)],
        lastFetchedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  }

  if (parentToChildren.size > 0) {
    logger.info(`[AsinRelationship] Backfilled childAsins for ${parentToChildren.size} parent ASINs.`);
  }
}

// ─────────────────────────────────────────────
// QUERY: Get relationships for frontend
// ─────────────────────────────────────────────

/**
 * Get all ASIN relationships for a user+country.
 * Returns a structure the frontend can use to group ASINs:
 *
 * {
 *   families: [
 *     {
 *       parentAsin: "B07ZQ1M5H2",
 *       variationTheme: "SIZE_NAME/COLOR_NAME",
 *       variationAttributes: ["color", "size"],
 *       children: ["B07ZQ2QKSR", "B07ZQ3ABCD"]
 *     }
 *   ],
 *   standalone: ["B08HWSPZHZ", "B0C4V4X865"],
 *   asinToParent: { "B07ZQ2QKSR": "B07ZQ1M5H2", ... }
 * }
 */
async function getAsinRelationships({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const allRelationships = await AsinRelationship.find({
    User: userObjectId,
    country,
    region: regionModel,
  }).lean();

  const families = [];
  const standalone = [];
  const asinToParent = {};

  // Find parents
  const parents = allRelationships.filter((r) => r.role === 'parent');
  for (const parent of parents) {
    families.push({
      parentAsin: parent.asin,
      relationshipType: parent.relationshipType,
      variationTheme: parent.variationTheme,
      variationAttributes: parent.variationAttributes,
      children: parent.childAsins || [],
    });
  }

  // Build asinToParent map from children
  const children = allRelationships.filter((r) => r.role === 'child');
  for (const child of children) {
    asinToParent[child.asin] = child.parentAsin;
  }

  // Standalone ASINs (no parent, no children)
  const standaloneRecords = allRelationships.filter((r) => r.role === 'standalone');
  for (const s of standaloneRecords) {
    standalone.push(s.asin);
  }

  return { families, standalone, asinToParent };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  syncAsinRelationships,
  getAsinRelationships,
  fetchAsinRelationship,
  parseRelationshipResponse,
  backfillParentChildAsins,
};