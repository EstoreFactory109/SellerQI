const { ingestReviewOrders } = require("./reviewIngestionService");
const { generateAccessToken } = require("../Sp_API/GenerateTokens");
const getTemporaryCredentials = require("../../utils/GenerateTemporaryCredentials");
const { createSpApiCredentialProvider } = require("../../utils/spApiCredentials");
const { SpApiAuthDeniedError } = require("../../utils/spApiErrors");
const Seller = require("../../models/user-auth/sellerCentralModel");
const {
  marketplaceConfig,
  URIs,
  spapiRegions,
} = require("../../controllers/config/config");
const logger = require("../../utils/Logger");

/**
 * Record (or clear) an SP-API Orders authorization denial on the seller subdocument.
 * Best-effort — a bookkeeping failure must never mask the real outcome of the run.
 */
async function setOrdersAuthDenied(userId, country, region, reason) {
  try {
    const update = reason
      ? {
          $set: {
            "sellerAccount.$[acct].spiOrdersAuthDeniedAt": new Date(),
            "sellerAccount.$[acct].spiOrdersAuthDeniedReason": reason,
          },
        }
      : {
          $unset: {
            "sellerAccount.$[acct].spiOrdersAuthDeniedAt": "",
            "sellerAccount.$[acct].spiOrdersAuthDeniedReason": "",
          },
        };

    await Seller.updateOne({ User: userId }, update, {
      arrayFilters: [{ "acct.country": country, "acct.region": region }],
    });
  } catch (err) {
    logger.warn(
      `[scheduledReviewIngestion] could not record auth-denied state (non-fatal): ${err.message}`
    );
  }
}

/**
 * Wrapper that matches the ScheduleConfig `isCalculationService` signature:
 *   (userId, country, region, source)
 *
 * Internally resolves seller tokens, builds awsConfig, and delegates to
 * ingestReviewOrders (the lightweight ingestion service).
 */
async function scheduledReviewIngestion(userId, country, region, source) {
  logger.info(
    `[scheduledReviewIngestion] Starting for user ${userId}, ${country}/${region} (source: ${source})`
  );

  try {
    const sellerCentral = await Seller.findOne({ User: userId }).lean();
    if (!sellerCentral?.sellerAccount?.length) {
      logger.warn(
        `[scheduledReviewIngestion] No seller account found for user ${userId}`
      );
      return { success: false, error: "Seller account not found" };
    }

    const sellerAccount = sellerCentral.sellerAccount.find(
      (acc) => acc.country === country && acc.region === region
    );
    if (!sellerAccount) {
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
      return { success: false, error: "SP-API refresh token not found" };
    }

    const accessToken = await generateAccessToken(userId, spiRefreshToken);
    if (!accessToken) {
      return { success: false, error: "Failed to generate SP-API access token" };
    }

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

    // Normalize casing so a stray lower/mixed-case region resolves correctly
    // instead of silently falling back to NA.
    const spRegion = String(region || "NA").trim().toUpperCase();
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

    // Both credentials above live ~60 min. A high-volume account takes longer than that to
    // walk, which is what produced `Orders API failed: 403` at exactly 61 minutes. The
    // provider adopts what we just minted (so the happy path costs no extra LWA/STS call)
    // and re-mints either half on demand from here on.
    const credentialProvider = createSpApiCredentialProvider({
      userId,
      spiRefreshToken,
      awsRegion,
      initialAccessToken: accessToken,
      initialAwsCreds: tempCreds,
      logPrefix: "[scheduledReviewIngestion]",
    });

    const result = await ingestReviewOrders({
      userId,
      country,
      region,
      accessToken,
      awsConfig,
      credentialProvider,
    });

    logger.info(
      `[scheduledReviewIngestion] Done for user ${userId}: ingested=${result.ingested}, failed=${result.failed}`
    );

    // A previously-denied account that just succeeded is authorized again.
    await setOrdersAuthDenied(userId, country, region, null);

    return { success: true, data: result, error: null };
  } catch (error) {
    // A denial is not a transient failure — refreshing cannot fix it and retrying wastes an
    // hour per run. Surface it distinctly so it is actionable (reconnect the account) rather
    // than buried among ordinary errors.
    if (error instanceof SpApiAuthDeniedError) {
      const reason = error.amazonMessage || error.message;
      logger.error(
        `[scheduledReviewIngestion] SP-API authorization DENIED for user ${userId} ` +
        `(${country}/${region}) — account must re-authorize: ${reason}`
      );
      await setOrdersAuthDenied(userId, country, region, reason);
      return {
        success: false,
        data: null,
        authDenied: true,
        error: `SP-API authorization denied for Orders — the account must reconnect: ${reason}`,
      };
    }

    logger.error(
      `[scheduledReviewIngestion] Error for user ${userId}:`,
      error
    );
    return {
      success: false,
      error: error.message || "Review order ingestion failed",
    };
  }
}

module.exports = {
  scheduledReviewIngestion,
};
