const Cogs = require("../../models/finance/CogsModel");
const logger = require("../../utils/Logger");

/**
 * COGS Service - Handles all COGS-related database operations
 */
class CogsService {
  /**
   * Get COGS data for a user and marketplace.
   *
   * Accepts EITHER key that identifies a marketplace in this codebase, because
   * the write and read paths historically disagree:
   *   - CogsController saves keyed on `sellerAccount.countryCode`, which
   *     actually holds a CURRENCY code ('AUD', 'INR', 'GBP', 'USD') despite
   *     the field name.
   *   - Analyse.js and QMateService read with the real marketplace COUNTRY
   *     code ('AU', 'IN', 'UK', 'US').
   * Matching only one of them silently returned {} for every calculation-side
   * caller, which zeroed out every COGS-derived recoverable amount
   * (unfulfillable + stranded inventory). Matching both is unambiguous by
   * construction: country codes are 2 chars and currency codes are 3, so the
   * two key spaces can never collide.
   *
   * @param {string} userId - User ID
   * @param {string} marketplaceKey - Marketplace country code ('US', 'AU') or
   *   the currency-style code stored as `countryCode` ('USD', 'AUD')
   * @returns {Object} - COGS data with entries as an object keyed by ASIN
   */
  static async getCogs(userId, marketplaceKey) {
    try {
      const cogsData = marketplaceKey
        ? await Cogs.findOne({
            userId,
            $or: [{ country: marketplaceKey }, { countryCode: marketplaceKey }],
          })
        : null;

      if (!cogsData) {
        return {
          success: true,
          data: {
            cogsValues: {},
            country: null,
            region: null,
          },
        };
      }

      // Convert cogsEntries array to object keyed by ASIN for frontend compatibility
      const cogsValues = {};
      if (cogsData.cogsEntries && Array.isArray(cogsData.cogsEntries)) {
        cogsData.cogsEntries.forEach((entry) => {
          if (entry && entry.asin) {
            cogsValues[entry.asin] = entry.cogs;
          }
        });
      }

      return {
        success: true,
        data: {
          cogsValues,
          country: cogsData.country,
          countryCode: cogsData.countryCode,
          region: cogsData.region,
        },
      };
    } catch (error) {
      logger.error(`Error fetching COGS for user ${userId}:`, JSON.stringify({
        message: error.message || String(error),
        name: error.name,
        code: error.code,
      }));
      throw error;
    }
  }

