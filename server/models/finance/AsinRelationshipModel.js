const mongoose = require('mongoose');

/**
 * AsinRelationshipModel
 *
 * Stores parent-child ASIN relationships from the Catalog Items API
 * (GET /catalog/2022-04-01/items/{asin}?includedData=relationships).
 *
 * This data is STATIC — it doesn't change daily. Fetched once per ASIN
 * when first seen, refreshed weekly/monthly.
 *
 * Use cases:
 *   - Frontend groups child ASINs under parent ASIN in the P&L table
 *   - Collapsible row: Parent ASIN (sum) → expand → child ASINs (individual)
 *   - Identify variation families (color/size variants)
 *
 * Example:
 *   Parent ASIN: B07ZQ1M5H2 (main listing)
 *   Child ASINs: B07ZQ2QKSR (Red/Large), B07ZQ3ABCD (Blue/Small), etc.
 *   variationTheme: "SIZE_NAME/COLOR_NAME"
 *   variationAttributes: ["color", "size"]
 *
 * How it works:
 *   1. During daily finance sync, collect unique ASINs from transactions
 *   2. For ASINs not yet in this collection (or stale), call Catalog Items API
 *   3. Store the parent ASIN and relationship type
 *   4. Frontend queries: "give me all children of parent X" or "what's the parent of child Y"
 */

const AsinRelationshipSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },

    // The ASIN this record is about
    asin: {
      type: String,
      required: true,
      index: true,
    },

    // Parent ASIN (if this ASIN is a child/variation)
    // Empty string if this ASIN has no parent (it IS the parent, or standalone)
    parentAsin: {
      type: String,
      default: '',
      index: true,
    },

    // Relationship type: "VARIATION" | "PACKAGE_HIERARCHY" | "" (standalone)
    relationshipType: {
      type: String,
      default: '',
    },

    // Variation theme (e.g. "SIZE_NAME/COLOR_NAME")
    variationTheme: {
      type: String,
      default: '',
    },

    // Variation attributes (e.g. ["color", "size"])
    variationAttributes: {
      type: [String],
      default: [],
    },

    // All child ASINs (populated when querying the parent ASIN)
    // This is filled in after all children are processed
    childAsins: {
      type: [String],
      default: [],
    },

    // Whether this ASIN is a parent (has children) or child (has parent)
    // "parent" | "child" | "standalone"
    role: {
      type: String,
      default: 'standalone',
      enum: ['parent', 'child', 'standalone'],
      index: true,
    },

    // When was this relationship last fetched from the API
    lastFetchedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

// Primary: find relationship for a specific ASIN
AsinRelationshipSchema.index(
  { User: 1, country: 1, region: 1, asin: 1 },
  { unique: true }
);

// Find all children of a parent
AsinRelationshipSchema.index({ User: 1, country: 1, region: 1, parentAsin: 1 });

// Find stale records that need refresh
AsinRelationshipSchema.index({ User: 1, country: 1, region: 1, lastFetchedAt: 1 });

module.exports = mongoose.model('AsinRelationship', AsinRelationshipSchema);