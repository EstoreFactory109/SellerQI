const OpenAI = require('openai');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('../Calculations/DashboardCalculation.js');
const { checkTitle, checkBulletPoints, BackendKeyWordOrAttributesStatus } = require('../Calculations/Rankings.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const CogsService = require('../Finance/CogsService.js');
const logger = require('../../utils/Logger.js');

let openaiClient = null;

const getOpenAIClient = () => {
    if (openaiClient) return openaiClient;

    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) {
        logger.error('OPENAPI_KEY is not set in environment variables');
        throw new Error('AI configuration error: OPENAPI_KEY is missing');
    }

    try {
        openaiClient = new OpenAI({
            apiKey,
        });
        return openaiClient;
    } catch (err) {
        logger.error('Failed to initialize OpenAI client', {
            message: err.message,
            stack: err.stack,
        });
        throw new Error('Failed to initialize AI client');
    }
};

const SYSTEM_PROMPT = `
You are QMate, a friendly AI assistant inside the SellerQI application for Amazon sellers.

### Role
- Help Amazon sellers understand their business using **only** the analytics data provided to you from SellerQI backend services.
- Turn numbers into clear, easy-to-understand insights and **actionable recommendations**.
- You do **not** fetch raw data yourself – all calculations are done by SellerQI.

### Tone and style (CRITICAL)
- Write in **plain, friendly language** as if talking to a busy seller. Be warm but professional.
- Be **concise and to the point**. Short sentences and short paragraphs. Avoid long blocks of text.
- **Never** include in your answer_markdown: raw JSON, code blocks, field names (e.g. asinWiseSales, datewiseSales), or technical payloads. The user must see only human-readable text.
- Use simple words. If you use a term like ACOS or TACOS, briefly explain it in one short phrase the first time (e.g. "ACOS (ad cost as % of sales)").
- Use bullet points for lists and clear, short headings so the answer is easy to scan.
- Do not repeat the user question back; go straight to the answer.

### Answer scope (CRITICAL)
- **Answer only what was asked.** If the user asks "which products have issues in titles", respond with only: (1) the list of products that have title issues, (2) the specific problem for each (e.g. restricted word, length, special characters), (3) the suggested fix for each. Do NOT add "all other products are fine", "you should also check bullet points", "if you want I can help with...", or generic advice that wasn't asked for.
- For any product- or issue-specific question (titles, bullet points, images, buy box, inventory, etc.): give **only** the affected products, their problems, and the concrete fix for each. No filler, no upsell to other analyses, no closing paragraphs about "improving visibility" or "boosting sales" unless the user asked for that.
- If the user asks about one thing (e.g. title issues), do not add recommendations about other things (e.g. bullet points, descriptions) unless they asked. Keep the answer strictly to the question.

### When suggesting fixes – use SellerQI criteria for ALL issue types (CRITICAL)
Your suggestions must align with the **same rules SellerQI uses** so they are error-free and actionable. For any suggested fix, apply the criteria below and output structured fields so the app can validate where possible.

**1. Ranking**
- **Title:** Length 80–200 characters; no restricted words (e.g. home, natural, safe, green, cure, heal, virus, antibacterial, antimicrobial, pesticide, fda approved, guarantee, proven, certified); no special characters: ! $ ? _ { } ^ ¬ ¦ ~ # < > *
  - When you suggest a fixed title, put the exact string in \`suggested_title\` so the app can validate it.
- **Bullet points:** Each bullet ≥150 characters; same restricted words and special characters as title.
  - When you suggest fixed bullet points, put the array of strings in \`suggested_bullet_points\` so the app can validate.
- **Backend keywords:** Total length ≥450 characters (out of 500); no duplicate words.
  - When you suggest fixed backend keywords, put the exact string in \`suggested_backend_keywords\` so the app can validate.
- **Description:** Each section ≥1700 characters; same restricted words and special characters as title. (If you suggest description fixes, describe the rule so the user can self-check.)

**2. Conversion**
SellerQI counts conversion issues when: fewer than 7 images; no video; no A+ content; star rating <4.3; seller does not hold Buy Box; no Brand Story. When suggesting conversion fixes, recommend only actions that satisfy these (e.g. "add images to reach 7+", "add a product video", "get A+ content", "improve rating to 4.3+", "win Buy Box", "add Brand Story").

**3. Inventory**
SellerQI uses inventory planning, stranded inventory, inbound non-compliance, and replenishment data. When suggesting inventory fixes, base recommendations on the same logic (e.g. replenish low stock, address stranded inventory, fix inbound issues).

**4. Sponsored ads**
SellerQI counts as errors: (a) campaign ACOS > 40% (with sales > 0), (b) keywords/search terms with spend but sales < 0.01 (wasted spend), (c) search terms with ≥10 clicks and sales < 0.01. When suggesting PPC fixes, align with these (e.g. "reduce campaign ACOS below 40%", "pause or add negatives for zero-sales keywords", "review high-clicks zero-sales search terms").

**5. Profitability**
SellerQI counts as errors: profit margin < 10% or negative net profit (sales − ads − Amazon fees). When suggesting profitability fixes, align with these (e.g. "improve margin above 10%", "reduce ad spend or fees to turn loss into profit").

**Structured suggestion fields (for validation):**
- \`suggested_title\` – exact suggested title string when you suggest a fixed title.
- \`suggested_bullet_points\` – array of strings (one per bullet) when you suggest fixed bullet points.
- \`suggested_backend_keywords\` – exact suggested backend keywords string when you suggest fixed backend keywords.
The backend will run these through the same SellerQI checks and surface any remaining errors to the user.

### Data & capabilities
You receive a JSON payload like:
{
  "question": "user question here",
  "dashboard": {
    "summary": {
      "brand": "Brand name",
      "country": "IN",
      "dateRange": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
      "totalSales": 12345.67,
      "grossProfit": 2345.67,
      "ppcSpend": 1234.56,
      "accountHealth": {
        "percentage": 87,
        "status": "GOOD" | "CRITICAL" | "DATA_NOT_FOUND"
      }
    },
    "profitability": {
      "topAsins": [
        {
          "asin": "B00EXAMPLE",
          "sales": 1234.56,
          "grossProfit": 345.67,
          "profitMargin": 28.0,
          "ads": 120.00,
          "amazonFees": 300.00,
          "errors": []
        }
      ],
      "lowMarginAsins": [ ... ],
      "lossMakingAsins": [ ... ]
    },
    "ads": {
      "summary": {
        "totalSpend": 1000,
        "totalSalesFromAds": 4000,
        "overallAcos": 25.0,
        "overallTacos": 8.0
      },
      "wastedSpendSummary": {
        "wastedSpend": 123.45,
        "wastedKeywordsCount": 10
      }
    },
    "issues": {
      "totalErrors": 120,
      "conversionErrors": 40,
      "rankingErrors": 30,
      "inventoryErrors": 50,
      "topErrorAsins": [
        { "asin": "B0ERROR1", "name": "Sample Product", "totalErrors": 12 }
      ]
    }
  }
}

Field names may vary slightly but follow the same meaning as SellerQI dashboard data.
If some sections are missing or arrays are empty, you must **acknowledge that gracefully** instead of inventing values.

### Output format (IMPORTANT)
You MUST respond as a **single JSON object** with this exact shape:

{
  "answer_markdown": "string - markdown formatted main answer for the user",
  "chart_suggestions": [
    {
      "id": "short_unique_id",
      "title": "Readable chart title",
      "type": "line" | "bar" | "pie",
      "dataSource": "ppc_datewise" | "sales_datewise",
      "xField": "date or label field name for client charts",
      "yFields": [
        { "field": "spend", "label": "Ad Spend" },
        { "field": "sales", "label": "Sales" }
      ],
      "description": "1–2 sentences explaining what the chart shows and how to interpret it."
    }
  ],
  "follow_up_questions": [
    "Short, specific follow-up question the user could ask next"
  ],
  "suggested_title": "optional - when you suggest a fixed product title, put the exact suggested title string here",
  "suggested_bullet_points": "optional - when you suggest fixed bullet points, put an array of strings (one per bullet) here",
  "suggested_backend_keywords": "optional - when you suggest fixed backend keywords, put the exact string here (single string, up to 500 chars)"
}

Rules:
- answer_markdown is required. Keep it concise and user-friendly. For narrow questions (e.g. "which products have title issues"), aim for a short answer: list the items, the problem, and the fix—often 50–150 words is enough. For broader questions you may use 200–400 words. No JSON, no code, no technical field names—only readable prose and bullet points.
- chart_suggestions can be an empty array when charts are not useful.
- Use **only** these dataSource values:
  - \`ppc_datewise\` – for PPC spend vs sales over time (SellerQI uses dateWise PPC metrics).
  - \`sales_datewise\` – for total sales and profit over time.
- Choose at most **2 charts** per answer unless explicitly asked for more.
- follow_up_questions should help the seller go deeper into diagnostics or actions.
- **When to include which chart (STRICT – match charts to what was asked):**
  - **Sales-only queries:** When the user asks for "sales performance", "sales trends", "key metrics", "revenue", "sales over time", "last 7/30 days" (without mentioning ads or PPC), include **only** a chart_suggestion with dataSource \`sales_datewise\` (e.g. "Sales and profit – last 30 days"). Do **NOT** add a PPC or ad-spend chart for these queries.
  - **PPC/ads queries:** Include a chart with dataSource \`ppc_datewise\` **only** when the user explicitly asks about PPC, ad spend, ads, advertising, "where am I wasting money", or ACOS. Do not add a PPC chart when they asked only about sales or key metrics.
  - **Both:** Include both sales_datewise and ppc_datewise only when the user explicitly asks for both (e.g. "sales and ad performance for the last 30 days"). Otherwise, one chart type only, matching the question.

### Behaviour guidelines
1. **Use SellerQI calculations as source of truth.**
   - Do not recalculate ACOS/TACOS yourself if they are provided.
   - Never assume data for an ASIN if it is not in the context.
2. **Always connect metrics to actions.**
   - For each key insight, recommend a concrete next step:
     - what to change,
     - where in Seller Central or SellerQI to look,
     - expected qualitative impact.
3. **Be honest about data quality.**
   - If numbers look incomplete, stale, or missing, explicitly say:
     - what is missing,
     - what you can still infer,
     - what the user should refresh or configure.
4. **Stay on topic.**
   - Only answer questions related to Amazon seller performance, products, SPI data, ads, profitability, inventory, or SellerQI itself.
   - If the question is outside this scope, briefly decline and suggest a relevant alternative question.

### Example 1 – Account health overview
User question:
- "Give me a quick health check of my account and what to fix first."

Good \`answer_markdown\` structure:
- **Section 1 – High-level summary** (sales trend, profit, ACOS/TACOS, account health status)
- **Section 2 – Top 3 urgent issues** (e.g. low-margin ASINs, high ACOS campaigns, inventory risks)
- **Section 3 – Prioritized action plan** (1–5 bullet points with concrete steps)

Example \`chart_suggestions\`:
[
  {
    "id": "overall_sales_trend",
    "title": "Total Sales vs Gross Profit (Last 30 Days)",
    "type": "line",
    "dataSource": "sales_datewise",
    "xField": "date",
    "yFields": [
      { "field": "TotalAmount", "label": "Sales" },
      { "field": "Profit", "label": "Gross Profit" }
    ],
    "description": "Shows whether profit is growing in line with sales or lagging behind, helping you spot margin compression."
  }
]

### Example 2 – Ads / PPC question
User question:
- "How are my ads performing in the last month and where am I wasting money?"

Good \`answer_markdown\` structure:
- Brief PPC overview (spend, sales from ads, ACOS, TACOS).
- Explanation of wasted spend (keywords/search terms with spend but no sales).
- 3–5 targeted optimization steps (pause, bid change, move to exact, add negatives).

Example \`chart_suggestions\`:
[
  {
    "id": "ppc_spend_vs_sales",
    "title": "PPC Spend vs Sales (Last 30 Days)",
    "type": "line",
    "dataSource": "ppc_datewise",
    "xField": "date",
    "yFields": [
      { "field": "totalCost", "label": "Ad Spend" },
      { "field": "sales", "label": "Sales from Ads" }
    ],
    "description": "Helps you see if additional spend is generating proportional sales or if ACOS is rising."
  }
]

### Example 3 – Product / ASIN level question
User question:
- "Which products should I optimize first and what exactly should I do?"

Good answer:
- Rank products by severity (profit loss, number of issues, missing content, inventory problems).
- For 3–5 ASINs:
  - briefly say **what is wrong** (e.g. high ACOS, low margin, missing images/A+, stranded inventory),
  - give a **concrete checklist** of 2–4 actions per ASIN.

Remember: **never** fabricate raw numbers. Only interpret the structured context you receive.
`;

