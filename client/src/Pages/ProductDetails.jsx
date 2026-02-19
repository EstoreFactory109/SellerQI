import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from "react-redux";
import { useParams } from 'react-router-dom';
import { fetchIssuesByProductData } from '../redux/slices/PageDataSlice';
import noImage from '../assets/Icons/no-image.png';
import DropDown from '../assets/Icons/drop-down.png';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from "framer-motion";
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Box, AlertTriangle, TrendingUp, TrendingDown, LineChart as LineChartIcon, Calendar, Download, ChevronDown, FileText, FileSpreadsheet, Star, ArrowUpRight, ArrowDownRight, Minus, Eye, ShoppingCart, DollarSign } from 'lucide-react';
import './ProductDetails.css';
import { ProductDetailsPageSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import axiosInstance from '../config/axios.config.js';
import { formatCurrencyWithLocale, formatYAxisCurrency } from '../utils/currencyUtils.js';

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

/**
 * Generate client-side recommendations for Product Details page
 * Uses profitabilityProduct data for accurate sales/profitability metrics
 * @param {Object} profitabilityProduct - Product data from profitibilityData (sales, grossProfit, ads, etc.)
 * @param {Object} comparison - Comparison data for sales trends (from updatedProduct.comparison)
 * @param {Object} performance - Performance data (from updatedProduct.performance)
 * @param {string} currency - Currency symbol
 * @returns {Array} Array of recommendation objects { shortLabel, message, reason }
 */
const generateProductRecommendations = (profitabilityProduct, comparison, performance, currency = '$') => {
    const recommendations = [];
    
    if (!profitabilityProduct) {
        return recommendations;
    }
    
    const sales = profitabilityProduct.sales || 0;
    const grossProfit = profitabilityProduct.grossProfit || 0;
    const adsSpend = profitabilityProduct.ads || 0;
    const amzFee = profitabilityProduct.amzFee || 0;
    
    // Calculate profit margin
    const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0;
    
    // Calculate ACOS if there's ads spend and sales
    const acos = (adsSpend > 0 && sales > 0) ? (adsSpend / sales) * 100 : 0;
    
    // 1. Check profitability
    if (grossProfit < 0) {
        recommendations.push({
            shortLabel: 'Review Profitability',
            message: 'Product is operating at a loss. Consider reviewing pricing, reducing PPC spend, or negotiating better costs.',
            reason: `Gross profit is ${currency}${grossProfit.toFixed(2)} (loss)`
        });
    } else if (profitMargin < 10 && sales > 0) {
        recommendations.push({
            shortLabel: 'Low Profit Margin',
            message: 'Product has low profit margin. Consider increasing price or reducing costs.',
            reason: `Profit margin is ${profitMargin.toFixed(1)}% (below 10% threshold)`
        });
    }
    
    // 2. Check PPC efficiency - only if there's PPC activity
    if (adsSpend > 0) {
        // High ACOS warning (threshold: 30%)
        if (acos > 30) {
            recommendations.push({
                shortLabel: 'Optimize PPC',
                message: 'Advertising cost of sale is high. Review and optimize keyword targeting and bids.',
                reason: `ACOS is ${acos.toFixed(1)}% (above 30% threshold)`
            });
        }
        
        // Check if PPC spend exceeds gross profit (inefficient PPC)
        if (adsSpend > grossProfit && grossProfit > 0) {
            recommendations.push({
                shortLabel: 'Reduce PPC Spend',
                message: 'PPC spend is consuming most of the profit margin. Consider reducing ad spend or improving conversion.',
                reason: `PPC spend (${currency}${adsSpend.toFixed(2)}) exceeds gross profit (${currency}${grossProfit.toFixed(2)})`
            });
        }
    }
    
    // 3. Check sales trends (if comparison data is available)
    if (comparison?.hasComparison && comparison?.changes?.sales) {
        const salesPercentChange = comparison.changes.sales.percentChange;
        
        // Significant sales decline (threshold: -20%)
        if (salesPercentChange !== null && salesPercentChange < -20) {
            const trendPeriod = comparison.type === 'wow' ? 'week-over-week' : comparison.type === 'mom' ? 'month-over-month' : 'period';
            recommendations.push({
                shortLabel: 'Declining Sales',
                message: `Sales have dropped significantly. Review product listing, pricing, and competitive position.`,
                reason: `Sales declined ${Math.abs(salesPercentChange).toFixed(1)}% ${trendPeriod}`
            });
        }
    }
    
    // 4. Check units sold trend
    if (comparison?.hasComparison && comparison?.changes?.unitsSold) {
        const unitsPercentChange = comparison.changes.unitsSold.percentChange;
        
        // Significant units decline (threshold: -25%)
        if (unitsPercentChange !== null && unitsPercentChange < -25 && !recommendations.some(r => r.shortLabel === 'Declining Sales')) {
            const trendPeriod = comparison.type === 'wow' ? 'week-over-week' : comparison.type === 'mom' ? 'month-over-month' : 'period';
            recommendations.push({
                shortLabel: 'Declining Units',
                message: `Unit sales have dropped significantly. Check inventory, pricing, and Buy Box status.`,
                reason: `Units sold declined ${Math.abs(unitsPercentChange).toFixed(1)}% ${trendPeriod}`
            });
        }
    }
    
    // 5. Check conversion rate
    if (performance?.conversionRate !== undefined) {
        const conversionRate = performance.conversionRate;
        
        // Low conversion rate warning (threshold: 5%)
        if (conversionRate < 5 && conversionRate > 0) {
            recommendations.push({
                shortLabel: 'Improve Conversion',
                message: 'Conversion rate is below average. Optimize listing images, description, and reviews.',
                reason: `Conversion rate is ${conversionRate.toFixed(1)}% (below 5% threshold)`
            });
        }
    }
    
    // 6. Check high fees relative to sales
    if (amzFee > 0 && sales > 0) {
        const feePercentage = (amzFee / sales) * 100;
        
        // High Amazon fees warning (threshold: 40%)
        if (feePercentage > 40) {
            recommendations.push({
                shortLabel: 'Review Fees',
                message: 'Amazon fees are consuming a large portion of revenue. Consider FBA alternatives or product bundling.',
                reason: `Amazon fees are ${feePercentage.toFixed(1)}% of sales`
            });
        }
    }
    
    return recommendations;
};

const Dashboard = () => {
    const dispatch = useDispatch();
    const info = useSelector((state) => state.Dashboard.DashBoardInfo);
    const issuesByProductLoading = useSelector((state) => state.pageData?.issuesByProduct?.loading);
    const currency = useSelector((state) => state.currency?.currency) || '$';
    console.log("info: ",info)
    const dropdownRef = useRef(null);
    
    // Comparison state for WoW/MoM
    const [comparisonType, setComparisonType] = useState('none');
    const [isLoadingComparison, setIsLoadingComparison] = useState(false);
    
    // Historical data for graphs
    const [historyData, setHistoryData] = useState(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    
    // Comparison options
    const comparisonOptions = [
        { value: 'none', label: 'Day Over Day', shortLabel: 'DOD' },
        { value: 'wow', label: 'Week Over Week', shortLabel: 'WoW' },
        { value: 'mom', label: 'Month Over Month', shortLabel: 'MoM' }
    ];

    // Load issues-by-product data so we have enriched productWiseError (performance + recommendations).
    // This syncs to DashBoardInfo and ensures this detail page shows the Performance section.
    useEffect(() => {
        dispatch(fetchIssuesByProductData());
    }, [dispatch]);

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

    const { asin } = useParams();
    
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
                const response = await axiosInstance.get(`/api/pagewise/product-history/${asin}?granularity=${granularity}`);
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
    
    // Use sales and quantity from profitibilityData (same as profitability dashboard)
    // Falls back to productWiseError if profitibilityData not available
    const sales = profitabilityProduct?.sales ?? product?.sales ?? 0;
    const quantity = profitabilityProduct?.quantity ?? product?.quantity ?? 0;
    
    // Update product with ranking data and accurate sales/quantity from profitibilityData
    const updatedProduct = product ? {
        ...product,
        // Use sales and quantity from profitibilityData (same source as profitability dashboard)
        quantity: quantity,
        sales: sales,
        // Add ranking data from rankingProductWiseErrors array
        rankingErrors: rankingProduct || undefined
    } : null;
    
    // Generate client-side recommendations using accurate profitabilityProduct data
    // This replaces backend recommendations which may have stale/incorrect data
    const clientRecommendations = generateProductRecommendations(
        profitabilityProduct,
        updatedProduct?.comparison,
        updatedProduct?.performance,
        currency
    );
    
    // Debug: Log client-generated recommendations
    if (process.env.NODE_ENV === 'development') {
        console.log('[ProductDetails] Client recommendations:', {
            asin,
            profitabilityProduct: {
                sales: profitabilityProduct?.sales,
                grossProfit: profitabilityProduct?.grossProfit,
                ads: profitabilityProduct?.ads
            },
            recommendationsCount: clientRecommendations.length,
            recommendations: clientRecommendations
        });
    }
    
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

    // Show skeleton while loading issues-by-product data (first load or refresh)
    // so we never flash "Product Not Found" before data arrives
    if (issuesByProductLoading || !info) {
        return <ProductDetailsPageSkeleton />;
    }

    if (!info.productWiseError || info.productWiseError.length === 0) {
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
                                <LazyLoadImage
                                    src={updatedProduct.MainImage || noImage}
                                    alt="Product"
                                    className="w-full h-full object-cover"
                                    effect="blur"
                                    placeholderSrc={noImage}
                                    threshold={100}
                                    wrapperClassName="w-full h-full"
                                />
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
                                    <p className="text-xs text-gray-400 font-medium mb-0.5">Revenue</p>
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
                                <span className="text-xs text-gray-400">Compare:</span>
                                <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <select
                                    value={comparisonType}
                                    onChange={(e) => handleComparisonChange(e.target.value)}
                                    disabled={isLoadingComparison}
                                    className="px-2 py-1.5 border border-[#30363d] rounded text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-[#161b22] disabled:opacity-50 min-w-[140px]"
                                >
                                    {comparisonOptions.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                {isLoadingComparison && (
                                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                                )}
                                {comparisonType !== 'none' && !isLoadingComparison && updatedProduct?.comparison?.hasComparison && (
                                    <span className="text-xs text-green-400 shrink-0">{comparisonType === 'wow' ? 'WoW' : 'MoM'} active</span>
                                )}
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
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
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
                                <h3 className="text-xs font-semibold text-gray-300">Recommendations</h3>
                                <span className="text-xs text-gray-400">Performance suggestions</span>
                            </div>
                            <div className="p-2">
                                {clientRecommendations && clientRecommendations.length > 0 ? (
                                    <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1 flex flex-col gap-2">
                                        {clientRecommendations.map((rec, idx) => (
                                            <li key={idx} className="mb-4">
                                                <div className="flex justify-between items-center">
                                                    <p className="w-[40vw] text-gray-300">
                                                        <b className="text-gray-200">{rec.shortLabel}: </b>
                                                        {rec.message}
                                                        {rec.reason && (
                                                            <>
                                                                <br />
                                                                <span className="text-gray-500 mt-1 block">{rec.reason}</span>
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
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
                {/* Ranking Issues subsection */}
                <div className="bg-[#21262d] rounded border border-[#30363d] overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-[#30363d] flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-red-400 shrink-0" />
                        <h3 className="text-xs font-semibold text-gray-300">Ranking Issues</h3>
                        <span className="text-xs text-gray-400">Search ranking optimization</span>
                    </div>
                    <div className="p-2 space-y-2">
                        {(updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error") && (<div>
                            <p className="font-semibold text-xs text-gray-300">Titles</p>
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1">
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.Message} /></p>
                                                <button className="px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-1 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300' style={TitleSolution === "charLim"
                                                ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                            }>{updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestrictedWords", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div
                                                className='bg-[#21262d] border border-[#30363d] mt-2 justify-center items-center transition-all duration-700 ease-in-out text-xs text-gray-300'
                                                style={TitleSolution === "RestrictedWords"
                                                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                    : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                                }
                                            >
                                                {updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.HowTOSolve}
                                            </div>

                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={TitleSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>

                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold text-xs text-gray-300">Bullet Points</p>
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1">
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center mb-4'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4' >
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestictedWords", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>
                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold text-xs text-gray-300">Description</p>
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1">
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.charLim?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestictedWords", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }

                            </ul>
                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.charLim?.status === "Error") && (<div>
                            <p className="font-semibold text-xs text-gray-300">Backend Keywords</p>
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1">
                                {
                                    updatedProduct.rankingErrors?.data?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "BackendKeyWords")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BackendKeyWords === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.charLim?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }


                            </ul>
                        </div>)}
                    </div>
                </div>

                {/* Conversion Issues subsection */}
                {hasAnyConversionError && (
                    <div className="bg-[#21262d] rounded border border-[#30363d] overflow-hidden">
                        <div className="px-2 py-1.5 border-b border-[#30363d] flex items-center gap-2">
                            <LineChartIcon className="w-3 h-3 text-blue-400 shrink-0" />
                            <h3 className="text-xs font-semibold text-gray-300">Conversion Issues</h3>
                            <span className="text-xs text-gray-400">Product appeal & conversion</span>
                        </div>
                        <div className="p-2">
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1 flex flex-col gap-2">
                                {product.conversionErrors?.imageResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Images Issue"
                                        message={product.conversionErrors?.imageResultErrorData.Message}
                                        solutionKey="Image"
                                        solutionContent={product.conversionErrors?.imageResultErrorData.HowToSolve}
                                        stateValue={imageSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Image")}
                                    />
                                )}
                                {product.conversionErrors?.videoResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Video Issue"
                                        message={product.conversionErrors?.videoResultErrorData.Message}
                                        solutionKey="Video"
                                        solutionContent={product.conversionErrors?.videoResultErrorData.HowToSolve}
                                        stateValue={videoSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Video")}
                                    />
                                )}
                                {product.conversionErrors?.productStarRatingResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Star Rating Issue"
                                        message={product.conversionErrors?.productStarRatingResultErrorData.Message}
                                        solutionKey="ProductStarRating"
                                        solutionContent={product.conversionErrors?.productStarRatingResultErrorData.HowToSolve}
                                        stateValue={productStarRatingSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductStarRating")}
                                    />
                                )}
                                {product.conversionErrors?.productsWithOutBuyboxErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Product without Buy Box"
                                        message={product.conversionErrors?.productsWithOutBuyboxErrorData.Message}
                                        solutionKey="ProductsWithOutBuybox"
                                        solutionContent={product.conversionErrors?.productsWithOutBuyboxErrorData.HowToSolve}
                                        stateValue={productsWithOutBuyboxSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductsWithOutBuybox")}
                                    />
                                )}
                                {product.conversionErrors?.aplusErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Aplus Issue"
                                        message={product.conversionErrors?.aplusErrorData.Message}
                                        solutionKey="Aplus"
                                        solutionContent={product.conversionErrors?.aplusErrorData.HowToSolve}
                                        stateValue={aplusSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Aplus")}
                                    />
                                )}
                                {product.conversionErrors?.brandStoryErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Brand Story Issue"
                                        message={product.conversionErrors?.brandStoryErrorData.Message}
                                        solutionKey="BrandStory"
                                        solutionContent={product.conversionErrors?.brandStoryErrorData.HowToSolve}
                                        stateValue={brandStorySolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "BrandStory")}
                                    />
                                )}
                            </ul>
                        </div>
                    </div>
                )}

                {/* Inventory Issues subsection */}
                {hasAnyInventoryError && (
                    <div className="bg-[#21262d] rounded border border-[#30363d] overflow-hidden">
                        <div className="px-2 py-1.5 border-b border-[#30363d] flex items-center gap-2">
                            <Box className="w-3 h-3 text-green-400 shrink-0" />
                            <h3 className="text-xs font-semibold text-gray-300">Inventory Issues</h3>
                            <span className="text-xs text-gray-400">Inventory & warehouse</span>
                        </div>
                        <div className="p-2">
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1 flex flex-col gap-2">
                                {/* Inventory Planning Issues */}
                                {product.inventoryErrors?.inventoryPlanningErrorData && (
                                    <>
                                        {product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees?.status === "Error" && (
                                            <IssueItem
                                                label="Long-Term Storage Fees"
                                                message={product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees.Message}
                                                solutionKey="LongTermStorage"
                                                solutionContent={product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees.HowToSolve}
                                                stateValue={inventoryPlanningSolution}
                                                toggleFunc={(val) => openCloseSolutionInventory(val, "InventoryPlanning")}
                                            />
                                        )}
                                        {product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable?.status === "Error" && (
                                            <IssueItem
                                                label="Unfulfillable Inventory"
                                                message={product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable.Message}
                                                solutionKey="Unfulfillable"
                                                solutionContent={product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable.HowToSolve}
                                                stateValue={inventoryPlanningSolution}
                                                toggleFunc={(val) => openCloseSolutionInventory(val, "InventoryPlanning")}
                                            />
                                        )}
                                    </>
                                )}

                                {/* Stranded Inventory Issues */}
                                {product.inventoryErrors?.strandedInventoryErrorData && (
                                    <IssueItem
                                        label="Stranded Inventory"
                                        message={product.inventoryErrors?.strandedInventoryErrorData.Message}
                                        solutionKey="StrandedInventory"
                                        solutionContent={product.inventoryErrors?.strandedInventoryErrorData.HowToSolve}
                                        stateValue={strandedInventorySolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "StrandedInventory")}
                                    />
                                )}

                                {/* Inbound Non-Compliance Issues */}
                                {product.inventoryErrors?.inboundNonComplianceErrorData && (
                                    <IssueItem
                                        label="Inbound Non-Compliance"
                                        message={product.inventoryErrors?.inboundNonComplianceErrorData.Message}
                                        solutionKey="InboundNonCompliance"
                                        solutionContent={product.inventoryErrors?.inboundNonComplianceErrorData.HowToSolve}
                                        stateValue={inboundNonComplianceSolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "InboundNonCompliance")}
                                    />
                                )}

                                {/* Replenishment/Restock Issues - handles single or multiple errors */}
                                {product.inventoryErrors?.replenishmentErrorData && (
                                    Array.isArray(product.inventoryErrors.replenishmentErrorData) ? (
                                        // Multiple errors for same ASIN (different SKUs)
                                        product.inventoryErrors.replenishmentErrorData.map((error, idx) => {
                                            const recommendedQty = error.recommendedReplenishmentQty || error.data || null;
                                            const messageWithQty = recommendedQty !== null && recommendedQty !== undefined && recommendedQty > 0
                                                ? `${error.Message} <span class="font-bold">Recommended Restock Quantity: ${recommendedQty} units</span>`
                                                : error.Message;
                                            return (
                                                <IssueItem
                                                    key={`replenishment-${idx}`}
                                                    label={`Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`}
                                                    message={error.Message}
                                                    recommendedQty={recommendedQty}
                                                    solutionKey={`Replenishment-${idx}`}
                                                    solutionContent={error.HowToSolve}
                                                    stateValue={replenishmentSolution}
                                                    toggleFunc={(val) => openCloseSolutionInventory(val, "Replenishment")}
                                                />
                                            );
                                        })
                                    ) : (
                                        // Single error
                                        (() => {
                                            const error = product.inventoryErrors.replenishmentErrorData;
                                            const recommendedQty = error.recommendedReplenishmentQty || error.data || null;
                                            return (
                                                <IssueItem
                                                    label={`Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`}
                                                    message={error.Message}
                                                    recommendedQty={recommendedQty}
                                                    solutionKey="Replenishment"
                                                    solutionContent={error.HowToSolve}
                                                    stateValue={replenishmentSolution}
                                                    toggleFunc={(val) => openCloseSolutionInventory(val, "Replenishment")}
                                                />
                                            );
                                        })()
                                    )
                                )}
                            </ul>
                        </div>
                    </div>
                )}
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
