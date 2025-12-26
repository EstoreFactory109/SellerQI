const CogsService = require("../../Services/Finance/CogsService");
const User = require("../../models/user-auth/userModel");
const Seller = require("../../models/user-auth/sellerCentralModel");
const logger = require("../../utils/Logger");

/**
 * Get COGS data for the authenticated user
 */
const getCogs = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get user's seller data to determine country/region
    const user = await User.findById(userId).populate("sellerCentral");
    if (!user || !user.sellerCentral) {
      return res.status(400).json({
        success: false,
        message: "Seller account not found",
      });
    }

    const seller = await Seller.findById(user.sellerCentral);
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No seller marketplace found",
      });
    }

    // Use the first seller account (or active one)
    const activeAccount = seller.sellerAccount[0];
    const countryCode = activeAccount.countryCode || "US";

    const result = await CogsService.getCogs(userId, countryCode);

    return res.status(200).json(result);
  } catch (error) {
    const errorInfo = {
      message: error.message || String(error),
      name: error.name || 'Error',
      code: error.code,
    };
    logger.error("Error in getCogs controller:", JSON.stringify(errorInfo, null, 2));
    return res.status(500).json({
      success: false,
      message: "Failed to fetch COGS data",
      error: errorInfo.message,
    });
  }
};

/**
 * Save or update COGS for a specific ASIN
 */
const saveCogs = async (req, res) => {
  try {
    const userId = req.userId;
    const { asin, sku, cogs } = req.body;

    if (!asin) {
      return res.status(400).json({
        success: false,
        message: "ASIN is required",
      });
    }

    if (cogs === undefined || cogs === null || isNaN(parseFloat(cogs))) {
      return res.status(400).json({
        success: false,
        message: "Valid COGS value is required",
      });
    }

    // Get user's seller data to determine country/region
    const user = await User.findById(userId).populate("sellerCentral");
    if (!user || !user.sellerCentral) {
      return res.status(400).json({
        success: false,
        message: "Seller account not found",
      });
    }

    const seller = await Seller.findById(user.sellerCentral);
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No seller marketplace found",
      });
    }

    // Use the first seller account (or active one)
    const activeAccount = seller.sellerAccount[0];
    const countryCode = activeAccount.countryCode || "US";
    const country = activeAccount.country;
    const region = activeAccount.region;

    const result = await CogsService.upsertCogs(
      userId,
      countryCode,
      asin,
      sku,
      parseFloat(cogs),
      country,
      region
    );

    return res.status(200).json(result);
  } catch (error) {
    const errorInfo = {
      message: error.message || String(error),
      name: error.name || 'Error',
      code: error.code,
    };
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      errorInfo.message = "Duplicate COGS entry detected. Retrying with update...";
    }
    
    logger.error("Error in saveCogs controller:", JSON.stringify(errorInfo, null, 2));
    
    return res.status(500).json({
      success: false,
      message: "Failed to save COGS data",
      error: errorInfo.message,
    });
  }
};

/**
 * Bulk update COGS for multiple ASINs
 */
const bulkSaveCogs = async (req, res) => {
  try {
    const userId = req.userId;
    const { cogsValues } = req.body;

    if (!cogsValues || typeof cogsValues !== "object") {
      return res.status(400).json({
        success: false,
        message: "COGS values object is required",
      });
    }

    // Get user's seller data to determine country/region
    const user = await User.findById(userId).populate("sellerCentral");
    if (!user || !user.sellerCentral) {
      return res.status(400).json({
        success: false,
        message: "Seller account not found",
      });
    }

    const seller = await Seller.findById(user.sellerCentral);
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No seller marketplace found",
      });
    }

    // Use the first seller account (or active one)
    const activeAccount = seller.sellerAccount[0];
    const countryCode = activeAccount.countryCode || "US";
    const country = activeAccount.country;
    const region = activeAccount.region;

    // Validate and parse COGS values
    const parsedCogsValues = {};
    for (const [asin, cogs] of Object.entries(cogsValues)) {
      const parsedCogs = parseFloat(cogs);
      if (!isNaN(parsedCogs) && parsedCogs >= 0) {
        parsedCogsValues[asin] = parsedCogs;
      }
    }

    const result = await CogsService.bulkUpdateCogs(
      userId,
      countryCode,
      parsedCogsValues,
      country,
      region
    );

    return res.status(200).json(result);
  } catch (error) {
    const errorInfo = {
      message: error.message || String(error),
      name: error.name || 'Error',
      code: error.code,
    };
    logger.error("Error in bulkSaveCogs controller:", JSON.stringify(errorInfo, null, 2));
    return res.status(500).json({
      success: false,
      message: "Failed to bulk save COGS data",
      error: errorInfo.message,
    });
  }
};

/**
 * Delete COGS for a specific ASIN
 */
const deleteCogs = async (req, res) => {
  try {
    const userId = req.userId;
    const { asin } = req.params;

    if (!asin) {
      return res.status(400).json({
        success: false,
        message: "ASIN is required",
      });
    }

    // Get user's seller data to determine country/region
    const user = await User.findById(userId).populate("sellerCentral");
    if (!user || !user.sellerCentral) {
      return res.status(400).json({
        success: false,
        message: "Seller account not found",
      });
    }

    const seller = await Seller.findById(user.sellerCentral);
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No seller marketplace found",
      });
    }

    // Use the first seller account (or active one)
    const activeAccount = seller.sellerAccount[0];
    const countryCode = activeAccount.countryCode || "US";

    const result = await CogsService.deleteCogs(userId, countryCode, asin);

    return res.status(200).json(result);
  } catch (error) {
    const errorInfo = {
      message: error.message || String(error),
      name: error.name || 'Error',
      code: error.code,
    };
    logger.error("Error in deleteCogs controller:", JSON.stringify(errorInfo, null, 2));
    return res.status(500).json({
      success: false,
      message: "Failed to delete COGS data",
      error: errorInfo.message,
    });
  }
};

/**
 * Delete all COGS data for the user's marketplace
 */
const deleteAllCogs = async (req, res) => {
  try {
    const userId = req.userId;

    // Get user's seller data to determine country/region
    const user = await User.findById(userId).populate("sellerCentral");
    if (!user || !user.sellerCentral) {
      return res.status(400).json({
        success: false,
        message: "Seller account not found",
      });
    }

    const seller = await Seller.findById(user.sellerCentral);
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No seller marketplace found",
      });
    }

    // Use the first seller account (or active one)
    const activeAccount = seller.sellerAccount[0];
    const countryCode = activeAccount.countryCode || "US";

    const result = await CogsService.deleteAllCogs(userId, countryCode);

    return res.status(200).json(result);
  } catch (error) {
    const errorInfo = {
      message: error.message || String(error),
      name: error.name || 'Error',
      code: error.code,
    };
    logger.error("Error in deleteAllCogs controller:", JSON.stringify(errorInfo, null, 2));
    return res.status(500).json({
      success: false,
      message: "Failed to delete all COGS data",
      error: errorInfo.message,
    });
  }
};

module.exports = {
  getCogs,
  saveCogs,
  bulkSaveCogs,
  deleteCogs,
  deleteAllCogs,
};