/**
 * Build a compact context object for the model from full dashboard data.
 * We intentionally limit array sizes to keep tokens under control.
 * @param {Object} dashboardData - Dashboard data from analyseData()
 * @param {string} question - User's question
 * @param {Object|null} ppcMetrics - PPCMetrics data from PPCMetrics model (optional)
 * @param {Object} cogsValues - COGS values keyed by ASIN (optional)
 */
const buildModelContext = (dashboardData, question, ppcMetrics = null, cogsValues = {}) => {
    if (!dashboardData) {
        return {
            question,
            dashboard: {
                summary: null,
                profitability: null,
                ads: null,
                issues: null,
            },
        };
    }

    const {
        Brand,
        Country,
        startDate,
        endDate,
        accountHealthPercentage,
        accountFinance,
        TotalWeeklySale,
        economicsMetrics,
        profitibilityData,
        totalProfitabilityErrors,
        profitabilityErrorDetails,
        sponsoredAdsMetrics,
        dateWiseTotalCosts,
        campaignWiseTotalSalesAndCost,
        totalSponsoredAdsErrors,
        sponsoredAdsErrorDetails,
        adsKeywordsPerformanceData, // Raw keyword data for wasted spend calculation
        totalErrorInConversion,
        TotalRankingerrors,
        totalInventoryErrors,
        totalErrorInAccount, // Account health errors
        productWiseError,
    } = dashboardData;

    // IMPORTANT: Use the SAME values as the dashboard displays to ensure consistency
    // Dashboard prioritizes PPCMetrics model data (from Amazon Ads API) over sponsoredAdsMetrics
    // Dashboard uses TotalWeeklySale (calculated by summing datewiseSales) for sales
    // Dashboard calculates Gross Profit = Backend Gross Profit - Ad Spend
    
    // PPC values: Use PPCMetrics model data if available (PRIMARY), fallback to sponsoredAdsMetrics
    const ppcSummary = ppcMetrics?.summary;
    const ppcSpendValue = ppcSummary?.totalSpend ?? sponsoredAdsMetrics?.adsPpcSpent ?? sponsoredAdsMetrics?.totalCost ?? null;
    const ppcSalesValue = ppcSummary?.totalSales ?? sponsoredAdsMetrics?.totalSalesIn30Days ?? null;
    
    // Calculate ACOS the same way Dashboard.jsx does (lines 471-474):
    // Use ppcSummary.overallAcos if available, otherwise calculate spend/sales * 100
    let acosValue = ppcSummary?.overallAcos ?? sponsoredAdsMetrics?.acos ?? null;
    if (acosValue === null && ppcSalesValue > 0 && ppcSpendValue > 0) {
        acosValue = (ppcSpendValue / ppcSalesValue) * 100;
    }
    
    // Calculate TACOS the same way PPCDashboard.jsx does (line 1153):
    // tacos = totalSales > 0 ? (spend / totalSales) * 100 : 0
    const totalSalesForTacos = TotalWeeklySale || economicsMetrics?.totalSales?.amount || 0;
    let tacosValue = sponsoredAdsMetrics?.tacos ?? null;
    if (tacosValue === null && totalSalesForTacos > 0 && ppcSpendValue > 0) {
        tacosValue = (ppcSpendValue / totalSalesForTacos) * 100;
    }
    
    // Calculate gross profit the SAME way the dashboard does:
    // Dashboard shows: Gross Profit = Backend Gross Profit (accountFinance.Gross_Profit) - Ad Spend
    // See ProfitibilityDashboard.jsx line 490: const grossProfit = grossProfitFromBackend - adSpend;
    const grossProfitFromBackend = accountFinance?.Gross_Profit || economicsMetrics?.grossProfit?.amount || 0;
    const adSpend = ppcSpendValue || 0;
    const displayedGrossProfit = grossProfitFromBackend - adSpend;
    
    // Calculate total sales the same way the dashboard does
    const displayedTotalSales = TotalWeeklySale || economicsMetrics?.totalSales?.amount || 0;
    
    // Calculate profit margin the same way ProfitibilityDashboard.jsx does (line 516):
    // profitMargin = totalSales > 0 ? ((grossProfit / totalSales) * 100) : 0
    const profitMargin = displayedTotalSales > 0 
        ? ((displayedGrossProfit / displayedTotalSales) * 100) 
        : 0;
    
    const summary = {
        brand: Brand || null,
        country: Country || null,
        dateRange: {
            startDate: startDate || null,
            endDate: endDate || null,
        },
        // Use TotalWeeklySale first - this is the calculated value the dashboard uses
        totalSales: displayedTotalSales || null,
        // Use displayedGrossProfit - this matches what the dashboard shows (backend profit - ad spend)
        grossProfit: displayedGrossProfit,
        // Profit margin calculated same as dashboard: (grossProfit / totalSales) * 100
        profitMargin: parseFloat(profitMargin.toFixed(2)),
        // Use PPCMetrics values first - these are what the dashboard displays
        ppcSpend: ppcSpendValue,
        accountHealth: {
            percentage: accountHealthPercentage?.Percentage ?? null,
            status: accountHealthPercentage?.status ?? null,
        },
    };

    // IMPORTANT: Calculate net profit margin WITH COGS to match the dashboard
    // Dashboard uses: netProfit = grossProfit - (cogsPerUnit * quantity)
    // Dashboard uses: profitMargin = (netProfit / sales) * 100
    const topProfitability = Array.isArray(profitibilityData)
        ? profitibilityData
              .slice()
              .map(p => {
                  // Get COGS for this ASIN (if user has entered it)
                  const cogsPerUnit = cogsValues[p.asin] || 0;
                  const quantity = p.quantity || 0;
                  const totalCogs = cogsPerUnit * quantity;
                  
                  // Calculate gross profit (same as backend)
                  const grossProfit = p.grossProfit !== undefined 
                      ? p.grossProfit 
                      : ((p.sales || 0) - (p.ads || 0) - (p.totalFees || p.amzFee || 0));
                  
                  // Calculate net profit (subtracting COGS like dashboard does)
                  const netProfit = grossProfit - totalCogs;
                  
                  // Calculate net profit margin (same as dashboard: ProfitibilityDashboard.jsx line 854)
                  const netProfitMargin = p.sales > 0 ? (netProfit / p.sales) * 100 : 0;
                  
                  return {
                      ...p,
                      grossProfit: parseFloat(grossProfit.toFixed(2)),
                      totalCogs: parseFloat(totalCogs.toFixed(2)),
                      netProfit: parseFloat(netProfit.toFixed(2)),
                      // Use net profit margin (with COGS) for consistency with dashboard
                      netProfitMargin: parseFloat(netProfitMargin.toFixed(2)),
                  };
              })
              .sort((a, b) => (b.sales || 0) - (a.sales || 0))
              .slice(0, 25)
        : [];

    // Filter loss-making ASINs using NET profit (after COGS)
    const lossMakingAsins = topProfitability
        .filter((p) => (p.netProfit || 0) < 0)
        .slice(0, 15);
    
    // Filter low margin ASINs using NET profit margin (after COGS)
    // This matches dashboard: ProfitibilityDashboard.jsx line 662-663
    const lowMarginAsins = topProfitability
        .filter((p) => (p.netProfitMargin || 0) >= 0 && p.netProfitMargin < 10)
        .slice(0, 15);

    const profitability = {
        topAsins: topProfitability,
        lowMarginAsins,
        lossMakingAsins,
        totalProfitabilityErrors: totalProfitabilityErrors ?? null,
        profitabilityErrorDetails: Array.isArray(profitabilityErrorDetails)
            ? profitabilityErrorDetails.slice(0, 50)
            : [],
    };

    const ads = {
        summary: {
            // Use PPCMetrics values first - these are what the dashboard displays
            totalSpend: ppcSpendValue,
            totalSalesFromAds: ppcSalesValue,
            overallAcos: acosValue,
            overallTacos: tacosValue,
        },
        // IMPORTANT: Calculate wasted spend from raw keyword data WITHOUT aggregation
        // This matches how Dashboard.jsx calculates it (lines 483-504)
        // Dashboard sums ALL keyword rows where cost > 0 and sales < 0.01
        wastedSpendSummary: (() => {
            if (!Array.isArray(adsKeywordsPerformanceData)) {
                return null;
            }
            // Filter keywords with cost > 0 and sales < 0.01 (wasted spend)
            const wastedKeywords = adsKeywordsPerformanceData.filter(kw => {
                const cost = parseFloat(kw.cost) || 0;
                const sales = parseFloat(kw.attributedSales30d) || 0;
                return cost > 0 && sales < 0.01;
            });
            // Sum all wasted spend without aggregation (same as dashboard)
            const wastedSpend = wastedKeywords.reduce(
                (sum, kw) => sum + (parseFloat(kw.cost) || 0),
                0
            );
            // Get top wasted keywords by spend for AI context
            const topWastedKeywords = wastedKeywords
                .sort((a, b) => (parseFloat(b.cost) || 0) - (parseFloat(a.cost) || 0))
                .slice(0, 10)
                .map(kw => ({
                    keyword: kw.keyword,
                    spend: parseFloat(kw.cost) || 0,
                    campaignName: kw.campaignName || 'Unknown Campaign',
                }));
            return {
                wastedSpend: parseFloat(wastedSpend.toFixed(2)),
                wastedKeywordsCount: wastedKeywords.length,
                topWastedKeywords,
            };
        })(),
        ppcDatewiseSample: Array.isArray(dateWiseTotalCosts)
            ? dateWiseTotalCosts.slice(-30)
            : [],
        campaignSample: Array.isArray(campaignWiseTotalSalesAndCost)
            ? campaignWiseTotalSalesAndCost.slice(0, 30)
            : [],
        totalSponsoredAdsErrors: totalSponsoredAdsErrors ?? null,
        sponsoredAdsErrorDetails: Array.isArray(sponsoredAdsErrorDetails)
            ? sponsoredAdsErrorDetails.slice(0, 50)
            : [],
    };

    // Calculate totalIssues the SAME way Dashboard.jsx does (lines 458-465):
    // totalProfitabilityErrors + totalSponsoredAdsErrors + totalInventoryErrors + 
    // TotalRankingerrors + totalErrorInConversion + totalErrorInAccount
    const issues = {
        totalErrors:
            (totalProfitabilityErrors || 0) +
            (totalSponsoredAdsErrors || 0) +
            (totalInventoryErrors || 0) +
            (TotalRankingerrors || 0) +
            (totalErrorInConversion || 0) +
            (totalErrorInAccount || 0),
        // Individual error counts for detailed breakdown
        profitabilityErrors: totalProfitabilityErrors ?? null,
        sponsoredAdsErrors: totalSponsoredAdsErrors ?? null,
        conversionErrors: totalErrorInConversion ?? null,
        rankingErrors: TotalRankingerrors ?? null,
        inventoryErrors: totalInventoryErrors ?? null,
        accountErrors: totalErrorInAccount ?? null,
        topErrorAsins: Array.isArray(productWiseError)
            ? productWiseError
                  .slice()
                  .sort((a, b) => (b.errors || 0) - (a.errors || 0))
                  .slice(0, 30)
            : [],
    };

    return {
        question,
        dashboard: {
            summary,
            profitability,
            ads,
            issues,
        },
    };
};

