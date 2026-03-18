const { processReviewRequests } = require("./reviewRequestSenderService");
const { generateAccessToken } = require("../Sp_API/GenerateTokens");
const getTemporaryCredentials = require("../../utils/GenerateTemporaryCredentials");
const Seller = require("../../models/user-auth/sellerCentralModel");
const User = require("../../models/user-auth/userModel");
const {
  marketplaceConfig,
  URIs,
  spapiRegions,
} = require("../../controllers/config/config");
const logger = require("../../utils/Logger");

/**
 * Wrapper that matches the ScheduleConfig `isCalculationService` signature:
 *   (userId, country, region, source)
 *
 * Internally resolves seller tokens, builds awsConfig, and delegates to
 * processReviewRequests (the cursor-based sender service).
 */
async function scheduledReviewRequestSender(userId, country, region, source) {
  logger.info(
    `[scheduledReviewRequestSender] Starting for user ${userId}, ${country}/${region} (source: ${source})`
  );

  try {
    // 0) Check if user is authorized to send review requests (PRO/trial only)
    const user = await User.findById(userId)
      .select({ reviewRequestAuthStatus: 1 })
      .lean();

    if (!user || !user.reviewRequestAuthStatus) {
      logger.info(
        `[scheduledReviewRequestSender] Skipping user ${userId} — reviewRequestAuthStatus is false (LITE plan)`
      );
      return { success: true, data: { skipped: true, reason: "LITE plan" }, error: null };
    }

    // 1) Resolve seller account and refresh token
    const sellerCentral = await Seller.findOne({ User: userId }).lean();
    if (!sellerCentral?.sellerAccount?.length) {
      logger.warn(
        `[scheduledReviewRequestSender] No seller account found for user ${userId}`
      );
      return { success: false, error: "Seller account not found" };
    }

    const sellerAccount = sellerCentral.sellerAccount.find(
      (acc) => acc.country === country && acc.region === region
    );
    if (!sellerAccount) {
      logger.warn(
        `[scheduledReviewRequestSender] No seller account for ${country}/${region}`
      );
      return {
        success: false,
        error: `Seller account not found for ${country}/${region}`,
      };
    }

    const spiRefreshToken =
      sellerAccount.spiRefreshToken ||
      sellerAccount.spRefreshToken ||
      sellerAccount.refreshToken;

    if (!spiRefreshToken) {
      logger.warn(
        `[scheduledReviewRequestSender] No SP-API refresh token for user ${userId}`
      );
      return { success: false, error: "SP-API refresh token not found" };
    }

    // 2) Generate access token
    const accessToken = await generateAccessToken(userId, spiRefreshToken);
    if (!accessToken) {
      return { success: false, error: "Failed to generate SP-API access token" };
    }

    // 3) Resolve marketplace + endpoint
    let marketplaceId =
      sellerAccount.marketplaceId ||
      (Array.isArray(sellerAccount.marketplaceIds)
        ? sellerAccount.marketplaceIds[0]
        : null) ||
      marketplaceConfig[country] ||
      marketplaceConfig[country?.toUpperCase()];

    if (!marketplaceId) {
      return { success: false, error: "Marketplace ID not found" };
    }

    const spRegion = region || "NA";
    let endpoint = URIs?.[spRegion];
    const awsRegion = spapiRegions[spRegion];

    if (!endpoint) {
      const defaultURIs = {
        NA: "https://sellingpartnerapi-na.amazon.com",
        EU: "https://sellingpartnerapi-eu.amazon.com",
        FE: "https://sellingpartnerapi-fe.amazon.com",
      };
      endpoint = defaultURIs[spRegion];
    }

    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      endpoint = `https://${endpoint}`;
    }

    if (!endpoint || !awsRegion) {
      return { success: false, error: `Unsupported SP-API region: ${spRegion}` };
    }

    // 4) Get temporary AWS credentials
    const tempCreds = await getTemporaryCredentials(awsRegion);
    if (
      !tempCreds?.AccessKey ||
      !tempCreds?.SecretKey ||
      !tempCreds?.SessionToken
    ) {
      return {
        success: false,
        error: "Failed to obtain temporary AWS credentials",
      };
    }

    const awsConfig = {
      marketplaceId,
      endpoint,
      awsAccessKeyId: tempCreds.AccessKey,
      awsSecretAccessKey: tempCreds.SecretKey,
      awsRegion,
      awsSessionToken: tempCreds.SessionToken,
    };

    // 5) Delegate to the sender service
    const summary = await processReviewRequests({
      userId,
      country,
      region,
      accessToken,
      awsConfig,
    });

    logger.info(
      `[scheduledReviewRequestSender] Done for user ${userId}: processed=${summary.processed}, sent=${summary.sent}, failed=${summary.failed}`
    );

    return { success: true, data: summary, error: null };
  } catch (error) {
    logger.error(
      `[scheduledReviewRequestSender] Error for user ${userId}:`,
      error
    );
    return {
      success: false,
      error: error.message || "Review request processing failed",
    };
  }
}

module.exports = {
  scheduledReviewRequestSender,
};
