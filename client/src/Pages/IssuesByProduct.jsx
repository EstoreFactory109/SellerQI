import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, Box, Eye, Activity, Star, TrendingUp, TrendingDown, LineChart, ArrowRight, Download, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { IssuesByProductPageSkeleton, IssuesProductCardSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import noImage from '../assets/Icons/no-image.png';
import { fetchProductsWithIssues, fetchIssuesSummary } from '../redux/slices/PageDataSlice.js';

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
const RankingIssuesTable = ({ product }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractRankingErrors = (product) => {
        // Use the ranking details from the enriched product (from backend)
        const rankingData = product.rankingDetails;
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
const ConversionIssuesTable = ({ product }) => {
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
        
        // Extract buybox errors from product.buyBoxDetails (enriched from backend)
        const productBuyBox = product.buyBoxDetails;
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

/**
 * ChangeIndicator - Displays period-over-period change with color coding
 * @param {number|null} percentChange - Percentage change (e.g., 15.5 for +15.5%)
 * @param {number} delta - Raw delta value (used when percentChange is null)
 * @param {boolean} positiveIsGood - Whether a positive change is good (green) or bad (red)
 * @param {boolean} isPercentagePoint - Whether to display as "pp" instead of "%"
 */
const ChangeIndicator = ({ percentChange, delta, positiveIsGood = true, isPercentagePoint = false }) => {
    // Determine the value to display
    const value = percentChange !== null && percentChange !== undefined ? percentChange : delta;
    
    if (value === null || value === undefined) {
        return <span className="text-[9px] text-gray-500">New</span>;
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
        <span className={`inline-flex items-center text-[9px] ${colorClass}`}>
            {isPositive && <ArrowUpRight className="w-2 h-2" />}
            {isNegative && <ArrowDownRight className="w-2 h-2" />}
            {isNeutral && <Minus className="w-2 h-2" />}
            <span>{prefix}{formattedValue}{suffix}</span>
        </span>
    );
};

const IssuesByProduct = () => {
    const dispatch = useDispatch();
    const currency = useSelector(state => state.currency?.currency) || '$';
    const navigate = useNavigate();
    
    // Get paginated state from Redux
    const paginatedState = useSelector((state) => state.pageData?.issuesByProductPaginated);
    const summaryState = useSelector((state) => state.pageData?.issuesPaginated?.summary);
    
    // Local UI state
    const [productTabs, setProductTabs] = useState({});
    const [prevProductTabs, setPrevProductTabs] = useState({});
    const [hasInteracted, setHasInteracted] = useState({});
    const [visibleSolutions, setVisibleSolutions] = useState({});
    
    // Filter and search states (sent to backend)
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPriority, setSelectedPriority] = useState('all');
    const [sortBy, setSortBy] = useState('issues');
    const [sortOrder, setSortOrder] = useState('desc');
    
    // Debounced search to avoid too many API calls
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const searchTimeoutRef = useRef(null);
    
    const ITEMS_PER_PAGE = 6;
    
    // Build lookup maps for detailed error tables
    const products = paginatedState?.data || [];
    const pagination = paginatedState?.pagination;
    const loading = paginatedState?.loading;
    
    // Build lookup maps from product data for child components
    const lookupMaps = useMemo(() => {
        const rankingMap = new Map();
        const buyboxMap = new Map();
        const totalProductMap = new Map();
        const productWiseErrorMap = new Map();
        
        products.forEach(product => {
            if (product.asin) {
                productWiseErrorMap.set(product.asin, product);
                if (product.rankingDetails) {
                    rankingMap.set(product.asin, product.rankingDetails);
                }
                if (product.buyBoxDetails) {
                    buyboxMap.set(product.asin, product.buyBoxDetails);
                }
            }
        });
        
        return { rankingMap, buyboxMap, totalProductMap, productWiseErrorMap };
    }, [products]);
    
    // Track if initial mount has completed
    const isInitialMount = useRef(true);
    
    // Fetch summary on mount only
    useEffect(() => {
        dispatch(fetchIssuesSummary());
    }, [dispatch]);
    
    // Fetch initial products data on mount only
    useEffect(() => {
        dispatch(fetchProductsWithIssues({
            page: 1,
            limit: ITEMS_PER_PAGE,
            sort: sortBy,
            sortOrder,
            priority: selectedPriority === 'all' ? null : selectedPriority,
            search: null,
            append: false
        }));
    }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps
    
    // Debounce search input
    useEffect(() => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        searchTimeoutRef.current = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery]);
    
    // Re-fetch when filters change (skip initial mount)
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        dispatch(fetchProductsWithIssues({
            page: 1,
            limit: ITEMS_PER_PAGE,
            sort: sortBy,
            sortOrder,
            priority: selectedPriority === 'all' ? null : selectedPriority,
            search: debouncedSearch || null,
            append: false
        }));
    }, [dispatch, debouncedSearch, selectedPriority, sortBy, sortOrder, ITEMS_PER_PAGE]);
    
    // Handle load more
    const handleLoadMore = useCallback(() => {
        const nextPage = (pagination?.page || 1) + 1;
        dispatch(fetchProductsWithIssues({
            page: nextPage,
            limit: ITEMS_PER_PAGE,
            sort: sortBy,
            sortOrder,
            priority: selectedPriority === 'all' ? null : selectedPriority,
            search: debouncedSearch || null,
            append: true
        }));
    }, [dispatch, pagination?.page, sortBy, sortOrder, selectedPriority, debouncedSearch, ITEMS_PER_PAGE]);
    
    // Check if product has any ranking issues - O(1) lookup
    const hasAnyRankingIssues = useCallback((product) => {
        const rankingData = lookupMaps.rankingMap.get(product.asin);
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
    }, [lookupMaps.rankingMap]);
    
    // Check if product has any conversion issues
    const hasAnyConversionIssues = useCallback((product) => {
        const conversionErrors = product.conversionErrors;
        if (!conversionErrors) return false;
        
        return (
            conversionErrors.imageResultErrorData?.status === "Error" ||
            conversionErrors.videoResultErrorData?.status === "Error" ||
            conversionErrors.productStarRatingResultErrorData?.status === "Error" ||
            conversionErrors.productsWithOutBuyboxErrorData?.status === "Error" ||
            conversionErrors.aplusErrorData?.status === "Error"
        );
    }, []);
    
    // Check if product has any inventory issues
    const hasAnyInventoryIssues = useCallback((product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return false;
        
        return (
            inventoryErrors.inventoryPlanningErrorData ||
            inventoryErrors.strandedInventoryErrorData ||
            inventoryErrors.inboundNonComplianceErrorData ||
            inventoryErrors.replenishmentErrorData
        );
    }, []);
    
    // Check if product has any buybox issues - O(1) lookup
    const hasAnyBuyboxIssues = useCallback((product) => {
        const productBuyBox = lookupMaps.buyboxMap.get(product.asin);
        if (!productBuyBox) return false;
        return productBuyBox.buyBoxPercentage === 0 || productBuyBox.buyBoxPercentage < 50;
    }, [lookupMaps.buyboxMap]);
    
    // Count ranking issues - O(1) lookup
    const countRankingIssues = useCallback((product) => {
        const rankingData = lookupMaps.rankingMap.get(product.asin);
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
    }, [lookupMaps.rankingMap]);
    
    // Count conversion issues - O(1) lookup for TotalProduct fallback
    const countConversionIssues = useCallback((product) => {
        let conversionErrors = product.conversionErrors;
        
        if (!conversionErrors) {
            const productData = lookupMaps.totalProductMap.get(product.asin);
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
        
        // Also count buybox issues - O(1) lookup
        const productBuyBox = lookupMaps.buyboxMap.get(product.asin);
        if (productBuyBox && (productBuyBox.buyBoxPercentage === 0 || productBuyBox.buyBoxPercentage < 50)) {
            count++;
        }
        
        return count;
    }, [lookupMaps.totalProductMap, lookupMaps.buyboxMap]);
    
    // Count inventory issues - O(1) lookup for TotalProduct fallback
    const countInventoryIssues = useCallback((product) => {
        let inventoryErrors = product.inventoryErrors;
        
        if (!inventoryErrors) {
            const productData = lookupMaps.totalProductMap.get(product.asin);
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
    }, [lookupMaps.totalProductMap]);
    
    // Get priority level for a product (uses pre-computed counts from backend)
    const getProductPriority = useCallback((product) => {
        const totalIssues = (product.rankingErrorCount || 0) + (product.conversionErrorCount || 0) + (product.inventoryErrorCount || 0) + (product.errors || 0);
        if (totalIssues >= 5) return { level: 'high', label: 'High', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50' };
        if (totalIssues >= 2) return { level: 'medium', label: 'Medium', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-50' };
        return { level: 'low', label: 'Low', color: 'bg-blue-500', textColor: 'text-blue-700', bgColor: 'bg-blue-50' };
    }, []);

    // Get stats from summary endpoint
    const stats = useMemo(() => {
        const summary = summaryState?.data;
        const totalProducts = pagination?.total || products.length;
        const rankingIssues = summary?.totalRankingErrors || 0;
        const conversionIssues = summary?.totalConversionErrors || 0;
        const inventoryIssues = summary?.totalInventoryErrors || 0;
        const totalIssues = rankingIssues + conversionIssues + inventoryIssues;
        
        // Calculate high priority from current products
        const highPriority = products.filter(product => {
            const total = (product.rankingErrorCount || 0) + (product.conversionErrorCount || 0) + (product.inventoryErrorCount || 0);
            return total >= 5;
        }).length;
        
        return { totalProducts, totalIssues, highPriority };
    }, [summaryState?.data, pagination?.total, products]);

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
        navigate(`/seller-central-checker/${asin}`);
    };
    
    // Derive hasMore and total from pagination state
    const hasMore = pagination?.hasMore || false;
    const total = pagination?.total || products.length;

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

            {loading && products.length === 0 ? (
                <IssuesByProductPageSkeleton />
            ) : !products || products.length === 0 ? (
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

                    {/* Product count */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded p-2">
                        <div className="px-2 py-1.5 text-xs text-gray-400">
                            Showing <span className="font-semibold text-blue-400">{products.length}</span> of <span className="font-semibold text-gray-300">{total}</span> products
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
                        <p className="text-xs text-gray-400">No products with issues found for this account.</p>
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
                                                            {/* Recommendation Badge */}
                                                            {product.primaryRecommendation && (
                                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${
                                                                    product.primaryRecommendation.type === 'add_ppc' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                                    product.primaryRecommendation.type === 'reduce_ppc' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                                                                    product.primaryRecommendation.type === 'fix_listing' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                                                                    product.primaryRecommendation.type === 'optimize_keywords' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                                                    'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                                                }`}>
                                                                    {product.primaryRecommendation.shortLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Performance Metrics Strip */}
                                                <div className="flex items-center gap-3">
                                                    {product.performance && (
                                                        <div className="hidden lg:flex items-center gap-2 text-xs">
                                                            <div className="flex flex-col items-center px-2 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                                <span className="text-gray-400">Sessions</span>
                                                                <span className="font-semibold text-gray-100">{product.performance.sessions?.toLocaleString() || 0}</span>
                                                                {product.comparison?.hasComparison && product.comparison?.changes?.sessions && (
                                                                    <ChangeIndicator 
                                                                        percentChange={product.comparison.changes.sessions.percentChange} 
                                                                        positiveIsGood={true}
                                                                    />
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col items-center px-2 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                                <span className="text-gray-400">Conv %</span>
                                                                <span className={`font-semibold ${product.performance.conversionRate >= 10 ? 'text-green-400' : product.performance.conversionRate >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                                    {product.performance.conversionRate?.toFixed(1) || 0}%
                                                                </span>
                                                                {product.comparison?.hasComparison && product.comparison?.changes?.conversionRate && (
                                                                    <ChangeIndicator 
                                                                        percentChange={product.comparison.changes.conversionRate.percentChange} 
                                                                        positiveIsGood={true}
                                                                    />
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col items-center px-2 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                                <span className="text-gray-400">Sales</span>
                                                                <span className="font-semibold text-gray-100">{formatCurrencyWithLocale(product.performance.sales || 0, currency)}</span>
                                                                {product.comparison?.hasComparison && product.comparison?.changes?.sales && (
                                                                    <ChangeIndicator 
                                                                        percentChange={product.comparison.changes.sales.percentChange} 
                                                                        positiveIsGood={true}
                                                                    />
                                                                )}
                                                            </div>
                                                            {product.performance.hasPPC && (
                                                                <div className="flex flex-col items-center px-2 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                                    <span className="text-gray-400">ACOS</span>
                                                                    <span className={`font-semibold ${product.performance.acos <= 30 ? 'text-green-400' : product.performance.acos <= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                                        {product.performance.acos?.toFixed(1) || 0}%
                                                                    </span>
                                                                    {product.comparison?.hasComparison && product.comparison?.changes?.acos && (
                                                                        <ChangeIndicator 
                                                                            percentChange={null}
                                                                            delta={product.comparison.changes.acos.delta}
                                                                            positiveIsGood={false}
                                                                            isPercentagePoint={true}
                                                                        />
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    <button 
                                                        className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-all flex items-center gap-1"
                                                        onClick={() => viewProductDetails(product.asin)}
                                                    >
                                                        <Eye className="w-3 h-3" />
                                                        View Details
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Mobile Performance Metrics Strip */}
                                        {product.performance && (
                                            <div className="lg:hidden border-b border-[#30363d] p-2 bg-[#1a1a1a]">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="grid grid-cols-4 gap-2 flex-1 text-xs">
                                                        <div className="flex flex-col items-center px-1.5 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                            <span className="text-gray-400 text-[10px]">Sessions</span>
                                                            <span className="font-semibold text-gray-100">{product.performance.sessions?.toLocaleString() || 0}</span>
                                                            {product.comparison?.hasComparison && product.comparison?.changes?.sessions && (
                                                                <ChangeIndicator 
                                                                    percentChange={product.comparison.changes.sessions.percentChange} 
                                                                    positiveIsGood={true}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col items-center px-1.5 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                            <span className="text-gray-400 text-[10px]">Conv %</span>
                                                            <span className={`font-semibold ${product.performance.conversionRate >= 10 ? 'text-green-400' : product.performance.conversionRate >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                                {product.performance.conversionRate?.toFixed(1) || 0}%
                                                            </span>
                                                            {product.comparison?.hasComparison && product.comparison?.changes?.conversionRate && (
                                                                <ChangeIndicator 
                                                                    percentChange={product.comparison.changes.conversionRate.percentChange} 
                                                                    positiveIsGood={true}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col items-center px-1.5 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                            <span className="text-gray-400 text-[10px]">Sales</span>
                                                            <span className="font-semibold text-gray-100">{formatCurrencyWithLocale(product.performance.sales || 0, currency)}</span>
                                                            {product.comparison?.hasComparison && product.comparison?.changes?.sales && (
                                                                <ChangeIndicator 
                                                                    percentChange={product.comparison.changes.sales.percentChange} 
                                                                    positiveIsGood={true}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col items-center px-1.5 py-1 bg-[#21262d] rounded border border-[#30363d]">
                                                            <span className="text-gray-400 text-[10px]">{product.performance.hasPPC ? 'ACOS' : 'PPC'}</span>
                                                            {product.performance.hasPPC ? (
                                                                <>
                                                                    <span className={`font-semibold ${product.performance.acos <= 30 ? 'text-green-400' : product.performance.acos <= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                                        {product.performance.acos?.toFixed(1) || 0}%
                                                                    </span>
                                                                    {product.comparison?.hasComparison && product.comparison?.changes?.acos && (
                                                                        <ChangeIndicator 
                                                                            percentChange={null}
                                                                            delta={product.comparison.changes.acos.delta}
                                                                            positiveIsGood={false}
                                                                            isPercentagePoint={true}
                                                                        />
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <span className="font-semibold text-gray-500">None</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {product.primaryRecommendation && (
                                                        <div className={`px-2 py-1 rounded text-[10px] font-semibold whitespace-nowrap ${
                                                            product.primaryRecommendation.type === 'add_ppc' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                            product.primaryRecommendation.type === 'reduce_ppc' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                                                            product.primaryRecommendation.type === 'fix_listing' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                                                            product.primaryRecommendation.type === 'optimize_keywords' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                                            'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                                        }`}>
                                                            {product.primaryRecommendation.shortLabel}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        
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
                                                        <RankingIssuesTable product={product} />
                                                    )}
                                                    {activeTab === 'conversion' && (
                                                        <ConversionIssuesTable product={product} />
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
                            {loading && products.length > 0 && (
                                <>
                                    {[1, 2].map((i) => (
                                        <IssuesProductCardSkeleton key={`skeleton-${i}`} />
                                    ))}
                                </>
                            )}
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
                                    className="px-4 py-2 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-all flex items-center gap-1 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleLoadMore}
                                    disabled={loading}
                                >
                                    {loading ? null : <ArrowRight className="w-3 h-3" />}
                                    {loading ? 'Loading...' : 'Load More Products'}
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