/**
 * QMateService
 * - Orchestrates fetching existing analytics and generating AI answers.
 */
class QMateService {
    /**
     * Generate an AI response for a given user question.
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} params.country
     * @param {string} params.region
     * @param {string} params.question
     * @param {Array<{role: string, content: string}>} [params.chatHistory]
     */
    static async generateResponse({ userId, country, region, question, chatHistory = [] }) {
        const client = getOpenAIClient();

        // Step 1: Fetch existing analytics using the same services as the dashboards
        const analyseStart = Date.now();
        const analyseResult = await AnalyseService.Analyse(userId, country, region);
        logger.info('[QMate] AnalyseService.Analyse completed', {
            userId,
            country,
            region,
            durationMs: Date.now() - analyseStart,
            status: analyseResult?.status,
        });

        if (!analyseResult || analyseResult.status !== 200 || !analyseResult.message) {
            const status = analyseResult?.status || 500;
            const message =
                analyseResult?.message ||
                'Unable to fetch analysis data for this account.';

            return {
                status,
                error: message,
            };
        }

        // Step 2: Run dashboard calculations so we reuse all existing logic
        const calcStart = Date.now();
        const { dashboardData } = await analyseData(analyseResult.message, null);
        logger.info('[QMate] DashboardCalculation.analyseData completed', {
            userId,
            country,
            region,
            durationMs: Date.now() - calcStart,
        });

        // Step 2.5: Fetch PPCMetrics data - this is what the dashboard displays for PPC values
        // The frontend dashboard uses PPCMetrics model as PRIMARY source for PPC data
        let ppcMetrics = null;
        try {
            const ppcStart = Date.now();
            ppcMetrics = await PPCMetrics.findLatestForUser(userId, country, region);
            logger.info('[QMate] PPCMetrics.findLatestForUser completed', {
                userId,
                country,
                region,
                durationMs: Date.now() - ppcStart,
                found: !!ppcMetrics,
            });
        } catch (ppcError) {
            logger.warn('[QMate] Failed to fetch PPCMetrics, will use fallback data', {
                userId,
                error: ppcError.message,
            });
        }

        // Step 2.6: Fetch COGS data - needed to calculate net profit margin like the dashboard
        let cogsValues = {};
        try {
            const cogsStart = Date.now();
            const cogsResult = await CogsService.getCogs(userId, country);
            if (cogsResult?.success && cogsResult?.data?.cogsValues) {
                cogsValues = cogsResult.data.cogsValues;
            }
            logger.info('[QMate] CogsService.getCogs completed', {
                userId,
                country,
                durationMs: Date.now() - cogsStart,
                cogsCount: Object.keys(cogsValues).length,
            });
        } catch (cogsError) {
            logger.warn('[QMate] Failed to fetch COGS, will use 0 for all products', {
                userId,
                error: cogsError.message,
            });
        }

        // Step 3: Build compact context for the model
        const modelContext = buildModelContext(dashboardData, question, ppcMetrics, cogsValues);

        // Step 4: Build messages for OpenAI
        const baseMessages = [
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
        ];

        // Include a short trimmed chat history for continuity (last 6 messages)
        const trimmedHistory = Array.isArray(chatHistory)
            ? chatHistory.slice(-6).map((m) => ({
                  role: m.role === 'assistant' ? 'assistant' : 'user',
                  content: String(m.content || '').slice(0, 2000),
              }))
            : [];

        const userMessage = {
            role: 'user',
            content: JSON.stringify(modelContext),
        };

        const messages = [...baseMessages, ...trimmedHistory, userMessage];

        // Step 5: Call OpenAI
        let aiRaw;
        try {
            const completion = await client.chat.completions.create({
                model: 'gpt-4.1-mini',
                response_format: { type: 'json_object' },
                messages,
            });

            const content = completion.choices?.[0]?.message?.content || '{}';
            aiRaw = content;
        } catch (err) {
            logger.error('[QMate] OpenAI chat.completions.create failed', {
                message: err.message,
                stack: err.stack,
            });

            return {
                status: 500,
                error: 'AI service is currently unavailable. Please try again in a moment.',
            };
        }

        // Step 6: Parse model JSON safely
        let parsed;
        try {
            parsed = JSON.parse(aiRaw);
        } catch (err) {
            logger.error('[QMate] Failed to parse AI JSON response', {
                message: err.message,
                raw: aiRaw?.slice(0, 500),
            });
            parsed = {
                answer_markdown:
                    'I encountered an internal formatting issue while generating the answer. Please ask your question again or try rephrasing it.',
                chart_suggestions: [],
                follow_up_questions: [],
            };
        }

        // Sanitize: remove code blocks and raw JSON lines so the user never sees them
        let answer_markdown = (parsed.answer_markdown || '').trim();
        answer_markdown = answer_markdown
            .replace(/```[\s\S]*?```/g, '')
            .split('\n')
            .filter((line) => {
                const t = line.trim();
                if (!t) return true;
                if (t.startsWith('{') && t.endsWith('}') && t.length > 60) return false;
                return true;
            })
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!answer_markdown) {
            answer_markdown = "Here’s what I found based on your account data. If you’d like more detail on a specific area, ask a follow-up question below.";
        }

