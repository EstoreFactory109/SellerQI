import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from "react-redux";
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Search, Filter, ChevronDown, Package, Eye, Activity, Star, TrendingUp, BarChart3, ArrowRight, Download } from 'lucide-react';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import noImage from '../assets/Icons/no-image.png';

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
const FormattedMessage = ({ message }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message);
  
  return (
    <>
      {mainText && <span>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          <strong className="text-gray-900 mt-1 block">{highlightedText}</strong>
        </>
      )}
    </>
  );
};

// Table component for ranking issues
const RankingIssuesTable = ({ product, info }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractRankingErrors = (product) => {
        // Find the corresponding ranking data from info.rankingProductWiseErrors
        const rankingData = info?.rankingProductWiseErrors?.find(item => item.asin === product.asin);
        if (!rankingData?.data) return [];
        
        const rankingErrors = rankingData.data;
        const errorRows = [];
        const sections = ['TitleResult', 'BulletPoints', 'Description'];
        const sectionLabels = {
            TitleResult: 'Title',
            BulletPoints: 'Bullet Points', 
            Description: 'Description'
        };
        
        const issueLabels = {
            RestictedWords: 'Restricted Words',
            checkSpecialCharacters: 'Special Characters',
            charLim: 'Character Limit'
        };
        
        sections.forEach((sectionKey) => {
            const section = rankingErrors[sectionKey];
            if (section) {
                Object.keys(issueLabels).forEach((checkKey) => {
                    const check = section[checkKey];
                    if (check?.status === 'Error') {
                        errorRows.push({
                            issueHeading: `${sectionLabels[sectionKey]} | ${issueLabels[checkKey]}`,
                            message: check.Message,
                            solution: check.HowTOSolve
                        });
                    }
                });
            }
        });
        
        // Backend Keywords
        if (rankingErrors.charLim?.status === "Error") {
            errorRows.push({
                issueHeading: 'Backend Keywords | Character Limit',
                message: rankingErrors.charLim.Message,
                solution: rankingErrors.charLim.HowTOSolve
            });
        }
        
        return errorRows;
    };
    
    const errors = extractRankingErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-4 mx-auto shadow-lg">
                    <Star className="w-8 h-8 text-white" />
                </div>
                <p className="text-lg font-semibold text-gray-700 mb-2">No ranking issues found</p>
                <p className="text-gray-500">This product's ranking optimization is on track!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded-xl shadow-sm border border-gray-200">
                <table className="w-full table-fixed bg-white">
                    <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors duration-200 min-h-[80px]">
                                <td className="px-4 py-5 text-sm font-medium text-gray-900 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                </td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More Issues
                    </button>
                </div>
            )}
        </div>
    );
};

