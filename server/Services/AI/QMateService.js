const OpenAI = require('openai');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('../Calculations/DashboardCalculation.js');
const { checkTitle, checkBulletPoints, BackendKeyWordOrAttributesStatus } = require('../Calculations/Rankings.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const CogsService = require('../Finance/CogsService.js');
const logger = require('../../utils/Logger.js');

// New optimized services for pre-computed data
const QMateIssuesService = require('./QMateIssuesService.js');
const QMateMetricsService = require('./QMateMetricsService.js');
const QMatePPCService = require('./QMatePPCService.js');
const QMateProfitabilityService = require('./QMateProfitabilityService.js');
const QMateInventoryService = require('./QMateInventoryService.js');
const QMateReimbursementService = require('./QMateReimbursementService.js');
const QMateProductsService = require('./QMateProductsService.js');
const QMateAccountService = require('./QMateAccountService.js');

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
You receive a comprehensive JSON payload with all SellerQI data. Here is the complete structure:

{
  "question": "user question here",
  "dashboard": {
    "summary": {
      "brand": "Brand name",
      "country": "IN",
      "dateRange": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
      "totalSales": 12345.67,
      "grossProfit": 2345.67,
      "netProfit": 1234.56,
      "profitMargin": 15.5,
      "ppcSpend": 1234.56,
      "fbaFees": 500.00,
      "storageFees": 50.00,
      "amazonFees": 800.00,
      "totalFees": 1350.00,
      "refunds": 123.45,
      "accountHealth": 87,
      "buyBox": { "totalProducts": 100, "winningBuyBox": 85, "lostBuyBox": 15, "winRate": 85 },
      "orders": { "totalOrders": 250, "totalUnits": 400, "avgOrderValue": 49.38, "refundedOrders": 10, "refundRate": 4 },
      "wastedAdsSpend": 234.56,
      "productCounts": { "totalProducts": 150, "withErrors": 45, "amazonReady": 105 }
    },
    "profitability": {
      "topAsins": [{ "asin": "B00EXAMPLE", "sales": 1234.56, "grossProfit": 345.67, "profitMargin": 28.0, "ads": 120.00, "amazonFees": 300.00 }],
      "lowMarginAsins": [ ... ],
      "lossMakingAsins": [ ... ],
      "hasCOGSData": true,
      "marginCategories": { "healthy": 50, "lowMargin": 30, "negative": 20 },
      "parentChildAnalysis": { "totalParents": 25, "totalChildren": 120 }
    },
    "ads": {
      "summary": { "totalSpend": 1000, "totalSalesFromAds": 4000, "overallAcos": 25.0, "overallTacos": 8.0, "overallRoas": 4.0, "totalImpressions": 50000, "totalClicks": 1500, "ctr": 3.0, "cpc": 0.67 },
      "campaignTypeBreakdown": { "SP": { "spend": 600 }, "SB": { "spend": 300 }, "SD": { "spend": 100 } },
      "wastedSpendSummary": { "totalWasted": 234.56, "highAcosCampaignsCount": 5, "zeroSalesKeywordsCount": 45, "wastedSearchTermsCount": 20 },
      "topWastedKeywords": [{ "keyword": "example", "spend": 50, "clicks": 100, "sales": 0 }],
      "highAcosCampaigns": [{ "campaignName": "Campaign1", "acos": 65, "spend": 200 }],
      "topPerformingKeywords": [{ "keyword": "best example", "sales": 500, "acos": 15 }],
      "campaignOverview": { "activeCampaigns": 20, "pausedCampaigns": 5, "totalCampaigns": 25 }
    },
    "issues": {
      "totalErrors": 120,
      "profitabilityErrors": 15,
      "sponsoredAdsErrors": 25,
      "conversionErrors": 40,
      "rankingErrors": 30,
      "inventoryErrors": 10,
      "accountErrors": 0,
      "dataCounts": { 
        "rankingIssuesProductCount": 25,
        "conversionIssuesRetrieved": 40,
        "inventoryIssuesRetrieved": 10
      },
      "topErrorAsins": [{ "asin": "B0ERROR1", "name": "Sample Product", "sku": "SKU123", "errors": 12, "rankingIssues": [...], "conversionIssues": [...], "inventoryIssues": [...] }],
      "rankingIssuesDetails": [
        { 
          "asin": "B00EXAMPLE", 
          "title": "Product Name",
          "totalIssueCount": 2,
          "issues": [
            { "section": "Title", "type": "character_limit", "message": "Title is too short", "howToSolve": "Extend to 80-200 chars" },
            { "section": "Backend Keywords", "type": "byte_limit", "message": "Exceeds 250-byte limit", "howToSolve": "Reduce to 249 bytes" }
          ]
        }
      ],
      "conversionIssuesDetails": [{ "asin": "B00CONV", "title": "Product", "issues": [{ "type": "low_image_count", "message": "Only 3 images", "suggestion": "Add more images" }] }],
      "inventoryIssuesDetails": [{ "asin": "B00INV", "title": "Product", "issues": [{ "type": "stranded_inventory", "message": "Has stranded inventory" }] }],
      "profitabilityIssuesDetails": [{ "asin": "B00PROFIT", "issues": [{ "type": "low_margin", "profitMargin": 5, "sales": 1000 }] }],
      "sponsoredAdsIssuesDetails": [{ "asin": null, "issues": [{ "type": "high_acos", "campaignName": "Campaign1", "acos": 65 }] }]
    },
    "inventory": {
      "stranded": { "hasStranded": true, "totalStranded": 15, "byReason": { "LISTING_CLOSED": 5, "PRICING_ERROR": 10 }, "topStrandedProducts": [...] },
      "nonCompliance": { "hasIssues": true, "totalIssues": 8, "byProblemType": { "MISSING_DOCS": 5, "LABEL_ERROR": 3 } },
      "aging": { "hasAgingInventory": true, "totalAgingUnits": 500, "agingCategories": { "181-270": 200, "271-365": 200, "365+": 100 }, "topAgingProducts": [...] },
      "replenishment": { "hasRecommendations": true, "needsRestock": 20, "outOfStock": 5, "lowStock": 15, "topReplenishmentProducts": [...] },
      "healthSummary": { "overallHealth": "NEEDS_ATTENTION", "criticalIssues": 5 }
    },
    "reimbursement": {
      "summary": { "totalEligible": 1500.00, "totalApproved": 800.00, "totalPending": 700.00, "claimCount": 25 },
      "byReason": [{ "reason": "LOST_INBOUND", "count": 10, "amount": 500 }],
      "lostInventory": { "totalLost": 50, "totalValue": 750.00 },
      "customerReturns": { "totalReturns": 100, "damagedReturns": 15, "recoverableValue": 200.00 },
      "monthlyTrends": [{ "month": "2024-01", "amount": 150 }],
      "insights": { "potentialRecovery": 500.00, "expiringClaimsDays": 5 }
    },
    "products": {
      "reviews": { "summary": { "avgRating": 4.2, "totalReviews": 5000 }, "lowRatedProducts": [...], "noReviewsProducts": [...] },
      "sales": { "summary": { "totalProducts": 150, "productsWithSales": 120, "zeroSalesProducts": 30 }, "topSellers": [...], "zeroSalesProducts": [...] },
      "listingQuality": { "healthy": 80, "needsWork": 50, "critical": 20 },
      "healthSummary": { "overallScore": 75, "issueBreakdown": {...} }
    },
    "account": {
      "currentStatus": { "health": 87, "status": "GOOD", "vohrStatus": "OK" },
      "historicalHealth": { "trend": "IMPROVING", "averageScore": 85, "recentHistory": [{ "date": "2024-01-15", "score": 87 }] },
      "issueTrends": { "direction": "DECREASING", "issueChange": -5 },
      "marketplaces": [{ "country": "US", "health": 92 }, { "country": "UK", "health": 85 }],
      "insights": { "recommendations": ["Focus on improving UK marketplace health"] }
    },
    "buyBox": {
      "summary": { "totalProducts": 100, "winningBuyBox": 85, "lostBuyBox": 15, "winRate": 85 },
      "productsWithoutBuyBox": [{ "asin": "B00NOBUYBOX", "name": "Product Name", "reason": "PRICE" }]
    }
  }
}

**Data Capabilities Summary:**
You can answer questions about ANY of the following domains:

1. **Financial Metrics**: Total sales, gross profit, net profit, profit margin, refunds, Amazon fees (FBA, storage, referral), COGS data
2. **PPC/Advertising**: Campaign performance, ACOS, TACOS, ROAS, wasted spend analysis, high-ACOS campaigns, zero-sales keywords, top performing keywords, search term analysis
3. **Inventory**: Stranded inventory, non-compliance issues, aging inventory, replenishment recommendations, FBA inventory health
4. **Reimbursements**: Recoverable amounts, claim status, lost inventory, customer return analysis, monthly trends

### CRITICAL: Handling Issues Queries (MUST READ)

When a user asks for "all ASINs with [type] issues" or "list products with [category] issues", you MUST:

1. **Use the complete issues data provided** - The \`rankingIssuesDetails\`, \`conversionIssuesDetails\`, \`inventoryIssuesDetails\`, etc. arrays contain ALL products with issues. Do NOT truncate or summarize.

2. **List ALL affected ASINs** - If there are 25 products with ranking issues, list all 25 ASINs. The user asked for "all" so provide all.

3. **Group by issue type when helpful** - If multiple products have the same issue (e.g., backend keywords exceeding 250 bytes), group them together for clarity.

4. **Include the specific issue details for each ASIN**:
   - For ranking issues: Which section (Title, Bullet Points, Description, Backend Keywords) and what the specific problem is
   - For conversion issues: What's missing (images, video, A+, buy box, etc.)
   - For inventory issues: Type of issue (stranded, non-compliance, replenishment)
   - For profitability issues: Current margin, whether losing money
   - For sponsored ads issues: Campaign name, ACOS, wasted spend

5. **Always provide the fix/solution** - Each issue in the data has a \`howToSolve\` or \`suggestion\` field. Include this for actionable advice.

**Ranking Issues Structure:**
- \`rankingIssuesDetails\` is an array where each item has:
  - \`asin\`: The product ASIN
  - \`title\`: Product name
  - \`totalIssueCount\`: Number of ranking issues for this product
  - \`issues\`: Array of specific issues with:
    - \`section\`: "Title", "Bullet Points", "Description", or "Backend Keywords"
    - \`type\`: "character_limit", "restricted_words", "special_characters", "byte_limit", "duplicate_words"
    - \`message\`: Description of the problem
    - \`howToSolve\`: How to fix it
    - \`restrictedWords\`: (if applicable) List of restricted words found

**Example response for "list all ASINs with ranking issues":**
"Here are all 4 ASINs with ranking issues:

**Backend Keywords Issues (4 products):**
- B08138LS42 - Exceeds Amazon's 250-byte limit (currently 289 bytes)
- B07SXSBD84 - Exceeds Amazon's 250-byte limit (currently 275 bytes)  
- B07HP4V8NK - Exceeds Amazon's 250-byte limit (currently 312 bytes)
- B07HP3TZVG - Exceeds Amazon's 250-byte limit (currently 268 bytes)

**How to fix:** Reduce backend keywords to 249 bytes or less. Remove unnecessary words, avoid repetition, and prioritize high-value search terms."

Note: If there are additional issues like title length, bullet point issues, etc. for any of these products, include those too!
5. **Products**: Product reviews, sales data, listing quality, ASIN-level issues, zero-sales products
6. **Account Health**: Historical health scores, issue trends, marketplace comparison, account status
7. **Issues by Category**: Ranking issues (title, bullets, backend keywords), conversion issues (images, video, A+, buy box), inventory issues, profitability issues, sponsored ads issues
8. **Buy Box**: Win rate, products losing buy box, reasons for loss
9. **Orders**: Total orders, units sold, average order value, refund rate

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
  "suggested_title": ["Title Option 1 (80-200 chars)", "Title Option 2", "Title Option 3"],
  "suggested_bullet_points": ["Bullet 1 (min 150 chars each)", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5"],
  "suggested_backend_keywords": "keyword1 keyword2 keyword3 (200-249 bytes, space-separated)",
  "suggested_description": "Full description text (min 1700 chars)",
  "content_actions": [
    {
      "action": "generate_suggestion" | "apply_fix",
      "asin": "B00EXAMPLE",
      "sku": "SKU123",
      "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
      "product_title": "Product Name for display",
      "current_value": "current content for context",
      "suggested_value": "the suggested fix (required for apply_fix)"
    }
  ]
}

### FIX IT CAPABILITIES (CRITICAL - QMate can generate suggestions and apply fixes)

QMate has the same capabilities as the "Fix It" button in the SellerQI dashboard. You can:

1. **Generate Content Suggestions**: When a user asks to fix a product's title, bullet points, description, or backend keywords, you can generate AI-optimized suggestions.

2. **Apply Fixes**: When a user confirms they want to apply a suggestion, you can trigger the actual update to their Amazon listing.

**How to use content_actions:**

When a user asks you to:
- "Fix the title for ASIN B00EXAMPLE" or "Suggest a better title for [product]"
- "Fix the bullet points for [product]"  
- "Optimize the backend keywords for ASIN B00EXAMPLE"
- "Update the description for [product]"

Include a \`content_actions\` array with:

**To generate a suggestion (user is asking for help/suggestions):**
\`\`\`json
{
  "action": "generate_suggestion",
  "asin": "B00EXAMPLE",
  "sku": "SKU123",
  "attribute": "title",
  "current_value": "Current Product Title Here"
}
\`\`\`

**To apply a fix (user explicitly says "apply", "update", "change it", "do it"):**
\`\`\`json
{
  "action": "apply_fix",
  "asin": "B00EXAMPLE", 
  "sku": "SKU123",
  "attribute": "title",
  "suggested_value": "The New Optimized Title That Meets All Requirements"
}
\`\`\`

**CONTENT GENERATION RULES (CRITICAL - same as SellerQI Fix It):**

When generating content suggestions, you MUST follow these exact rules:

**1. TITLE:**
- Length: 80-200 characters (MUST be at least 80)
- NO restricted words (see list below)
- NO special characters: ! $ ? _ { } ^ ¬ ¦ ~ # < > *
- Keep brand name at start if present
- Keep key attributes (size, color, pack size)

**2. BULLET POINTS:**
- Exactly 5 bullet points
- Each bullet MUST be at least 150 characters
- NO restricted words
- NO special characters
- Focus on benefits, features, use cases

**3. DESCRIPTION:**
- MUST be at least 1700 characters
- NO restricted words  
- NO special characters
- Rich, detailed product information

**4. BACKEND KEYWORDS (generic_keyword):**
- MUST be 200-249 bytes (NOT characters, bytes!)
- Space-separated words only (no commas, no phrases)
- All lowercase
- NO duplicate words
- NO restricted words
- NO brand names, ASINs, or competitor names

**RESTRICTED WORDS (BANNED - do not use in ANY content):**
cure, treat, diagnose, prevent, covid, coronavirus, cancer, diabetes, hiv, fda-approved, clinically proven, 
doctor recommended, anti-bacterial, anti-fungal, antimicrobial, antiviral, virus, germs, bacteria, 
detox, cleanse, sanitize, disinfect, sterilize, cbd, thc, hemp oil, marijuana, 
guarantee, guaranteed, best seller, amazon's choice, free shipping, sale, discount, promo, 
non-toxic, hypoallergenic, eco-friendly, bpa-free, lead-free, kills, eliminates, repels, pesticide, 
brightening, whitening, anti-aging, weight loss, proven, certified, tested, approved, 
home, natural, safe, green, heal, toxic, remedy, treatment

**SPECIAL CHARACTERS (BANNED):**
! $ ? _ { } ^ ¬ ¦ ~ # < > *

**Example workflow for TITLE FIX:**

User: "Fix the title for ASIN B08138LS42, it's too short"
Your response should include:
1. In \`answer_markdown\`: Explain the issue and mention you've generated 3 title options for them to choose from
2. In \`suggested_title\`: An ARRAY of exactly 3 title suggestions (each 80-200 characters)
3. In \`content_actions\`: Include the action with asin, sku, and product_title

Example JSON fields:
\`\`\`json
{
  "suggested_title": [
    "Brand Name Professional Quality Product with Key Feature - Size/Color - Perfect for Use Case (Pack of X)",
    "Brand Name Premium Product Title Alternative with Different Keywords and Benefits Highlighted",
    "Brand Name Product Type with Unique Selling Points - Material, Size, Quantity Included"
  ],
  "content_actions": [{
    "action": "generate_suggestion",
    "asin": "B08138LS42",
    "sku": "SKU-FROM-DATA",
    "attribute": "title",
    "product_title": "Current Product Name"
  }]
}
\`\`\`

The frontend will display these as selectable options with an "Apply Fix" button.

User: "Apply option 2" or "Use the second title"
Your response:
1. In \`answer_markdown\`: Confirm you're applying the selected title
2. In \`content_actions\`: Include action: "apply_fix" with the selected title as suggested_value

**Important notes:**
- ALWAYS provide exactly 3 title options in \`suggested_title\` array when fixing titles
- SKU is required to apply fixes - look it up from the issues data (topErrorAsins or rankingIssuesDetails have sku field)
- Always validate your suggestions meet ALL rules before including them
- If you can't find the SKU, include it as null and the UI will show a message to apply manually
- For apply_fix, the frontend will call the actual Amazon API

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
        
        // Extract content_actions for Fix It functionality
        const content_actions = Array.isArray(parsed.content_actions)
            ? parsed.content_actions.filter(action => 
                action && 
                typeof action === 'object' && 
                ['generate_suggestion', 'apply_fix'].includes(action.action)
              )
            : [];

        // Validate suggested titles if present (can be array or string)
        let suggestedTitle = [];
        if (Array.isArray(parsed.suggested_title)) {
            suggestedTitle = parsed.suggested_title.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
        } else if (typeof parsed.suggested_title === 'string' && parsed.suggested_title.trim()) {
            suggestedTitle = [parsed.suggested_title.trim()];
        }
        
        if (suggestedTitle.length > 0) {
            // Validate each title and report
            const validTitles = [];
            const invalidTitles = [];
            for (const title of suggestedTitle) {
                const titleCheck = checkTitle(title);
                if (!titleCheck || titleCheck.NumberOfErrors === 0) {
                    validTitles.push(title);
                } else {
                    invalidTitles.push({ title, errors: titleCheck });
                }
            }
            
            if (validTitles.length === suggestedTitle.length) {
                answer_markdown = answer_markdown + '\n\n*All suggested titles have been validated and pass SellerQI title checks (length, no restricted words, no prohibited special characters). Select one and click "Apply Fix" to update.*';
            } else if (validTitles.length > 0) {
                answer_markdown = answer_markdown + `\n\n*${validTitles.length} of ${suggestedTitle.length} suggested titles pass validation. Invalid titles may contain restricted words or length issues.*`;
            } else {
                answer_markdown = answer_markdown + '\n\n**Title validation:** Some suggested titles have issues. Please select carefully or request new suggestions.';
            }
            // Keep only valid titles, or all if none valid (let user see them anyway)
            suggestedTitle = validTitles.length > 0 ? validTitles : suggestedTitle;
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
            // Fix It functionality - content suggestions and actions
            content_actions: content_actions.length > 0 ? content_actions : undefined,
            suggested_title: suggestedTitle.length > 0 ? suggestedTitle : undefined,
            suggested_bullet_points: suggestedBulletPoints.length > 0 ? suggestedBulletPoints : undefined,
            suggested_backend_keywords: suggestedBackendKeywords || undefined,
        };
    }

    /**
     * Generate an AI response using OPTIMIZED pre-computed data services.
     * This method uses QMateIssuesService and QMateMetricsService for faster responses.
     * 
     * Benefits:
     * - Uses pre-computed data from MongoDB instead of full analysis pipeline
     * - Much faster response times (direct DB queries vs analysis)
     * - Includes detailed issues with suggested solutions
     * 
     * Falls back to legacy generateResponse if pre-computed data is not available.
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} params.country
     * @param {string} params.region
     * @param {string} params.question
     * @param {Array<{role: string, content: string}>} [params.chatHistory]
     * @param {string} [params.startDate] - Start date for filtering (YYYY-MM-DD)
     * @param {string} [params.endDate] - End date for filtering (YYYY-MM-DD)
     * @param {string} [params.calendarMode] - Calendar mode (default, last7, custom)
     */
    static async generateResponseOptimized({ userId, country, region, question, chatHistory = [], startDate, endDate, calendarMode = 'default' }) {
        const client = getOpenAIClient();
        const startTime = Date.now();

        try {
            // Step 1: Fetch pre-computed data from ALL optimized services in parallel
            // Pass date range to metrics service if provided (syncs with dashboard filter)
            const [
                metricsResult, 
                issuesResult,
                ppcResult,
                profitabilityResult,
                inventoryResult,
                reimbursementResult,
                productsResult,
                accountResult
            ] = await Promise.all([
                QMateMetricsService.getQMateMetricsContext(userId, country, region, {
                    topAsinsLimit: 25,
                    startDate,
                    endDate,
                    calendarMode
                }),
                QMateIssuesService.getQMateIssuesContext(userId, country, region, {
                    topProductsLimit: 30,
                    issuesPerCategoryLimit: 50
                }),
                QMatePPCService.getQMatePPCContext(userId, country, region, {
                    acosThreshold: 50,
                    minSpend: 5,
                    topKeywordsLimit: 15
                }).catch(() => ({ success: false })),
                QMateProfitabilityService.getQMateProfitabilityContext(userId, country, region)
                    .catch(() => ({ success: false })),
                QMateInventoryService.getQMateInventoryContext(userId, country, region)
                    .catch(() => ({ success: false })),
                QMateReimbursementService.getQMateReimbursementContext(userId, country, region)
                    .catch(() => ({ success: false })),
                QMateProductsService.getQMateProductsContext(userId, country, region)
                    .catch(() => ({ success: false })),
                QMateAccountService.getQMateAccountContext(userId, country, region)
                    .catch(() => ({ success: false }))
            ]);

            logger.info('[QMate] Optimized data fetch completed', {
                userId,
                country,
                region,
                durationMs: Date.now() - startTime,
                metricsSuccess: metricsResult.success,
                issuesSuccess: issuesResult.success,
                ppcSuccess: ppcResult.success,
                inventorySuccess: inventoryResult.success,
                hasDateFilter: !!(startDate && endDate),
                calendarMode
            });

            // If both core services failed, fall back to legacy method
            if (!metricsResult.success && !issuesResult.success) {
                logger.warn('[QMate] Optimized services failed, falling back to legacy method', {
                    userId,
                    metricsError: metricsResult.error,
                    issuesError: issuesResult.error
                });
                return this.generateResponse({ userId, country, region, question, chatHistory });
            }

            // Step 2: Build optimized model context from ALL pre-computed data
            const modelContext = buildOptimizedModelContext(
                metricsResult.data,
                issuesResult.data,
                question,
                {
                    ppc: ppcResult.success ? ppcResult.data : null,
                    profitability: profitabilityResult.success ? profitabilityResult.data : null,
                    inventory: inventoryResult.success ? inventoryResult.data : null,
                    reimbursement: reimbursementResult.success ? reimbursementResult.data : null,
                    products: productsResult.success ? productsResult.data : null,
                    account: accountResult.success ? accountResult.data : null
                }
            );

            // Step 3: Build messages for OpenAI
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

            // Step 4: Call OpenAI
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

            // Step 5: Parse model JSON safely
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
                answer_markdown = "Here's what I found based on your account data. If you'd like more detail on a specific area, ask a follow-up question below.";
            }

            const chart_suggestions = Array.isArray(parsed.chart_suggestions)
                ? parsed.chart_suggestions
                : [];
            const follow_up_questions = Array.isArray(parsed.follow_up_questions)
                ? parsed.follow_up_questions
                : [];
            
            // Extract content_actions for Fix It functionality
            const content_actions = Array.isArray(parsed.content_actions)
                ? parsed.content_actions.filter(action => 
                    action && 
                    typeof action === 'object' && 
                    ['generate_suggestion', 'apply_fix'].includes(action.action)
                  )
                : [];
            
            // Extract suggested content fields
            const suggested_description = typeof parsed.suggested_description === 'string'
                ? parsed.suggested_description.trim()
                : '';

            // Validate suggested titles if present (can be array or string)
            let suggestedTitle = [];
            if (Array.isArray(parsed.suggested_title)) {
                suggestedTitle = parsed.suggested_title.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
            } else if (typeof parsed.suggested_title === 'string' && parsed.suggested_title.trim()) {
                suggestedTitle = [parsed.suggested_title.trim()];
            }
            
            if (suggestedTitle.length > 0) {
                // Validate each title and report
                const validTitles = [];
                const invalidTitles = [];
                for (const title of suggestedTitle) {
                    const titleCheck = checkTitle(title);
                    if (!titleCheck || titleCheck.NumberOfErrors === 0) {
                        validTitles.push(title);
                    } else {
                        invalidTitles.push({ title, errors: titleCheck });
                    }
                }
                
                if (validTitles.length === suggestedTitle.length) {
                    answer_markdown = answer_markdown + '\n\n*All suggested titles have been validated and pass SellerQI title checks (length, no restricted words, no prohibited special characters). Select one and click "Apply Fix" to update.*';
                } else if (validTitles.length > 0) {
                    answer_markdown = answer_markdown + `\n\n*${validTitles.length} of ${suggestedTitle.length} suggested titles pass validation. Invalid titles may contain restricted words or length issues.*`;
                } else {
                    answer_markdown = answer_markdown + '\n\n**Title validation:** Some suggested titles have issues. Please select carefully or request new suggestions.';
                }
                // Keep only valid titles, or all if none valid (let user see them anyway)
                suggestedTitle = validTitles.length > 0 ? validTitles : suggestedTitle;
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

            // Step 6: Attach chart data for allowed data sources
            const questionLower = (question || '').toLowerCase();
            const wantsLast7 =
                /\b(7|seven)\s*day|last\s*7|past\s*7|weekly\b/.test(questionLower);
            const wantsProfit =
                /\bprofit\b|\bmargin\b/.test(questionLower);
            const dateLimit = wantsLast7 ? 7 : 30;

            const chartsWithData = chart_suggestions.map((chart) => {
                if (!chart || !chart.dataSource) return chart;

                if (chart.dataSource === 'ppc_datewise') {
                    const raw = metricsResult.data?.datewisePPC || [];
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
                    const totalSalesArr = metricsResult.data?.datewiseSales || [];
                    const slice = totalSalesArr.slice(-dateLimit);

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
                        xField: chart.xField || 'date',
                        yFields:
                            chart.yFields && chart.yFields.length > 0
                                ? chart.yFields
                                : fallbackYFields,
                    };
                }

                return chart;
            });

            logger.info('[QMate] Optimized response generated', {
                userId,
                country,
                region,
                totalDurationMs: Date.now() - startTime,
                hasContentActions: content_actions.length > 0
            });

            return {
                status: 200,
                answer_markdown,
                chart_suggestions: chartsWithData,
                follow_up_questions,
                // Fix It functionality - content suggestions and actions
                content_actions: content_actions.length > 0 ? content_actions : undefined,
                suggested_title: suggestedTitle.length > 0 ? suggestedTitle : undefined,
                suggested_bullet_points: suggestedBulletPoints.length > 0 ? suggestedBulletPoints : undefined,
                suggested_description: suggested_description || undefined,
                suggested_backend_keywords: suggestedBackendKeywords || undefined,
            };

        } catch (error) {
            logger.error('[QMate] generateResponseOptimized failed, falling back to legacy', {
                error: error.message,
                stack: error.stack,
                userId,
                country,
                region
            });
            
            // Fall back to legacy method on any error
            return this.generateResponse({ userId, country, region, question, chatHistory });
        }
    }
}

/**
 * Build optimized model context from pre-computed services data.
 * This replaces buildModelContext when using optimized services.
 * 
 * @param {Object} metricsData - Data from QMateMetricsService.getQMateMetricsContext
 * @param {Object} issuesData - Data from QMateIssuesService.getQMateIssuesContext
 * @param {string} question - User's question
 * @param {Object} additionalData - Data from other specialized services
 * @returns {Object} Context object for AI model
 */
const buildOptimizedModelContext = (metricsData, issuesData, question, additionalData = {}) => {
    // Handle null/undefined data gracefully
    const metrics = metricsData || {};
    const issues = issuesData || {};
    const { ppc, profitability: profitabilityExtended, inventory, reimbursement, products, account } = additionalData;

    const summary = metrics.summary ? {
        brand: metrics.summary.brand || null,
        country: metrics.summary.country || null,
        dateRange: metrics.summary.dateRange || null,
        totalSales: metrics.summary.totalSales || null,
        grossProfit: metrics.summary.grossProfit || null,
        netProfit: metrics.summary.netProfit || null,
        profitMargin: metrics.summary.profitMargin || null,
        ppcSpend: metrics.summary.ppcSpend || null,
        fbaFees: metrics.summary.fbaFees || null,
        storageFees: metrics.summary.storageFees || null,
        amazonFees: metrics.summary.amazonFees || null,
        totalFees: metrics.summary.totalFees || null,
        refunds: metrics.summary.refunds || null,
        accountHealth: account?.currentStatus?.health || metrics.accountHealth || null,
        // Add new metrics from extended services
        buyBox: metrics.buyBox?.summary || null,
        orders: metrics.orders || null,
        wastedAdsSpend: metrics.wastedAds?.totalWastedSpend || null,
        productCounts: metrics.productCounts || null
    } : null;

    // Enhanced profitability with COGS and margin categories
    const profitabilityContext = metrics.profitability ? {
        topAsins: metrics.profitability.topAsins || [],
        lowMarginAsins: metrics.profitability.lowMarginAsins || [],
        lossMakingAsins: metrics.profitability.lossMakingAsins || [],
        // Add extended profitability data if available
        hasCOGSData: profitabilityExtended?.cogsData?.hasCOGS || false,
        marginCategories: profitabilityExtended?.marginCategories?.summary || null,
        parentChildAnalysis: profitabilityExtended?.parentChildAnalysis?.summary || null
    } : null;

    // Enhanced ads/PPC data with optimization opportunities
    const adsContext = metrics.ppc ? {
        summary: {
            totalSpend: metrics.ppc.totalSpend || null,
            totalSalesFromAds: metrics.ppc.totalSalesFromAds || null,
            overallAcos: metrics.ppc.overallAcos || null,
            overallTacos: metrics.ppc.tacos || null,
            overallRoas: metrics.ppc.overallRoas || null,
            totalImpressions: metrics.ppc.totalImpressions || null,
            totalClicks: metrics.ppc.totalClicks || null,
            ctr: metrics.ppc.ctr || null,
            cpc: metrics.ppc.cpc || null
        },
        campaignTypeBreakdown: metrics.ppc.campaignTypeBreakdown || null,
        ppcDatewiseSample: (metrics.datewisePPC || []).slice(-30),
        // Add extended PPC data if available
        wastedSpendSummary: ppc ? {
            totalWasted: (ppc.optimizationOpportunity?.totalWastedSpend || 0),
            highAcosCampaignsCount: ppc.highAcosCampaigns?.count || 0,
            zeroSalesKeywordsCount: ppc.zeroSalesKeywords?.count || 0,
            wastedSearchTermsCount: ppc.searchTerms?.summary?.wastedCount || 0
        } : null,
        topWastedKeywords: ppc?.zeroSalesKeywords?.zeroSalesKeywords?.slice(0, 10) || metrics.wastedAds?.topWastedKeywords || [],
        highAcosCampaigns: ppc?.highAcosCampaigns?.highAcosCampaigns?.slice(0, 10) || [],
        topPerformingKeywords: ppc?.topPerformingKeywords?.topKeywords?.slice(0, 10) || [],
        campaignOverview: ppc?.campaigns || null
    } : null;

    // Build issues context with detailed suggestions
    // IMPORTANT: Do NOT truncate issues data - AI needs complete data for queries like "list all ASINs with ranking issues"
    const issuesContext = {
        totalErrors: issues.summary?.totalIssues || metrics.issues?.totalErrors || 0,
        profitabilityErrors: issues.summary?.profitabilityErrors || metrics.issues?.profitabilityErrors || 0,
        sponsoredAdsErrors: issues.summary?.sponsoredAdsErrors || metrics.issues?.sponsoredAdsErrors || 0,
        conversionErrors: issues.summary?.conversionErrors || metrics.issues?.conversionErrors || 0,
        rankingErrors: issues.summary?.rankingErrors || metrics.issues?.rankingErrors || 0,
        inventoryErrors: issues.summary?.inventoryErrors || metrics.issues?.inventoryErrors || 0,
        accountErrors: issues.summary?.accountErrors || metrics.issues?.accountErrors || 0,
        // Include data counts so AI knows how much data is available
        dataCounts: issues.dataCounts || null,
        // Top error products (limit to 100 for reasonable context size)
        topErrorAsins: (issues.topErrorAsins || metrics.topErrorProducts || []).slice(0, 100),
        // COMPLETE issues by category - no truncation for accurate responses
        // Ranking issues with full details (ASIN, title, all issues per product)
        rankingIssuesDetails: issues.rankingIssues || [],
        // Other categories - also complete data
        conversionIssuesDetails: issues.conversionIssues || [],
        inventoryIssuesDetails: issues.inventoryIssues || [],
        profitabilityIssuesDetails: issues.profitabilityIssues || [],
        sponsoredAdsIssuesDetails: issues.sponsoredAdsIssues || []
    };

    // Inventory context with detailed data
    const inventoryContext = inventory ? {
        stranded: {
            hasStranded: inventory.stranded?.hasStranded || false,
            totalStranded: inventory.stranded?.summary?.totalStranded || 0,
            byReason: inventory.stranded?.summary?.byReason || {},
            topStrandedProducts: inventory.stranded?.strandedProducts?.slice(0, 10) || []
        },
        nonCompliance: {
            hasIssues: inventory.nonCompliance?.hasIssues || false,
            totalIssues: inventory.nonCompliance?.summary?.totalIssues || 0,
            byProblemType: inventory.nonCompliance?.summary?.byProblemType || {}
        },
        aging: {
            hasAgingInventory: inventory.aging?.hasAgingInventory || false,
            totalAgingUnits: inventory.aging?.summary?.totalAgingUnits || 0,
            agingCategories: inventory.aging?.summary?.agingCategories || {},
            topAgingProducts: inventory.aging?.agingProducts?.slice(0, 10) || []
        },
        replenishment: {
            hasRecommendations: inventory.replenishment?.hasRecommendations || false,
            needsRestock: inventory.replenishment?.summary?.needsRestock || 0,
            outOfStock: inventory.replenishment?.summary?.outOfStock || 0,
            lowStock: inventory.replenishment?.summary?.lowStock || 0,
            topReplenishmentProducts: inventory.replenishment?.products?.slice(0, 10) || []
        },
        healthSummary: inventory.overallSummary || null
    } : null;

    // Reimbursement context
    const reimbursementContext = reimbursement ? {
        summary: reimbursement.summary?.summary || null,
        byReason: reimbursement.summary?.byReason?.slice(0, 5) || [],
        lostInventory: reimbursement.lostInventory?.summary || null,
        customerReturns: reimbursement.customerReturns?.summary || null,
        monthlyTrends: reimbursement.trends?.monthlyTrends?.slice(-6) || [],
        insights: reimbursement.insights || null
    } : null;

    // Products context with reviews and quality
    const productsContext = products ? {
        reviews: {
            summary: products.reviews?.summary || null,
            lowRatedProducts: products.reviews?.lowRatedProducts?.slice(0, 10) || [],
            noReviewsProducts: products.reviews?.noReviewsProducts?.slice(0, 10) || []
        },
        sales: {
            summary: products.sales?.summary || null,
            topSellers: products.sales?.topSellers?.slice(0, 10) || [],
            zeroSalesProducts: products.sales?.zeroSalesProducts?.slice(0, 10) || []
        },
        listingQuality: products.listingQuality?.summary || null,
        healthSummary: products.productHealthSummary || null
    } : null;

    // Account context with historical data
    const accountContext = account ? {
        currentStatus: account.currentStatus || null,
        historicalHealth: {
            trend: account.historicalHealth?.summary?.trend || null,
            averageScore: account.historicalHealth?.summary?.averageScore || null,
            recentHistory: account.historicalHealth?.history?.slice(-7) || []
        },
        issueTrends: {
            direction: account.issueTrends?.summary?.trendDirection || null,
            issueChange: account.issueTrends?.summary?.issueChange || 0
        },
        marketplaces: account.marketplaceComparison?.marketplaces || [],
        insights: account.insights || null
    } : null;

    // BuyBox specific data
    const buyBoxContext = metrics.buyBox ? {
        summary: metrics.buyBox.summary || null,
        productsWithoutBuyBox: metrics.buyBox.productsWithoutBuyBox?.slice(0, 10) || []
    } : null;

    return {
        question,
        dashboard: {
            summary,
            profitability: profitabilityContext,
            ads: adsContext,
            issues: issuesContext,
            inventory: inventoryContext,
            reimbursement: reimbursementContext,
            products: productsContext,
            account: accountContext,
            buyBox: buyBoxContext
        }
    };
};

module.exports = {
    QMateService,
};