        const chart_suggestions = Array.isArray(parsed.chart_suggestions)
            ? parsed.chart_suggestions
            : [];
        const follow_up_questions = Array.isArray(parsed.follow_up_questions)
            ? parsed.follow_up_questions
            : [];

        // Validate suggested title if present (same rules as ranking/title check)
        const suggestedTitle = typeof parsed.suggested_title === 'string'
            ? parsed.suggested_title.trim()
            : '';
        if (suggestedTitle) {
            const titleCheck = checkTitle(suggestedTitle);
            const errCount = titleCheck.NumberOfErrors || 0;
            const validationNote =
                errCount === 0
                    ? '\n\n*This suggested title has been validated and passes SellerQI title checks (length, no restricted words, no prohibited special characters).*'
                    : '\n\n**Title validation:** The suggested title still has issues according to SellerQI rules: '
                        + [
                            titleCheck.charLim?.status === 'Error' ? titleCheck.charLim.Message : null,
                            titleCheck.RestictedWords?.status === 'Error' ? titleCheck.RestictedWords.Message : null,
                            titleCheck.checkSpecialCharacters?.status === 'Error' ? titleCheck.checkSpecialCharacters.Message : null,
                        ]
                            .filter(Boolean)
                            .join(' ') + ' Please revise the title to fix these.';
            answer_markdown = answer_markdown + validationNote;
        }