// Table component for conversion issues (now includes buybox issues)
const ConversionIssuesTable = ({ product, buyBoxData }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractConversionErrors = (product) => {
        const conversionErrors = product.conversionErrors;
        const errorRows = [];
        
        if (conversionErrors) {
            const issueMap = [
                ['Images', conversionErrors.imageResultErrorData],
                ['Video', conversionErrors.videoResultErrorData],
                ['Product Review', conversionErrors.productReviewResultErrorData],
                ['Star Rating', conversionErrors.productStarRatingResultErrorData],
                ['A+ Content', conversionErrors.aplusErrorData]
            ];
            
            issueMap.forEach(([label, errorData]) => {
                if (errorData?.status === 'Error') {
                    errorRows.push({
                        issueHeading: `${label} Issue`,
                        message: errorData.Message,
                        solution: errorData.HowToSolve
                    });
                }
            });
        }
        
        // Also extract buybox errors from buyBoxData (now part of conversion)
        if (buyBoxData?.asinBuyBoxData && Array.isArray(buyBoxData.asinBuyBoxData)) {
            // Try multiple matching strategies to handle type/format mismatches
            let productBuyBox = buyBoxData.asinBuyBoxData.find(
                i => i.childAsin === product.asin || i.parentAsin === product.asin
            );
            
            if (!productBuyBox) {
                const productAsinStr = String(product.asin || '').trim();
                productBuyBox = buyBoxData.asinBuyBoxData.find(
                    i => String(i.childAsin || '').trim() === productAsinStr || 
                         String(i.parentAsin || '').trim() === productAsinStr
                );
            }
            
            if (!productBuyBox) {
                const productAsinLower = String(product.asin || '').trim().toLowerCase();
                productBuyBox = buyBoxData.asinBuyBoxData.find(
                    i => String(i.childAsin || '').trim().toLowerCase() === productAsinLower || 
                         String(i.parentAsin || '').trim().toLowerCase() === productAsinLower
                );
            }
            
            if (productBuyBox && (productBuyBox.buyBoxPercentage === 0 || productBuyBox.buyBoxPercentage < 50)) {
                if (productBuyBox.buyBoxPercentage === 0) {
                    errorRows.push({
                        issueHeading: 'Buy Box | No Buy Box',
                        message: `This product has 0% Buy Box ownership. With ${productBuyBox.pageViews || 0} page views and ${productBuyBox.sessions || 0} sessions, you're losing potential sales to competitors who own the Buy Box.`,
                        solution: 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics (shipping time, order defect rate), and consider using repricing tools. Also ensure your product is Prime eligible if possible.'
                    });
                } else {
                    errorRows.push({
                        issueHeading: 'Buy Box | Low Buy Box Percentage',
                        message: `This product has only ${productBuyBox.buyBoxPercentage.toFixed(1)}% Buy Box ownership. With ${productBuyBox.pageViews || 0} page views and ${productBuyBox.sessions || 0} sessions, a significant portion of potential sales are going to competitors.`,
                        solution: 'Improve your Buy Box percentage by optimizing your pricing, maintaining competitive shipping options, improving seller metrics (late shipment rate, cancellation rate), and ensuring inventory availability. Consider FBA if you\'re currently using FBM.'
                    });
                }
            }
        }
        
        return errorRows;
    };
    
    const errors = extractConversionErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-4 mx-auto shadow-lg">
                    <Star className="w-8 h-8 text-white" />
                </div>
                <p className="text-lg font-semibold text-gray-700 mb-2">No conversion issues found</p>
                <p className="text-gray-500">This product's conversion optimization looks great!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded-xl shadow-sm border border-gray-200">
                <table className="w-full table-fixed bg-white">
                    <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors duration-200 min-h-[80px]">
                                <td className="px-4 py-5 text-sm font-medium text-gray-900 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                </td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More Issues
                    </button>
                </div>
            )}
        </div>
    );
};