  /**
   * Create or update COGS entry for a specific ASIN
   * @param {string} userId - User ID
   * @param {string} countryCode - Country code
   * @param {string} asin - Product ASIN
   * @param {string} sku - Product SKU (optional)
   * @param {number} cogs - COGS value
   * @param {string} country - Country name (optional)
   * @param {string} region - Region (NA, EU, FE)
   * @returns {Object} - Updated COGS data
   */
  static async upsertCogs(userId, countryCode, asin, sku, cogs, country, region) {
    try {
      // Ensure countryCode has a default value
      const safeCountryCode = countryCode || "US";
      
      // First, try to find existing document
      let cogsDoc = await Cogs.findOne({ userId, countryCode: safeCountryCode });

      if (!cogsDoc) {
        // Create new COGS document
        cogsDoc = new Cogs({
          userId,
          countryCode: safeCountryCode,
          country: country || null,
          region: region || null,
          cogsEntries: [{ asin, sku: sku || null, cogs, updatedAt: new Date() }],
        });
        
        await cogsDoc.save();
      } else {
        // Update existing document using findOneAndUpdate to avoid race conditions
        const existingEntryIndex = cogsDoc.cogsEntries.findIndex(
          (entry) => entry.asin === asin
        );

        if (existingEntryIndex >= 0) {
          // Update existing entry
          cogsDoc.cogsEntries[existingEntryIndex].cogs = cogs;
          cogsDoc.cogsEntries[existingEntryIndex].updatedAt = new Date();
          if (sku) {
            cogsDoc.cogsEntries[existingEntryIndex].sku = sku;
          }
        } else {
          // Add new entry
          cogsDoc.cogsEntries.push({ asin, sku: sku || null, cogs, updatedAt: new Date() });
        }

        // Update country/region if provided
        if (country) cogsDoc.country = country;
        if (region) cogsDoc.region = region;

        await cogsDoc.save();
      }

      // Return updated COGS values
      const cogsValues = {};
      if (cogsDoc.cogsEntries && Array.isArray(cogsDoc.cogsEntries)) {
        cogsDoc.cogsEntries.forEach((entry) => {
          if (entry && entry.asin) {
            cogsValues[entry.asin] = entry.cogs;
          }
        });
      }

      return {
        success: true,
        data: {
          cogsValues,
          country: cogsDoc.country,
          countryCode: cogsDoc.countryCode,
          region: cogsDoc.region,
        },
        message: "COGS saved successfully",
      };
    } catch (error) {
      const errorInfo = {
        message: error.message || String(error),
        name: error.name || 'Error',
        code: error.code,
      };
      
      logger.error(`Error upserting COGS for user ${userId}, ASIN ${asin}:`, JSON.stringify(errorInfo));
      
      // Handle duplicate key error by retrying with update
      if (error.code === 11000) {
        try {
          logger.info(`Retrying COGS upsert for user ${userId}, ASIN ${asin} after duplicate key error`);
          
          // Use findOneAndUpdate with $set to handle the race condition
          const result = await Cogs.findOneAndUpdate(
            { userId, countryCode: countryCode || "US" },
            {
              $set: {
                country: country || null,
                region: region || null,
              },
              $setOnInsert: {
                cogsEntries: [],
              },
            },
            { upsert: true, new: true }
          );
          
          // Now update the specific COGS entry
          const existingEntryIndex = result.cogsEntries.findIndex(
            (entry) => entry.asin === asin
          );
          
          if (existingEntryIndex >= 0) {
            result.cogsEntries[existingEntryIndex].cogs = cogs;
            result.cogsEntries[existingEntryIndex].updatedAt = new Date();
            if (sku) {
              result.cogsEntries[existingEntryIndex].sku = sku;
            }
          } else {
            result.cogsEntries.push({ asin, sku: sku || null, cogs, updatedAt: new Date() });
          }
          
          await result.save();
          
          const cogsValues = {};
          result.cogsEntries.forEach((entry) => {
            if (entry && entry.asin) {
              cogsValues[entry.asin] = entry.cogs;
            }
          });
          
          return {
            success: true,
            data: {
              cogsValues,
              country: result.country,
              countryCode: result.countryCode,
              region: result.region,
            },
            message: "COGS saved successfully (after retry)",
          };
        } catch (retryError) {
          logger.error(`Retry also failed for user ${userId}, ASIN ${asin}:`, JSON.stringify({
            message: retryError.message || String(retryError),
            name: retryError.name,
            code: retryError.code,
          }));
          throw retryError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Bulk update COGS entries
   * @param {string} userId - User ID
   * @param {string} countryCode - Country code
   * @param {Object} cogsValues - Object with ASIN keys and COGS values
   * @param {string} country - Country name (optional)
   * @param {string} region - Region (NA, EU, FE)
   * @returns {Object} - Updated COGS data
   */
  static async bulkUpdateCogs(userId, countryCode, cogsValues, country, region) {
    try {
      const safeCountryCode = countryCode || "US";
      let cogsDoc = await Cogs.findOne({ userId, countryCode: safeCountryCode });

      if (!cogsDoc) {
        // Create new COGS document with all entries
        const cogsEntries = Object.entries(cogsValues).map(([asin, cogs]) => ({
          asin,
          cogs,
          updatedAt: new Date(),
        }));

        cogsDoc = new Cogs({
          userId,
          countryCode: safeCountryCode,
          country: country || null,
          region: region || null,
          cogsEntries,
        });
      } else {
        // Update existing entries and add new ones
        Object.entries(cogsValues).forEach(([asin, cogs]) => {
          const existingEntryIndex = cogsDoc.cogsEntries.findIndex(
            (entry) => entry.asin === asin
          );

          if (existingEntryIndex >= 0) {
            cogsDoc.cogsEntries[existingEntryIndex].cogs = cogs;
            cogsDoc.cogsEntries[existingEntryIndex].updatedAt = new Date();
          } else {
            cogsDoc.cogsEntries.push({ asin, cogs, updatedAt: new Date() });
          }
        });

        // Update country/region if provided
        if (country) cogsDoc.country = country;
        if (region) cogsDoc.region = region;
      }

      await cogsDoc.save();

      // Return updated COGS values
      const updatedCogsValues = {};
      if (cogsDoc.cogsEntries && Array.isArray(cogsDoc.cogsEntries)) {
        cogsDoc.cogsEntries.forEach((entry) => {
          if (entry && entry.asin) {
            updatedCogsValues[entry.asin] = entry.cogs;
          }
        });
      }

      return {
        success: true,
        data: {
          cogsValues: updatedCogsValues,
          country: cogsDoc.country,
          countryCode: cogsDoc.countryCode,
          region: cogsDoc.region,
        },
        message: "COGS bulk updated successfully",
      };
    } catch (error) {
      logger.error(`Error bulk updating COGS for user ${userId}:`, JSON.stringify({
        message: error.message || String(error),
        name: error.name,
        code: error.code,
      }));
      throw error;
    }
  }

  /**
   * Delete COGS entry for a specific ASIN
   * @param {string} userId - User ID
   * @param {string} countryCode - Country code
   * @param {string} asin - Product ASIN
   * @returns {Object} - Updated COGS data
   */
  static async deleteCogs(userId, countryCode, asin) {
    try {
      const safeCountryCode = countryCode || "US";
      const cogsDoc = await Cogs.findOne({ userId, countryCode: safeCountryCode });

      if (!cogsDoc) {
        return {
          success: true,
          message: "No COGS data found",
        };
      }

      // Remove the COGS entry for the specified ASIN
      cogsDoc.cogsEntries = cogsDoc.cogsEntries.filter(
        (entry) => entry.asin !== asin
      );

      await cogsDoc.save();

      // Return updated COGS values
      const cogsValues = {};
      if (cogsDoc.cogsEntries && Array.isArray(cogsDoc.cogsEntries)) {
        cogsDoc.cogsEntries.forEach((entry) => {
          if (entry && entry.asin) {
            cogsValues[entry.asin] = entry.cogs;
          }
        });
      }

      return {
        success: true,
        data: {
          cogsValues,
          country: cogsDoc.country,
          countryCode: cogsDoc.countryCode,
          region: cogsDoc.region,
        },
        message: "COGS deleted successfully",
      };
    } catch (error) {
      logger.error(`Error deleting COGS for user ${userId}, ASIN ${asin}:`, JSON.stringify({
        message: error.message || String(error),
        name: error.name,
        code: error.code,
      }));
      throw error;
    }
  }

  /**
   * Delete all COGS data for a user and marketplace
   * @param {string} userId - User ID
   * @param {string} countryCode - Country code
   * @returns {Object} - Result
   */
  static async deleteAllCogs(userId, countryCode) {
    try {
      const safeCountryCode = countryCode || "US";
      await Cogs.deleteOne({ userId, countryCode: safeCountryCode });

      return {
        success: true,
        message: "All COGS data deleted successfully",
      };
    } catch (error) {
      logger.error(`Error deleting all COGS for user ${userId}:`, JSON.stringify({
        message: error.message || String(error),
        name: error.name,
        code: error.code,
      }));
      throw error;
    }
  }
}

module.exports = CogsService;
