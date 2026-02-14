import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Search, 
  Download, 
  CheckCircle, 
  XCircle, 
  Info, 
  Star, 
  ChevronDown,
  Filter,
  Award,
  AlertTriangle,
  AlertCircle,
  Check,
  X,
  FileText,
  BookOpen
} from 'lucide-react';
import { fetchYourProductsData, fetchIssuesByProductData } from '../redux/slices/PageDataSlice.js';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import { SkeletonTableBody } from '../Components/Skeleton/PageSkeletons.jsx';

// Exactly 6 columns: 4 fixed (ASIN/SKU, Name, Issues or Recommendation, View) + 2 chosen from dropdown.
// Product tabs: pick 2 from this list to fill columns 5 and 6.
const PRODUCT_SELECTABLE_COLUMNS = [
  { id: 'price', label: 'Price' },
  { id: 'quantity', label: 'Available Stocks' },
  { id: 'starRating', label: 'Ratings ⭐' },
  { id: 'aPlus', label: 'A+ Content' },
  { id: 'video', label: 'Videos' },
  { id: 'b2b', label: 'B2B Pricing' },
  { id: 'ads', label: 'Targeted in Ads' },
  { id: 'reviews', label: 'Reviews' }
];

// Optimization tab: pick 2 from this list.
const OPTIMIZATION_SELECTABLE_COLUMNS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'pageViews', label: 'Page Views' },
  { id: 'conversionRate', label: 'Conv %' },
  { id: 'sales', label: 'Sales' },
  { id: 'ppcSpend', label: 'PPC Spend' },
  { id: 'acos', label: 'ACOS %' }
];

const COLUMN_STORAGE_KEY_PRODUCT = 'yourProducts_selectedProductColumns';
const COLUMN_STORAGE_KEY_OPTIMIZATION = 'yourProducts_selectedOptimizationColumns';

const DEFAULT_PRODUCT_SELECTED = ['price', 'quantity'];
const DEFAULT_OPTIMIZATION_SELECTED = ['sessions', 'sales'];

function loadSelectedProductColumns() {
  try {
    const s = localStorage.getItem(COLUMN_STORAGE_KEY_PRODUCT);
    if (s) {
      const arr = JSON.parse(s);
      const validIds = new Set(PRODUCT_SELECTABLE_COLUMNS.map(c => c.id));
      if (Array.isArray(arr) && arr.length >= 2 && validIds.has(arr[0]) && validIds.has(arr[1])) {
        let c1 = arr[0], c2 = arr[1];
        if (c1 === c2) c2 = PRODUCT_SELECTABLE_COLUMNS.find(c => c.id !== c1)?.id ?? c2;
        return [c1, c2];
      }
    }
  } catch (_) {}
  return [...DEFAULT_PRODUCT_SELECTED];
}

function loadSelectedOptimizationColumns() {
  try {
    const s = localStorage.getItem(COLUMN_STORAGE_KEY_OPTIMIZATION);
    if (s) {
      const arr = JSON.parse(s);
      const validIds = new Set(OPTIMIZATION_SELECTABLE_COLUMNS.map(c => c.id));
      if (Array.isArray(arr) && arr.length >= 2 && validIds.has(arr[0]) && validIds.has(arr[1])) {
        let c1 = arr[0], c2 = arr[1];
        if (c1 === c2) c2 = OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id !== c1)?.id ?? c2;
        return [c1, c2];
      }
    }
  } catch (_) {}
  return [...DEFAULT_OPTIMIZATION_SELECTED];
}

// Helper function to format text with numbered points on separate lines
// Handles both formats: "1) " and "(1) "
const formatNumberedPoints = (text) => {
  if (!text) return [];
  
  // Check if text contains numbered points pattern (e.g., "1) ", "2) ", "(1) ", "(2) ", etc.)
  // Pattern matches: number followed by ") " or "(number) " with optional space before
  if (!text.match(/(\s+|^)(\d+\)\s+|\(\d+\)\s+)/)) {
    // No numbered points, return as single item
    return [text];
  }
  
  // First, handle "(1) " format by replacing it with a temporary marker
  // This prevents it from being split incorrectly
  let processedText = text;
  const parenMatches = [];
  let parenIndex = 0;
  
  // Replace "(1) ", "(2) ", etc. with temporary markers
  processedText = processedText.replace(/\(\d+\)\s+/g, (match) => {
    const marker = `__PAREN_MARKER_${parenIndex}__`;
    parenMatches[parenIndex] = match;
    parenIndex++;
    return marker;
  });
  
  // Now split on "1) " format (with space before)
  const parts = processedText.split(/(?=\s+\d+\)\s+)/);
  
  // Restore the "(1) " format
  const formatted = [];
  for (const part of parts) {
    let restored = part;
    // Restore parenthesized markers
    for (let i = 0; i < parenMatches.length; i++) {
      restored = restored.replace(`__PAREN_MARKER_${i}__`, parenMatches[i]);
    }
    const trimmed = restored.trim();
    if (trimmed) {
      formatted.push(trimmed);
    }
  }
  
  return formatted.length > 0 ? formatted : [text];
};

// Component to render text with numbered points on separate lines
const FormattedIssueText = ({ text, hasHTML, processedHTML, onClick }) => {
  if (hasHTML) {
    // For HTML content, we need to format it differently
    // First check if it contains numbered points
    const formattedPoints = formatNumberedPoints(processedHTML);
    
    if (formattedPoints.length > 1) {
      // Multiple points - render each on separate line
      return (
        <div className="space-y-1.5 issues-content [&_a]:text-blue-400 [&_a]:hover:text-blue-300 [&_a]:underline [&_a]:font-medium [&_strong]:text-gray-100 [&_strong]:font-semibold">
          {formattedPoints.map((point, index) => (
            <div 
              key={index}
              className="text-sm text-gray-200 leading-relaxed break-words whitespace-normal"
              dangerouslySetInnerHTML={{ __html: point }}
            />
          ))}
        </div>
      );
    }
    
    // Single item or no numbered points - render as before
    return (
      <div 
        className="text-sm text-gray-200 leading-relaxed flex-1 break-words whitespace-normal min-w-0 issues-content [&_a]:text-blue-400 [&_a]:hover:text-blue-300 [&_a]:underline [&_a]:font-medium [&_strong]:text-gray-100 [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{ __html: processedHTML }}
      />
    );
  }
  
  // For plain text, format numbered points
  const formattedPoints = formatNumberedPoints(processedHTML);
  
  if (formattedPoints.length > 1) {
    // Multiple points - render each on separate line
    return (
      <div className="space-y-1">
        {formattedPoints.map((point, index) => (
            <p key={index} className="text-sm text-gray-200 leading-relaxed break-words whitespace-normal">
              {point}
            </p>
        ))}
      </div>
    );
  }
  
  // Single item or no numbered points - render as before
  return (
            <p className="text-sm text-gray-200 leading-relaxed flex-1 break-words whitespace-normal min-w-0 issues-content [&_strong]:text-gray-100 [&_strong]:font-semibold">
              {processedHTML}
            </p>
  );
};

/**
 * Generate all client-side recommendations for a product
 * Uses profitabilityProduct data for accurate sales/profitability metrics
 * @param {Object} profitabilityProduct - Product data from profitibilityData (sales, grossProfit, ads, etc.)
 * @param {Object} performance - Performance data (sessions, conversionRate, etc.)
 * @param {string} currency - Currency symbol
 * @returns {Array} Array of recommendation objects { shortLabel, message, reason }
 */