// Table component for inventory issues
const InventoryIssuesTable = ({ product }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractInventoryErrors = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return [];
        
        const errorRows = [];
        
        // Inventory Planning Issues
        if (inventoryErrors.inventoryPlanningErrorData) {
            const planning = inventoryErrors.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") {
                errorRows.push({
                    issueHeading: 'Inventory Planning | Long-Term Storage Fees',
                    message: planning.longTermStorageFees.Message,
                    solution: planning.longTermStorageFees.HowToSolve
                });
            }
            if (planning.unfulfillable?.status === "Error") {
                errorRows.push({
                    issueHeading: 'Inventory Planning | Unfulfillable Inventory',
                    message: planning.unfulfillable.Message,
                    solution: planning.unfulfillable.HowToSolve
                });
            }
        }
        
        // Stranded Inventory
        if (inventoryErrors.strandedInventoryErrorData) {
            errorRows.push({
                issueHeading: 'Stranded Inventory | Product Not Listed',
                message: inventoryErrors.strandedInventoryErrorData.Message,
                solution: inventoryErrors.strandedInventoryErrorData.HowToSolve
            });
        }
        
        // Inbound Non-Compliance
        if (inventoryErrors.inboundNonComplianceErrorData) {
            errorRows.push({
                issueHeading: 'Inbound Non-Compliance | Shipment Issue',
                message: inventoryErrors.inboundNonComplianceErrorData.Message,
                solution: inventoryErrors.inboundNonComplianceErrorData.HowToSolve
            });
        }
        
        // Replenishment - handles single or multiple errors
        if (inventoryErrors.replenishmentErrorData) {
            if (Array.isArray(inventoryErrors.replenishmentErrorData)) {
                // Multiple errors for same ASIN (different SKUs)
                inventoryErrors.replenishmentErrorData.forEach(error => {
                    errorRows.push({
                        issueHeading: `Replenishment | Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
                        message: error.Message,
                        solution: error.HowToSolve,
                        recommendedReplenishmentQty: error.recommendedReplenishmentQty || error.data || null
                    });
                });
            } else {
                // Single error
                errorRows.push({
                    issueHeading: `Replenishment | Low Inventory Risk ${inventoryErrors.replenishmentErrorData.sku ? `(SKU: ${inventoryErrors.replenishmentErrorData.sku})` : ''}`,
                    message: inventoryErrors.replenishmentErrorData.Message,
                    solution: inventoryErrors.replenishmentErrorData.HowToSolve,
                    recommendedReplenishmentQty: inventoryErrors.replenishmentErrorData.recommendedReplenishmentQty || inventoryErrors.replenishmentErrorData.data || null
                });
            }
        }
        
        return errorRows;
    };
    
    const errors = extractInventoryErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-4 mx-auto shadow-lg">
                    <Star className="w-8 h-8 text-white" />
                </div>
                <p className="text-lg font-semibold text-gray-700 mb-2">No inventory issues found</p>
                <p className="text-gray-500">Your inventory management is working perfectly!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded-xl shadow-sm border border-gray-200">
                <table className="w-full table-fixed bg-white">
                    <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors duration-200 min-h-[80px]">
                                <td className="px-4 py-5 text-sm font-medium text-gray-900 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                    {error.recommendedReplenishmentQty !== null && error.recommendedReplenishmentQty !== undefined && error.recommendedReplenishmentQty > 0 && (
                                        <>
                                            <br />
                                            <strong className="text-gray-900 mt-1 block">Recommended Restock Quantity: {error.recommendedReplenishmentQty} units</strong>
                                        </>
                                    )}
                                </td>
                                <td className="px-4 py-5 text-sm text-gray-700 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More Issues
                    </button>
                </div>
            )}
        </div>
    );
};

const IssuesByProduct = () => {
    const info = useSelector((state) => state.Dashboard.DashBoardInfo);
    const currency = useSelector(state => state.currency?.currency) || '$';
    const navigate = useNavigate();
    // Enhanced state management
    const [currentPage, setCurrentPage] = useState(0);
    const [productTabs, setProductTabs] = useState({});
    const [prevProductTabs, setPrevProductTabs] = useState({});
    const [hasInteracted, setHasInteracted] = useState({});
    const [visibleSolutions, setVisibleSolutions] = useState({});
    
    // New filter and search states
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPriority, setSelectedPriority] = useState('all');
    const [sortBy, setSortBy] = useState('issues');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
    
    
    const ITEMS_PER_PAGE = 6; // Reduced for better layout
    
    // Filter and sort options
    const priorityOptions = [
        { value: 'all', label: 'All Priorities' },
        { value: 'high', label: 'High Priority' },
        { value: 'medium', label: 'Medium Priority' },
        { value: 'low', label: 'Low Priority' }
    ];
    
    const sortOptions = [
        { value: 'issues', label: 'Most Issues' },
        { value: 'name', label: 'Product Name' },
        { value: 'asin', label: 'ASIN' },
        { value: 'price', label: 'Price' }
    ];
    
    // Check if product has any ranking issues
    const hasAnyRankingIssues = (product) => {
        const rankingData = info?.rankingProductWiseErrors?.find(item => item.asin === product.asin);
        if (!rankingData?.data) return false;
        
        const rankingErrors = rankingData.data;
        return (
            rankingErrors.TitleResult?.charLim?.status === "Error" ||
            rankingErrors.TitleResult?.RestictedWords?.status === "Error" ||
            rankingErrors.TitleResult?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.BulletPoints?.charLim?.status === "Error" ||
            rankingErrors.BulletPoints?.RestictedWords?.status === "Error" ||
            rankingErrors.BulletPoints?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.Description?.charLim?.status === "Error" ||
            rankingErrors.Description?.RestictedWords?.status === "Error" ||
            rankingErrors.Description?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.charLim?.status === "Error"
        );
    };
    
    // Check if product has any conversion issues
    const hasAnyConversionIssues = (product) => {
        const conversionErrors = product.conversionErrors;
        if (!conversionErrors) return false;
        
        return (
            conversionErrors.imageResultErrorData?.status === "Error" ||
            conversionErrors.videoResultErrorData?.status === "Error" ||
            conversionErrors.productReviewResultErrorData?.status === "Error" ||
            conversionErrors.productStarRatingResultErrorData?.status === "Error" ||
            conversionErrors.productsWithOutBuyboxErrorData?.status === "Error" ||
            conversionErrors.aplusErrorData?.status === "Error"
        );
    };
    
    // Check if product has any inventory issues
    const hasAnyInventoryIssues = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return false;
        
        return (
            inventoryErrors.inventoryPlanningErrorData ||
            inventoryErrors.strandedInventoryErrorData ||
            inventoryErrors.inboundNonComplianceErrorData ||
            inventoryErrors.replenishmentErrorData
        );
    };
    
    // Check if product has any buybox issues - Use same matching strategy
    const hasAnyBuyboxIssues = (product) => {
        if (!info?.buyBoxData?.asinBuyBoxData) return false;
        
        // Try multiple matching strategies
        let productBuyBox = info.buyBoxData.asinBuyBoxData.find(
            item => item.childAsin === product.asin || item.parentAsin === product.asin
        );
        
        if (!productBuyBox) {
            const productAsinStr = String(product.asin || '').trim();
            productBuyBox = info.buyBoxData.asinBuyBoxData.find(
                item => String(item.childAsin || '').trim() === productAsinStr || 
                       String(item.parentAsin || '').trim() === productAsinStr
            );
        }
        
        if (!productBuyBox) {
            const productAsinLower = String(product.asin || '').trim().toLowerCase();
            productBuyBox = info.buyBoxData.asinBuyBoxData.find(
                item => String(item.childAsin || '').trim().toLowerCase() === productAsinLower || 
                       String(item.parentAsin || '').trim().toLowerCase() === productAsinLower
            );
        }
        
        if (!productBuyBox) return false;
        
        // Use exact same condition as Category.jsx
        return productBuyBox.buyBoxPercentage === 0 || productBuyBox.buyBoxPercentage < 50;
    };
    
    // Get products that have any issues (must be defined after all hasAny* functions)
    const getProductsWithIssues = () => {
        const productsMap = new Map();
        
        // First, add all products from productWiseError that have issues
        if (info?.productWiseError) {
            info.productWiseError.forEach(product => {
                const hasRankingIssues = hasAnyRankingIssues(product);
                const hasConversionIssues = hasAnyConversionIssues(product);
                const hasInventoryIssues = hasAnyInventoryIssues(product);
                const hasBuyboxIssues = hasAnyBuyboxIssues(product);
                if (hasRankingIssues || hasConversionIssues || hasInventoryIssues || hasBuyboxIssues) {
                    productsMap.set(product.asin, product);
                }
            });
        }
        
        // Then, add products with buybox issues that might not be in productWiseError
        // Use SAME condition as Category.jsx: buyBoxPercentage === 0 || buyBoxPercentage < 50
        if (info?.buyBoxData?.asinBuyBoxData) {
            info.buyBoxData.asinBuyBoxData.forEach(buyboxItem => {
                const asin = buyboxItem.childAsin || buyboxItem.parentAsin;
                const hasBuyboxIssue = buyboxItem.buyBoxPercentage === 0 || buyboxItem.buyBoxPercentage < 50;
                
                // If product has buybox issue and not already in map, add it
                if (hasBuyboxIssue && asin && !productsMap.has(asin)) {
                    // Try to find product info from TotalProduct or productWiseError
                    const productInfo = info?.TotalProduct?.find(p => p.asin === asin) || 
                                       info?.productWiseError?.find(p => p.asin === asin);
                    
                    // Create a product entry for this buybox-only issue
                    productsMap.set(asin, {
                        asin: asin,
                        sku: productInfo?.sku || 'N/A',
                        name: productInfo?.itemName || productInfo?.name || productInfo?.title || 'N/A',
                        price: productInfo?.price || 0,
                        MainImage: productInfo?.MainImage || null,
                        errors: 1,
                        rankingErrors: undefined,
                        conversionErrors: {},
                        inventoryErrors: {},
                        sales: 0,
                        quantity: 0
                    });
                }
            });
        }
        
        return Array.from(productsMap.values());
    };
    
    // Enhanced filtered and sorted products
    const getFilteredAndSortedProducts = () => {
        // Get all products with issues (including buybox-only issues)
        let products = getProductsWithIssues();
        
        // Apply search filter
        if (searchQuery && searchQuery.trim()) {
            const trimmedQuery = searchQuery.trim().toLowerCase();
            
            products = products.filter(product => {
                if (!product) return false;
                
                // Handle null/undefined values safely and convert to strings
                const productName = (product.name ? String(product.name) : '').trim().toLowerCase();
                const productAsin = (product.asin ? String(product.asin) : '').trim().toLowerCase();
                const productSku = (product.sku ? String(product.sku) : '').trim().toLowerCase();
                
                // Check if any field matches the search query (case-insensitive)
                const matchesName = productName && productName.includes(trimmedQuery);
                const matchesAsin = productAsin && (productAsin.includes(trimmedQuery) || productAsin === trimmedQuery);
                const matchesSku = productSku && (productSku.includes(trimmedQuery) || productSku === trimmedQuery);
                
                return matchesName || matchesAsin || matchesSku;
            });
        }
        
        // Apply priority filter
        // Note: countConversionIssues now includes buybox, so we don't add countBuyboxIssues separately
        if (selectedPriority !== 'all') {
            products = products.filter(product => {
                const totalIssues = countRankingIssues(product) + countConversionIssues(product) + countInventoryIssues(product);
                if (selectedPriority === 'high') return totalIssues >= 5;
                if (selectedPriority === 'medium') return totalIssues >= 2 && totalIssues < 5;
                if (selectedPriority === 'low') return totalIssues >= 1 && totalIssues < 2;
                return true;
            });
        }
        
        // Apply sorting
        // Note: countConversionIssues now includes buybox, so we don't add countBuyboxIssues separately
        products.sort((a, b) => {
            switch (sortBy) {
                case 'issues':
                    const aIssues = countRankingIssues(a) + countConversionIssues(a) + countInventoryIssues(a);
                    const bIssues = countRankingIssues(b) + countConversionIssues(b) + countInventoryIssues(b);
                    return bIssues - aIssues;
                case 'name':
                    return (a.name || '').localeCompare(b.name || '');
                case 'asin':
                    return (a.asin || '').localeCompare(b.asin || '');
                case 'price':
                    return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
                default:
                    return 0;
            }
        });
        
        return products;
    };

    const getPaginatedProducts = () => {
        const products = getFilteredAndSortedProducts();
        const endIndex = (currentPage + 1) * ITEMS_PER_PAGE;
        const paginatedProducts = products.slice(0, endIndex);
        const hasMore = endIndex < products.length;
        
        return { products: paginatedProducts, hasMore, total: products.length };
    };

    // Get priority level for a product
    // Note: countConversionIssues now includes buybox, so we don't add countBuyboxIssues separately
    const getProductPriority = (product) => {
        const totalIssues = countRankingIssues(product) + countConversionIssues(product) + countInventoryIssues(product);
        if (totalIssues >= 5) return { level: 'high', label: 'High', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50' };
        if (totalIssues >= 2) return { level: 'medium', label: 'Medium', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-50' };
        return { level: 'low', label: 'Low', color: 'bg-blue-500', textColor: 'text-blue-700', bgColor: 'bg-blue-50' };
    };

    // Calculate summary stats
    // Use the same backend fields as dashboard and category page to ensure consistency
    const calculateStats = () => {
        const allProducts = getProductsWithIssues();
        const totalProducts = allProducts.length;
        
        // Use backend fields for total issues (same as Category page and Dashboard)
        const rankingIssues = info?.TotalRankingerrors || 0;
        const conversionIssues = info?.totalErrorInConversion || 0;
        const inventoryIssues = info?.totalInventoryErrors || 0;
        const totalIssues = rankingIssues + conversionIssues + inventoryIssues;
        
        const highPriority = allProducts.filter(product => getProductPriority(product).level === 'high').length;
        const criticalProducts = allProducts.filter(product => {
            const totalIssues = countRankingIssues(product) + countConversionIssues(product) + countInventoryIssues(product);
            return totalIssues >= 3;
        }).length;
        
        return { totalProducts, totalIssues, highPriority, criticalProducts };
    };

    // Get active tab for a product
    const getActiveTab = (productId) => {
        return productTabs[productId] || 'ranking';
    };
    
    // Set active tab for a product
    const setActiveTab = (productId, tab) => {
        const currentTab = getActiveTab(productId);
        if (tab === currentTab) return;
        
        setPrevProductTabs(prev => ({
            ...prev,
            [productId]: currentTab
        }));
        
        setProductTabs(prev => ({
            ...prev,
            [productId]: tab
        }));
        
        setHasInteracted(prev => ({
            ...prev,
            [productId]: true
        }));
    };
    
    // Get animation direction for a product
    const getDirection = (productId) => {
        const tabs = ['ranking', 'conversion', 'inventory'];
        const currentIndex = tabs.indexOf(getActiveTab(productId));
        const prevIndex = tabs.indexOf(prevProductTabs[productId] || 'ranking');
        return currentIndex > prevIndex ? 1 : -1;
    };
    
    // Animation variants for page transitions
    const pageVariants = {
        enter: (direction) => ({
            x: direction > 0 ? "100%" : "-100%",
            opacity: 0,
            position: "absolute",
            width: "100%",
        }),
        center: {
            x: 0,
            opacity: 1,
            position: "relative",
            width: "100%",
            transition: { duration: 0.4, ease: "easeInOut" },
        },
        exit: (direction) => ({
            x: direction > 0 ? "-100%" : "100%",
            opacity: 0,
            position: "absolute",
            width: "100%",
            transition: { duration: 0.4, ease: "easeInOut" },
        }),
    };
    
    // Toggle solution visibility
    const toggleSolution = (productId, issueKey) => {
        const key = `${productId}-${issueKey}`;
        setVisibleSolutions(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };
    
    // Navigate to detailed product issues page
    const viewProductDetails = (asin) => {
        navigate(`/seller-central-checker/issues/${asin}`);
    };
    
    // Count issues for each category
    const countRankingIssues = (product) => {
        const rankingData = info?.rankingProductWiseErrors?.find(item => item.asin === product.asin);
        if (!rankingData?.data) return 0;
        
        const rankingErrors = rankingData.data;
        let count = 0;
        const sections = ['TitleResult', 'BulletPoints', 'Description'];
        const checks = ['RestictedWords', 'checkSpecialCharacters', 'charLim'];
        
        sections.forEach(section => {
            if (rankingErrors[section]) {
                checks.forEach(check => {
                    if (rankingErrors[section][check]?.status === 'Error') count++;
                });
            }
        });
        
        if (rankingErrors.charLim?.status === "Error") count++;
        return count;
    };
    
    const countConversionIssues = (product) => {
        const conversionErrors = product.conversionErrors;
        let count = 0;
        
        if (conversionErrors) {
            const checks = [
                conversionErrors.imageResultErrorData,
                conversionErrors.videoResultErrorData,
                conversionErrors.productReviewResultErrorData,
                conversionErrors.productStarRatingResultErrorData,
                conversionErrors.productsWithOutBuyboxErrorData,
                conversionErrors.aplusErrorData
            ];
            
            checks.forEach(check => {
                if (check?.status === 'Error') count++;
            });
        }
        
        // Also count buybox issues from buyBoxData (part of conversion now)
        count += countBuyboxIssues(product);
        
        return count;
    };
    
    const countInventoryIssues = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return 0;
        
        let count = 0;
        
        if (inventoryErrors.inventoryPlanningErrorData) {
            const planning = inventoryErrors.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") count++;
            if (planning.unfulfillable?.status === "Error") count++;
        }
        
        if (inventoryErrors.strandedInventoryErrorData) count++;
        if (inventoryErrors.inboundNonComplianceErrorData) count++;
        if (inventoryErrors.replenishmentErrorData) {
            count += Array.isArray(inventoryErrors.replenishmentErrorData) 
                ? inventoryErrors.replenishmentErrorData.length 
                : 1;
        }
        
        return count;
    };
    
    // Count buybox issues - Use same matching strategy as BuyboxIssuesTable
    const countBuyboxIssues = (product) => {
        if (!info?.buyBoxData?.asinBuyBoxData) return 0;
        
        // Try multiple matching strategies
        let productBuyBox = info.buyBoxData.asinBuyBoxData.find(
            item => item.childAsin === product.asin || item.parentAsin === product.asin
        );
        
        if (!productBuyBox) {
            // Try string comparison
            const productAsinStr = String(product.asin || '').trim();
            productBuyBox = info.buyBoxData.asinBuyBoxData.find(
                item => String(item.childAsin || '').trim() === productAsinStr || 
                       String(item.parentAsin || '').trim() === productAsinStr
            );
        }
        
        if (!productBuyBox) {
            // Try case-insensitive
            const productAsinLower = String(product.asin || '').trim().toLowerCase();
            productBuyBox = info.buyBoxData.asinBuyBoxData.find(
                item => String(item.childAsin || '').trim().toLowerCase() === productAsinLower || 
                       String(item.parentAsin || '').trim().toLowerCase() === productAsinLower
            );
        }
        
        if (!productBuyBox) return 0;
        
        // Use exact same condition as Category.jsx
        if (productBuyBox.buyBoxPercentage === 0 || productBuyBox.buyBoxPercentage < 50) {
            return 1;
        }
        
        return 0;
    };
    
    const { products, hasMore, total } = getPaginatedProducts();
    const stats = calculateStats();

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(0);
    }, [searchQuery, selectedPriority, sortBy]);

    // Handle clicks outside dropdown

    return (
        <div className="min-h-screen bg-gray-50/50">
            {/* Modern Header Section */}
            <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
                <div className='px-4 lg:px-6 py-4'>
                    <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
                        <div className='flex items-center gap-4'>
                            <div>
                                <h1 className='text-2xl font-bold text-gray-900'>Issues By Product</h1>
                                <p className='text-sm text-gray-600 mt-1'>Detailed analysis of issues for individual products in your catalog</p>
                            </div>
                            <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium'>
                                <AlertTriangle className='w-3 h-3' />
                                Product Analysis
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content - Scrollable */}
            <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
                <div className='px-4 lg:px-6 py-6 pb-20 space-y-6'>

            {!info?.productWiseError || info.productWiseError.length === 0 ? (
                <motion.div 
                    className="bg-white rounded-2xl shadow-lg border-0 p-8 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                >
                    <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg">
                        <Star className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">No Product Issues Found</h1>
                    <p className="text-gray-600">Excellent! All your products are performing optimally without any detected issues.</p>
                </motion.div>
            ) : (
                <div className="space-y-6">
                    {/* Enhanced Banner Section with margins */}
                    <div className="mx-2">
                        <div className="bg-gradient-to-br from-green-900 via-emerald-950 to-red-950 text-white relative overflow-hidden rounded-2xl">
                            <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
                            <div className="relative z-10 px-6 py-8">
                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                                            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                                Issues by Product
                                            </h1>
                                        </div>
                                        <p className="text-gray-300 text-lg">Detailed issue analysis for individual products</p>
                                        {stats.totalProducts > 0 && (
                                            <div className="flex items-center gap-2 text-sm text-orange-300 mt-4">
                                                <AlertTriangle className="w-4 h-4" />
                                                <span>{stats.totalProducts} products need attention</span>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Stats Cards */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center">
                                            <div className="text-2xl font-bold text-white mb-1">{stats.totalProducts}</div>
                                            <div className="text-xs text-gray-300">Products with Issues</div>
                                        </div>
                                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center">
                                            <div className="text-2xl font-bold text-orange-300 mb-1">{stats.totalIssues}</div>
                                            <div className="text-xs text-gray-300">Total Issues</div>
                                            <div className="text-xs text-gray-400 mt-0.5">(Ranking + Conversion + Inventory)</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Enhanced Filters and Search Section */}
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                        <div className="px-6 py-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="text-sm text-gray-600">
                                        Showing <span className="font-semibold text-blue-600">{products.length}</span> of <span className="font-semibold">{total}</span> products
                                    </div>
                                    {(searchQuery || selectedPriority !== 'all' || sortBy !== 'issues') && (
                                        <button
                                            onClick={() => {
                                                setSearchQuery('');
                                                setSelectedPriority('all');
                                                setSortBy('issues');
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                                        >
                                            Clear filters
                                        </button>
                                    )}
                                </div>
                                
                                <div className="flex items-center gap-3">
                                    {/* Search */}
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search products..."
                                            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 transition-all duration-200"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                    </div>
                                    
                                    {/* Priority Filter */}
                                    <select
                                        value={selectedPriority}
                                        onChange={(e) => setSelectedPriority(e.target.value)}
                                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    >
                                        {priorityOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    
                                    {/* Sort */}
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    >
                                        {sortOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="space-y-6">
                {products.length === 0 ? (
                    <motion.div 
                        className="bg-white rounded-2xl shadow-lg border-0 p-8 text-center"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                        <div className="w-20 h-20 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex items-center justify-center mb-6 mx-auto shadow-sm">
                            <Package className="w-10 h-10 text-gray-400" />
                        </div>
                        <p className="text-lg font-semibold text-gray-700 mb-2">No products found</p>
                        <p className="text-sm text-gray-500">Try adjusting your search terms or filters to find what you're looking for.</p>
                    </motion.div>
                ) : (
                    <>
                        {/* Products Grid */}
                        <div className="space-y-8">
                                            {products.map((product, index) => {
                                                const activeTab = getActiveTab(product.asin);
                                                const rankingCount = countRankingIssues(product);
                                                // conversionCount now includes buybox issues
                                                const conversionCount = countConversionIssues(product);
                                                const inventoryCount = countInventoryIssues(product);
                                                const priority = getProductPriority(product);
                                                // Note: conversionCount already includes buybox, so total is ranking + conversion + inventory
                                                const totalIssues = rankingCount + conversionCount + inventoryCount;

                                return (
                                    <motion.div 
                                        key={product.asin} 
                                        className="bg-white rounded-2xl shadow-lg border-0 hover:shadow-xl transition-all duration-300"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            duration: 0.4,
                                            delay: index * 0.1,
                                            ease: "easeOut"
                                        }}
                                    >
                                        {/* Enhanced Product Header */}
                                        <div className="p-6 border-b border-gray-100">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-4">
                                                    <div className="relative">
                                                        <LazyLoadImage
                                                            src={product.MainImage || noImage}
                                                            alt="Product"
                                                            className="w-20 h-20 rounded-xl object-cover shadow-md"
                                                            effect="blur"
                                                            placeholderSrc={noImage}
                                                        />
                                                        <div className={`absolute -top-2 -right-2 w-6 h-6 ${priority.color} rounded-full flex items-center justify-center shadow-lg`}>
                                                            <span className="text-white text-xs font-bold">{totalIssues}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex-1">
                                                        <h3 className="font-bold text-xl mb-2 text-gray-900 max-w-md truncate">
                                                            {product.name}
                                                        </h3>
                                                        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                                            <span className="flex items-center gap-1">
                                                                <span className="font-medium">ASIN:</span> {product.asin}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <span className="font-medium">SKU:</span> {product.sku}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <span className="font-medium">Price:</span> {formatCurrencyWithLocale(product.price || 0, currency)}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-3">
                                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${priority.bgColor} ${priority.textColor}`}>
                                                                {priority.label} Priority
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} found
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button 
                                                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg flex items-center gap-2"
                                                    onClick={() => viewProductDetails(product.asin)}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                    View Details
                                                </button>
                                            </div>
                                        </div>
                                        
                                        {/* Enhanced Product Tabs */}
                                        <div className="flex border-b border-gray-100">
                                            <button
                                                className={`flex-1 px-4 py-4 font-medium transition-all duration-200 ${
                                                    activeTab === 'ranking'
                                                        ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'ranking')}
                                            >
                                                <div className="flex items-center justify-center gap-2">
                                                    <TrendingUp className="w-4 h-4" />
                                                    <span className="hidden sm:inline">Ranking Issues</span>
                                                    <span className="sm:hidden">Ranking</span>
                                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                                        rankingCount > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {rankingCount}
                                                    </span>
                                                </div>
                                            </button>
                                            <button
                                                className={`flex-1 px-4 py-4 font-medium transition-all duration-200 ${
                                                    activeTab === 'conversion'
                                                        ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'conversion')}
                                            >
                                                <div className="flex items-center justify-center gap-2">
                                                    <BarChart3 className="w-4 h-4" />
                                                    <span className="hidden sm:inline">Conversion (incl. Buy Box)</span>
                                                    <span className="sm:hidden">Conversion</span>
                                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                                        conversionCount > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {conversionCount}
                                                    </span>
                                                </div>
                                            </button>
                                            <button
                                                className={`flex-1 px-4 py-4 font-medium transition-all duration-200 ${
                                                    activeTab === 'inventory'
                                                        ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50/50'
                                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'inventory')}
                                            >
                                                <div className="flex items-center justify-center gap-2">
                                                    <Package className="w-4 h-4" />
                                                    <span className="hidden sm:inline">Inventory Issues</span>
                                                    <span className="sm:hidden">Inventory</span>
                                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                                        inventoryCount > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {inventoryCount}
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                        
                                        {/* Enhanced Tab Content */}
                                        <div className="p-6 relative bg-gray-50/30" style={{ minHeight: '300px' }}>
                                            <AnimatePresence custom={getDirection(product.asin)} mode="sync">
                                                <motion.div
                                                    key={activeTab}
                                                    custom={getDirection(product.asin)}
                                                    variants={pageVariants}
                                                    initial={hasInteracted[product.asin] ? "enter" : false}
                                                    animate="center"
                                                    exit="exit"
                                                    className="w-full"
                                                >
                                                            {activeTab === 'ranking' && (
                                                        <RankingIssuesTable product={product} info={info} />
                                                    )}
                                                    {activeTab === 'conversion' && (
                                                        <ConversionIssuesTable product={product} buyBoxData={info?.buyBoxData} />
                                                    )}
                                                    {activeTab === 'inventory' && (
                                                        <InventoryIssuesTable product={product} />
                                                    )}
                                                </motion.div>
                                            </AnimatePresence>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                        
                        {/* Enhanced View More Button */}
                        {hasMore && (
                            <motion.div 
                                className="text-center pt-8"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    duration: 0.3,
                                    delay: 0.2,
                                    ease: "easeOut"
                                }}
                            >
                                <button
                                    className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 text-lg font-medium shadow-lg hover:shadow-xl flex items-center gap-2 mx-auto"
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                >
                                    <ArrowRight className="w-5 h-5" />
                                    Load More Products
                                </button>
                                <p className="text-sm text-gray-500 mt-3">
                                    {total - products.length} more products available
                                </p>
                            </motion.div>
                        )}
                    </>
                )}
                    </div>
                </div>
            )}
                </div>
            </div>
        </div>
    );
};

export default IssuesByProduct;