        // Validate suggested bullet points if present (same rules as ranking/bullet check)
        const suggestedBulletPoints = Array.isArray(parsed.suggested_bullet_points)
            ? parsed.suggested_bullet_points.filter((s) => typeof s === 'string')
            : [];
        if (suggestedBulletPoints.length > 0) {
            const bulletCheck = checkBulletPoints(suggestedBulletPoints);
            const errCount = bulletCheck.NumberOfErrors || 0;
            const validationNote =
                errCount === 0
                    ? '\n\n*These suggested bullet points have been validated and pass SellerQI checks (length ≥150 each, no restricted words, no prohibited special characters).*'
                    : '\n\n**Bullet points validation:** The suggested bullet points still have issues according to SellerQI rules: '
                        + [
                            bulletCheck.charLim?.status === 'Error' ? bulletCheck.charLim.Message : null,
                            bulletCheck.RestictedWords?.status === 'Error' ? bulletCheck.RestictedWords.Message : null,
                            bulletCheck.checkSpecialCharacters?.status === 'Error' ? bulletCheck.checkSpecialCharacters.Message : null,
                        ]
                            .filter(Boolean)
                            .join(' ') + ' Please revise to fix these.';
            answer_markdown = answer_markdown + validationNote;
        }

        // Validate suggested backend keywords if present (same rules as ranking/backend keywords)
        const suggestedBackendKeywords = typeof parsed.suggested_backend_keywords === 'string'
            ? parsed.suggested_backend_keywords.trim()
            : '';
        if (suggestedBackendKeywords) {
            const kwCheck = BackendKeyWordOrAttributesStatus(suggestedBackendKeywords);
            const errCount = kwCheck.NumberOfErrors || 0;
            const validationNote =
                errCount === 0
                    ? '\n\n*These suggested backend keywords have been validated and pass SellerQI checks (≥450 characters, no duplicate words).*'
                    : '\n\n**Backend keywords validation:** The suggested keywords still have issues according to SellerQI rules: '
                        + [
                            kwCheck.charLim?.status === 'Error' ? kwCheck.charLim.Message : null,
                            kwCheck.dublicateWords?.status === 'Error' ? kwCheck.dublicateWords.Message : null,
                        ]
                            .filter(Boolean)
                            .join(' ') + ' Please revise to fix these.';
            answer_markdown = answer_markdown + validationNote;
        }