const generateProductRecommendations = (profitabilityProduct, performance, currency = '$') => {
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
  
  // Check profitability (most critical)
  if (grossProfit < 0) {
    recommendations.push({
      shortLabel: 'Review Profitability',
      message: 'Product is operating at a loss. Consider reviewing pricing, reducing PPC spend, or negotiating better costs.',
      reason: `Gross profit is ${currency}${grossProfit.toFixed(2)} (loss)`
    });
  } else if (profitMargin < 10 && sales > 0) {
    // Low profit margin (only if not already at a loss)
    recommendations.push({
      shortLabel: 'Low Profit Margin',
      message: 'Product has low profit margin. Consider increasing price or reducing costs.',
      reason: `Profit margin is ${profitMargin.toFixed(1)}% (below 10% threshold)`
    });
  }
  
  // High ACOS (only if there's PPC activity)
  if (adsSpend > 0 && acos > 30) {
    recommendations.push({
      shortLabel: 'Optimize PPC',
      message: 'Advertising cost of sale is high. Review and optimize keyword targeting and bids.',
      reason: `ACOS is ${acos.toFixed(1)}% (above 30% threshold)`
    });
  }
  
  // PPC spend exceeds gross profit
  if (adsSpend > grossProfit && grossProfit > 0) {
    recommendations.push({
      shortLabel: 'Reduce PPC Spend',
      message: 'PPC spend is consuming most of the profit margin. Consider reducing ad spend or improving conversion.',
      reason: `PPC spend (${currency}${adsSpend.toFixed(2)}) exceeds gross profit (${currency}${grossProfit.toFixed(2)})`
    });
  }
  
  // Low conversion rate
  if (performance?.conversionRate !== undefined && performance.conversionRate < 5 && performance.conversionRate > 0) {
    recommendations.push({
      shortLabel: 'Improve Conversion',
      message: 'Conversion rate is below average. Optimize listing images, description, and reviews.',
      reason: `Conversion rate is ${performance.conversionRate.toFixed(1)}% (below 5% threshold)`
    });
  }
  
  // High fees relative to sales
  if (amzFee > 0 && sales > 0) {
    const feePercentage = (amzFee / sales) * 100;
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

const YourProducts = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track if this is the first load
  const itemsPerPage = 20; // Items fetched from backend per page
  const [optimizationDisplayLimit, setOptimizationDisplayLimit] = useState(20); // Optimization tab: show 20 then load more
  const fetchingRef = useRef(false); // Prevent duplicate fetches

  // Exactly 6 columns: 4 fixed + 2 chosen. State is [column5Id, column6Id].
  const [selectedProductColumns, setSelectedProductColumns] = useState(loadSelectedProductColumns);
  const [selectedOptimizationColumns, setSelectedOptimizationColumns] = useState(loadSelectedOptimizationColumns);
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef(null);

  // Persist selected columns to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY_PRODUCT, JSON.stringify(selectedProductColumns));
    } catch (_) {}
  }, [selectedProductColumns]);
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY_OPTIMIZATION, JSON.stringify(selectedOptimizationColumns));
    } catch (_) {}
  }, [selectedOptimizationColumns]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(e.target)) {
        setColumnDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get current marketplace and currency from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentRegion = useSelector((state) => state.currency?.region) || '';
  const currency = useSelector((state) => state.currency?.currency) || '$';

  // Optimization tab: issues-by-product data (ASIN-wise performance + recommendations)
  const issuesByProductData = useSelector((state) => state.pageData?.issuesByProduct?.data);
  const optimizationProductsRaw = issuesByProductData?.productWiseError || [];
  const optimizationLoading = useSelector((state) => state.pageData?.issuesByProduct?.loading) || false;
  
  // Get profitability data for accurate sales/profit recommendations
  const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
  
  // Create profitability map for quick lookup
  const profitabilityMap = useMemo(() => {
    const map = new Map();
    profitibilityData.forEach(item => {
      if (item.asin) {
        map.set(item.asin, item);
      }
    });
    return map;
  }, [profitibilityData]);
  
  // Enrich optimization products with client-generated recommendations
  // This replaces backend recommendations which may have stale/incorrect profitability data
  const optimizationProducts = useMemo(() => {
    return optimizationProductsRaw.map(product => {
      const profitabilityProduct = profitabilityMap.get(product.asin);
      const clientRecommendations = generateProductRecommendations(
        profitabilityProduct,
        product.performance,
        currency
      );
      
      return {
        ...product,
        // Store all recommendations for display
        recommendations: clientRecommendations,
        // Keep primaryRecommendation as the first one for compatibility
        primaryRecommendation: clientRecommendations.length > 0 ? clientRecommendations[0] : null
      };
    });
  }, [optimizationProductsRaw, profitabilityMap, currency]);

  // Fetch optimization data on mount so tab count is available immediately
  useEffect(() => {
    if (!issuesByProductData && !optimizationLoading) {
      dispatch(fetchIssuesByProductData());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper function to detect and process HTML content in issues
  const processIssueHTML = useMemo(() => (issueText) => {
    if (!issueText || typeof issueText !== 'string') {
      return { hasHTML: false, processedHTML: issueText || '' };
    }

    // Check if the text contains HTML tags (more comprehensive check)
    const htmlTagPattern = /<[a-z][\s\S]*?>/i;
    const hasHTMLTags = htmlTagPattern.test(issueText);
    
    // URL pattern to detect plain URLs (http, https, or www)
    // Matches URLs with query parameters, fragments, and special characters
    const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
    const hasURLs = urlPattern.test(issueText);
    
    // If no HTML tags and no URLs, return as plain text
    if (!hasHTMLTags && !hasURLs) {
      return { 
        hasHTML: false, 
        processedHTML: issueText
      };
    }

    // Process HTML content
    let processedHTML = issueText;
    
    // First, process existing anchor tags - check if they're complete URLs
    processedHTML = processedHTML.replace(
      /<a\s+([^>]*?)>(.*?)<\/a>/gi,
      (match, attributes, linkText) => {
        // Extract href value
        const hrefMatch = attributes.match(/href=["']([^"']+)["']/i);
        const href = hrefMatch ? hrefMatch[1] : '#';
        
        // Check if it's a complete URL (starts with http://, https://, or //)
        const isCompleteUrl = href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//'));
        
        // If not a complete URL, convert to bold text showing the actual href instead of link text
        if (!isCompleteUrl && href !== '#') {
          return `<strong>${href}</strong>`;
        }
        
        // For complete URLs, process as normal link
        // Check if target exists, if not add it
        const hasTarget = /target\s*=/i.test(attributes);
        const hasRel = /rel\s*=/i.test(attributes);
        const hasClass = /class\s*=/i.test(attributes);
        
        // Build new attributes
        let newAttributes = attributes.trim();
        
        // Ensure target="_blank" for all links
        if (!hasTarget) {
          newAttributes += ' target="_blank"';
        }
        
        // Ensure rel="noopener noreferrer" for security
        if (!hasRel) {
          newAttributes += ' rel="noopener noreferrer"';
        }
        
        // Add data attribute to prevent React Router interception
        newAttributes += ' data-external-link="true"';
        
        // Add styling class if not present
        if (!hasClass) {
          newAttributes += ' class="text-blue-600 hover:text-blue-800 underline font-medium"';
        } else {
          // Append to existing class
          newAttributes = newAttributes.replace(
            /class=["']([^"']+)["']/i,
            'class="$1 text-blue-600 hover:text-blue-800 underline font-medium"'
          );
        }
        
        return `<a ${newAttributes}>${linkText}</a>`;
      }
    );

    // Process other common HTML tags
    // Ensure proper closing of self-closing tags
    processedHTML = processedHTML.replace(/<br\s*\/?>/gi, '<br />');
    processedHTML = processedHTML.replace(/<hr\s*\/?>/gi, '<hr />');
    
    // Ensure proper spacing around block-level tags for readability
    processedHTML = processedHTML.replace(/(<p[^>]*>)/gi, '<br />$1');
    processedHTML = processedHTML.replace(/(<\/p>)/gi, '$1<br />');

    // Convert plain URLs to clickable links (but not URLs already inside anchor tags or bold tags)
    // Strategy: First, temporarily replace existing anchor tags and bold tags with placeholders
    const tagPlaceholders = [];
    let placeholderIndex = 0;
    
    // Store existing anchor tags and bold tags with placeholders
    processedHTML = processedHTML.replace(
      /<(a|strong)[^>]*>.*?<\/(a|strong)>/gi,
      (match) => {
        const placeholder = `__TAG_PLACEHOLDER_${placeholderIndex}__`;
        tagPlaceholders[placeholderIndex] = match;
        placeholderIndex++;
        return placeholder;
      }
    );
    
    // Now convert plain URLs to links (only complete URLs)
    processedHTML = processedHTML.replace(
      /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi,
      (match) => {
        // Ensure URL has protocol
        let fullUrl = match;
        if (match.startsWith('www.')) {
          fullUrl = 'https://' + match;
        }
        
        // Create anchor tag with proper styling and data attribute
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" data-external-link="true" class="text-blue-600 hover:text-blue-800 underline font-medium">${match}</a>`;
      }
    );
    
    // Restore original tags
    tagPlaceholders.forEach((originalTag, index) => {
      processedHTML = processedHTML.replace(
        `__TAG_PLACEHOLDER_${index}__`,
        originalTag
      );
    });

    return { hasHTML: true, processedHTML };
  }, [currentRegion]);

  // Get products data from Redux
  const yourProductsData = useSelector((state) => state.pageData?.yourProducts?.data);
  const loading = useSelector((state) => state.pageData?.yourProducts?.loading) ?? true;
  const error = useSelector((state) => state.pageData?.yourProducts?.error);
  const lastFetched = useSelector((state) => state.pageData?.yourProducts?.lastFetched);

  // Get Dashboard info (same as IssuesByProduct) for issue counts
  const dashboardInfo = useSelector((state) => state.Dashboard.DashBoardInfo);

  // Extract products, summary, and pagination from Redux data
  const products = useMemo(() => yourProductsData?.products || [], [yourProductsData]);
  const summary = useMemo(() => yourProductsData?.summary || {}, [yourProductsData]);
  const pagination = useMemo(() => yourProductsData?.pagination || {}, [yourProductsData]);
  
  // Debug: Log when products change
  useEffect(() => {
    console.log('[YourProducts] Products updated:', {
      productsCount: products.length,
      totalItems: pagination.totalItems,
      hasMore: pagination.hasMore,
      currentPage: pagination.page
    });
  }, [products.length, pagination.totalItems, pagination.hasMore, pagination.page]);

  // Map tab key to status filter for backend (Optimization tab uses issues-by-product data, not your-products)
  const getStatusForTab = (tab) => {
    switch (tab) {
      case 'active':
        return 'Active';
      case 'inactive':
        return 'Inactive';
      case 'incomplete':
        return 'Incomplete';
      case 'withoutAPlus':
        return undefined; // Keep client-side filtering for Without A+ tab
      case 'optimization':
        return undefined; // Optimization tab uses fetchIssuesByProductData
      default:
        return undefined;
    }
  };

  // Show table skeleton when current tab's data is loading (on initial load or tab switch)
  const showTableSkeleton = useMemo(() => {
    if (activeTab === 'optimization') {
      return optimizationLoading;
    }
    const expectedStatus = getStatusForTab(activeTab);
    const hasDataForThisTab = yourProductsData?.products?.length > 0 &&
      (expectedStatus == null ? true : yourProductsData?.currentStatus === expectedStatus);
    return loading && !hasDataForThisTab;
  }, [activeTab, loading, optimizationLoading, yourProductsData?.products?.length, yourProductsData?.currentStatus]);

  // Track when data is first loaded to distinguish initial load from tab switches
  useEffect(() => {
    // Once we have data (even if loading), we're past initial load
    // This ensures tab switches don't show full page loader
    if (yourProductsData && yourProductsData.products && yourProductsData.products.length > 0) {
      setIsInitialLoad(false);
    }
  }, [yourProductsData]);

  // Fetch products data when component mounts or when tab changes
  useEffect(() => {
    // Optimization tab uses issues-by-product API instead of your-products
    if (activeTab === 'optimization') {
      dispatch(fetchIssuesByProductData());
      return;
    }

    const status = getStatusForTab(activeTab);
    const currentStatus = yourProductsData?.currentStatus;
    
    // Check if we already have data for this status in Redux
    // Only fetch if:
    // 1. No data exists at all
    // 2. Status changed AND we don't have data for this status
    // 3. Data is stale (older than 5 minutes)
    const hasDataForStatus = yourProductsData && 
                            yourProductsData.products && 
                            yourProductsData.products.length > 0 &&
                            currentStatus === status;
    
    const isDataStale = lastFetched && (Date.now() - lastFetched) > 5 * 60 * 1000;
    
    const needsFetch = !hasDataForStatus || isDataStale;
    
    // Prevent duplicate fetches
    if (needsFetch && !loading && !fetchingRef.current) {
      fetchingRef.current = true;
      
      console.log('[YourProducts] Fetching data:', {
        hasDataForStatus,
        currentStatus,
        requestedStatus: status,
        isDataStale,
        needsFetch,
        lastFetched: lastFetched ? new Date(lastFetched).toISOString() : null
      });
      
      dispatch(fetchYourProductsData({ 
        page: 1, 
        limit: itemsPerPage, 
        status: status,
        reset: false // Don't reset - let Redux check cache first
      })).finally(() => {
        fetchingRef.current = false;
      });
    } else {
      console.log('[YourProducts] Using cached data from Redux (no database call):', {
        hasDataForStatus,
        currentStatus,
        requestedStatus: status,
        lastFetched: lastFetched ? new Date(lastFetched).toISOString() : null
      });
    }
  }, [dispatch, activeTab, loading, yourProductsData?.currentStatus, lastFetched]); // Include lastFetched to detect stale data
  
  // Handle loading more products from backend
  const handleLoadMoreFromBackend = async () => {
    // Guard against loading if already loading
    if (loadingMore || loading) return;
    
    // Get current status filter
    const status = getStatusForTab(activeTab);
    
    // Check if we already have all data for current filter
    const totalItems = pagination.totalItems || 0; // Use filtered total from pagination
    if (products.length >= totalItems) return;
    
    setLoadingMore(true);
    try {
      // Calculate next page based on current products loaded
      // IMPORTANT: Calculate based on how many pages we've already loaded, not just pagination.page
      // This ensures we always request the correct next page even if pagination state is stale
      const currentPage = pagination.page || 1;
      const nextPage = currentPage + 1;
      
      console.log('[YourProducts] Load More - Before fetch:', {
        currentPage,
        nextPage,
        currentProductsCount: products.length,
        totalItems,
        status,
        lastAsin: products[products.length - 1]?.asin
      });
      
      const result = await dispatch(fetchYourProductsData({ 
        page: nextPage, 
        limit: itemsPerPage, 
        append: true,
        status: status
      })).unwrap();
      
      console.log('[YourProducts] Load More result:', {
        requestedPage: nextPage,
        status,
        previousProductsCount: products.length,
        newProductsCount: result.products?.length || 0,
        totalItems: result.pagination?.totalItems || 0,
        hasMore: result.pagination?.hasMore,
        newPage: result.pagination?.page,
        lastAsin: result.products?.[result.products.length - 1]?.asin,
        firstNewAsin: result.products?.[products.length]?.asin
      });
    } catch (err) {
      console.error('Error loading more products:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Filter products based on search and sort (client-side filtering)
  // Note: Status filtering is now done on backend, but we keep client-side for 'withoutAPlus' and 'notTargetedInAds' tabs
  const filteredProducts = useMemo(() => {
    let filtered = [...products];

    // Only apply client-side status filter for 'withoutAPlus' tab (backend doesn't filter by hasAPlus)
    if (activeTab === 'withoutAPlus') {
      filtered = filtered.filter(p => !p.hasAPlus);
    }
    // Filter for 'notTargetedInAds' tab (products not targeted in ads)
    if (activeTab === 'notTargetedInAds') {
      filtered = filtered.filter(p => !p.isTargetedInAds);
    }
    // For other tabs (all, active, inactive, incomplete), backend already filters by status

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(product => 
        product.asin?.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.title?.toLowerCase().includes(query)
      );
    }

    // Sort
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // Handle totalIssues - calculate from issues data
        if (sortConfig.key === 'totalIssues') {
          aValue = a.status === 'Active' ? getTotalIssues(a) : null;
          bValue = b.status === 'Active' ? getTotalIssues(b) : null;
          // Handle null values (non-active products) - put them at the end
          if (aValue === null && bValue === null) return 0;
          if (aValue === null) return 1;
          if (bValue === null) return -1;
          aValue = aValue || 0;
          bValue = bValue || 0;
        }
        // Handle numeric values
        else if (sortConfig.key === 'price' || sortConfig.key === 'numRatings' || sortConfig.key === 'starRatings' || sortConfig.key === 'quantity') {
          aValue = parseFloat(aValue) || 0;
          bValue = parseFloat(bValue) || 0;
        } else {
          aValue = (aValue || '').toString().toLowerCase();
          bValue = (bValue || '').toString().toLowerCase();
        }

        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }

    return filtered;
  }, [products, searchQuery, activeTab, sortConfig]);

  // Optimization tab: filter and sort ASIN-wise data (sessions, conversion, PPC, recommendations)
  const filteredOptimizationProducts = useMemo(() => {
    if (activeTab !== 'optimization' || !optimizationProducts.length) return [];
    let list = [...optimizationProducts];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(p =>
        (p.asin || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.name || p.title || '').toLowerCase().includes(q)
      );
    }
    if (sortConfig.key) {
      list.sort((a, b) => {
        const perfA = a.performance || {};
        const perfB = b.performance || {};
        let aVal, bVal;
        switch (sortConfig.key) {
          case 'sessions': aVal = perfA.sessions ?? 0; bVal = perfB.sessions ?? 0; break;
          case 'pageViews': aVal = perfA.pageViews ?? 0; bVal = perfB.pageViews ?? 0; break;
          case 'conversionRate': aVal = perfA.conversionRate ?? 0; bVal = perfB.conversionRate ?? 0; break;
          case 'sales': aVal = perfA.sales ?? 0; bVal = perfB.sales ?? 0; break;
          case 'ppcSpend': aVal = perfA.ppcSpend ?? 0; bVal = perfB.ppcSpend ?? 0; break;
          case 'acos': aVal = perfA.acos ?? 0; bVal = perfB.acos ?? 0; break;
          case 'asin': aVal = (a.asin || '').toLowerCase(); bVal = (b.asin || '').toLowerCase(); break;
          case 'title': aVal = (a.name || a.title || '').toLowerCase(); bVal = (b.name || b.title || '').toLowerCase(); break;
          default: aVal = (a[sortConfig.key] ?? '').toString(); bVal = (b[sortConfig.key] ?? '').toString();
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [activeTab, optimizationProducts, searchQuery, sortConfig]);

  // Optimization tab: paginate client-side (first 20, then load more 20 at a time)
  const displayedOptimizationProducts = useMemo(() => {
    if (activeTab !== 'optimization') return [];
    return filteredOptimizationProducts.slice(0, optimizationDisplayLimit);
  }, [activeTab, filteredOptimizationProducts, optimizationDisplayLimit]);

  // Reset optimization display limit when switching to Optimization tab or when search changes (show first 20 again)
  const prevActiveTabRef = useRef(activeTab);
  const prevSearchQueryRef = useRef(searchQuery);
  useEffect(() => {
    const switchedToOptimization = prevActiveTabRef.current !== 'optimization' && activeTab === 'optimization';
    const searchChanged = prevSearchQueryRef.current !== searchQuery;
    prevActiveTabRef.current = activeTab;
    prevSearchQueryRef.current = searchQuery;
    if (switchedToOptimization || (activeTab === 'optimization' && searchChanged)) {
      setOptimizationDisplayLimit(20);
    }
  }, [activeTab, searchQuery]);

  // For display, use filtered products or paginated optimization list
  const displayedProducts = activeTab === 'optimization' ? displayedOptimizationProducts : filteredProducts;

  const hasMoreOptimization = activeTab === 'optimization' && optimizationDisplayLimit < filteredOptimizationProducts.length;
  const loadMoreOptimization = () => setOptimizationDisplayLimit(prev => prev + itemsPerPage);

  // Exactly 6 columns: 4 fixed + 2 chosen (equal width for the 2 chosen)
  const productTableColCount = 6;
  const optimizationTableColCount = 6;
  const productTableColCountForTab = (activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') ? 4 : productTableColCount;
  const chosenColumnWidth = '16.67%'; // 2 columns share ~33%, 1/6 each
  const productFixedWidths = { asin: '14%', title: '28%', issues: '18%', view: '10%' }; // 70%, chosen 2 get 15% each = 100%
  const optimizationFixedWidths = { asin: '14%', title: '28%', recommendation: '22%', view: '10%' };
  
  // Check if there's more data to load from backend
  // Use filtered total from pagination (not summary.totalProducts which is for all products)
  const totalItems = pagination.totalItems || 0; // This is the filtered total (e.g., 70 for inactive)
  const hasMoreFromBackend = pagination.hasMore && products.length < totalItems;

  // Handle sort
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Get status badge styles
  const getStatusBadge = (status) => {
    switch (status) {
      case 'Active':
        return {
          bg: '#d1fae5',
          color: '#065f46',
          icon: <CheckCircle size={12} />
        };
      case 'Inactive':
        return {
          bg: '#fee2e2',
          color: '#991b1b',
          icon: <XCircle size={12} />
        };
      case 'Incomplete':
        return {
          bg: '#fef3c7',
          color: '#92400e',
          icon: <AlertCircle size={12} />
        };
      default:
        return {
          bg: '#f1f5f9',
          color: '#475569',
          icon: null
        };
    }
  };

  // Get issues badge color based on count - using only green, red, blue, yellow
  const getIssuesBadge = (totalIssues) => {
    if (totalIssues === null || totalIssues === undefined) {
      return { bg: '#f1f5f9', color: '#94a3b8', text: '—' };
    }
    if (totalIssues === 0) {
      return { bg: '#d1fae5', color: '#065f46', text: '0' }; // green
    }
    if (totalIssues >= 5) {
      return { bg: '#fee2e2', color: '#991b1b', text: totalIssues.toString() }; // red
    }
    if (totalIssues >= 2) {
      return { bg: '#fef3c7', color: '#92400e', text: totalIssues.toString() }; // yellow
    }
    return { bg: '#dbeafe', color: '#1e40af', text: totalIssues.toString() }; // blue
  };

  // Pre-compute issue counts by ASIN from Dashboard info (same data structure as IssuesByProduct)
  const issueCountsByAsin = useMemo(() => {
    const countsMap = new Map();
    
    if (!dashboardInfo) return countsMap;

    // Build fast lookups (Issues-by-Product uses productWiseError as the primary source)
    const productWiseErrorByAsin = new Map(
      (dashboardInfo.productWiseError || []).map(p => [p.asin, p])
    );
    const totalProductByAsin = new Map(
      (dashboardInfo.TotalProduct || []).map(p => [p.asin, p])
    );
    const rankingByAsin = new Map(
      (dashboardInfo.rankingProductWiseErrors || []).map(r => [r.asin, r])
    );

    const getIssueSourceProduct = (asin) =>
      productWiseErrorByAsin.get(asin) || totalProductByAsin.get(asin) || null;

    // Match buybox data with the same robustness as IssuesByProduct
    const findBuyBoxForAsin = (asin) => {
      const list = dashboardInfo.buyBoxData?.asinBuyBoxData;
      if (!Array.isArray(list) || !asin) return null;

      // Direct match
      let match = list.find(item => item.childAsin === asin || item.parentAsin === asin);
      if (match) return match;

      // String trimmed match
      const asinStr = String(asin).trim();
      match = list.find(item =>
        String(item.childAsin || '').trim() === asinStr ||
        String(item.parentAsin || '').trim() === asinStr
      );
      if (match) return match;

      // Case-insensitive match
      const asinLower = asinStr.toLowerCase();
      return list.find(item =>
        String(item.childAsin || '').trim().toLowerCase() === asinLower ||
        String(item.parentAsin || '').trim().toLowerCase() === asinLower
      ) || null;
    };
    
    // Helper to count ranking issues (same logic as IssuesByProduct)
    const countRankingForAsin = (asin) => {
      const rankingData = rankingByAsin.get(asin);
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
      
      if (rankingErrors.charLim?.status === 'Error') count++;
      return count;
    };
    
    // Helper to count conversion issues (same logic as IssuesByProduct)
    const countConversionForAsin = (asin) => {
      const sourceProduct = getIssueSourceProduct(asin);
      const conversionErrors = sourceProduct?.conversionErrors;
      if (!conversionErrors) return 0;
      let count = 0;
      
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
      
      // Also count buybox issues
      const buyBox = findBuyBoxForAsin(asin);
      if (buyBox && (buyBox.buyBoxPercentage === 0 || buyBox.buyBoxPercentage < 50)) {
        count++;
      }
      
      return count;
    };
    
    // Helper to count inventory issues (same logic as IssuesByProduct)
    const countInventoryForAsin = (asin) => {
      const sourceProduct = getIssueSourceProduct(asin);
      const inventoryErrors = sourceProduct?.inventoryErrors;
      if (!inventoryErrors) return 0;
      let count = 0;
      
      if (inventoryErrors.inventoryPlanningErrorData) {
        const planning = inventoryErrors.inventoryPlanningErrorData;
        if (planning.longTermStorageFees?.status === 'Error') count++;
        if (planning.unfulfillable?.status === 'Error') count++;
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
    
    // Get all unique ASINs from products
    const allAsins = new Set();
    products.forEach(product => {
      if (product.asin) allAsins.add(product.asin);
    });
    
    // Pre-compute counts for all ASINs
    allAsins.forEach(asin => {
      const rankingCount = countRankingForAsin(asin);
      const conversionCount = countConversionForAsin(asin);
      const inventoryCount = countInventoryForAsin(asin);
      const totalCount = rankingCount + conversionCount + inventoryCount;
      
      countsMap.set(asin, {
        ranking: rankingCount,
        conversion: conversionCount,
        inventory: inventoryCount,
        total: totalCount
      });
    });
    
    return countsMap;
  }, [dashboardInfo, products]);

  // Get total issues for a product using pre-computed map
  const getTotalIssues = (product) => {
    if (product.status !== 'Active') return null;
    const counts = issueCountsByAsin.get(product.asin);
    return counts ? counts.total : 0;
  };
  
  // Helper functions for CSV export (using pre-computed map)
  const countRankingIssues = (product) => {
    const counts = issueCountsByAsin.get(product.asin);
    return counts ? counts.ranking : 0;
  };
  
  const countConversionIssues = (product) => {
    const counts = issueCountsByAsin.get(product.asin);
    return counts ? counts.conversion : 0;
  };
  
  const countInventoryIssues = (product) => {
    const counts = issueCountsByAsin.get(product.asin);
    return counts ? counts.inventory : 0;
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'ASIN',
      'SKU',
      'Title',
      'Status',
      'Price',
      'Reviews',
      'Ratings',
      'Has A+ Content',
      'A+ Status',
      'Has Videos',
      'Targeted In Ads',
      'Ranking Issues',
      'Conversion Issues',
      'Inventory Issues',
      'Total Issues'
    ];

    const csvRows = [
      headers.join(','),
      ...filteredProducts.map(product => {
        const rankingIssues = product.status === 'Active' ? countRankingIssues(product) : '';
        const conversionIssues = product.status === 'Active' ? countConversionIssues(product) : '';
        const inventoryIssues = product.status === 'Active' ? countInventoryIssues(product) : '';
        const totalIssues = product.status === 'Active' ? getTotalIssues(product) : '';
        return [
          product.asin,
          `"${(product.sku || '').replace(/"/g, '""')}"`,
          `"${(product.title || '').replace(/"/g, '""')}"`,
          product.status,
          product.price,
          product.numRatings,
          product.starRatings,
          product.hasAPlus ? 'Yes' : 'No',
          product.aPlusStatus,
          product.hasVideo ? 'Yes' : 'No',
          product.isTargetedInAds ? 'Yes' : 'No',
          rankingIssues,
          conversionIssues,
          inventoryIssues,
          totalIssues
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `your-products-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] p-2 md:p-3 font-sans overflow-x-hidden" style={{ overflowY: 'visible' }}>
      <style>{`
        /* Fix overflow for issues column */
        .issues-cell {
          max-width: 0;
          overflow: hidden;
        }
        
        .issues-content {
          min-width: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        
        .issues-content a {
          word-break: break-all;
          overflow-wrap: anywhere;
        }
        
        /* Prevent horizontal scrolling */
        table {
          max-width: 100%;
        }
        
        table th,
        table td {
          word-wrap: break-word;
          overflow-wrap: break-word;
          overflow: visible;
        }
        
        /* Ensure table container doesn't exceed viewport */
        .max-w-7xl {
          max-width: 100%;
          overflow-x: hidden;
          overflow-y: visible;
        }
        
        table thead {
          position: relative;
        }
        
        table thead th {
          overflow: visible !important;
          position: relative;
        }
      `}</style>

      <div className="max-w-7xl mx-auto px-2 lg:px-3 py-1.5" style={{ maxWidth: '100%', overflowX: 'hidden', overflowY: 'visible' }}>
        {/* Header */}
        <div className="bg-[#161b22] rounded border border-[#30363d] p-2 mb-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-blue-400" />
              <div>
                <h1 className="text-lg font-bold text-gray-100">Your Products</h1>
                <p className="text-gray-400 text-xs">
                  {currentCountry ? `Marketplace: ${currentCountry.toUpperCase()}` : 'All Products'}
                </p>
              </div>
            </div>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors"
            >
              <Download size={16} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-1.5 mb-2">
          {loading && !yourProductsData ? (
            <>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="bg-[#161b22] rounded border border-[#30363d] p-2">
                  <div className="mb-1 h-3 w-20 rounded bg-[#30363d] animate-pulse" />
                  <div className="h-6 w-12 rounded bg-[#21262d] animate-pulse" />
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <Box className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Total Products</span>
                </div>
                <div className="text-lg font-bold text-white">{summary.totalProducts || 0}</div>
              </div>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Active</span>
                </div>
                <div className="text-lg font-bold text-white">{summary.activeProducts || 0}</div>
              </div>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Inactive</span>
                </div>
                <div className="text-lg font-bold text-white">{summary.inactiveProducts || 0}</div>
              </div>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Incomplete</span>
                </div>
                <div className="text-lg font-bold text-white">{summary.incompleteProducts || 0}</div>
              </div>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Without A+</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {summary.productsWithoutAPlus ??
                    (summary.totalProducts != null
                      ? summary.totalProducts - (summary.productsWithAPlus || 0)
                      : 0)}
                </div>
              </div>
              <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                  <BookOpen className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                  <span>Brand Story</span>
                </div>
                <div className="flex items-center">
                  {summary.hasBrandStory ? (
                    <Check size={20} className="text-green-400" strokeWidth={3} />
                  ) : (
                    <X size={20} className="text-red-400" strokeWidth={3} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* General Info / Tips for user guidance */}
        <div className="bg-blue-500/10 border-l-4 border-blue-500/40 p-2 mb-2 rounded-r space-y-3">
          <div className="flex items-start gap-2">
            <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
            <div>
              <h3 className="text-xs font-semibold text-blue-300 mb-0.5">
                Customize table columns
              </h3>
              <p className="text-xs text-blue-400">
                Use the <strong>Columns</strong> dropdown next to the search bar (on Active and Optimization tabs) to choose up to 2 extra columns—e.g. Price, Ratings, A+ Content, or Reviews—so the table shows the fields you care about.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
            <div>
              <h3 className="text-xs font-semibold text-blue-300 mb-0.5">
                View button
              </h3>
              <p className="text-xs text-blue-400">
                Click <strong>View</strong> in any row to open that product’s detail page, where you can see full metrics, performance trends, recommendations, and issues for that product.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
            <div>
              <h3 className="text-xs font-semibold text-blue-300 mb-0.5">
                Check Product Issues
              </h3>
              <p className="text-xs text-blue-400">
                To view and resolve issues for inactive or incomplete products, navigate to the <strong>Inactive</strong> or <strong>Incomplete</strong> tabs above. Each product in these tabs displays the specific issues that need to be addressed.
              </p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-[#161b22] rounded border border-[#30363d] p-2 mb-2">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search by ASIN, SKU, or Title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
              />
            </div>
            {/* Column selection - single dropdown, choose at most 2 columns */}
            {['active', 'optimization'].includes(activeTab) && (
              <div className="relative flex-shrink-0" ref={columnDropdownRef}>
                <button
                  type="button"
                  onClick={() => setColumnDropdownOpen(prev => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded text-sm text-gray-300 hover:bg-[#30363d] hover:border-[#484f58] transition-colors"
                >
                  <Box size={16} className="text-gray-400" />
                  Columns
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${columnDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {columnDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] bg-[#21262d] border border-[#30363d] rounded shadow-lg py-3 px-3">
                    <p className="text-xs text-gray-400 mb-3">Choose up to 2 columns for the table.</p>
                    {activeTab === 'optimization' ? (
                      <div className="space-y-2">
                        <label className="block text-xs text-gray-400">Column 5</label>
                        <select
                          value={selectedOptimizationColumns[0]}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedOptimizationColumns(prev => [v, prev[1] === v ? OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id !== v)?.id ?? prev[1] : prev[1]]);
                          }}
                          className="w-full px-2 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-sm text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                          {OPTIMIZATION_SELECTABLE_COLUMNS.map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                        <label className="block text-xs text-gray-400 mt-2">Column 6</label>
                        <select
                          value={selectedOptimizationColumns[1]}
                          onChange={(e) => setSelectedOptimizationColumns(prev => [prev[0], e.target.value])}
                          className="w-full px-2 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-sm text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                          {OPTIMIZATION_SELECTABLE_COLUMNS.filter(c => c.id !== selectedOptimizationColumns[0]).map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-xs text-gray-400">Column 5</label>
                        <select
                          value={selectedProductColumns[0]}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedProductColumns(prev => [v, prev[1] === v ? PRODUCT_SELECTABLE_COLUMNS.find(c => c.id !== v)?.id ?? prev[1] : prev[1]]);
                          }}
                          className="w-full px-2 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-sm text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                          {PRODUCT_SELECTABLE_COLUMNS.map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                        <label className="block text-xs text-gray-400 mt-2">Column 6</label>
                        <select
                          value={selectedProductColumns[1]}
                          onChange={(e) => setSelectedProductColumns(prev => [prev[0], e.target.value])}
                          className="w-full px-2 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-sm text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                          {PRODUCT_SELECTABLE_COLUMNS.filter(c => c.id !== selectedProductColumns[0]).map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-[#161b22] rounded-t border border-b-0 border-[#30363d] px-2 flex gap-1 overflow-x-auto">
          {[
            { key: 'active', label: 'Active', count: summary.activeProducts || 0 },
            { key: 'optimization', label: 'Optimization', count: optimizationProducts.length },
            { key: 'withoutAPlus', label: 'Without A+', count: summary.productsWithoutAPlus ?? (summary.totalProducts != null ? (summary.totalProducts - (summary.productsWithAPlus || 0)) : 0) },
            { key: 'notTargetedInAds', label: 'Not Targeted to Ads', count: products.filter(p => !p.isTargetedInAds).length },
            { key: 'inactive', label: 'Inactive', count: summary.inactiveProducts || 0 },
            { key: 'incomplete', label: 'Incomplete', count: summary.incompleteProducts || 0 }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-2 py-1.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Products Table */}
        <div className="bg-[#161b22] rounded-b border border-[#30363d] relative" style={{ overflowX: 'hidden', overflowY: 'visible', overflow: 'visible' }}>
          {/* Skeleton when current tab's data is loading (initial load or tab switch) */}
          {showTableSkeleton ? (
            <div className="p-2">
              <SkeletonTableBody rows={10} />
            </div>
          ) : (
          <div className="w-full" style={{ overflowX: 'hidden', overflowY: 'visible', maxWidth: '100%' }}>
            <table className="w-full" style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }}>
              <thead className="bg-[#21262d]">
                <tr>
                  {/* Show different columns based on tab */}
                  {activeTab === 'optimization' ? (
                    <>
                      {/* Optimization: 6 columns = ASIN/SKU, Title, [chosen1], [chosen2], Recommendation, View */}
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: optimizationFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: optimizationFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedOptimizationColumns[0])}>{OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id === selectedOptimizationColumns[0])?.label ?? selectedOptimizationColumns[0]} {sortConfig.key === selectedOptimizationColumns[0] && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedOptimizationColumns[1])}>{OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id === selectedOptimizationColumns[1])?.label ?? selectedOptimizationColumns[1]} {sortConfig.key === selectedOptimizationColumns[1] && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: optimizationFixedWidths.recommendation }}>Recommendation</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: optimizationFixedWidths.view }}>View</th>
                    </>
                  ) : (activeTab === 'inactive' || activeTab === 'incomplete') ? (
                    <>
                      {/* Simplified columns for inactive/incomplete tabs: ASIN/SKU, Title, B2B Pricing, Issues */}
                      <th 
                        className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]"
                        style={{ width: '10%' }}
                        onClick={() => handleSort('asin')}
                      >
                        ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]"
                        style={{ width: '29%' }}
                        onClick={() => handleSort('title')}
                      >
                        Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '8%' }}>
                        B2B Pricing
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '53%' }}>
                        Issues
                      </th>
                    </>
                  ) : activeTab === 'active' ? (
                    <>
                      {/* Active tab: 6 columns = ASIN/SKU, Title, Issues, [chosen1], [chosen2], View */}
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.issues }} onClick={() => handleSort('totalIssues')}>Issues {sortConfig.key === 'totalIssues' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => { const k = selectedProductColumns[0] === 'reviews' ? 'numRatings' : selectedProductColumns[0] === 'starRating' ? 'starRatings' : selectedProductColumns[0]; if (['price','quantity','numRatings','starRatings'].includes(k)) handleSort(k); }}>{PRODUCT_SELECTABLE_COLUMNS.find(c => c.id === selectedProductColumns[0])?.label ?? selectedProductColumns[0]} {sortConfig.key === (selectedProductColumns[0] === 'reviews' ? 'numRatings' : selectedProductColumns[0] === 'starRating' ? 'starRatings' : selectedProductColumns[0]) && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => { const k = selectedProductColumns[1] === 'reviews' ? 'numRatings' : selectedProductColumns[1] === 'starRating' ? 'starRatings' : selectedProductColumns[1]; if (['price','quantity','numRatings','starRatings'].includes(k)) handleSort(k); }}>{PRODUCT_SELECTABLE_COLUMNS.find(c => c.id === selectedProductColumns[1])?.label ?? selectedProductColumns[1]} {sortConfig.key === (selectedProductColumns[1] === 'reviews' ? 'numRatings' : selectedProductColumns[1] === 'starRating' ? 'starRatings' : selectedProductColumns[1]) && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: productFixedWidths.view }}>View</th>
                    </>
                  ) : activeTab === 'withoutAPlus' ? (
                    <>
                      {/* Without A+: 4 columns = ASIN/SKU, Title, Status, A+ (mandatory) */}
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.issues }} onClick={() => handleSort('status')}>Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '12%' }}>A+</th>
                    </>
                  ) : (
                    <>
                      {/* Not Targeted to Ads: 4 columns = ASIN/SKU, Title, Status, Targeted in Ads (mandatory) */}
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.issues }} onClick={() => handleSort('status')}>Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '12%' }}>Targeted in Ads</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {displayedProducts.length > 0 ? (
                  displayedProducts.map((product, index) => {
                    const statusBadge = getStatusBadge(product.status);
                    
                    // Optimization tab: ASIN-wise performance + recommendation
                    if (activeTab === 'optimization') {
                      const perf = product.performance || {};
                      const rec = product.primaryRecommendation;
                      return (
                        <tr
                          key={`opt-${product.asin}-${index}`}
                          onClick={() => navigate(`/seller-central-checker/${product.asin}`)}
                          className="border-b border-[#30363d] hover:bg-[#21262d] cursor-pointer transition-colors"
                        >
                          <td className="px-1.5 py-2 text-left align-top">
                            <div className="flex flex-col gap-1">
                              <code className="text-xs font-mono text-blue-400 break-all">{product.asin || '—'}</code>
                              <span className="text-xs text-gray-400 break-words">{product.sku || '—'}</span>
                            </div>
                          </td>
                          <td className="pl-1 pr-2 py-2 text-left align-top">
                            <span className="text-xs text-gray-100 break-words line-clamp-2" title={product.name || product.title}>{product.name || product.title || '—'}</span>
                          </td>
                          <td className="px-2 py-2 text-center align-top text-xs text-gray-100">
                            {selectedOptimizationColumns[0] === 'sessions' && (perf.sessions ?? 0).toLocaleString()}
                            {selectedOptimizationColumns[0] === 'pageViews' && (perf.pageViews ?? 0).toLocaleString()}
                            {selectedOptimizationColumns[0] === 'conversionRate' && `${(perf.conversionRate ?? 0).toFixed(1)}%`}
                            {selectedOptimizationColumns[0] === 'sales' && (perf.sales != null ? formatCurrencyWithLocale(perf.sales, currency, 2) : '—')}
                            {selectedOptimizationColumns[0] === 'ppcSpend' && (perf.ppcSpend != null ? formatCurrencyWithLocale(perf.ppcSpend, currency, 2) : '—')}
                            {selectedOptimizationColumns[0] === 'acos' && (perf.acos != null ? `${Number(perf.acos).toFixed(1)}%` : '—')}
                          </td>
                          <td className="px-2 py-2 text-center align-top text-xs text-gray-100">
                            {selectedOptimizationColumns[1] === 'sessions' && (perf.sessions ?? 0).toLocaleString()}
                            {selectedOptimizationColumns[1] === 'pageViews' && (perf.pageViews ?? 0).toLocaleString()}
                            {selectedOptimizationColumns[1] === 'conversionRate' && `${(perf.conversionRate ?? 0).toFixed(1)}%`}
                            {selectedOptimizationColumns[1] === 'sales' && (perf.sales != null ? formatCurrencyWithLocale(perf.sales, currency, 2) : '—')}
                            {selectedOptimizationColumns[1] === 'ppcSpend' && (perf.ppcSpend != null ? formatCurrencyWithLocale(perf.ppcSpend, currency, 2) : '—')}
                            {selectedOptimizationColumns[1] === 'acos' && (perf.acos != null ? `${Number(perf.acos).toFixed(1)}%` : '—')}
                          </td>
                          <td className="px-2 py-2 text-left align-top">
                            {rec?.shortLabel ? (
                              <span className="flex items-center gap-1">
                                <span className="text-xs text-amber-400 font-medium" title={rec.message}>{rec.shortLabel}</span>
                                {product.recommendations?.length > 1 && (
                                  <span className="text-xs text-gray-400 bg-gray-700/50 px-1.5 py-0.5 rounded" title={`${product.recommendations.length - 1} more recommendation${product.recommendations.length > 2 ? 's' : ''}`}>
                                    +{product.recommendations.length - 1}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate(`/seller-central-checker/${product.asin}`); }}
                              className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    
                    // Render different row layout for inactive/incomplete tabs
                    if (activeTab === 'inactive' || activeTab === 'incomplete') {
                      const issueCount = product.issues?.length || 0;
                      return (
                        <tr key={`${product.asin}-${index}`} className="border-b border-[#30363d]">
                          <td className="px-1.5 py-2 text-left align-top">
                            <div className="flex flex-col gap-1 items-start">
                            <code className="text-xs font-mono text-gray-100 bg-[#21262d] px-1.5 py-0.5 rounded break-all">
                                {product.asin || '—'}
                            </code>
                              <span className="text-xs font-medium text-gray-400 break-words">
                                {product.sku || '—'}
                              </span>
                            </div>
                          </td>
                          <td className="pl-1 pr-2 py-2 text-left align-top">
                            <span className="text-sm text-gray-100 font-medium leading-relaxed block break-words">
                              {product.title || '—'}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            {product.has_b2b_pricing ? (
                              <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} />
                            ) : (
                              <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />
                            )}
                          </td>
                          <td className="px-2 py-2 text-left align-top issues-cell">
                            {issueCount > 0 ? (
                              <div className="space-y-2 issues-content">
                                {product.issues.map((issue, issueIndex) => (
                                  <div 
                                    key={issueIndex} 
                                    className="flex items-start gap-2.5 p-2.5 bg-[#21262d] border border-[#30363d] rounded hover:border-yellow-500/40 hover:bg-[#1c2128] transition-all min-w-0"
                                  >
                                    <div className="flex-shrink-0 mt-0.5">
                                      <AlertTriangle size={14} className="text-yellow-400" />
                                    </div>
                                    {(() => {
                                      const { hasHTML, processedHTML } = processIssueHTML(issue);
                                      const handleLinkClick = (e) => {
                                        // Prevent React Router from intercepting link clicks
                                        const target = e.target;
                                        // Check if clicked element is a link or inside a link
                                        const link = target.closest('a');
                                        if (link && link.href) {
                                          // Check if it has the data-external-link attribute or is an external URL
                                          const isExternalLink = link.getAttribute('data-external-link') === 'true';
                                          const href = link.getAttribute('href');
                                          const isExternalUrl = href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//'));
                                          
                                          // If it's marked as external or is an external URL, prevent React Router
                                          if (isExternalLink || isExternalUrl) {
                                            // Stop event propagation to prevent React Router from handling it
                                            e.stopPropagation();
                                            // Prevent default to handle manually if needed
                                            e.preventDefault();
                                            // Open the link in a new tab
                                            window.open(href || link.href, '_blank', 'noopener,noreferrer');
                                          }
                                        }
                                      };
                                      
                                      return (
                                        <div 
                                          className="flex-1 min-w-0"
                                          onClick={handleLinkClick}
                                        >
                                          <FormattedIssueText 
                                            text={issue} 
                                            hasHTML={hasHTML} 
                                            processedHTML={processedHTML} 
                                          />
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 px-2.5 py-2 bg-[#21262d] rounded border border-[#30363d]">
                                <CheckCircle size={12} className="text-green-400 flex-shrink-0" />
                                <span className="text-xs text-gray-400 italic">No issues recorded</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    
                    // Default row layout for product tabs: 6 columns = ASIN/SKU, Title, Issues, [chosen1], [chosen2], View
                    const renderProductChosenCell = (colId) => {
                      if (colId === 'price') return <span className="text-xs font-medium text-gray-100 whitespace-nowrap">{product.price ? formatCurrencyWithLocale(parseFloat(product.price), currency, 2) : '—'}</span>;
                      if (colId === 'quantity') return <span className="text-xs font-semibold text-gray-100 whitespace-nowrap">{product.quantity !== undefined && product.quantity !== null ? parseInt(product.quantity).toLocaleString() : '—'}</span>;
                      if (colId === 'aPlus') return product.hasAPlus ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
                      if (colId === 'video') return product.hasVideo ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
                      if (colId === 'b2b') return product.has_b2b_pricing ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
                      if (colId === 'ads') return product.isTargetedInAds ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
                      if (colId === 'reviews') return <span className="text-xs text-gray-400 whitespace-nowrap">{product.numRatings ? parseInt(product.numRatings).toLocaleString() : '0'}</span>;
                      if (colId === 'starRating') return <span className="text-xs text-gray-100 whitespace-nowrap">{product.starRatings != null && product.starRatings !== '' ? `${typeof product.starRatings === 'number' ? product.starRatings.toFixed(1) : String(product.starRatings)} ⭐` : '—'}</span>;
                      return '—';
                    };
                    return (
                      <tr key={`${product.asin}-${index}`} className="border-b border-[#30363d]">
                        <td className="px-1.5 py-2 text-left align-top">
                          <div className="flex flex-col gap-1">
                            <code className="text-xs font-mono text-gray-100 break-all">{product.asin || '—'}</code>
                            <span className="text-xs text-gray-400 break-words">{product.sku || '—'}</span>
                          </div>
                        </td>
                        <td className="pl-1 pr-2 py-2 text-left align-top">
                          <span className="text-xs text-gray-100 break-words line-clamp-2" title={product.title}>
                            {product.title || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center align-top">
                          {(activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') ? (
                            <span
                              className={`text-xs font-medium ${product.status === 'Active' ? 'text-white' : 'text-gray-400'}`}
                            >
                              {product.status || '—'}
                            </span>
                          ) : product.status === 'Active' ? (() => {
                            const totalIssues = getTotalIssues(product);
                            const rankingIssues = countRankingIssues(product);
                            const conversionIssues = countConversionIssues(product);
                            const inventoryIssues = countInventoryIssues(product);
                            const badge = getIssuesBadge(totalIssues);
                            return (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border-2 ${
                                  totalIssues > 0 
                                    ? 'border-red-500 text-red-400' 
                                    : 'border-green-500 text-green-400'
                                }`}
                                title={totalIssues > 0 ? `Ranking: ${rankingIssues}, Conversion: ${conversionIssues}, Inventory: ${inventoryIssues}` : 'No issues'}
                              >
                                {totalIssues > 0 && <AlertTriangle size={12} />}
                                {badge.text}
                              </span>
                            );
                          })() : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center align-top">
                          {activeTab === 'withoutAPlus' ? (
                            product.hasAPlus ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />
                          ) : activeTab === 'notTargetedInAds' ? (
                            product.isTargetedInAds ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />
                          ) : (
                            renderProductChosenCell(selectedProductColumns[0])
                          )}
                        </td>
                        {activeTab === 'active' && (
                          <td className="px-2 py-2 text-center align-top">{renderProductChosenCell(selectedProductColumns[1])}</td>
                        )}
                        {activeTab === 'active' && (
                          <td className="px-2 py-2 text-center align-top">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate(`/seller-central-checker/${product.asin}`); }}
                              className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors"
                            >
                              View
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={
                      activeTab === 'optimization' ? optimizationTableColCount :
                      (activeTab === 'inactive' || activeTab === 'incomplete') ? 4 : 
                      productTableColCountForTab
                    } className="px-4 py-12 text-center text-gray-400">
                      {activeTab === 'optimization'
                        ? (optimizationProducts.length === 0 ? 'No optimization data yet. Data loads when you open this tab.' : 'No products match your current filters.')
                        : (products.length === 0 ? 'No products found. Please ensure your account is connected and data is synced.' : 'No products match your current filters.')}
                    </td>
                  </tr>
                )}
                
                {/* Loading row - shown when loading more products (not for optimization tab) */}
                {loadingMore && displayedProducts.length > 0 && activeTab !== 'optimization' && (
                  <tr>
                    <td colSpan={
                      (activeTab === 'inactive' || activeTab === 'incomplete') ? 4 : 
                      productTableColCountForTab
                    } className="px-4 py-8 text-center bg-[#21262d]">
                      <div className="flex items-center justify-center gap-3">
                        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm text-gray-400">Loading more products...</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          {/* Load More (hidden for Optimization tab - that tab shows full list from issues-by-product) */}
          {activeTab !== 'optimization' && hasMoreFromBackend && !loadingMore && (
            <div className="px-4 py-3 border-t border-[#30363d] bg-[#21262d] flex items-center justify-center gap-3">
              <button
                onClick={handleLoadMoreFromBackend}
                disabled={loadingMore}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Load More
                <ChevronDown size={16} />
              </button>
            </div>
          )}
          {activeTab === 'optimization' && displayedProducts.length > 0 && hasMoreOptimization && (
            <div className="px-4 py-3 border-t border-[#30363d] bg-[#21262d] flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={loadMoreOptimization}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors"
              >
                Load More
                <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YourProducts;
