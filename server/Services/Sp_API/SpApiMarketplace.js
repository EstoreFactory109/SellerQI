const https = require("https");
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require("../../controllers/config/config.js");

const COUNTRY_TO_INTERNAL_REGION = {
  US: "na", CA: "na", MX: "na", BR: "na",
  UK: "eu", DE: "eu", FR: "eu", IT: "eu", ES: "eu", NL: "eu",
  SE: "eu", PL: "eu", BE: "eu", IN: "eu", TR: "eu", AE: "eu",
  SA: "eu", EG: "eu",
  AU: "apac", JP: "apac", SG: "apac",
};

const REGION_BASE_URLS = {
  na: "sellingpartnerapi-na.amazon.com",
  eu: "sellingpartnerapi-eu.amazon.com",
  apac: "sellingpartnerapi-fe.amazon.com",
};

const LWA_TOKEN_URL = "api.amazon.com";

function mapInternalRegionToSharedRegionKey(internalRegion) {
  switch (internalRegion) {
    case "na":
      return "NA";
    case "eu":
      return "EU";
    case "apac":
      return "FE";
    default:
      return null;
  }
}

function resolveMarketplaceAndRegion(countryUpper, regionOverride) {
  const internalRegionFromCountry = COUNTRY_TO_INTERNAL_REGION[countryUpper];
  if (!internalRegionFromCountry) {
    throw new Error(
      `Unsupported country: "${countryUpper}". Supported: ${Object.keys(COUNTRY_TO_INTERNAL_REGION).join(", ")}`
    );
  }

  const internalRegion = regionOverride || internalRegionFromCountry;
  const sharedRegionKey = mapInternalRegionToSharedRegionKey(internalRegion);

  const marketplaceId = sharedMarketplaceConfig?.[countryUpper];
  if (!marketplaceId) {
    throw new Error(`marketplaceId not configured for country: "${countryUpper}"`);
  }

  const baseUrlFromShared = sharedRegionKey ? URIs?.[sharedRegionKey] : null;
  const baseUrl = baseUrlFromShared || REGION_BASE_URLS[internalRegion];

  if (!baseUrl) {
    throw new Error(`Unsupported region: "${internalRegion}". Supported: na, eu, apac`);
  }

  return { marketplaceId, baseUrl, region: internalRegion };
}

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const postData = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await httpsRequest(
    {
      hostname: LWA_TOKEN_URL,
      path: "/auth/o2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    },
    postData
  );

  if (!res.body.access_token) {
    throw new Error(`Auth failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

module.exports = {
  resolveMarketplaceAndRegion,
  getAccessToken,
};
