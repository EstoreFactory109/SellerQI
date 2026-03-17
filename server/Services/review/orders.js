const crypto = require("crypto");

// ─── CONFIG ────────────────────────────────────────────────────────────────────
// This module is now a **pure service** that expects caller to provide:
// - accessToken: per-user LWA access token (SP-API)
// - awsAccessKeyId / awsSecretAccessKey / awsRegion / endpoint / marketplaceId: passed via config object
//
// We keep only order-related constants here; credentials come from caller.
const ORDER_CONFIG = {
  // Only Shipped orders are eligible for review requests
  orderStatuses: ["Shipped"],

  // Solicitation eligibility window: 5 to 30 days old
  minOrderAgeDays: 5,
  maxOrderAgeDays: 30,

  // Delay between each solicitation request (ms) to respect rate limits
  delayBetweenRequests: 1000,
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDateRange() {
  const today = new Date();

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  yesterday.setHours(23, 59, 59, 0);

  const startDate = new Date(yesterday);
  startDate.setDate(yesterday.getDate() - 15);
  startDate.setHours(0, 0, 0, 0);

  return {
    createdAfter: startDate.toISOString(),
    createdBefore: yesterday.toISOString(),
  };
}

function isEligibleForReview(order) {
  const purchaseDate = new Date(order.PurchaseDate);
  const now = new Date();
  const ageInDays = (now - purchaseDate) / (1000 * 60 * 60 * 24);

  return (
    order.OrderStatus === "Shipped" &&
    ageInDays >= ORDER_CONFIG.minOrderAgeDays &&
    ageInDays <= ORDER_CONFIG.maxOrderAgeDays
  );
}

// ─── SIGV4 SIGNING ─────────────────────────────────────────────────────────────
function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest(encoding);
}

function hash(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function getSignatureKey(secretKey, dateStamp, regionName, serviceName) {
  const kDate    = hmac("AWS4" + secretKey, dateStamp);
  const kRegion  = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  return hmac(kService, "aws4_request");
}

function signRequest({ method, url, accessToken, body = "", awsConfig }) {
  const parsedUrl      = new URL(url);
  const service        = "execute-api";
  const now            = new Date();
  const amzDate        = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp      = amzDate.slice(0, 8);
  const payloadHash    = hash(body);
  const hasSessionToken = !!awsConfig.awsSessionToken;

  const canonicalHeaders =
    `host:${parsedUrl.host}\n` +
    `x-amz-access-token:${accessToken}\n` +
    `x-amz-date:${amzDate}\n` +
    (hasSessionToken ? `x-amz-security-token:${awsConfig.awsSessionToken}\n` : "");

  const signedHeaders = hasSessionToken
    ? "host;x-amz-access-token;x-amz-date;x-amz-security-token"
    : "host;x-amz-access-token;x-amz-date";

  const sortedParams = Array.from(parsedUrl.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [method, parsedUrl.pathname, sortedParams, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${awsConfig.awsRegion}/${service}/aws4_request`;
  const stringToSign    = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");

  const signingKey = getSignatureKey(awsConfig.awsSecretAccessKey, dateStamp, awsConfig.awsRegion, service);
  const signature  = hmac(signingKey, stringToSign, "hex");

  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${awsConfig.awsAccessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-access-token": accessToken,
    "x-amz-date": amzDate,
    ...(hasSessionToken ? { "x-amz-security-token": awsConfig.awsSessionToken } : {}),
    "Content-Type": "application/json",
  };
}

// ─── FETCH ALL ORDERS ──────────────────────────────────────────────────────────
async function fetchOrders(
  accessToken,
  { marketplaceId, endpoint, awsAccessKeyId, awsSecretAccessKey, awsRegion, awsSessionToken }
) {
  const { createdAfter, createdBefore } = getDateRange();
  console.log(`\n📦 Fetching Shipped orders from ${createdAfter} to ${createdBefore}...\n`);

  let allOrders = [];
  let nextToken = null;
  let page      = 1;

  do {
    const params = new URLSearchParams({
      MarketplaceIds:    marketplaceId,
      CreatedAfter:      createdAfter,
      CreatedBefore:     createdBefore,
      OrderStatuses:     ORDER_CONFIG.orderStatuses.join(","),
      MaxResultsPerPage: "100",
    });

    if (nextToken) params.set("NextToken", nextToken);

    const url     = `${endpoint}/orders/v0/orders?${params.toString()}`;
    const headers = signRequest({
      method: "GET",
      url,
      accessToken,
      awsConfig: { awsAccessKeyId, awsSecretAccessKey, awsRegion, awsSessionToken },
      body: "",
    });

    const response = await fetch(url, { method: "GET", headers });
    const data     = await response.json();

    if (!response.ok) {
      console.error("Orders API Error:", JSON.stringify(data, null, 2));
      throw new Error(`Orders API failed: ${response.status}`);
    }

    const orders = data?.payload?.Orders || [];
    allOrders    = allOrders.concat(orders);
    nextToken    = data?.payload?.NextToken || null;

    console.log(`  Page ${page}: ${orders.length} orders (total: ${allOrders.length})`);
    page++;

  } while (nextToken);

  return allOrders;
}

module.exports = {
  ORDER_CONFIG,
  sleep,
  getDateRange,
  isEligibleForReview,
  hmac,
  hash,
  getSignatureKey,
  signRequest,
  fetchOrders,
};