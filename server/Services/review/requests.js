const {
  CONFIG,
  sleep,
  isEligibleForReview,
  getLWAAccessToken,
  signRequest,
  fetchOrders,
} = require("./orders");

// ─── SEND REVIEW REQUEST ───────────────────────────────────────────────────────
async function sendReviewRequest(accessToken, orderId) {
  const url = `${CONFIG.endpoint}/solicitations/v1/orders/${orderId}/solicitations/productReview?marketplaceIds=${CONFIG.marketplaceId}`;

  const headers = signRequest({ method: "POST", url, accessToken });

  const response = await fetch(url, {
    method: "POST",
    headers,
  });

  // 201 = success, 429 = rate limited, 422 = ineligible
  if (response.status === 201) {
    return { success: true, orderId };
  }

  const errorData = await response.json();
  return {
    success: false,
    orderId,
    status: response.status,
    error: errorData?.errors?.[0]?.message || "Unknown error",
  };
}

// ─── MAIN FLOW (ORCHESTRATOR) ─────────────────────────────────────────────────
async function main() {
  try {
    const accessToken = await getLWAAccessToken();
    console.log("✅ LWA token obtained.");

    // Step 1: Fetch all Shipped orders
    const allOrders = await fetchOrders(accessToken);
    console.log(`\n📋 Total Shipped orders fetched: ${allOrders.length}`);

    // Step 2: Filter eligible orders (5–30 days old)
    const eligibleOrders = allOrders.filter(isEligibleForReview);
    console.log(`✅ Eligible for review request: ${eligibleOrders.length}`);
    console.log(
      `⛔ Skipped (too new or too old): ${
        allOrders.length - eligibleOrders.length
      }\n`
    );

    if (eligibleOrders.length === 0) {
      console.log("No eligible orders to send review requests for.");
      return;
    }

    // Step 3: Send review requests
    const results = { success: [], failed: [], ineligible: [] };

    for (let i = 0; i < eligibleOrders.length; i++) {
      const order = eligibleOrders[i];
      const orderId = order.AmazonOrderId;

      process.stdout.write(
        `[${i + 1}/${eligibleOrders.length}] Sending review request for ${orderId}... `
      );

      const result = await sendReviewRequest(accessToken, orderId);

      if (result.success) {
        console.log("✅ Sent");
        results.success.push(orderId);
      } else if (result.status === 422) {
        console.log(`⛔ Ineligible: ${result.error}`);
        results.ineligible.push({ orderId, reason: result.error });
      } else {
        console.log(`❌ Failed (${result.status}): ${result.error}`);
        results.failed.push({ orderId, error: result.error });
      }

      // Respect rate limit: 1 request/second for Solicitations API
      await sleep(CONFIG.delayBetweenRequests);
    }

    // Step 4: Summary
    console.log("\n─────────────────────────────────────");
    console.log("📊 Summary");
    console.log("─────────────────────────────────────");
    console.log(`✅ Successfully sent : ${results.success.length}`);
    console.log(`⛔ Ineligible        : ${results.ineligible.length}`);
    console.log(`❌ Failed            : ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.log("\nFailed orders:");
      results.failed.forEach(({ orderId, error }) =>
        console.log(`  - ${orderId}: ${error}`)
      );
    }
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
  }
}

module.exports = {
  sendReviewRequest,
  main,
};

