import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from "react-redux";
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Search, Filter, ChevronDown, Box, Eye, Activity, Star, TrendingUp, LineChart, ArrowRight, Download } from 'lucide-react';
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
          <strong className="text-gray-100 mt-1 block">{highlightedText}</strong>
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
            <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-3 mx-auto border border-green-500/30">
                    <Star className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-sm font-semibold text-gray-100 mb-1">No ranking issues found</p>
                <p className="text-xs text-gray-400">This product's ranking optimization is on track!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded border border-[#30363d]">
                <table className="w-full table-fixed bg-[#161b22]">
                    <thead>
                        <tr className="bg-[#21262d] border-b border-[#30363d]">
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-b border-[#30363d] min-h-[60px]">
                                <td className="px-2 py-2 text-xs font-medium text-gray-100 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                </td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-2 text-center">
                    <button
                        className="bg-blue-500 text-white px-4 py-1.5 rounded text-xs hover:bg-blue-600 transition-all"
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
                ['Star Rating', conversionErrors.productStarRatingResultErrorData],
                ['A+ Content', conversionErrors.aplusErrorData],
                ['Brand Story', conversionErrors.brandStoryErrorData]
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
            <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-3 mx-auto border border-green-500/30">
                    <Star className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-sm font-semibold text-gray-100 mb-1">No conversion issues found</p>
                <p className="text-xs text-gray-400">This product's conversion optimization looks great!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded border border-[#30363d]">
                <table className="w-full table-fixed bg-[#161b22]">
                    <thead>
                        <tr className="bg-[#21262d] border-b border-[#30363d]">
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-b border-[#30363d] min-h-[60px]">
                                <td className="px-2 py-2 text-xs font-medium text-gray-100 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                </td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-2 text-center">
                    <button
                        className="bg-blue-500 text-white px-4 py-1.5 rounded text-xs hover:bg-blue-600 transition-all"
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
            <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-3 mx-auto border border-green-500/30">
                    <Star className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-sm font-semibold text-gray-100 mb-1">No inventory issues found</p>
                <p className="text-xs text-gray-400">Your inventory management is working perfectly!</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="w-full rounded border border-[#30363d]">
                <table className="w-full table-fixed bg-[#161b22]">
                    <thead>
                        <tr className="bg-[#21262d] border-b border-[#30363d]">
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/4">Issue Type</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Description</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-b border-[#30363d] min-h-[60px]">
                                <td className="px-2 py-2 text-xs font-medium text-gray-100 align-top break-words leading-relaxed">{error.issueHeading}</td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">
                                    <FormattedMessage message={error.message} />
                                    {error.recommendedReplenishmentQty !== null && error.recommendedReplenishmentQty !== undefined && error.recommendedReplenishmentQty > 0 && (
                                        <>
                                            <br />
                                            <strong className="text-gray-100 mt-1 block">Recommended Restock Quantity: {error.recommendedReplenishmentQty} units</strong>
                                        </>
                                    )}
                                </td>
                                <td className="px-2 py-2 text-xs text-gray-300 align-top break-words leading-relaxed">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-2 text-center">
                    <button
                        className="bg-blue-500 text-white px-4 py-1.5 rounded text-xs hover:bg-blue-600 transition-all"
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
        // First try to get conversionErrors from product.conversionErrors (for productWiseError products)
        // If not found, look it up from info?.TotalProduct (same as YourProducts.jsx)
        let conversionErrors = product.conversionErrors;
        
        if (!conversionErrors && info?.TotalProduct) {
            const productData = info.TotalProduct.find(item => item.asin === product.asin);
            conversionErrors = productData?.conversionErrors;
        }
        
        let count = 0;
        
        if (conversionErrors) {
            const checks = [
                conversionErrors.imageResultErrorData,
                conversionErrors.videoResultErrorData,
                conversionErrors.productStarRatingResultErrorData,
                conversionErrors.productsWithOutBuyboxErrorData,
                conversionErrors.aplusErrorData,
                conversionErrors.brandStoryErrorData
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
        // First try to get inventoryErrors from product.inventoryErrors (for productWiseError products)
        // If not found, look it up from info?.TotalProduct (same as YourProducts.jsx)
        let inventoryErrors = product.inventoryErrors;
        
        if (!inventoryErrors && info?.TotalProduct) {
            const productData = info.TotalProduct.find(item => item.asin === product.asin);
            inventoryErrors = productData?.inventoryErrors;
        }
        
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
        <div className="min-h-screen bg-[#1a1a1a]">
            {/* Modern Header Section */}
            <div className='bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40'>
                <div className='px-2 lg:px-3 py-1.5'>
                    <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                            <div>
                                <h1 className='text-lg font-bold text-gray-100'>Issues By Product</h1>
                                <p className='text-xs text-gray-400 mt-0.5'>Detailed analysis of issues for individual products in your catalog</p>
                            </div>
                            <div className='hidden sm:flex items-center gap-1 px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs font-medium border border-orange-500/30'>
                                <AlertTriangle className='w-3 h-3' />
                                Product Analysis
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content - Scrollable */}
            <div className='overflow-y-auto' style={{ height: 'calc(100vh - 72px)', scrollBehavior: 'smooth' }}>
                <div className='px-2 lg:px-3 py-1.5 pb-1 space-y-2'>

            {!info?.productWiseError || info.productWiseError.length === 0 ? (
                <motion.div 
                    className="bg-[#161b22] rounded border border-[#30363d] p-4 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                >
                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-3 mx-auto border border-green-500/30">
                        <Star className="w-6 h-6 text-green-400" />
                    </div>
                    <h1 className="text-lg font-bold text-gray-100 mb-1">No Product Issues Found</h1>
                    <p className="text-xs text-gray-400">Excellent! All your products are performing optimally without any detected issues.</p>
                </motion.div>
            ) : (
                <div className="space-y-2">
                    {/* Enhanced Banner Section with margins */}
                    <div className="mx-1">
                        <div className="bg-[#161b22] border border-[#30363d] rounded p-2 relative overflow-hidden">
                            <div className="relative z-10 px-2 py-2">
                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Box className="w-4 h-4 text-blue-400" />
                                            <h1 className="text-lg font-bold text-gray-100">
                                                Issues by Product
                                            </h1>
                                        </div>
                                        <p className="text-xs text-gray-400">Detailed issue analysis for individual products</p>
                                        {stats.totalProducts > 0 && (
                                            <div className="flex items-center gap-1 text-xs text-orange-400 mt-2">
                                                <AlertTriangle className="w-3 h-3" />
                                                <span>{stats.totalProducts} products need attention</span>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Stats Cards */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-[#21262d] border border-[#30363d] rounded p-2 text-center">
                                            <div className="text-lg font-bold text-gray-100 mb-0.5">{stats.totalProducts}</div>
                                            <div className="text-xs text-gray-400">Products with Issues</div>
                                        </div>
                                        <div className="bg-[#21262d] border border-[#30363d] rounded p-2 text-center">
                                            <div className="text-lg font-bold text-orange-400 mb-0.5">{stats.totalIssues}</div>
                                            <div className="text-xs text-gray-400">Total Issues</div>
                                            <div className="text-xs text-gray-500 mt-0.5">(Ranking + Conversion + Inventory)</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Enhanced Filters and Search Section */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded p-2">
                        <div className="px-2 py-1.5">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="text-xs text-gray-400">
                                        Showing <span className="font-semibold text-blue-400">{products.length}</span> of <span className="font-semibold text-gray-300">{total}</span> products
                                    </div>
                                    {(searchQuery || selectedPriority !== 'all' || sortBy !== 'issues') && (
                                        <button
                                            onClick={() => {
                                                setSearchQuery('');
                                                setSelectedPriority('all');
                                                setSortBy('issues');
                                            }}
                                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                                        >
                                            Clear filters
                                        </button>
                                    )}
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    {/* Search */}
                                    <div className="relative">
                                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search products..."
                                            className="pl-7 pr-2 py-1 border border-[#30363d] rounded bg-[#1a1a1a] text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 w-40 transition-all placeholder-gray-500"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                    </div>
                                    
                                    {/* Priority Filter */}
                                    <select
                                        value={selectedPriority}
                                        onChange={(e) => setSelectedPriority(e.target.value)}
                                        className="px-2 py-1 border border-[#30363d] rounded text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 bg-[#1a1a1a]"
                                    >
                                        {priorityOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    
                                    {/* Sort */}
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        className="px-2 py-1 border border-[#30363d] rounded text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 bg-[#1a1a1a]"
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
                        className="bg-[#161b22] rounded border border-[#30363d] p-4 text-center"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                        <div className="w-12 h-12 bg-[#21262d] rounded-full flex items-center justify-center mb-3 mx-auto border border-[#30363d]">
                            <Box className="w-6 h-6 text-gray-400" />
                        </div>
                        <p className="text-sm font-semibold text-gray-100 mb-1">No products found</p>
                        <p className="text-xs text-gray-400">Try adjusting your search terms or filters to find what you're looking for.</p>
                    </motion.div>
                ) : (
                    <>
                        {/* Products Grid */}
                        <div className="space-y-2">
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
                                        className="bg-[#161b22] rounded border border-[#30363d] transition-all duration-300"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            duration: 0.4,
                                            delay: index * 0.1,
                                            ease: "easeOut"
                                        }}
                                    >
                                        {/* Enhanced Product Header */}
                                        <div className="p-2 border-b border-[#30363d]">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <div className="relative">
                                                        <LazyLoadImage
                                                            src={product.MainImage || noImage}
                                                            alt="Product"
                                                            className="w-12 h-12 rounded object-cover"
                                                            effect="blur"
                                                            placeholderSrc={noImage}
                                                        />
                                                        <div className={`absolute -top-1 -right-1 w-4 h-4 ${priority.color} rounded-full flex items-center justify-center`}>
                                                            <span className="text-white text-xs font-bold">{totalIssues}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-bold text-sm mb-1 text-gray-100 break-words">
                                                            {product.name}
                                                        </h3>
                                                        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                                                            <span className="flex items-center gap-0.5">
                                                                <span className="font-medium">ASIN:</span> {product.asin}
                                                            </span>
                                                            <span className="flex items-center gap-0.5">
                                                                <span className="font-medium">SKU:</span> {product.sku}
                                                            </span>
                                                            <span className="flex items-center gap-0.5">
                                                                <span className="font-medium">Price:</span> {formatCurrencyWithLocale(product.price || 0, currency)}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1.5">
                                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${
                                                                priority.level === 'high' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                                                priority.level === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                                                                'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                            }`}>
                                                                {priority.label} Priority
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} found
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button 
                                                    className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-all flex items-center gap-1"
                                                    onClick={() => viewProductDetails(product.asin)}
                                                >
                                                    <Eye className="w-3 h-3" />
                                                    View Details
                                                </button>
                                            </div>
                                        </div>
                                        
                                        {/* Enhanced Product Tabs */}
                                        <div className="flex border-b border-[#30363d]">
                                            <button
                                                className={`flex-1 px-2 py-2 font-medium transition-all duration-200 text-xs ${
                                                    activeTab === 'ranking'
                                                        ? 'border-b-2 border-blue-500 text-blue-400 bg-blue-500/10'
                                                        : 'text-gray-400 hover:text-gray-300 hover:bg-[#21262d]'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'ranking')}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    <TrendingUp className="w-3 h-3" />
                                                    <span className="hidden sm:inline">Ranking Issues</span>
                                                    <span className="sm:hidden">Ranking</span>
                                                    <span className={`px-1 py-0.5 rounded text-xs font-semibold ${
                                                        rankingCount > 0 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                    }`}>
                                                        {rankingCount}
                                                    </span>
                                                </div>
                                            </button>
                                            <button
                                                className={`flex-1 px-2 py-2 font-medium transition-all duration-200 text-xs ${
                                                    activeTab === 'conversion'
                                                        ? 'border-b-2 border-blue-500 text-blue-400 bg-blue-500/10'
                                                        : 'text-gray-400 hover:text-gray-300 hover:bg-[#21262d]'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'conversion')}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    <LineChart className="w-3 h-3" />
                                                    <span className="hidden sm:inline">Conversion (incl. Buy Box)</span>
                                                    <span className="sm:hidden">Conversion</span>
                                                    <span className={`px-1 py-0.5 rounded text-xs font-semibold ${
                                                        conversionCount > 0 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                    }`}>
                                                        {conversionCount}
                                                    </span>
                                                </div>
                                            </button>
                                            <button
                                                className={`flex-1 px-2 py-2 font-medium transition-all duration-200 text-xs ${
                                                    activeTab === 'inventory'
                                                        ? 'border-b-2 border-blue-500 text-blue-400 bg-blue-500/10'
                                                        : 'text-gray-400 hover:text-gray-300 hover:bg-[#21262d]'
                                                }`}
                                                onClick={() => setActiveTab(product.asin, 'inventory')}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    <Box className="w-3 h-3" />
                                                    <span className="hidden sm:inline">Inventory Issues</span>
                                                    <span className="sm:hidden">Inventory</span>
                                                    <span className={`px-1 py-0.5 rounded text-xs font-semibold ${
                                                        inventoryCount > 0 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                    }`}>
                                                        {inventoryCount}
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                        
                                        {/* Enhanced Tab Content */}
                                        <div className="p-2 relative bg-[#1a1a1a]" style={{ minHeight: '200px' }}>
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
                                className="text-center pt-2"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    duration: 0.3,
                                    delay: 0.2,
                                    ease: "easeOut"
                                }}
                            >
                                <button
                                    className="px-4 py-2 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-all flex items-center gap-1 mx-auto"
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                >
                                    <ArrowRight className="w-3 h-3" />
                                    Load More Products
                                </button>
                                <p className="text-xs text-gray-500 mt-1.5">
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
