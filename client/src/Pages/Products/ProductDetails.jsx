import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from "react-redux";
import { useParams } from 'react-router-dom';
import { 
    fetchIssuesByProductData,
    fetchProductBasicInfo,
    fetchProductPerformance,
    fetchProductIssues,
    fetchProductPPCIssues
} from '../../redux/slices/PageDataSlice';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from "framer-motion";
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Box, AlertTriangle, TrendingUp, TrendingDown, LineChart as LineChartIcon, Calendar, Download, ChevronDown, FileText, FileSpreadsheet, Star, ArrowUpRight, ArrowDownRight, Minus, Eye, ShoppingCart, DollarSign, ImageOff, CheckCircle, PackageOpen } from 'lucide-react';
import './ProductDetails.css';
import { ProductDetailsPageSkeleton } from '../../Components/Skeleton/PageSkeletons.jsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import axiosInstance from '../../config/axios.config.js';
import { formatCurrencyWithLocale, formatYAxisCurrency } from '../../utils/currencyUtils.js';
import ProductPPCIssuesTable from '../../Components/ProductDetails/ProductPPCIssuesTable.jsx';

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message) => {
    if (!message) return { mainText: '', highlightedText: '' };
    
    // Patterns to extract and highlight on a separate line
    // These patterns match the exact formats from the backend
    const patterns = [
        // Ranking - Restricted words patterns (exact backend formats)
        /^(.*?)(The Characters used are:\s*.+)$/i,  // Title - restricted words
        /^(.*?)(The characters which are used:\s*.+)$/i,  // Title - special characters
        /^(.*?)(The words Used are:\s*.+)$/,  // Bullet Points - restricted words (case sensitive 'Used')
        /^(.*?)(The words used are:\s*.+)$/i,  // Description - restricted words
        /^(.*?)(The special characters used are:\s*.+)$/i,  // Bullet Points & Description - special characters
        
        // Inventory patterns - units available
        /^(.*?)(Only \d+ units available.*)$/i,
        /^(.*?)(Currently \d+ units available.*)$/i,
        /^(.*?)(\d+ units available.*)$/i,
        
        // Inventory - Stranded reason
        /^(.*?)(Reason:\s*.+)$/i,
        
        // Inventory - Inbound non-compliance problem
        /^(.*?)(Problem:\s*.+)$/i,
        
        // Buy Box patterns
        /^(.*?)(With \d+ page views.+)$/i,
        
        // Amazon recommends pattern
        /^(.*?)(Amazon recommends replenishing \d+ units.*)$/i,
        
        // Unfulfillable inventory quantity
        /^(.*?)(Unfulfillable Quantity:\s*\d+\s*units)$/i,
    ];
    
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[2]) {
            return {
                mainText: match[1].trim(),
                highlightedText: match[2].trim()
            };
        }
    }
    
    return { mainText: message, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessageComponent = ({ message }) => {
    const { mainText, highlightedText } = formatMessageWithHighlight(message);
    
    return (
        <>
            {mainText && <span>{mainText}</span>}
            {highlightedText && (
                <>
                    <br />
                    <strong className="text-gray-100 mt-1 block">{highlightedText}</strong>
                </>
            )}
        </>
    );
};

const getRankingAttributeKeyFromIssueHeading = (issueHeading = '') => {
    const lower = String(issueHeading).toLowerCase();
    if (lower.startsWith('title')) return 'title';
    if (lower.startsWith('bullet points')) return 'bulletpoints';
    if (lower.startsWith('description')) return 'description';
    if (lower.startsWith('backend keywords')) return 'backend';
    return 'title';
};

// Reusable component for conversion issues
const IssueItem = ({ label, message, solutionKey, solutionContent, stateValue, toggleFunc, recommendedQty }) => (
    <li className="mb-4">
        <div className="flex justify-between items-center">
            <p className="w-[40vw]">
                <b>{label}: </b>
                <FormattedMessageComponent message={message} />
                {recommendedQty !== null && recommendedQty !== undefined && recommendedQty > 0 && (
                    <>
                        <br />
                        <strong className="text-gray-100 mt-1 block">Recommended Restock Quantity: {recommendedQty} units</strong>
                    </>
                )}
            </p>
            <button
                className="px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-1 text-gray-300 hover:bg-[#161b22] transition-all"
                onClick={() => toggleFunc(solutionKey)}
            >
                How to solve
                <ChevronDown className="w-[7px] h-[7px] text-gray-400" />
            </button>
        </div>
        <div
            className="bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center transition-all duration-700 ease-in-out"
            style={
                stateValue === solutionKey
                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                    : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
            }
        >
            <p className="w-[80%]">{solutionContent}</p>
        </div>
    </li>
);

/**
 * ChangeIndicator - Displays period-over-period change with color coding
 * @param {number|null} percentChange - Percentage change (e.g., 15.5 for +15.5%)
 * @param {number} delta - Raw delta value (used when percentChange is null)
 * @param {boolean} positiveIsGood - Whether a positive change is good (green) or bad (red)
 * @param {boolean} isPercentagePoint - Whether to display as "pp" instead of "%"
 * @param {string} comparisonLabel - Label for the comparison type (e.g., "vs last week")
 */
const ChangeIndicator = ({ percentChange, delta, positiveIsGood = true, isPercentagePoint = false, comparisonLabel = '' }) => {
    // Determine the value to display
    const value = percentChange !== null && percentChange !== undefined ? percentChange : delta;
    
    if (value === null || value === undefined) {
        return <span className="text-[10px] text-gray-500">New</span>;
    }
    
    const isPositive = value > 0;
    const isNegative = value < 0;
    const isNeutral = Math.abs(value) < 0.5;
    
    // Determine color based on direction and whether positive is good
    let colorClass = 'text-gray-400';
    if (!isNeutral) {
        if (positiveIsGood) {
            colorClass = isPositive ? 'text-green-400' : 'text-red-400';
        } else {
            colorClass = isPositive ? 'text-red-400' : 'text-green-400';
        }
    }
    
    // Format the value
    const formattedValue = Math.abs(value).toFixed(1);
    const suffix = isPercentagePoint ? 'pp' : '%';
    const prefix = isPositive ? '+' : isNegative ? '-' : '';
    
    return (
        <span className={`inline-flex items-center gap-0.5 text-[10px] ${colorClass}`}>
            {isPositive && <ArrowUpRight className="w-2.5 h-2.5" />}
            {isNegative && <ArrowDownRight className="w-2.5 h-2.5" />}
            {isNeutral && <Minus className="w-2.5 h-2.5" />}
            <span>{prefix}{formattedValue}{suffix}</span>
            {comparisonLabel && <span className="text-gray-500 ml-0.5">{comparisonLabel}</span>}
        </span>
    );
};

// ---------------------------------------------------------------------------
// Scenario-based recommendation engine (client-side mirror of
// server/Services/Calculations/ScenarioRecommendationService.js)
// ---------------------------------------------------------------------------

// Sessions & units normalised to daily (BuyBoxData = 1 day per doc).
// Monthly spec: Sessions Low < 300, High > 1500  →  Daily: Low < 10, High > 50
const KPI_RANGES = {
    sessions: { low: 10, high: 50 },
    cvr:      { low: 10,  high: 20 },
    buyBox:   { low: 80,  high: 95 },
    acos:     { low: 15,  high: 30 },
    tacos:    { low: 8,   high: 15 },
    ppcSpendPctRev: { low: 10, high: 25 },
    unitsSold: { low: 2, high: 4 },
};

const TREND_THRESHOLDS = { rising: 15, flat: 10, dropping: -15 };

const _isRising   = (pct) => typeof pct === 'number' && pct > TREND_THRESHOLDS.rising;
const _isFlat     = (pct) => typeof pct === 'number' && pct >= -TREND_THRESHOLDS.flat && pct <= TREND_THRESHOLDS.flat;
const _isDropping = (pct) => typeof pct === 'number' && pct < TREND_THRESHOLDS.dropping;
const ACOS_DELTA_THRESHOLD = 5;
const _isAcosRising = (change) => typeof change?.delta === 'number' && change.delta > ACOS_DELTA_THRESHOLD;

const SCENARIOS = [
    { id:'high_sessions_low_cvr', priority:2, shortLabel:'Fix Listing',
      message:'Your product is getting strong traffic but visitors are not buying. This is a classic listing quality problem. Focus on improving your main image, ensuring competitive pricing, adding high-quality A+ content, and addressing negative reviews. Your listing needs to convince shoppers who are already finding you.',
      evaluate:(m)=>m.sessions>KPI_RANGES.sessions.high&&m.cvr<KPI_RANGES.cvr.low,
      buildReason:(m)=>`Sessions are high (${m.sessions.toLocaleString()}/day) but conversion rate is only ${m.cvr.toFixed(1)}% (below ${KPI_RANGES.cvr.low}% threshold). Traffic is not the problem — your listing is failing to convert.` },
    { id:'low_sessions_high_cvr', priority:3, shortLabel:'Scale Traffic',
      message:'Your listing converts well when people find it, but not enough shoppers are seeing it. This is a visibility problem. Consider increasing PPC budget, launching Sponsored Brand campaigns, improving backend keywords for organic discovery, or running promotions and deals to boost ranking.',
      evaluate:(m)=>m.sessions<KPI_RANGES.sessions.low&&m.cvr>KPI_RANGES.cvr.high,
      buildReason:(m)=>`Conversion rate is strong at ${m.cvr.toFixed(1)}% (above ${KPI_RANGES.cvr.high}%) but sessions are only ${m.sessions.toLocaleString()}/day. The product converts — it just needs more eyeballs.` },
    { id:'high_acos_low_buybox', priority:1, shortLabel:'Fix Buy Box First',
      message:'You are spending heavily on ads but don\'t own the Buy Box, meaning most of that ad spend is driving sales for a competitor or another seller on your listing. Pause or reduce PPC immediately and focus on winning back the Buy Box by reviewing your pricing, checking fulfillment method (FBA vs FBM), and ensuring your seller metrics are healthy.',
      evaluate:(m)=>m.acos>KPI_RANGES.acos.high&&m.buyBoxPercentage<KPI_RANGES.buyBox.low,
      buildReason:(m)=>`ACoS is ${m.acos.toFixed(1)}% (above ${KPI_RANGES.acos.high}%) while Buy Box ownership is only ${m.buyBoxPercentage.toFixed(0)}% (below ${KPI_RANGES.buyBox.low}%). Ad dollars are being wasted — fix Buy Box before spending on ads.` },
    { id:'low_sessions_low_cvr', priority:1, shortLabel:'Fix Listing First',
      message:'Both traffic and conversion are critically low. Do not increase ad spend in this state — you\'d be paying to send people to a listing that doesn\'t convert. Start by fixing the listing fundamentals: main image, title with relevant keywords, bullet points that address buyer objections, competitive pricing, and reviews. Only scale ads once conversion rate improves.',
      evaluate:(m)=>m.sessions<KPI_RANGES.sessions.low&&m.cvr<KPI_RANGES.cvr.low,
      buildReason:(m)=>`Sessions (${m.sessions.toLocaleString()}/day) and conversion rate (${m.cvr.toFixed(1)}%) are both below healthy levels. Both traffic acquisition and listing quality need attention — prioritise the listing first.` },
    { id:'high_ppc_spend_low_units', priority:2, shortLabel:'Keyword-Listing Mismatch',
      message:'Your ads are consuming a large share of revenue but generating very few sales. This typically indicates a keyword-to-listing mismatch — shoppers clicking your ads aren\'t finding what they expected. Review your search term reports to identify irrelevant clicks, add negative keywords aggressively, and ensure your ad copy and product listing align with the keywords you\'re bidding on.',
      evaluate:(m)=>m.ppcSpendPctRev>KPI_RANGES.ppcSpendPctRev.high&&m.unitsSold<KPI_RANGES.unitsSold.low,
      buildReason:(m)=>`PPC spend accounts for ${m.ppcSpendPctRev.toFixed(1)}% of revenue (above ${KPI_RANGES.ppcSpendPctRev.high}%) but only ${m.unitsSold} units were sold. Ads are attracting clicks that don\'t convert to purchases.` },
    { id:'high_pageviews_low_sessions', priority:3, shortLabel:'Listing Creating Doubt',
      message:'Shoppers are viewing your product page multiple times within their browsing sessions but not committing to a purchase. This revisiting behaviour signals hesitation or doubt — often caused by unclear product information, unanswered questions in the listing, inconsistent images, or pricing that feels uncertain. Review your listing from a buyer\'s perspective and address potential objections.',
      evaluate:(m)=>m.sessions>0&&(m.pageViews/m.sessions)>2.0&&m.sessions<KPI_RANGES.sessions.low,
      buildReason:(m)=>`Page views per session ratio is ${(m.pageViews/m.sessions).toFixed(1)}x (visitors are coming back to the page multiple times) with only ${m.sessions.toLocaleString()} sessions. Shoppers are interested but something is stopping them from buying.` },
    { id:'high_cvr_high_acos', priority:2, shortLabel:'Reduce Bids',
      message:'Your product converts well — the listing is doing its job. The problem is ad efficiency: your bids are too aggressive, driving up cost per click beyond what\'s profitable. Lower your bids gradually (10-15% at a time), pause high-ACoS keywords that aren\'t converting, and focus budget on your best-performing exact match keywords. Do not pause campaigns entirely — just trim the bids.',
      evaluate:(m)=>m.cvr>KPI_RANGES.cvr.high&&m.acos>KPI_RANGES.acos.high,
      buildReason:(m)=>`Conversion rate is excellent at ${m.cvr.toFixed(1)}% but ACoS is ${m.acos.toFixed(1)}% (above ${KPI_RANGES.acos.high}%). The product sells well — you\'re just overpaying for the traffic.` },
    { id:'low_acos_low_sessions', priority:3, shortLabel:'Increase Bids',
      message:'Your ad campaigns are very efficient but barely generating any traffic. You\'re being too conservative with bids — your ads likely aren\'t winning enough auctions to get meaningful impressions. Gradually increase bids by 15-25%, expand to broader match types, and consider adding new keyword targets. You have room to spend more while staying profitable.',
      evaluate:(m)=>m.acos>0&&m.acos<KPI_RANGES.acos.low&&m.sessions<KPI_RANGES.sessions.low,
      buildReason:(m)=>`ACoS is only ${m.acos.toFixed(1)}% (well below ${KPI_RANGES.acos.low}%) with just ${m.sessions.toLocaleString()} sessions/day. There\'s significant headroom to increase ad spend while maintaining profitability.` },
    { id:'buybox_full_low_cvr', priority:2, shortLabel:'Listing Bottleneck',
      message:'You own the Buy Box — that\'s not the issue. The problem is purely your listing\'s ability to convert visitors into buyers. Audit your listing content: are your images high quality and showing the product in use? Do your bullet points address the top buyer concerns? Is the price competitive? Check your reviews for recurring complaints and address them in your listing copy or product improvements.',
      evaluate:(m)=>m.buyBoxPercentage>=KPI_RANGES.buyBox.high&&m.cvr<KPI_RANGES.cvr.low,
      buildReason:(m)=>`Buy Box is solid at ${m.buyBoxPercentage.toFixed(0)}% but conversion rate is only ${m.cvr.toFixed(1)}%. The Buy Box isn\'t the bottleneck — your listing quality is preventing sales.` },
    { id:'low_tacos_low_units', priority:4, shortLabel:'Push More Ads',
      message:'Your advertising efficiency is excellent relative to total sales, but overall sales volume is low. This is a good position to scale from — your organic-to-paid ratio is healthy, meaning you can safely increase PPC spend without it eating into margins. Consider launching new campaigns, adding more keyword targets, or increasing daily budgets to drive incremental volume.',
      evaluate:(m)=>m.tacos<KPI_RANGES.tacos.low&&m.unitsSold<KPI_RANGES.unitsSold.low,
      buildReason:(m)=>`TACoS is only ${m.tacos.toFixed(1)}% (below ${KPI_RANGES.tacos.low}%) with ${m.unitsSold} units sold. Ad efficiency is strong but total volume is small — safe to invest more in advertising.` },
    { id:'high_sessions_low_pv_ratio', priority:3, shortLabel:'Single Visit Behavior',
      message:'Shoppers are visiting your listing and making a decision quickly — they don\'t come back for a second look. This can be positive (instant purchase) or negative (instant bounce). Check whether your conversion rate matches this behaviour: if CVR is high, your listing is compelling at first glance. If CVR is low, shoppers are deciding against you immediately — likely due to the main image, price, or star rating visible on the search results page.',
      evaluate:(m)=>m.sessions>KPI_RANGES.sessions.high&&m.sessions>0&&(m.pageViews/m.sessions)<1.3,
      buildReason:(m)=>`High traffic (${m.sessions.toLocaleString()} sessions/day) but page-views-per-session is only ${(m.pageViews/m.sessions).toFixed(2)}x — visitors are making instant decisions without revisiting.` },
    { id:'high_units_low_buybox', priority:1, shortLabel:'Investigate Hijackers',
      message:'Your product is selling well but you don\'t control the Buy Box for a significant portion of sales. This strongly suggests another seller is on your listing — potentially a hijacker, an unauthorized reseller, or Amazon itself. Check your listing\'s "Other Sellers" section, file a complaint if unauthorized sellers are present, and consider enrolling in Amazon Brand Registry or Transparency to protect your listing.',
      evaluate:(m)=>m.unitsSold>KPI_RANGES.unitsSold.high&&m.buyBoxPercentage<KPI_RANGES.buyBox.low,
      buildReason:(m)=>`${m.unitsSold} units are being sold but your Buy Box share is only ${m.buyBoxPercentage.toFixed(0)}% (below ${KPI_RANGES.buyBox.low}%). Someone else is capturing sales on your listing.` },
    { id:'high_sessions_high_cvr_high_acos', priority:2, shortLabel:'Restructure Campaigns',
      message:'This is a healthy product — strong traffic, strong conversion — but your ad campaigns are inefficient. The product doesn\'t need more visibility or listing improvements. Focus entirely on campaign structure: consolidate ad groups, move top-converting search terms into exact match campaigns with controlled bids, add negative keywords to broad/auto campaigns, and consider reducing bids on high-ACoS keywords rather than pausing them entirely.',
      evaluate:(m)=>m.sessions>KPI_RANGES.sessions.high&&m.cvr>KPI_RANGES.cvr.high&&m.acos>KPI_RANGES.acos.high,
      buildReason:(m)=>`Sessions (${m.sessions.toLocaleString()}/day) and CVR (${m.cvr.toFixed(1)}%) are both strong, but ACoS is ${m.acos.toFixed(1)}%. The product is performing well — campaigns just need optimization.` },
    { id:'low_ppc_spend_low_sessions', priority:3, shortLabel:'Underspending',
      message:'Your product has minimal ad investment and minimal traffic — it\'s effectively invisible on Amazon. In competitive categories, organic ranking alone is rarely enough. Consider allocating a meaningful PPC budget, starting with auto campaigns to discover relevant keywords, then building out manual exact-match campaigns for your best performers.',
      evaluate:(m)=>m.ppcSpendPctRev<KPI_RANGES.ppcSpendPctRev.low&&m.sessions<KPI_RANGES.sessions.low,
      buildReason:(m)=>`PPC spend is only ${m.ppcSpendPctRev.toFixed(1)}% of revenue with just ${m.sessions.toLocaleString()} sessions/day. The product is getting almost no visibility — both organic and paid.` },
    // Trend scenarios
    { id:'high_tacos_flat_units', priority:2, shortLabel:'Weak Organic',
      message:'Your total advertising cost relative to sales is high, and unit sales are not growing despite the spend. This means ads are sustaining your current sales level rather than driving organic growth. Healthy products should see TACoS decrease over time as organic ranking improves. Review whether your ads are driving enough organic keyword ranking improvements, and check if competitors have gained ground.',
      evaluate:(m,c)=>m.tacos>KPI_RANGES.tacos.high&&c?.hasComparison&&_isFlat(c.changes?.unitsSold?.percentChange),
      buildReason:(m,c)=>`TACoS is ${m.tacos.toFixed(1)}% (above ${KPI_RANGES.tacos.high}%) while unit sales are flat (${c.changes.unitsSold.percentChange?.toFixed(1)??0}% change). Advertising is propping up sales without building organic momentum.` },
    { id:'rising_sessions_flat_units', priority:2, shortLabel:'Competitors Improving',
      message:'Traffic to your listing is increasing but sales are not keeping pace. This often means competitors are improving their listings or pricing — shoppers are comparison-shopping more and choosing alternatives. Audit competitor listings for recent changes (new images, lower prices, better reviews) and ensure your listing remains competitive. Also check if your conversion rate has dropped.',
      evaluate:(m,c)=>c?.hasComparison&&_isRising(c.changes?.sessions?.percentChange)&&_isFlat(c.changes?.unitsSold?.percentChange),
      buildReason:(m,c)=>`Sessions are up ${c.changes.sessions.percentChange?.toFixed(1)}% but unit sales remain flat (${c.changes.unitsSold.percentChange?.toFixed(1)}% change). More people are seeing your listing but not buying — competitive pressure is likely increasing.` },
    { id:'high_units_rising_acos', priority:2, shortLabel:'Organic Slipping',
      message:'You\'re still selling well, but your advertising costs are climbing. This is a warning sign that organic ranking is declining — ads are picking up the slack to maintain sales volume. If left unchecked, profitability will erode. Investigate keyword ranking changes, check if competitors are bidding more aggressively, and review whether recent listing or inventory changes may have affected organic performance.',
      evaluate:(m,c)=>m.unitsSold>KPI_RANGES.unitsSold.high&&c?.hasComparison&&_isAcosRising(c.changes?.acos),
      buildReason:(m,c)=>`${m.unitsSold} units sold but ACoS has increased by ${c.changes.acos.delta?.toFixed(1)} percentage points. Sales are holding but you\'re paying more in ads to maintain them — organic visibility is likely declining.` },
    { id:'flat_sessions_dropping_units', priority:1, shortLabel:'CVR Falling',
      message:'Traffic is stable but fewer visitors are converting to buyers — your conversion rate is actively declining. Something has changed: check for recent negative reviews, competitor price drops, listing suppression warnings, or changes to your images/content. Also verify that your product is still in stock and that the Buy Box hasn\'t shifted to another seller.',
      evaluate:(m,c)=>c?.hasComparison&&_isFlat(c.changes?.sessions?.percentChange)&&_isDropping(c.changes?.unitsSold?.percentChange),
      buildReason:(m,c)=>`Sessions are stable (${c.changes.sessions.percentChange?.toFixed(1)}% change) but units sold dropped ${Math.abs(c.changes.unitsSold.percentChange).toFixed(1)}%. Same traffic, fewer sales — conversion rate is declining.` },
    { id:'rising_ppc_flat_revenue', priority:1, shortLabel:'Audit Search Terms',
      message:'You\'re spending more on advertising but revenue isn\'t growing — your ad efficiency is deteriorating. This typically happens when broad or auto campaigns accumulate wasteful search terms over time. Download your search term report, identify terms with high spend and zero or low sales, and add them as negative keywords. Also check if your bids have drifted up due to bid automation or competitive pressure.',
      evaluate:(m,c)=>c?.hasComparison&&_isRising(c.changes?.ppcSpend?.percentChange)&&_isFlat(c.changes?.sales?.percentChange),
      buildReason:(m,c)=>`PPC spend increased ${c.changes.ppcSpend.percentChange?.toFixed(1)}% but revenue is flat (${c.changes.sales.percentChange?.toFixed(1)}% change). Increasing ad budget is not translating to more sales — search term waste is the likely culprit.` },
    { id:'dropping_sessions_rising_acos', priority:1, shortLabel:'Losing Organic Rank',
      message:'Traffic is declining while ad costs are rising — this is the signature pattern of losing organic ranking. Your product is becoming less visible in organic search results, forcing you to spend more on ads to compensate. Conduct a full keyword ranking audit, check for indexing issues, review any recent listing changes that may have affected relevance, and ensure your inventory levels haven\'t caused ranking penalties.',
      evaluate:(m,c)=>c?.hasComparison&&_isDropping(c.changes?.sessions?.percentChange)&&_isAcosRising(c.changes?.acos),
      buildReason:(m,c)=>`Sessions dropped ${Math.abs(c.changes.sessions.percentChange).toFixed(1)}% while ACoS rose by ${c.changes.acos.delta?.toFixed(1)} percentage points. Organic visibility is eroding and paid ads are becoming more expensive to compensate.` },
];

/**
 * Evaluate all 20 scenarios against a product's metrics and comparison data.
 */
const evaluateScenarios = (metrics, comparison) => {
    if (!metrics) return [];
    const matched = [];
    for (const s of SCENARIOS) {
        try {
            if (s.evaluate(metrics, comparison)) {
                matched.push({ id: s.id, shortLabel: s.shortLabel, message: s.message,
                    reason: s.buildReason(metrics, comparison), priority: s.priority });
            }
        } catch (_) { /* skip on missing fields */ }
    }
    matched.sort((a, b) => a.priority - b.priority);
    return matched;
};

/**
 * Build normalised metrics from the shapes available on the Product Details page.
 */
const clientBuildMetrics = (performance, profitabilityProduct) => {
    const sessions        = performance?.sessions        ?? 0;
    const pageViews       = performance?.pageViews       ?? 0;
    const cvr             = performance?.conversionRate   ?? 0;
    const buyBoxPercentage = performance?.buyBoxPercentage ?? 100;
    const unitsSold       = profitabilityProduct?.unitsSold ?? performance?.unitsSold ?? 0;
    const sales           = profitabilityProduct?.sales     ?? performance?.sales     ?? 0;
    const ppcSpend        = profitabilityProduct?.ads       ?? performance?.ppcSpend  ?? 0;
    const ppcSales        = performance?.ppcSales          ?? 0;
    const acos            = performance?.acos ?? (ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : 0);
    const tacos           = sales > 0 ? (ppcSpend / sales) * 100 : 0;
    const ppcSpendPctRev  = tacos;
    return { sessions, pageViews, cvr, buyBoxPercentage, unitsSold,
             sales, ppcSpend, ppcSales, acos, tacos, ppcSpendPctRev };
};

const Dashboard = () => {
    const dispatch = useDispatch();
    const info = useSelector((state) => state.Dashboard.DashBoardInfo);
    const issuesByProductLoading = useSelector((state) => state.pageData?.issuesByProduct?.loading);
    const currency = useSelector((state) => state.currency?.currency) || '$';
    const country = useSelector((state) => state.Dashboard?.DashBoardInfo?.Country ?? state.currency?.country);
    const region = useSelector((state) => state.Dashboard?.DashBoardInfo?.Region);
    
    // Per-ASIN product details state (fallback when ASIN not in issues-by-product)
    const productDetailsState = useSelector((state) => state.pageData?.productDetails);
    const productDetailsLoading = productDetailsState?.loading;
    
    const dropdownRef = useRef(null);

    // Fix-it modal state (same behavior as Category issues page)
    const [isFixModalOpen, setIsFixModalOpen] = useState(false);
    const [fixContext, setFixContext] = useState({ asin: '', sku: '', title: '', attributeKey: 'title' });
    const [fixForm, setFixForm] = useState({
        title: '',
        description: '',
        bulletpoints: [''],
        backendKeywords: ''
    });
    const [titleSuggestions, setTitleSuggestions] = useState([]);
    const [generateTitleLoading, setGenerateTitleLoading] = useState(false);
    const [generateTitleError, setGenerateTitleError] = useState(null);
    const [applyLoading, setApplyLoading] = useState(false);
    const [applyError, setApplyError] = useState(null);
    const [applySuccessMessage, setApplySuccessMessage] = useState(null);
    const applySuccessTimeoutRef = useRef(null);

    useEffect(() => {
        return () => {
            if (applySuccessTimeoutRef.current) clearTimeout(applySuccessTimeoutRef.current);
        };
    }, []);
    
    // Comparison state for WoW/MoM
    const [comparisonType, setComparisonType] = useState('none');
    const [isLoadingComparison, setIsLoadingComparison] = useState(false);
    
    // Historical data for graphs
    const [historyData, setHistoryData] = useState(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    
    // Track if we're using per-ASIN fallback
    const [usingPerAsinFallback, setUsingPerAsinFallback] = useState(false);
    
    // Comparison options
    const comparisonOptions = [
        { value: 'none', label: 'Day Over Day', shortLabel: 'DOD' },
        { value: 'wow', label: 'Week Over Week', shortLabel: 'WoW' },
        { value: 'mom', label: 'Month Over Month', shortLabel: 'MoM' }
    ];

    const { asin } = useParams();
    const normalizedAsin = asin?.trim().toUpperCase();

    // Load issues-by-product data so we have enriched productWiseError (performance + recommendations).
    // This syncs to DashBoardInfo and ensures this detail page shows the Performance section.
    useEffect(() => {
        dispatch(fetchIssuesByProductData());
    }, [dispatch]);
    
    // Load per-ASIN PPC issues for this product
    useEffect(() => {
        if (normalizedAsin) {
            dispatch(fetchProductPPCIssues(normalizedAsin));
        }
    }, [dispatch, normalizedAsin]);
    
    // Check if ASIN exists in issues-by-product data
    const productFromIssuesByProduct = useMemo(() => {
        return info?.productWiseError?.find(item => 
            (item.asin || '').trim().toUpperCase() === normalizedAsin
        );
    }, [info?.productWiseError, normalizedAsin]);
    
    // Get per-ASIN cached data if available
    const perAsinCachedData = useMemo(() => {
        return productDetailsState?.byAsin?.[normalizedAsin] || null;
    }, [productDetailsState?.byAsin, normalizedAsin]);

    const openFixModal = useCallback((row) => {
        setFixContext({
            asin: row.asin || normalizedAsin || '',
            sku: row.sku || '',
            title: row.title || 'N/A',
            attributeKey: row.attributeKey || getRankingAttributeKeyFromIssueHeading(row.issueHeading)
        });
        setFixForm({
            title: '',
            description: '',
            bulletpoints: [''],
            backendKeywords: ''
        });
        setTitleSuggestions([]);
        setGenerateTitleError(null);
        setApplyError(null);
        setIsFixModalOpen(true);
    }, [normalizedAsin]);

    const closeFixModal = useCallback(() => {
        setIsFixModalOpen(false);
        setGenerateTitleError(null);
        setApplyError(null);
    }, []);

    const handleFixSubmit = useCallback((e) => {
        e.preventDefault();
        setApplyError(null);

        const dataToBeUpdated = fixContext.attributeKey === 'title'
            ? 'title'
            : fixContext.attributeKey === 'description'
                ? 'description'
                : fixContext.attributeKey === 'backend'
                    ? 'generic_keyword'
                    : 'bulletpoints';

        let valueToBeUpdated;
        if (dataToBeUpdated === 'title') {
            valueToBeUpdated = fixForm.title?.trim() || '';
        } else if (dataToBeUpdated === 'description') {
            valueToBeUpdated = fixForm.description?.trim() || '';
        } else if (dataToBeUpdated === 'generic_keyword') {
            valueToBeUpdated = fixForm.backendKeywords?.trim() || '';
        } else {
            const bullets = Array.isArray(fixForm.bulletpoints) ? fixForm.bulletpoints : [fixForm.bulletpoints || ''];
            valueToBeUpdated = bullets.map((b) => String(b ?? '').trim()).filter(Boolean);
        }

        if (dataToBeUpdated === 'title' && !valueToBeUpdated) return setApplyError('Please enter a title.');
        if (dataToBeUpdated === 'description' && !valueToBeUpdated) return setApplyError('Please enter a description.');
        if (dataToBeUpdated === 'generic_keyword' && !valueToBeUpdated) return setApplyError('Please enter backend keywords.');
        if (dataToBeUpdated === 'bulletpoints' && (!valueToBeUpdated || (Array.isArray(valueToBeUpdated) && valueToBeUpdated.length === 0))) {
            return setApplyError('Please enter at least one bullet point.');
        }

        const sku = fixContext.sku?.trim();
        if (!sku) return setApplyError('SKU is required to update the listing.');
        if (!country || !region) return setApplyError('Country and region are required. Please ensure you have selected a marketplace.');

        setApplyLoading(true);
        axiosInstance.post('/api/listings/update-product-content', {
            sku,
            country,
            region,
            dataToBeUpdated,
            valueToBeUpdated
        })
            .then(() => {
                closeFixModal();
                // Refresh data so the "Applied" state can show up
                dispatch(fetchIssuesByProductData({ forceRefresh: true }));
                if (normalizedAsin) dispatch(fetchProductIssues(normalizedAsin));
                setApplySuccessMessage('It will be displayed on your catalog once Amazon accepts it.');
                if (applySuccessTimeoutRef.current) clearTimeout(applySuccessTimeoutRef.current);
                applySuccessTimeoutRef.current = setTimeout(() => setApplySuccessMessage(null), 5000);
            })
            .catch((err) => {
                const msg = err.response?.data?.message || err.message || 'Failed to update listing.';
                setApplyError(msg);
            })
            .finally(() => setApplyLoading(false));
    }, [fixContext.attributeKey, fixContext.sku, country, region, fixForm, closeFixModal, dispatch, normalizedAsin]);

    const handleGenerate = useCallback((attribute) => {
        setGenerateTitleError(null);
        setGenerateTitleLoading(true);

        const asinForAi = fixContext.asin || normalizedAsin || '';
        const payload = { asin: asinForAi };

        if (attribute === 'title') {
            payload.attribute = 'title';
            payload.title = fixForm.title || fixContext.title || '';
        } else if (attribute === 'description') {
            payload.attribute = 'description';
            payload.description = fixForm.description || '';
        } else if (attribute === 'bulletpoints') {
            payload.attribute = 'bulletpoints';
            payload.bulletpoints = Array.isArray(fixForm.bulletpoints) ? fixForm.bulletpoints : [fixForm.bulletpoints || ''];
        } else {
            payload.attribute = 'generic_keyword';
            payload.backendKeywords = fixForm.backendKeywords || '';
        }

        axiosInstance.post('/api/ai/ranking-content', payload)
            .then((res) => {
                const data = res.data?.data || {};
                if (attribute === 'title') {
                    const titles = Array.isArray(data.titles) ? data.titles : [];
                    if (titles.length > 0) {
                        setTitleSuggestions(titles);
                        setFixForm(prev => ({ ...prev, title: titles[0] }));
                    }
                } else if (attribute === 'description' && data.description) {
                    setFixForm(prev => ({ ...prev, description: data.description }));
                } else if (attribute === 'bulletpoints' && data.bulletpoints) {
                    const arr = Array.isArray(data.bulletpoints) ? data.bulletpoints : [String(data.bulletpoints)];
                    setFixForm(prev => ({ ...prev, bulletpoints: arr.length ? arr : [''] }));
                } else if (attribute === 'backend' && data.keywords !== undefined) {
                    setFixForm(prev => ({ ...prev, backendKeywords: data.keywords }));
                }
            })
            .catch((err) => {
                setGenerateTitleError(err.response?.data?.message || err.message || 'AI suggestion failed.');
            })
            .finally(() => setGenerateTitleLoading(false));
    }, [fixContext.asin, fixContext.title, fixForm, normalizedAsin]);
    
    // Fallback: If ASIN not in issues-by-product cache and not loading, fetch per-ASIN data
    useEffect(() => {
        if (!normalizedAsin) return;
        
        // Wait for issues-by-product to finish loading
        if (issuesByProductLoading) return;
        
        // If product found in issues-by-product, use that (existing flow)
        if (productFromIssuesByProduct) {
            setUsingPerAsinFallback(false);
            return;
        }
        
        // Product not in issues-by-product - check per-ASIN cache
        const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
        if (perAsinCachedData?.info && perAsinCachedData?.issues && 
            perAsinCachedData?.lastFetched && (Date.now() - perAsinCachedData.lastFetched) < CACHE_TTL_MS) {
            setUsingPerAsinFallback(true);
            return;
        }
        
        // Fetch per-ASIN data in parallel
        setUsingPerAsinFallback(true);
        console.log('[ProductDetails] ASIN not in cache, fetching per-ASIN data:', normalizedAsin);
        
        dispatch(fetchProductBasicInfo(normalizedAsin));
        dispatch(fetchProductPerformance({ asin: normalizedAsin, comparison: comparisonType }));
        dispatch(fetchProductIssues(normalizedAsin));
    }, [normalizedAsin, issuesByProductLoading, productFromIssuesByProduct, dispatch, comparisonType, perAsinCachedData]);
    
    // Re-fetch performance when comparison type changes (for per-ASIN fallback)
    useEffect(() => {
        if (!usingPerAsinFallback || !normalizedAsin || comparisonType === 'none') return;
        
        dispatch(fetchProductPerformance({ asin: normalizedAsin, comparison: comparisonType }));
    }, [comparisonType, usingPerAsinFallback, normalizedAsin, dispatch]);

    useEffect(() => {
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpenSelector(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [])
    
    // Map comparison type to graph granularity
    const getGranularity = (type) => {
        switch (type) {
            case 'wow': return 'weekly';
            case 'mom': return 'monthly';
            default: return 'daily';
        }
    };
    
    // Fetch product history for graphs - re-fetches when comparisonType changes
    useEffect(() => {
        if (!asin) return;
        
        const fetchHistory = async () => {
            setIsLoadingHistory(true);
            setHistoryError(null);
            try {
                const granularity = getGranularity(comparisonType);
                const params = new URLSearchParams();
                params.set('granularity', granularity);
                // For daily charts on the product details page, limit to last 7 days
                if (granularity === 'daily') {
                    params.set('limit', '7');
                }
                const response = await axiosInstance.get(`/api/pagewise/product-history/${asin}?${params.toString()}`);
                setHistoryData(response.data.data);
            } catch (error) {
                console.error('Error fetching product history:', error);
                setHistoryError(error.response?.data?.message || 'Failed to load history');
            } finally {
                setIsLoadingHistory(false);
            }
        };
        
        fetchHistory();
    }, [asin, comparisonType]);
    
    // Handle comparison type change
    const handleComparisonChange = useCallback(async (newType) => {
        if (newType === comparisonType) return;
        console.log('[ProductDetails] handleComparisonChange:', newType);
        setComparisonType(newType);
        setIsLoadingComparison(true);
        try {
            const result = await dispatch(fetchIssuesByProductData({ comparison: newType, forceRefresh: true })).unwrap();
            console.log('[ProductDetails] Comparison data received:', {
                productCount: result?.productWiseError?.length,
                comparisonMeta: result?.comparisonMeta,
                sampleProduct: result?.productWiseError?.[0]?.comparison
            });
        } catch (error) {
            console.error('Error fetching comparison data:', error);
        } finally {
            setIsLoadingComparison(false);
        }
    }, [dispatch, comparisonType]);
    
    // Find product from rankingProductWiseErrors array (same as Category.jsx)
    const rankingProduct = info?.rankingProductWiseErrors?.find(item => item.asin === asin);
    
    // Get product from productWiseError for error data
    const product = info?.productWiseError?.find(item => item.asin === asin);
    
    // Get profitability data (same source as profitability dashboard) for accurate sales/quantity
    // This uses EconomicsMetrics as primary source, which is more accurate
    const profitabilityProduct = info?.profitibilityData?.find(item => item.asin === asin);
    
            // Build product from per-ASIN fallback data if available
    const buildProductFromPerAsinData = useCallback(() => {
        if (!perAsinCachedData?.info || !perAsinCachedData?.issues) return null;
        
        const infoData = perAsinCachedData.info;
        const issuesData = perAsinCachedData.issues;
                const performanceData = perAsinCachedData.performance;
        
                return {
            asin: normalizedAsin,
            sku: infoData.sku || issuesData.sku,
            name: infoData.name || issuesData.name,
            MainImage: infoData.mainImage || issuesData.MainImage,
            price: infoData.price || 0,
            quantity: infoData.unitsSold || 0,
            sales: infoData.sales || 0,
            totalErrors: issuesData.totalErrors || 0,
                    // Map performance data
                    performance: performanceData?.performance ? {
                        sessions: performanceData.performance.sessions || 0,
                        pageViews: performanceData.performance.pageViews || 0,
                        conversionRate: performanceData.performance.conversionRate || 0,
                        buyBoxPercentage: performanceData.performance.buyBoxPercentage || 0,
                        sales: performanceData.performance.sales || 0,
                        unitsSold: performanceData.performance.unitsSold || 0,
                        grossProfit: performanceData.performance.grossProfit || 0,
                        ppcSpend: performanceData.performance.ppcSpend || 0,
                        ppcSales: performanceData.performance.ppcSales || 0,
                        acos: performanceData.performance.acos
                    } : null,
            // Map comparison data
            comparison: performanceData?.comparison || null,
            // Map issues data
            rankingErrors: issuesData.rankingErrors || null,
            conversionErrors: issuesData.conversionErrors || {},
            inventoryErrors: issuesData.inventoryErrors || {}
        };
    }, [perAsinCachedData, normalizedAsin]);
    
    // Effective product: prefer issues-by-product cache, fallback to per-ASIN data
    const effectiveProduct = useMemo(() => {
        if (product) return product;
        if (usingPerAsinFallback) return buildProductFromPerAsinData();
        return null;
    }, [product, usingPerAsinFallback, buildProductFromPerAsinData]);
    
    // Use sales and quantity from profitibilityData (same as profitability dashboard)
    // Falls back to productWiseError/perAsinData if profitibilityData not available
    const sales = profitabilityProduct?.sales ?? effectiveProduct?.sales ?? 0;
    const quantity = profitabilityProduct?.quantity ?? effectiveProduct?.quantity ?? 0;
    
    // Update product with ranking data and accurate sales/quantity from profitibilityData
    const updatedProduct = effectiveProduct ? {
        ...effectiveProduct,
        // Use sales and quantity from profitibilityData (same source as profitability dashboard)
        quantity: quantity,
        sales: sales,
        // Add ranking data from rankingProductWiseErrors array (or from per-ASIN issues)
        rankingErrors: rankingProduct || effectiveProduct?.rankingErrors || undefined
    } : null;

    const rankingTableRows = useMemo(() => {
        if (!updatedProduct?.rankingErrors?.data) return [];

        const asin = updatedProduct.asin;
        const sku = updatedProduct.sku || '';
        const title = updatedProduct.name || updatedProduct.Title || 'N/A';
        const fixedAttributes = updatedProduct.fixedAttributes || {};
        const rows = [];

        const pushRow = (sectionLabel, issueLabel, messageObj, howToSolve) => {
            if (!messageObj) return;
            const issueHeading = `${sectionLabel} | ${issueLabel}`;
            const attributeKey = getRankingAttributeKeyFromIssueHeading(issueHeading);
            const isFixed = attributeKey === 'title'
                ? !!fixedAttributes.title?.fixed
                : attributeKey === 'description'
                    ? !!fixedAttributes.description?.fixed
                    : attributeKey === 'bulletpoints'
                        ? !!fixedAttributes.bulletpoints?.fixed
                        : attributeKey === 'backend'
                            ? !!fixedAttributes.generic_keyword?.fixed
                            : false;
            rows.push({
                asin,
                sku,
                title,
                issueHeading,
                attributeKey,
                isFixed,
                message: messageObj,
                solution: howToSolve
            });
        };

        const titleData = updatedProduct.rankingErrors.data.TitleResult;
        if (titleData?.charLim?.status === 'Error') {
            pushRow('Title', 'Character Limit', titleData.charLim.Message, titleData.charLim.HowTOSolve);
        }
        if (titleData?.RestictedWords?.status === 'Error') {
            pushRow('Title', 'Restricted Words', titleData.RestictedWords.Message, titleData.RestictedWords.HowTOSolve);
        }
        if (titleData?.checkSpecialCharacters?.status === 'Error') {
            pushRow('Title', 'Special Characters', titleData.checkSpecialCharacters.Message, titleData.checkSpecialCharacters.HowTOSolve);
        }

        const bulletData = updatedProduct.rankingErrors.data.BulletPoints;
        if (bulletData?.charLim?.status === 'Error') {
            pushRow('Bullet Points', 'Character Limit', bulletData.charLim.Message, bulletData.charLim.HowTOSolve);
        }
        if (bulletData?.RestictedWords?.status === 'Error') {
            pushRow('Bullet Points', 'Restricted Words', bulletData.RestictedWords.Message, bulletData.RestictedWords.HowTOSolve);
        }
        if (bulletData?.checkSpecialCharacters?.status === 'Error') {
            pushRow('Bullet Points', 'Special Characters', bulletData.checkSpecialCharacters.Message, bulletData.checkSpecialCharacters.HowTOSolve);
        }

        const descData = updatedProduct.rankingErrors.data.Description;
        if (descData?.charLim?.status === 'Error') {
            pushRow('Description', 'Character Limit', descData.charLim.Message, descData.charLim.HowTOSolve);
        }
        if (descData?.RestictedWords?.status === 'Error') {
            pushRow('Description', 'Restricted Words', descData.RestictedWords.Message, descData.RestictedWords.HowTOSolve);
        }
        if (descData?.checkSpecialCharacters?.status === 'Error') {
            pushRow('Description', 'Special Characters', descData.checkSpecialCharacters.Message, descData.checkSpecialCharacters.HowTOSolve);
        }

        const backendData = updatedProduct.rankingErrors.data.charLim;
        if (backendData?.status === 'Error') {
            pushRow('Backend Keywords', 'Character Limit', backendData.Message, backendData.HowTOSolve);
        }

        return rows;
    }, [updatedProduct]);

    const conversionTableRows = useMemo(() => {
        const errors = updatedProduct?.conversionErrors;
        if (!errors) return [];

        const asin = updatedProduct.asin;
        const sku = updatedProduct.sku || '';
        const title = updatedProduct.name || updatedProduct.Title || 'N/A';
        const rows = [];

        const pushRow = (heading, subheading, errorObj) => {
            if (!errorObj || errorObj.status !== 'Error') return;
            rows.push({
                asin,
                sku,
                title,
                issueHeading: `${heading} | ${subheading}`,
                message: errorObj.Message,
                solution: errorObj.HowToSolve
            });
        };

        pushRow('Images', 'Image Issue', errors.imageResultErrorData);
        pushRow('Videos', 'Video Issue', errors.videoResultErrorData);
        pushRow('Rating', 'Star Rating Issue', errors.productStarRatingResultErrorData);
        pushRow('Buy Box', 'Product without Buy Box', errors.productsWithOutBuyboxErrorData);
        pushRow('A Plus', 'A+ Content Issue', errors.aplusErrorData);
        pushRow('Brand Story', 'Brand Story Issue', errors.brandStoryErrorData);

        return rows;
    }, [updatedProduct]);

    const inventoryTableRows = useMemo(() => {
        const errors = updatedProduct?.inventoryErrors;
        if (!errors) return [];

        const asin = updatedProduct.asin;
        const sku = updatedProduct.sku || '';
        const title = updatedProduct.name || updatedProduct.Title || 'N/A';
        const rows = [];

        if (errors.inventoryPlanningErrorData) {
            const planning = errors.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === 'Error') {
                rows.push({
                    asin,
                    sku,
                    title,
                    issueHeading: 'Inventory Planning | Long-Term Storage Fees',
                    message: planning.longTermStorageFees.Message,
                    solution: planning.longTermStorageFees.HowToSolve
                });
            }
            if (planning.unfulfillable?.status === 'Error') {
                rows.push({
                    asin,
                    sku,
                    title,
                    issueHeading: 'Inventory Planning | Unfulfillable Inventory',
                    message: planning.unfulfillable.Message,
                    solution: planning.unfulfillable.HowToSolve
                });
            }
        }

        if (errors.strandedInventoryErrorData) {
            rows.push({
                asin,
                sku,
                title,
                issueHeading: 'Stranded Inventory | Product Not Listed',
                message: errors.strandedInventoryErrorData.Message,
                solution: errors.strandedInventoryErrorData.HowToSolve
            });
        }

        if (errors.inboundNonComplianceErrorData) {
            rows.push({
                asin,
                sku,
                title,
                issueHeading: 'Inbound Non-Compliance | Shipment Issue',
                message: errors.inboundNonComplianceErrorData.Message,
                solution: errors.inboundNonComplianceErrorData.HowToSolve
            });
        }

        if (errors.replenishmentErrorData) {
            if (Array.isArray(errors.replenishmentErrorData)) {
                errors.replenishmentErrorData.forEach((error) => {
                    rows.push({
                        asin,
                        sku,
                        title,
                        issueHeading: `Replenishment | Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
                        message: error.Message,
                        solution: error.HowToSolve
                    });
                });
            } else {
                const error = errors.replenishmentErrorData;
                rows.push({
                    asin,
                    sku,
                    title,
                    issueHeading: `Replenishment | Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
                    message: error.Message,
                    solution: error.HowToSolve
                });
            }
        }

        return rows;
    }, [updatedProduct]);
    
    // Build normalised metrics and evaluate 20 scenario-based recommendations
    const scenarioMetrics = clientBuildMetrics(updatedProduct?.performance, profitabilityProduct);
    const clientRecommendations = evaluateScenarios(scenarioMetrics, updatedProduct?.comparison);
    
    // Debug: Log performance data (can be removed once verified working)
    if (process.env.NODE_ENV === 'development') {
        console.log('[ProductDetails] Performance data:', {
            asin,
            hasPerformance: !!product?.performance,
            sessions: product?.performance?.sessions,
            buyBoxPercentage: product?.performance?.buyBoxPercentage,
            conversionRate: product?.performance?.conversionRate,
            ppcSpend: product?.performance?.ppcSpend
        });
    }

    // All state and refs (must be declared before useEffects and early returns)
    const [TitleSolution, setTitleSolution] = useState("");
    const [BulletSoltion, setBulletSolution] = useState("");
    const [DescriptionSolution, setDescriptionSolution] = useState("");
    const [BackendKeyWords, setBackendKeyWords] = useState("");
    const [imageSolution, setImageSolution] = useState("");
    const [videoSolution, setVideoSolution] = useState("");
    const [productReviewSolution, setProductReviewSolution] = useState("");
    const [productStarRatingSolution, setProductStarRatingSolution] = useState("");
    const [productsWithOutBuyboxSolution, setProductsWithOutBuyboxSolution] = useState("");
    const [aplusSolution, setAplusSolution] = useState("");
    const [brandStorySolution, setBrandStorySolution] = useState("");
    const [inventoryPlanningSolution, setInventoryPlanningSolution] = useState("");
    const [strandedInventorySolution, setStrandedInventorySolution] = useState("");
    const [inboundNonComplianceSolution, setInboundNonComplianceSolution] = useState("");
    const [replenishmentSolution, setReplenishmentSolution] = useState("");
    const [openSelector, setOpenSelector] = useState(false);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const contentRef = useRef(null);
    const downloadRef = useRef(null);
    const navigate = useNavigate();
    
    // Debug: Log product data
    console.log('ProductDetails - Product found:', !!product);
    console.log('ProductDetails - Profitability product found:', !!profitabilityProduct);
    console.log('ProductDetails - Quantity from profitibilityData:', profitabilityProduct?.quantity);
    console.log('ProductDetails - Sales from profitibilityData:', profitabilityProduct?.sales);
    console.log('ProductDetails - Final quantity used:', quantity);
    console.log('ProductDetails - Final sales used:', sales);
    
    // Debug: Log when component renders with new ASIN
    useEffect(() => {
        console.log('Component rendered with ASIN:', asin);
        console.log('Product found:', !!product);
        console.log('Product quantity from backend:', product?.quantity);
        console.log('Product sales from backend:', product?.sales);
        console.log('Ranking product found:', !!rankingProduct);
    }, [asin, product, rankingProduct]);

    // Reset states when ASIN changes
    useEffect(() => {
        console.log('ASIN changed to:', asin);
        // Reset all solution states when navigating to a different product
        setTitleSolution("");
        setBulletSolution("");
        setDescriptionSolution("");
        setBackendKeyWords("");
        setImageSolution("");
        setVideoSolution("");
        setProductReviewSolution("");
        setProductStarRatingSolution("");
        setProductsWithOutBuyboxSolution("");
        setAplusSolution("");
        setInventoryPlanningSolution("");
        setStrandedInventorySolution("");
        setInboundNonComplianceSolution("");
        setReplenishmentSolution("");
        setOpenSelector(false);
        setShowDownloadOptions(false);
        
        // Scroll to top when product changes
        if (contentRef.current) {
            contentRef.current.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    }, [asin]);

    // Download dropdown: close on click outside
    useEffect(() => {
        function handleClickOutsideDownload(e) {
            if (downloadRef.current && !downloadRef.current.contains(e.target)) {
                setShowDownloadOptions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutsideDownload);
        return () => {
            document.removeEventListener("mousedown", handleClickOutsideDownload);
        }
    }, []);

    // Check if per-ASIN data is still loading
    const isPerAsinLoading = productDetailsLoading?.info || productDetailsLoading?.issues;
    
    // Show skeleton while loading issues-by-product data OR per-ASIN fallback data
    // so we never flash "Product Not Found" before data arrives
    if (issuesByProductLoading || !info) {
        return <ProductDetailsPageSkeleton />;
    }
    
    // If ASIN not found in issues-by-product, but we're fetching per-ASIN data, show skeleton
    if (!product && isPerAsinLoading) {
        return <ProductDetailsPageSkeleton />;
    }

    // Only show "No Product Data" if there's truly no data anywhere
    // AND we're not using per-ASIN fallback
    if (!info.productWiseError?.length && !usingPerAsinFallback) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center p-6">
                    <h2 className="text-lg font-semibold text-gray-100 mb-1">No Product Data Available</h2>
                    <p className="text-xs text-gray-400">No product analysis data has been loaded yet.</p>
                </div>
            </div>
        );
    }

    if (!updatedProduct) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center p-6">
                    <h2 className="text-lg font-semibold text-gray-100 mb-1">Product Not Found</h2>
                    <p className="text-xs text-gray-400">No product data found for ASIN: {asin}</p>
                    <p className="text-xs text-gray-500 mt-1">Please check the ASIN and try again.</p>
                </div>
            </div>
        );
    }

    const hasAnyConversionError = [
        updatedProduct.conversionErrors?.imageResultErrorData?.status,
        updatedProduct.conversionErrors?.videoResultErrorData?.status,
        updatedProduct.conversionErrors?.productStarRatingResultErrorData?.status,
        updatedProduct.conversionErrors?.productsWithOutBuyboxErrorData?.status,
        updatedProduct.conversionErrors?.aplusErrorData?.status
    ].includes("Error");

    const hasAnyInventoryError = updatedProduct.inventoryErrors && (
        updatedProduct.inventoryErrors.inventoryPlanningErrorData ||
        updatedProduct.inventoryErrors.strandedInventoryErrorData ||
        updatedProduct.inventoryErrors.inboundNonComplianceErrorData ||
        updatedProduct.inventoryErrors.replenishmentErrorData
    );

    const openCloseSol = (val, component) => {
        if (component === "Title") {
            setTitleSolution(prev => prev === val ? "" : val);
        }
        if (component === "BulletPoints") {
            setBulletSolution(prev => prev === val ? "" : val);
        }
        if (component === "Description") {
            setDescriptionSolution(prev => prev === val ? "" : val);
        }
        if (component === "BackendKeyWords") {
            setBackendKeyWords(prev => prev === val ? "" : val);
        }
    };

    const openCloseSolutionConversion = (val, component) => {
        if (component === "Image") {
            setImageSolution(prev => prev === val ? "" : val);
        }
        if (component === "Video") {
            setVideoSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductReview") {
            setProductReviewSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductStarRating") {
            setProductStarRatingSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductsWithOutBuybox") {
            setProductsWithOutBuyboxSolution(prev => prev === val ? "" : val);
        }
        if (component === "Aplus") {
            setAplusSolution(prev => prev === val ? "" : val);
        }
        if (component === "BrandStory") {
            setBrandStorySolution(prev => prev === val ? "" : val);
        }
    };

    const openCloseSolutionInventory = (val, component) => {
        if (component === "InventoryPlanning") {
            setInventoryPlanningSolution(prev => prev === val ? "" : val);
        }
        if (component === "StrandedInventory") {
            setStrandedInventorySolution(prev => prev === val ? "" : val);
        }
        if (component === "InboundNonCompliance") {
            setInboundNonComplianceSolution(prev => prev === val ? "" : val);
        }
        if (component === "Replenishment") {
            setReplenishmentSolution(prev => prev === val ? "" : val);
        }
    };

    // Prepare data for export
    const prepareExportData = () => {
        const exportData = [];
        
        // Basic Product Information
        exportData.push({
            Category: 'Product Information',
            Type: 'ASIN',
            Issue: '',
            Message: updatedProduct.asin,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'SKU',
            Issue: '',
            Message: updatedProduct.sku,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Product Name',
            Issue: '',
            Message: updatedProduct.name,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'List Price',
            Issue: '',
            Message: formatCurrencyWithLocale(Number(updatedProduct.price || 0), currency),
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Units Sold',
            Issue: '',
            Message: String(updatedProduct.quantity || 0),
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Sales',
            Issue: '',
            Message: formatCurrencyWithLocale(updatedProduct.sales || 0, currency),
            Solution: ''
        });
        // Use profitibilityData as primary source (more accurate, includes fees calculation)
        const exportGrossProfit = profitabilityProduct?.grossProfit ?? updatedProduct.performance?.grossProfit ?? 0;
        const exportGrossProfitNum = Number(exportGrossProfit);
        exportData.push({
            Category: 'Product Information',
            Type: 'Gross Profit / Loss',
            Issue: '',
            Message: (exportGrossProfitNum < 0 ? '-' : '') + formatCurrencyWithLocale(Math.abs(exportGrossProfitNum), currency),
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Duration',
            Issue: '',
            Message: `${info?.startDate} - ${info?.endDate}`,
            Solution: ''
        });

        // Ranking Issues - Title
        if (updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.HowTOSolve
            });
        }

        // Ranking Issues - Bullet Points
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.HowTOSolve
            });
        }

        // Ranking Issues - Description
        if (updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.Description?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.HowTOSolve
            });
        }
        
        // Ranking Issues - Backend Keywords
        if (updatedProduct.rankingErrors?.data?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Backend Keywords',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.charLim?.HowTOSolve
            });
        }

        // Conversion Issues
        if (product.conversionErrors?.imageResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Images',
                Issue: 'Images Issue',
                Message: product.conversionErrors?.imageResultErrorData.Message,
                Solution: product.conversionErrors?.imageResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.videoResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Video',
                Issue: 'Video Issue',
                Message: product.conversionErrors?.videoResultErrorData.Message,
                Solution: product.conversionErrors?.videoResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.productStarRatingResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Star Rating',
                Issue: 'Star Rating Issue',
                Message: product.conversionErrors?.productStarRatingResultErrorData.Message,
                Solution: product.conversionErrors?.productStarRatingResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.productsWithOutBuyboxErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Buy Box',
                Issue: 'Product without Buy Box',
                Message: product.conversionErrors?.productsWithOutBuyboxErrorData.Message,
                Solution: product.conversionErrors?.productsWithOutBuyboxErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.aplusErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'A+ Content',
                Issue: 'Aplus Issue',
                Message: product.conversionErrors?.aplusErrorData.Message,
                Solution: product.conversionErrors?.aplusErrorData.HowToSolve
            });
        }

        // Inventory Issues
        if (product.inventoryErrors?.inventoryPlanningErrorData) {
            const planning = product.inventoryErrors?.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Inventory Planning',
                    Issue: 'Long-Term Storage Fees',
                    Message: planning.longTermStorageFees.Message,
                    Solution: planning.longTermStorageFees.HowToSolve
                });
            }
            if (planning.unfulfillable?.status === "Error") {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Inventory Planning',
                    Issue: 'Unfulfillable Inventory',
                    Message: planning.unfulfillable.Message,
                    Solution: planning.unfulfillable.HowToSolve
                });
            }
        }
        if (product.inventoryErrors?.strandedInventoryErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Stranded Inventory',
                Issue: 'Product Not Listed',
                Message: product.inventoryErrors?.strandedInventoryErrorData.Message,
                Solution: product.inventoryErrors?.strandedInventoryErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.inboundNonComplianceErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Inbound Non-Compliance',
                Issue: 'Shipment Issue',
                Message: product.inventoryErrors?.inboundNonComplianceErrorData.Message,
                Solution: product.inventoryErrors?.inboundNonComplianceErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.replenishmentErrorData) {
            if (Array.isArray(product.inventoryErrors.replenishmentErrorData)) {
                product.inventoryErrors.replenishmentErrorData.forEach(error => {
                    exportData.push({
                        Category: 'Inventory Issues',
                        Type: 'Replenishment',
                        Issue: `Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
                        Message: error.Message,
                        Solution: error.HowToSolve
                    });
                });
            } else {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Replenishment',
                    Issue: `Low Inventory Risk ${product.inventoryErrors.replenishmentErrorData.sku ? `(SKU: ${product.inventoryErrors.replenishmentErrorData.sku})` : ''}`,
                    Message: product.inventoryErrors?.replenishmentErrorData.Message,
                    Solution: product.inventoryErrors?.replenishmentErrorData.HowToSolve
                });
            }
        }

        return exportData;
    };

    // Download as Excel
    const downloadExcel = async () => {
        const data = prepareExportData();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Product Issues');
        
        // Add header row
        if (data.length > 0) {
            const headers = Object.keys(data[0]);
            worksheet.addRow(headers);
            
            // Add data rows
            data.forEach(row => {
                worksheet.addRow(Object.values(row));
            });
            
            // Auto-size columns
            worksheet.columns = [
                { width: 20 }, // Category
                { width: 20 }, // Type
                { width: 20 }, // Issue
                { width: 50 }, // Message
                { width: 50 }  // Solution
            ];
            
            // Style header row
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
        }
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${updatedProduct.asin}_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // Write and download file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, fileName);
    };

    // Download as CSV
    const downloadCSV = () => {
        const data = prepareExportData();
        const csv = Papa.unparse(data);
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${updatedProduct.asin}_${new Date().toISOString().split('T')[0]}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, fileName);
    };

    // Download handler - showDownloadOptions, isGeneratingPDF, downloadRef, contentRef declared at top

    return (
        <div className="product-details-page bg-[#1a1a1a] lg:mt-0 mt-[10vh] h-screen overflow-y-auto">
            <div className="p-2">
                {/* Page Header */}
                <div className="bg-[#161b22] border border-[#30363d] rounded mb-2">
                    <div className="px-2 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Box className="w-4 h-4 text-blue-400 shrink-0" />
                            <div>
                                <h1 className="text-lg font-bold text-gray-100">Product Details</h1>
                                <p className="text-xs text-gray-400">Complete product overview, performance & issues</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-medium uppercase">ASIN</span>
                            <span className="font-mono text-sm font-bold text-blue-400 bg-[#21262d] border border-[#30363d] px-2 py-1 rounded">{updatedProduct.asin}</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-3 pb-1" ref={contentRef}>
                {/* Section 1: Product Details */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="bg-[#161b22] border border-[#30363d] rounded transition-all duration-300"
                >
                    <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Box className="w-4 h-4 text-blue-400 shrink-0" />
                            <h2 className="text-sm font-bold text-gray-100">Product Details</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative" ref={downloadRef}>
                                <button
                                    className="flex items-center gap-1 px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-all font-medium"
                                    onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                                >
                                    <Download className="w-3 h-3" />
                                    Export
                                    <ChevronDown className="w-3 h-3" />
                                </button>
                                <AnimatePresence>
                                    {showDownloadOptions && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-1 z-50 bg-[#21262d] shadow-xl rounded border border-[#30363d] overflow-hidden min-w-[160px]"
                                        >
                                            <div className="py-1">
                                                <button
                                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-[#161b22] transition-colors duration-200 text-xs"
                                                    onClick={() => { downloadCSV(); setShowDownloadOptions(false); }}
                                                >
                                                    <FileText className="w-3 h-3 text-green-400" />
                                                    <span className="font-medium">Download as CSV</span>
                                                </button>
                                                <button
                                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-[#161b22] transition-colors duration-200 text-xs"
                                                    onClick={() => { downloadExcel(); setShowDownloadOptions(false); }}
                                                >
                                                    <FileSpreadsheet className="w-3 h-3 text-blue-400" />
                                                    <span className="font-medium">Download as Excel</span>
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded text-xs hover:bg-[#30363d] focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-300 min-w-[120px]"
                                    onClick={() => setOpenSelector(!openSelector)}
                                >
                                    <span>Switch Product</span>
                                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${openSelector ? 'rotate-180' : ''}`} />
                                </button>
                                <AnimatePresence>
                                    {openSelector && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-1 w-80 max-h-64 overflow-y-auto bg-[#21262d] border border-[#30363d] rounded shadow-xl z-50"
                                        >
                                            <div className="py-1">
                                                {(info?.productWiseError || []).map((item, index) => (
                                                    <button
                                                        key={index}
                                                        className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#161b22] text-gray-300 hover:text-blue-400 border-b border-[#30363d] last:border-b-0"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (item.asin === asin) { setOpenSelector(false); return; }
                                                            navigate(`/seller-central-checker/${item.asin}`);
                                                            setOpenSelector(false);
                                                        }}
                                                    >
                                                        <div className="font-mono text-xs text-blue-400 mb-0.5">{item.asin}</div>
                                                        <div className="truncate">{item.name}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                    <div className="p-3">
                        <div className="flex flex-col md:flex-row md:items-start gap-4">
                            <div className="w-20 h-20 bg-[#21262d] border border-[#30363d] rounded overflow-hidden shrink-0">
                                {updatedProduct.MainImage ? (
                                    <LazyLoadImage
                                        src={updatedProduct.MainImage}
                                        alt="Product"
                                        className="w-full h-full object-cover"
                                        effect="blur"
                                        threshold={100}
                                        wrapperClassName="w-full h-full"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                                        <ImageOff className="w-10 h-10" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 overflow-visible">
                                {/* Product name: full-width block so complete title is always visible */}
                                <div className="w-full mb-3 pr-0">
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Name</p>
                                    <p className="text-sm font-semibold text-gray-100 leading-relaxed break-words overflow-visible" style={{ wordBreak: 'break-word' }}>
                                        {updatedProduct.name || updatedProduct.itemName || updatedProduct.title || '—'}
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">ASIN</p>
                                    <span className="font-mono text-sm bg-[#21262d] border border-[#30363d] px-2 py-1 rounded text-gray-300">{updatedProduct.asin}</span>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">SKU</p>
                                    <span className="font-mono text-sm bg-[#21262d] border border-[#30363d] px-2 py-1 rounded text-gray-300">{updatedProduct.sku}</span>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Price</p>
                                    <p className="text-sm font-bold text-white">{formatCurrencyWithLocale(Number(updatedProduct.price || 0), currency)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Units Sold</p>
                                    <p className="text-sm font-bold text-gray-100">{Number(updatedProduct.quantity || 0).toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Total Sales</p>
                                    <p className="text-sm font-bold text-gray-100">{formatCurrencyWithLocale(updatedProduct.sales || 0, currency)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Gross Profit / Loss</p>
                                    {(() => {
                                        // Use profitibilityData as primary source (more accurate, includes fees calculation)
                                        // Fall back to performance.grossProfit from EconomicsMetrics
                                        const grossProfit = profitabilityProduct?.grossProfit ?? updatedProduct.performance?.grossProfit ?? 0;
                                        const value = Number(grossProfit);
                                        const isLoss = value < 0;
                                        return (
                                            <p className={`text-sm font-bold ${isLoss ? 'text-red-400' : 'text-green-400'}`}>
                                                {isLoss ? '-' : ''}{formatCurrencyWithLocale(Math.abs(value), currency)}
                                            </p>
                                        );
                                    })()}
                                </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Section 2: Performance (metrics, recommendations, trends) with WoW/MoM */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="mb-2"
                >
                    <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                        {/* Performance section header with WoW/MoM filter */}
                        <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <TrendingUp className="w-4 h-4 text-green-400 shrink-0" />
                                <h2 className="text-sm font-bold text-gray-100">Performance</h2>
                                <span className="text-xs text-gray-400 hidden sm:inline">Metrics, recommendations & trends</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Comparison dropdown removed */}
                            </div>
                        </div>

                        {/* Performance metrics subsection - always visible (boxes above graphs) */}
                        <div className="border-b border-[#30363d]">
                            <div className="px-3 py-2 border-b border-[#30363d]">
                                <h3 className="text-xs font-semibold text-gray-300">Performance Metrics</h3>
                            </div>
                            
                            <div className="p-3">
                                {/* Comparison Period Badge */}
                                {updatedProduct.comparison?.hasComparison && (
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-400">
                                            <Calendar className="w-3 h-3" />
                                            {updatedProduct.comparison.type === 'wow' ? 'Week Over Week Comparison' : 
                                             updatedProduct.comparison.type === 'mom' ? 'Month Over Month Comparison' : 'Comparison'}
                                        </span>
                                    </div>
                                )}
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3 mb-4">
                                    {/* Sessions */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">Sessions</p>
                                        <p className="text-lg font-bold text-gray-100">{(updatedProduct.performance?.sessions ?? 0).toLocaleString()}</p>
                                        {updatedProduct.comparison?.hasComparison && updatedProduct.comparison?.changes?.sessions && (
                                            <ChangeIndicator 
                                                percentChange={updatedProduct.comparison.changes.sessions.percentChange} 
                                                positiveIsGood={true}
                                            />
                                        )}
                                    </div>
                                    
                                    {/* Page Views */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">Page Views</p>
                                        <p className="text-lg font-bold text-gray-100">{(updatedProduct.performance?.pageViews ?? 0).toLocaleString()}</p>
                                        {updatedProduct.comparison?.hasComparison && updatedProduct.comparison?.changes?.pageViews && (
                                            <ChangeIndicator 
                                                percentChange={updatedProduct.comparison.changes.pageViews.percentChange} 
                                                positiveIsGood={true}
                                            />
                                        )}
                                    </div>
                                    
                                    {/* Conversion Rate */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">Conversion Rate</p>
                                        <p className={`text-lg font-bold ${
                                            (updatedProduct.performance?.conversionRate ?? 0) >= 10 ? 'text-green-400' : 
                                            (updatedProduct.performance?.conversionRate ?? 0) >= 5 ? 'text-yellow-400' : 'text-red-400'
                                        }`}>
                                            {(updatedProduct.performance?.conversionRate ?? 0).toFixed(1)}%
                                        </p>
                                        {updatedProduct.comparison?.hasComparison && updatedProduct.comparison?.changes?.conversionRate && (
                                            <ChangeIndicator 
                                                percentChange={updatedProduct.comparison.changes.conversionRate.percentChange} 
                                                positiveIsGood={true}
                                            />
                                        )}
                                    </div>
                                    
                                    {/* Buy Box % */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">Buy Box %</p>
                                        <p className="text-lg font-bold text-gray-100">
                                            {(updatedProduct.performance?.buyBoxPercentage ?? 0).toFixed(0)}%
                                        </p>
                                    </div>
                                    
                                    {/* PPC Spend */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">PPC Spend</p>
                                        <p className="text-lg font-bold text-gray-100">
                                            {formatCurrencyWithLocale(updatedProduct.performance?.ppcSpend ?? 0, currency)}
                                        </p>
                                        {updatedProduct.comparison?.hasComparison && updatedProduct.comparison?.changes?.ppcSpend && (
                                            <ChangeIndicator 
                                                percentChange={updatedProduct.comparison.changes.ppcSpend.percentChange} 
                                                positiveIsGood={false}
                                            />
                                        )}
                                    </div>

                                    {/* PPC Sales */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">PPC Sales (30 days)</p>
                                        <p className="text-lg font-bold text-gray-100">
                                            {formatCurrencyWithLocale(updatedProduct.performance?.ppcSales ?? 0, currency)}
                                        </p>
                                    </div>
                                    
                                    {/* ACOS */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">ACOS</p>
                                        <p className="text-lg font-bold text-gray-100">
                                            {updatedProduct.performance?.hasPPC ? `${(updatedProduct.performance?.acos ?? 0).toFixed(1)}%` : 'N/A'}
                                        </p>
                                        {updatedProduct.performance?.hasPPC && updatedProduct.comparison?.hasComparison && updatedProduct.comparison?.changes?.acos && (
                                            <ChangeIndicator 
                                                percentChange={null}
                                                delta={updatedProduct.comparison.changes.acos.delta}
                                                positiveIsGood={false}
                                                isPercentagePoint={true}
                                            />
                                        )}
                                    </div>

                                    {/* PPC Impressions / Clicks */}
                                    <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                        <p className="text-xs text-gray-400 mb-1">PPC Impressions / Clicks (30 days)</p>
                                        <p className="text-lg font-bold text-gray-100">
                                            {perAsinCachedData?.ppcIssues?.ppcMetrics
                                                ? `${(perAsinCachedData.ppcIssues.ppcMetrics.impressions ?? 0).toLocaleString()} / ${(perAsinCachedData.ppcIssues.ppcMetrics.clicks ?? 0).toLocaleString()}`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                </div>
                                
                                {/* Sales & Units comparison (if available) */}
                                {updatedProduct.comparison?.hasComparison && (
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        {/* Sales Change */}
                                        <div className="bg-[#21262d] rounded border border-[#30363d] p-2">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-xs text-gray-400 mb-1">Sales Change</p>
                                                    <p className="text-lg font-bold text-gray-100">
                                                        {updatedProduct.comparison.changes?.sales?.delta >= 0 ? '+' : ''}
                                                        {formatCurrencyWithLocale(updatedProduct.comparison.changes?.sales?.delta ?? 0, currency)}
                                                    </p>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    {updatedProduct.comparison.changes?.sales && (
                                                        <ChangeIndicator 
                                                            percentChange={updatedProduct.comparison.changes.sales.percentChange} 
                                                            positiveIsGood={true}
                                                        />
                                                    )}
                                                    <span className="text-[9px] text-gray-500 mt-0.5">
                                                        {updatedProduct.comparison.type === 'wow' ? 'vs last week' : 'vs last month'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Units Change */}
                                        <div className="bg-[#21262d] rounded border border-[#30363d] p-2">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-xs text-gray-400 mb-1">Units Change</p>
                                                    <p className="text-lg font-bold text-gray-100">
                                                        {updatedProduct.comparison.changes?.unitsSold?.delta >= 0 ? '+' : ''}
                                                        {updatedProduct.comparison.changes?.unitsSold?.delta || 0}
                                                    </p>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    {updatedProduct.comparison.changes?.unitsSold && (
                                                        <ChangeIndicator 
                                                            percentChange={updatedProduct.comparison.changes.unitsSold.percentChange} 
                                                            positiveIsGood={true}
                                                        />
                                                    )}
                                                    <span className="text-[9px] text-gray-500 mt-0.5">
                                                        {updatedProduct.comparison.type === 'wow' ? 'vs last week' : 'vs last month'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                            </div>
                        </div>

                        {/* Performance Trends (graphs) - same section, no subheading */}
                        <div className="border-b border-[#30363d]">
                            <div className="p-3">
                            {isLoadingHistory ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
                                    <span className="text-sm text-gray-400">Loading performance history...</span>
                                </div>
                            ) : historyError ? (
                                <div className="text-center py-6">
                                    <p className="text-sm text-amber-400">{historyError}</p>
                                    <p className="text-xs text-gray-500 mt-1">Trend graphs require historical data from multiple analysis runs.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Granularity indicator */}
                                    {historyData?.granularity && historyData.granularity !== 'daily' && (
                                        <div className="flex items-center gap-2 text-xs text-gray-400">
                                            <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400">
                                                {historyData.granularity === 'weekly' ? 'Weekly View' : 'Monthly View'}
                                            </span>
                                            <span>{historyData.dataPoints || 0} data points</span>
                                        </div>
                                    )}
                                    
                                    {/* No data message (shown inside charts area) */}
                                    {(!historyData || !historyData.history || historyData.history.length === 0) && (
                                        <div className="text-center py-4">
                                            <p className="text-sm text-gray-400">No historical data available</p>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {comparisonType === 'wow' 
                                                    ? 'Weekly data will appear after multiple analysis runs over different weeks.'
                                                    : comparisonType === 'mom'
                                                    ? 'Monthly data will appear after analysis runs over different months.'
                                                    : 'Run analysis multiple times to collect historical data.'}
                                            </p>
                                        </div>
                                    )}
                                    
                                    {/* Sales & Conversion Chart - first */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                                                <DollarSign className="w-3 h-3 text-green-400" />
                                                Sales
                                                {historyData?.granularity === 'weekly' && <span className="text-gray-500 ml-1">(by week)</span>}
                                                {historyData?.granularity === 'monthly' && <span className="text-gray-500 ml-1">(by month)</span>}
                                            </h4>
                                            <div className="h-36 bg-[#21262d] rounded border border-[#30363d] p-2">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={historyData?.history || []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                                        <XAxis dataKey="displayDate" tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={{ stroke: '#30363d' }} />
                                                        <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={{ stroke: '#30363d' }} tickFormatter={(v) => formatYAxisCurrency(v, currency)} />
                                                        <Tooltip 
                                                            contentStyle={{ backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: '6px' }}
                                                            formatter={(value) => [formatCurrencyWithLocale(value ?? 0, currency), 'Sales']}
                                                        />
                                                        <Line type="monotone" dataKey="sales" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                                                <ShoppingCart className="w-3 h-3 text-orange-400" />
                                                Conversion Rate %
                                                {historyData?.granularity === 'weekly' && <span className="text-gray-500 ml-1">(by week)</span>}
                                                {historyData?.granularity === 'monthly' && <span className="text-gray-500 ml-1">(by month)</span>}
                                            </h4>
                                            <div className="h-36 bg-[#21262d] rounded border border-[#30363d] p-2">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={historyData?.history || []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                                        <XAxis dataKey="displayDate" tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={{ stroke: '#30363d' }} />
                                                        <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={{ stroke: '#30363d' }} tickFormatter={(v) => `${v}%`} />
                                                        <Tooltip 
                                                            contentStyle={{ backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: '6px' }}
                                                            formatter={(value) => [`${value?.toFixed(1) || 0}%`, 'Conversion']}
                                                        />
                                                        <Line type="monotone" dataKey="conversionRate" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316', r: 3 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Sessions & Page Views - separate charts side by side */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                                                <Eye className="w-3 h-3 text-blue-400" />
                                                Sessions
                                                {historyData?.granularity === 'weekly' && <span className="text-gray-500 ml-1">(by week)</span>}
                                                {historyData?.granularity === 'monthly' && <span className="text-gray-500 ml-1">(by month)</span>}
                                            </h4>
                                            <div className="h-48 bg-[#21262d] rounded border border-[#30363d] p-2">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={historyData?.history || []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                                        <XAxis dataKey="displayDate" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#30363d' }} />
                                                        <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#30363d' }} />
                                                        <Tooltip 
                                                            contentStyle={{ backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: '6px' }}
                                                            formatter={(value) => [value?.toLocaleString() ?? 0, 'Sessions']}
                                                        />
                                                        <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                                                <Eye className="w-3 h-3 text-violet-400" />
                                                Page Views
                                                {historyData?.granularity === 'weekly' && <span className="text-gray-500 ml-1">(by week)</span>}
                                                {historyData?.granularity === 'monthly' && <span className="text-gray-500 ml-1">(by month)</span>}
                                            </h4>
                                            <div className="h-48 bg-[#21262d] rounded border border-[#30363d] p-2">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={historyData?.history || []} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                                        <XAxis dataKey="displayDate" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#30363d' }} />
                                                        <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#30363d' }} />
                                                        <Tooltip 
                                                            contentStyle={{ backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: '6px' }}
                                                            formatter={(value) => [value?.toLocaleString() ?? 0, 'Page Views']}
                                                        />
                                                        <Line type="monotone" dataKey="pageViews" name="Page Views" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Summary Stats */}
                                    {historyData?.summary?.hasData && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                            <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                                <p className="text-xs text-gray-400">Avg. Sessions</p>
                                                <p className="text-sm font-bold text-gray-100">{historyData.summary.averages.sessions?.toLocaleString() || 0}</p>
                                            </div>
                                            <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                                <p className="text-xs text-gray-400">Avg. Sales</p>
                                                <p className="text-sm font-bold text-gray-100">{formatCurrencyWithLocale(historyData.summary.averages.sales ?? 0, currency)}</p>
                                            </div>
                                            <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                                <p className="text-xs text-gray-400">Avg. Conv %</p>
                                                <p className="text-sm font-bold text-gray-100">{historyData.summary.averages.conversionRate?.toFixed(1) || 0}%</p>
                                            </div>
                                            <div className="bg-[#21262d] rounded border border-[#30363d] p-2 text-center">
                                                <p className="text-xs text-gray-400">Sales Trend</p>
                                                <p className={`text-sm font-bold flex items-center justify-center gap-1 ${
                                                    historyData.summary.trends.sales > 0 ? 'text-green-400' : 
                                                    historyData.summary.trends.sales < 0 ? 'text-red-400' : 'text-gray-400'
                                                }`}>
                                                    {historyData.summary.trends.sales > 0 ? <ArrowUpRight className="w-3 h-3" /> : 
                                                     historyData.summary.trends.sales < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
                                                    {historyData.summary.trends.sales > 0 ? '+' : ''}{historyData.summary.trends.sales || 0}%
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            </div>
                        </div>

                        {/* Recommendations subsection (after graphs) - same UI as Ranking/Conversion issues */}
                        {/* Uses client-generated recommendations based on accurate profitabilityProduct data */}
                        <div className="bg-[#21262d] rounded border border-[#30363d] overflow-hidden mt-2">
                            <div className="px-2 py-1.5 border-b border-[#30363d] flex items-center gap-2">
                                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                <h3 className="text-xs font-semibold text-gray-300">Performance suggestions</h3>
                            </div>
                            <div className="p-2">
                                {clientRecommendations && clientRecommendations.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-gray-300 table-fixed">
                                            <thead>
                                                <tr className="bg-[#161b22] border-b border-[#30363d]">
                                                    <th className="px-2 py-1 text-left font-semibold text-gray-300 w-1/4 uppercase tracking-wider">Problems In Performance</th>
                                                    <th className="px-2 py-1 text-left font-semibold text-gray-300 w-1/5 uppercase tracking-wider">Recommendation</th>
                                                    <th className="px-2 py-1 text-left font-semibold text-gray-300 w-[55%] uppercase tracking-wider">Details</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {clientRecommendations.map((rec, idx) => (
                                                    <tr key={idx} className="border-b border-[#30363d] last:border-b-0 text-gray-200">
                                                        <td className="px-2 py-2 align-top">
                                                            <p className="text-xs text-amber-300 bg-amber-500/10 p-2 rounded border border-amber-500/30 leading-relaxed break-words">
                                                                {rec.reason || 'No specific guidance — monitor performance and keep optimizing.'}
                                                            </p>
                                                        </td>
                                                        <td className="px-2 py-2 align-middle text-center">
                                                            <div className="flex items-center justify-center">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                                                {rec.shortLabel}
                                                            </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-2 align-top">
                                                            <p className="text-xs text-gray-300 leading-relaxed break-words">
                                                                {rec.message}
                                                            </p>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-3 flex items-center gap-2 text-gray-400">
                                        <Star className="w-4 h-4 text-green-400 shrink-0" />
                                        <p className="text-xs">No recommendations — this product is performing well.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Section 3: Issues */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="mb-2"
                >
                    <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                        <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                                <div>
                                    <h2 className="text-sm font-bold text-gray-100">Issues</h2>
                                    <p className="text-xs text-gray-400">Ranking, conversion & inventory issues for this product</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-2 space-y-3">
                            {/* Issues summary tables (same format as Issues by Category) */}
                            {rankingTableRows.length > 0 && (
                                <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                                    <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
                                        <div className="flex items-center gap-2">
                                            <TrendingUp className="w-4 h-4 text-red-400" />
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-100">Ranking Issues</h3>
                                                <p className="text-xs text-gray-400">Title, bullets, description & backend keywords</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full">
                                        <table className="w-full table-fixed">
                                            <thead>
                                                <tr className="bg-[#21262d]">
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Details</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/4">How to Solve</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-24">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#30363d]">
                                                {rankingTableRows.map((row, idx) => (
                                                    <tr key={idx} className="text-sm text-gray-200 border-b border-[#30363d]">
                                                        <td className="py-2 px-2 align-top">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                                                {row.issueHeading}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-gray-300 leading-relaxed break-words">
                                                                <FormattedMessageComponent message={row.message} />
                                                            </p>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">
                                                                {row.solution}
                                                            </p>
                                                        </td>
                                                        <td className="py-2 px-2 align-middle">
                                                            {row.isFixed ? (
                                                                <div className="flex items-center justify-center">
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                                                    <CheckCircle className="w-3 h-3" />
                                                                    Applied
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center justify-center">
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-blue-600 border border-blue-500/60 hover:bg-blue-500 active:bg-blue-600 active:translate-y-[0.5px] transition-[background-color,border-color,transform] focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                                                                        onClick={() => openFixModal(row)}
                                                                    >
                                                                        <span className="text-[12px] leading-none text-white" aria-hidden>✓</span>
                                                                        Fix it
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {conversionTableRows.length > 0 && (
                                <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                                    <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
                                        <div className="flex items-center gap-2">
                                            <LineChart className="w-4 h-4 text-blue-400" />
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-100">Conversion Issues</h3>
                                                <p className="text-xs text-gray-400">Images, videos, rating, buy box, A+ & brand story</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full">
                                        <table className="w-full table-fixed">
                                            <thead>
                                                <tr className="bg-[#21262d]">
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Details</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/4">How to Solve</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#30363d]">
                                                {conversionTableRows.map((row, idx) => (
                                                    <tr key={idx} className="text-sm text-gray-200 border-b border-[#30363d]">
                                                        <td className="py-2 px-2 align-top">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                                                {row.issueHeading}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-gray-300 leading-relaxed break-words">
                                                                <FormattedMessageComponent message={row.message} />
                                                            </p>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">
                                                                {row.solution}
                                                            </p>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {inventoryTableRows.length > 0 && (
                                <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                                    <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
                                        <div className="flex items-center gap-2">
                                            <PackageOpen className="w-4 h-4 text-yellow-400" />
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-100">Inventory Issues</h3>
                                                <p className="text-xs text-gray-400">Planning, stranded, inbound & replenishment risks</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full">
                                        <table className="w-full table-fixed">
                                            <thead>
                                                <tr className="bg-[#21262d]">
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Details</th>
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/4">How to Solve</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#30363d]">
                                                {inventoryTableRows.map((row, idx) => (
                                                    <tr key={idx} className="text-sm text-gray-200 border-b border-[#30363d]">
                                                        <td className="py-2 px-2 align-top">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                                                {row.issueHeading}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-gray-300 leading-relaxed break-words">
                                                                <FormattedMessageComponent message={row.message} />
                                                            </p>
                                                        </td>
                                                        <td className="py-2 px-2 align-top">
                                                            <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">
                                                                {row.solution}
                                                            </p>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Keywords Optimization (per-ASIN, backend-calculated and accurate) - placed after Inventory issues */}
                            {perAsinCachedData?.ppcIssues && (
                                <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                                    <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
                                        <div className="flex items-center gap-2">
                                            <LineChartIcon className="w-4 h-4 text-blue-400" />
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-100">Keywords Optimization</h3>
                                                <p className="text-xs text-gray-400">Ad spend, ACOS, low impressions & wasted keywords</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-2">
                                        <ProductPPCIssuesTable 
                                            data={perAsinCachedData.ppcIssues}
                                            currency={currency}
                                            asin={normalizedAsin}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Fix It Modal (Ranking) */}
                            <AnimatePresence>
                                {isFixModalOpen && (
                                    <motion.div
                                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        <motion.div
                                            className="bg-[#0d1117] border border-[#30363d] rounded-lg w-full max-w-lg mx-2 p-4 shadow-xl"
                                            initial={{ scale: 0.9, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0.9, opacity: 0 }}
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div>
                                                    <h2 className="text-sm font-bold text-gray-100">Fix Ranking Issues</h2>
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        ASIN: <span className="font-mono">{fixContext.asin}</span>
                                                        {fixContext.sku && (
                                                            <>
                                                                {' · '}
                                                                SKU: <span className="font-mono">{fixContext.sku}</span>
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="text-gray-400 hover:text-gray-200 text-xs"
                                                    onClick={closeFixModal}
                                                >
                                                    Close
                                                </button>
                                            </div>

                                            <form className="space-y-3" onSubmit={handleFixSubmit}>
                                                {fixContext.attributeKey === 'title' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-300 mb-1">New Title</label>
                                                        <input
                                                            type="text"
                                                            className="w-full px-2 py-1.5 rounded border border-[#30363d] bg-[#161b22] text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                            placeholder="Enter optimized product title"
                                                            value={fixForm.title}
                                                            onChange={(e) => setFixForm(prev => ({ ...prev, title: e.target.value }))}
                                                        />
                                                        {titleSuggestions.length > 0 && (
                                                            <div className="mt-2 space-y-1">
                                                                <p className="text-[11px] text-gray-400">Suggestions</p>
                                                                <div className="space-y-1">
                                                                    {titleSuggestions.slice(0, 5).map((t, i) => (
                                                                        <button
                                                                            key={i}
                                                                            type="button"
                                                                            className="w-full text-left text-[11px] px-2 py-1 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#161b22] text-gray-200"
                                                                            onClick={() => setFixForm(prev => ({ ...prev, title: t }))}
                                                                        >
                                                                            {t}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="mt-2">
                                                            <button
                                                                type="button"
                                                                className="px-2 py-1 rounded text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                                                                onClick={() => handleGenerate('title')}
                                                                disabled={generateTitleLoading}
                                                            >
                                                                {generateTitleLoading ? 'Generating…' : 'Generate with AI'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {fixContext.attributeKey === 'description' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-300 mb-1">New Description</label>
                                                        <textarea
                                                            className="w-full px-2 py-1.5 rounded border border-[#30363d] bg-[#161b22] text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                                                            placeholder="Enter optimized product description"
                                                            value={fixForm.description}
                                                            onChange={(e) => setFixForm(prev => ({ ...prev, description: e.target.value }))}
                                                        />
                                                        <div className="mt-2">
                                                            <button
                                                                type="button"
                                                                className="px-2 py-1 rounded text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                                                                onClick={() => handleGenerate('description')}
                                                                disabled={generateTitleLoading}
                                                            >
                                                                {generateTitleLoading ? 'Generating…' : 'Generate with AI'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {fixContext.attributeKey === 'bulletpoints' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-300 mb-1">New Bullet Points</label>
                                                        <div className="space-y-2">
                                                            {(fixForm.bulletpoints || ['']).map((b, i) => (
                                                                <input
                                                                    key={i}
                                                                    type="text"
                                                                    className="w-full px-2 py-1.5 rounded border border-[#30363d] bg-[#161b22] text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    placeholder={`Bullet ${i + 1}`}
                                                                    value={b}
                                                                    onChange={(e) => setFixForm(prev => {
                                                                        const next = Array.isArray(prev.bulletpoints) ? [...prev.bulletpoints] : [''];
                                                                        next[i] = e.target.value;
                                                                        return { ...prev, bulletpoints: next };
                                                                    })}
                                                                />
                                                            ))}
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    className="px-2 py-1 rounded text-[11px] font-medium bg-[#21262d] text-gray-200 border border-[#30363d] hover:bg-[#161b22]"
                                                                    onClick={() => setFixForm(prev => ({ ...prev, bulletpoints: [...(Array.isArray(prev.bulletpoints) ? prev.bulletpoints : ['']), ''] }))}
                                                                >
                                                                    Add bullet
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="px-2 py-1 rounded text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                                                                    onClick={() => handleGenerate('bulletpoints')}
                                                                    disabled={generateTitleLoading}
                                                                >
                                                                    {generateTitleLoading ? 'Generating…' : 'Generate with AI'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {fixContext.attributeKey === 'backend' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-300 mb-1">Backend Keywords</label>
                                                        <textarea
                                                            className="w-full px-2 py-1.5 rounded border border-[#30363d] bg-[#161b22] text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                                                            placeholder="Enter backend keywords"
                                                            value={fixForm.backendKeywords}
                                                            onChange={(e) => setFixForm(prev => ({ ...prev, backendKeywords: e.target.value }))}
                                                        />
                                                        <div className="mt-2">
                                                            <button
                                                                type="button"
                                                                className="px-2 py-1 rounded text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                                                                onClick={() => handleGenerate('backend')}
                                                                disabled={generateTitleLoading}
                                                            >
                                                                {generateTitleLoading ? 'Generating…' : 'Generate with AI'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {generateTitleError && (
                                                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                                                        {generateTitleError}
                                                    </div>
                                                )}
                                                {applyError && (
                                                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                                                        {applyError}
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-end gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        className="px-3 py-1.5 rounded text-xs font-medium bg-[#21262d] text-gray-200 border border-[#30363d] hover:bg-[#161b22]"
                                                        onClick={closeFixModal}
                                                        disabled={applyLoading}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                                                        disabled={applyLoading}
                                                    >
                                                        {applyLoading ? 'Applying…' : 'Apply'}
                                                    </button>
                                                </div>
                                            </form>
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
                
                <div className="py-2 w-full h-5" />
                </div>
            </div>
            
            {/* Loading overlay for PDF generation */}
            {isGeneratingPDF && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
                    <div className="bg-[#161b22] border border-[#30363d] rounded p-4 flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                        <p className="text-xs text-gray-300">Generating PDF...</p>
                        <p className="text-xs text-gray-400 mt-1">Please wait, this may take a moment</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