        // Step 7: Attach chart data for allowed data sources; support "last 7 days" and sales vs sales+profit
        const questionLower = (question || '').toLowerCase();
        const wantsLast7 =
            /\b(7|seven)\s*day|last\s*7|past\s*7|weekly\b/.test(questionLower);
        const wantsProfit =
            /\bprofit\b|\bmargin\b/.test(questionLower);
        const dateLimit = wantsLast7 ? 7 : 30;

        const chartsWithData = chart_suggestions.map((chart) => {
            if (!chart || !chart.dataSource) return chart;

            if (chart.dataSource === 'ppc_datewise') {
                const raw =
                    Array.isArray(dashboardData.dateWiseTotalCosts) &&
                    dashboardData.dateWiseTotalCosts.length > 0
                        ? dashboardData.dateWiseTotalCosts
                        : [];
                const slice = raw.slice(-dateLimit);
                return {
                    ...chart,
                    data: slice,
                    xField: chart.xField || 'date',
                    yFields:
                        chart.yFields && chart.yFields.length > 0
                            ? chart.yFields
                            : [
                                  { field: 'totalCost', label: 'Ad Spend' },
                                  { field: 'sales', label: 'Sales' },
                              ],
                };
            }

            if (chart.dataSource === 'sales_datewise') {
                const totalSalesArr = Array.isArray(dashboardData.TotalSales)
                    ? dashboardData.TotalSales
                    : [];
                const slice = totalSalesArr.slice(-dateLimit);

                // If the model explicitly set yFields, respect that.
                // Otherwise:
                // - If user asked only for sales, show just Sales.
                // - If user asked for sales and profit, show Sales vs Profit.
                const fallbackYFields = wantsProfit
                    ? [
                          { field: 'TotalAmount', label: 'Sales' },
                          { field: 'Profit', label: 'Profit' },
                      ]
                    : [
                          { field: 'TotalAmount', label: 'Sales' },
                      ];

                return {
                    ...chart,
                    data: slice,
                    xField: chart.xField || 'interval',
                    yFields:
                        chart.yFields && chart.yFields.length > 0
                            ? chart.yFields
                            : fallbackYFields,
                };
            }

            return chart;
        });

        return {
            status: 200,
            answer_markdown,
            chart_suggestions: chartsWithData,
            follow_up_questions,
        };
    }
}

module.exports = {
    QMateService,
};

