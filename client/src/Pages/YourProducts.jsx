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
import { 
  // V3 optimized endpoints
  fetchYourProductsSummaryV3,
  fetchYourProductsActiveV3,
  fetchYourProductsInactiveV3,
  fetchYourProductsIncompleteV3,
  fetchYourProductsWithoutAPlusV3,
  fetchYourProductsNotTargetedInAdsV3,
  fetchOptimizationProductsV3
} from '../redux/slices/PageDataSlice.js';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import { SkeletonTableBody } from '../Components/Skeleton/PageSkeletons.jsx';

// Exactly 6 columns: 4 fixed (ASIN/SKU, Name, Issues or Recommendation, View) + 2 chosen from dropdown.
// Product tabs: pick 2 from this list to fill columns 5 and 6.
// NOTE: A+ Content and Targeted in Ads columns REMOVED for Active tab (V3 optimization)
const PRODUCT_SELECTABLE_COLUMNS = [
  { id: 'price', label: 'Price' },
  { id: 'quantity', label: 'Available Stocks' },
  { id: 'starRating', label: 'Ratings ⭐' },
  { id: 'video', label: 'Videos' },
  { id: 'b2b', label: 'B2B Pricing' },
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
const formatNumberedPoints = (text) => {
  if (!text) return [];
  if (!text.match(/(\s+|^)(\d+\)\s+|\(\d+\)\s+)/)) {
    return [text];
  }
  let processedText = text;
  const parenMatches = [];
  let parenIndex = 0;
  processedText = processedText.replace(/\(\d+\)\s+/g, (match) => {
    const marker = `__PAREN_MARKER_${parenIndex}__`;
    parenMatches[parenIndex] = match;
    parenIndex++;
    return marker;
  });
  const parts = processedText.split(/(?=\s+\d+\)\s+)/);
  const formatted = [];
  for (const part of parts) {
    let restored = part;
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
    const formattedPoints = formatNumberedPoints(processedHTML);
    if (formattedPoints.length > 1) {
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
    return (
      <div 
        className="text-sm text-gray-200 leading-relaxed flex-1 break-words whitespace-normal min-w-0 issues-content [&_a]:text-blue-400 [&_a]:hover:text-blue-300 [&_a]:underline [&_a]:font-medium [&_strong]:text-gray-100 [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{ __html: processedHTML }}
      />
    );
  }
  const formattedPoints = formatNumberedPoints(processedHTML);
  if (formattedPoints.length > 1) {
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
  return (
            <p className="text-sm text-gray-200 leading-relaxed flex-1 break-words whitespace-normal min-w-0 issues-content [&_strong]:text-gray-100 [&_strong]:font-semibold">
              {processedHTML}
            </p>
  );
};

const YourProducts = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });
  const [loadingMore, setLoadingMore] = useState(false);
  const itemsPerPage = 20;
  const [optimizationDisplayLimit, setOptimizationDisplayLimit] = useState(20);
  const fetchingRef = useRef(false);

  const [selectedProductColumns, setSelectedProductColumns] = useState(loadSelectedProductColumns);
  const [selectedOptimizationColumns, setSelectedOptimizationColumns] = useState(loadSelectedOptimizationColumns);
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef(null);

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

  // Optimization tab: V3 self-contained endpoint (backend generates recommendations)
  const v3Optimization = useSelector((state) => state.pageData?.yourProductsV3?.optimization);
  const optimizationProductsRaw = v3Optimization?.products || [];
  const optimizationLoading = v3Optimization?.loading || false;
  const optimizationPagination = v3Optimization?.pagination || {};
  
  // Backend now generates recommendations - just use products directly
  const optimizationProducts = optimizationProductsRaw;

  // ========== V3 OPTIMIZED: Separate endpoints, parallel calls ==========
  const v3Summary = useSelector((state) => state.pageData?.yourProductsV3?.summary);
  const v3Active = useSelector((state) => state.pageData?.yourProductsV3?.active);
  const v3Inactive = useSelector((state) => state.pageData?.yourProductsV3?.inactive);
  const v3Incomplete = useSelector((state) => state.pageData?.yourProductsV3?.incomplete);
  const v3WithoutAPlus = useSelector((state) => state.pageData?.yourProductsV3?.withoutAPlus);
  const v3NotTargetedInAds = useSelector((state) => state.pageData?.yourProductsV3?.notTargetedInAds);

  // Summary from v3
  const summary = useMemo(() => {
    return v3Summary?.data || {};
  }, [v3Summary?.data]);

  // Get current tab's data
  const currentTabData = useMemo(() => {
    switch (activeTab) {
      case 'active': return v3Active;
      case 'inactive': return v3Inactive;
      case 'incomplete': return v3Incomplete;
      case 'withoutAPlus': return v3WithoutAPlus;
      case 'notTargetedInAds': return v3NotTargetedInAds;
      default: return null;
    }
  }, [activeTab, v3Active, v3Inactive, v3Incomplete, v3WithoutAPlus, v3NotTargetedInAds]);

  const products = currentTabData?.products || [];
  const pagination = currentTabData?.pagination || {};
  const loading = currentTabData?.loading || false;
  const error = currentTabData?.error || null;

  // Initial load: fetch summary + active products in parallel
  useEffect(() => {
    const summaryLoaded = v3Summary?.data && v3Summary.lastFetched;
    const activeLoaded = v3Active?.products?.length > 0 && v3Active.lastFetched;
    
    if (!summaryLoaded && !v3Summary?.loading && !fetchingRef.current) {
      dispatch(fetchYourProductsSummaryV3());
    }
    if (!activeLoaded && !v3Active?.loading && !fetchingRef.current) {
      dispatch(fetchYourProductsActiveV3({ limit: itemsPerPage }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab switch: lazy load data for other tabs
  useEffect(() => {
    if (activeTab === 'active') return; // Already loaded initially
    
    if (activeTab === 'optimization') {
      const hasData = optimizationProductsRaw.length > 0;
      const lastFetched = v3Optimization?.lastFetched;
      const isStale = lastFetched && (Date.now() - lastFetched) > 15 * 60 * 1000;
      
      if ((!hasData || isStale) && !optimizationLoading) {
        dispatch(fetchOptimizationProductsV3({ limit: itemsPerPage }));
      }
      return;
    }
    
    // For other tabs, fetch if not cached
    const tabData = currentTabData;
    const hasData = tabData?.products?.length > 0;
    const lastFetched = tabData?.lastFetched;
    const isStale = lastFetched && (Date.now() - lastFetched) > 15 * 60 * 1000;
    
    if (!hasData || isStale) {
      if (!tabData?.loading) {
        switch (activeTab) {
          case 'inactive':
            dispatch(fetchYourProductsInactiveV3({ limit: itemsPerPage }));
            break;
          case 'incomplete':
            dispatch(fetchYourProductsIncompleteV3({ limit: itemsPerPage }));
            break;
          case 'withoutAPlus':
            dispatch(fetchYourProductsWithoutAPlusV3({ limit: itemsPerPage }));
            break;
          case 'notTargetedInAds':
            dispatch(fetchYourProductsNotTargetedInAdsV3({ limit: itemsPerPage }));
            break;
        }
      }
    }
  }, [dispatch, activeTab, currentTabData, optimizationProductsRaw, optimizationLoading, v3Optimization?.lastFetched]);

  // Handle loading more products
  const handleLoadMoreFromBackend = async () => {
    if (loadingMore || loading) return;
    
    // For optimization tab, use its own pagination
    if (activeTab === 'optimization') {
      const totalItems = optimizationPagination.totalItems || 0;
      if (optimizationProductsRaw.length >= totalItems) return;
      
      setLoadingMore(true);
      try {
        const currentPage = optimizationPagination.page || 1;
        const nextPage = currentPage + 1;
        await dispatch(fetchOptimizationProductsV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
        // After successfully loading more products, increase display limit to show them
        setOptimizationDisplayLimit(prev => prev + itemsPerPage);
      } catch (err) {
        console.error('[v3] Error loading more optimization products:', err);
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    
    const totalItems = pagination.totalItems || 0;
    if (products.length >= totalItems) return;
    
    setLoadingMore(true);
    try {
      const currentPage = pagination.page || 1;
      const nextPage = currentPage + 1;
      
      switch (activeTab) {
        case 'active':
          await dispatch(fetchYourProductsActiveV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
          break;
        case 'inactive':
          await dispatch(fetchYourProductsInactiveV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
          break;
        case 'incomplete':
          await dispatch(fetchYourProductsIncompleteV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
          break;
        case 'withoutAPlus':
          await dispatch(fetchYourProductsWithoutAPlusV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
          break;
        case 'notTargetedInAds':
          await dispatch(fetchYourProductsNotTargetedInAdsV3({ page: nextPage, limit: itemsPerPage, append: true })).unwrap();
          break;
      }
    } catch (err) {
      console.error('[v3] Error loading more products:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Show table skeleton
  const showTableSkeleton = useMemo(() => {
    if (activeTab === 'optimization') return optimizationLoading;
    return loading && products.length === 0;
  }, [activeTab, optimizationLoading, loading, products.length]);

  // Helper function to process HTML content in issues
  const processIssueHTML = useMemo(() => (issueText) => {
    if (!issueText || typeof issueText !== 'string') {
      return { hasHTML: false, processedHTML: issueText || '' };
    }
    const htmlTagPattern = /<[a-z][\s\S]*?>/i;
    const hasHTMLTags = htmlTagPattern.test(issueText);
    const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
    const hasURLs = urlPattern.test(issueText);
    if (!hasHTMLTags && !hasURLs) {
      return { hasHTML: false, processedHTML: issueText };
    }
    let processedHTML = issueText;
    processedHTML = processedHTML.replace(/<a\s+([^>]*?)>(.*?)<\/a>/gi, (match, attributes, linkText) => {
      const hrefMatch = attributes.match(/href=["']([^"']+)["']/i);
      const href = hrefMatch ? hrefMatch[1] : '#';
      const isCompleteUrl = href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//'));
      if (!isCompleteUrl && href !== '#') {
        return `<strong>${href}</strong>`;
      }
      const hasTarget = /target\s*=/i.test(attributes);
      const hasRel = /rel\s*=/i.test(attributes);
      const hasClass = /class\s*=/i.test(attributes);
      let newAttributes = attributes.trim();
      if (!hasTarget) newAttributes += ' target="_blank"';
      if (!hasRel) newAttributes += ' rel="noopener noreferrer"';
      newAttributes += ' data-external-link="true"';
      if (!hasClass) {
        newAttributes += ' class="text-blue-600 hover:text-blue-800 underline font-medium"';
      } else {
        newAttributes = newAttributes.replace(/class=["']([^"']+)["']/i, 'class="$1 text-blue-600 hover:text-blue-800 underline font-medium"');
      }
      return `<a ${newAttributes}>${linkText}</a>`;
    });
    processedHTML = processedHTML.replace(/<br\s*\/?>/gi, '<br />');
    processedHTML = processedHTML.replace(/<hr\s*\/?>/gi, '<hr />');
    processedHTML = processedHTML.replace(/(<p[^>]*>)/gi, '<br />$1');
    processedHTML = processedHTML.replace(/(<\/p>)/gi, '$1<br />');
    const tagPlaceholders = [];
    let placeholderIndex = 0;
    processedHTML = processedHTML.replace(/<(a|strong)[^>]*>.*?<\/(a|strong)>/gi, (match) => {
      const placeholder = `__TAG_PLACEHOLDER_${placeholderIndex}__`;
      tagPlaceholders[placeholderIndex] = match;
      placeholderIndex++;
      return placeholder;
    });
    processedHTML = processedHTML.replace(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi, (match) => {
      let fullUrl = match;
      if (match.startsWith('www.')) fullUrl = 'https://' + match;
      return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" data-external-link="true" class="text-blue-600 hover:text-blue-800 underline font-medium">${match}</a>`;
    });
    tagPlaceholders.forEach((originalTag, index) => {
      processedHTML = processedHTML.replace(`__TAG_PLACEHOLDER_${index}__`, originalTag);
    });
    return { hasHTML: true, processedHTML };
  }, [currentRegion]);

  // Filter products based on search and sort
  const filteredProducts = useMemo(() => {
    let filtered = [...products];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(product => 
        product.asin?.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.title?.toLowerCase().includes(query)
      );
    }
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (sortConfig.key === 'price' || sortConfig.key === 'numRatings' || sortConfig.key === 'starRatings' || sortConfig.key === 'quantity') {
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
  }, [products, searchQuery, sortConfig]);

  // Optimization tab filtering
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

  const displayedOptimizationProducts = useMemo(() => {
    if (activeTab !== 'optimization') return [];
    return filteredOptimizationProducts.slice(0, optimizationDisplayLimit);
  }, [activeTab, filteredOptimizationProducts, optimizationDisplayLimit]);

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

  const displayedProducts = activeTab === 'optimization' ? displayedOptimizationProducts : filteredProducts;
  
  // Optimization: client-side display limit (for already loaded products)
  const hasMoreOptimizationClientSide = activeTab === 'optimization' && optimizationDisplayLimit < filteredOptimizationProducts.length;
  const loadMoreOptimization = () => setOptimizationDisplayLimit(prev => prev + itemsPerPage);
  
  // Optimization: backend pagination (when server has more products)
  // Show backend Load More when: we've displayed all loaded products AND there are more on server
  const optimizationTotalItems = optimizationPagination.totalItems || 0;
  const allLoadedProductsDisplayed = optimizationDisplayLimit >= filteredOptimizationProducts.length;
  const hasMoreOptimizationFromBackend = activeTab === 'optimization' && allLoadedProductsDisplayed && optimizationProductsRaw.length < optimizationTotalItems;

  const productTableColCount = 6;
  const optimizationTableColCount = 6;
  const chosenColumnWidth = '16.67%';
  const productFixedWidths = { asin: '14%', title: '28%', issues: '18%', view: '10%' };
  const optimizationFixedWidths = { asin: '14%', title: '28%', recommendation: '22%', view: '10%' };
  
  const totalItems = pagination.totalItems || 0;
  const hasMoreFromBackend = pagination.hasMore && products.length < totalItems;

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Active':
        return { bg: '#d1fae5', color: '#065f46', icon: <CheckCircle size={12} /> };
      case 'Inactive':
        return { bg: '#fee2e2', color: '#991b1b', icon: <XCircle size={12} /> };
      case 'Incomplete':
        return { bg: '#fef3c7', color: '#92400e', icon: <AlertCircle size={12} /> };
      default:
        return { bg: '#f1f5f9', color: '#475569', icon: null };
    }
  };

  const getIssuesBadge = (totalIssues) => {
    if (totalIssues === null || totalIssues === undefined) {
      return { bg: '#f1f5f9', color: '#94a3b8', text: '—' };
    }
    if (totalIssues === 0) {
      return { bg: '#d1fae5', color: '#065f46', text: '0' };
    }
    if (totalIssues >= 5) {
      return { bg: '#fee2e2', color: '#991b1b', text: totalIssues.toString() };
    }
    if (totalIssues >= 2) {
      return { bg: '#fef3c7', color: '#92400e', text: totalIssues.toString() };
    }
    return { bg: '#dbeafe', color: '#1e40af', text: totalIssues.toString() };
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'ASIN', 'SKU', 'Title', 'Status', 'Price', 'Reviews', 'Ratings', 'Quantity', 'Issue Count'
    ];
    const csvRows = [
      headers.join(','),
      ...filteredProducts.map(product => {
        return [
          product.asin,
          `"${(product.sku || '').replace(/"/g, '""')}"`,
          `"${(product.title || '').replace(/"/g, '""')}"`,
          product.status,
          product.price,
          product.numRatings || 0,
          product.starRatings || 0,
          product.quantity || 0,
          product.issueCount || 0
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
        .issues-cell { max-width: 0; overflow: hidden; }
        .issues-content { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .issues-content a { word-break: break-all; overflow-wrap: anywhere; }
        table { max-width: 100%; }
        table th, table td { word-wrap: break-word; overflow-wrap: break-word; overflow: visible; }
        .max-w-7xl { max-width: 100%; overflow-x: hidden; overflow-y: visible; }
        table thead { position: relative; }
        table thead th { overflow: visible !important; position: relative; }
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
          {v3Summary?.loading && !summary.totalProducts ? (
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
                <div className="text-lg font-bold text-white">{summary.productsWithoutAPlus || 0}</div>
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

        {/* Info Box */}
        <div className="bg-blue-500/10 border-l-4 border-blue-500/40 p-2 mb-2 rounded-r space-y-3">
          <div className="flex items-start gap-2">
            <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
            <div>
              <h3 className="text-xs font-semibold text-blue-300 mb-0.5">Customize table columns</h3>
              <p className="text-xs text-blue-400">
                Use the <strong>Columns</strong> dropdown next to the search bar (on Active and Optimization tabs) to choose up to 2 extra columns.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
            <div>
              <h3 className="text-xs font-semibold text-blue-300 mb-0.5">View button</h3>
              <p className="text-xs text-blue-400">
                Click <strong>View</strong> in any row to open that product's detail page.
              </p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-[#161b22] rounded border border-[#30363d] p-2 mb-2">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
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
            { key: 'optimization', label: 'Optimization', count: null },
            { key: 'withoutAPlus', label: 'Without A+', count: summary.productsWithoutAPlus || 0 },
            { key: 'notTargetedInAds', label: 'Not Targeted to Ads', count: summary.productsNotTargetedInAds || 0 },
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
              {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>

        {/* Products Table */}
        <div className="bg-[#161b22] rounded-b border border-[#30363d] relative" style={{ overflowX: 'hidden', overflowY: 'visible', overflow: 'visible' }}>
          {showTableSkeleton ? (
            <div className="p-2">
              <SkeletonTableBody rows={10} />
            </div>
          ) : (
          <div className="w-full" style={{ overflowX: 'hidden', overflowY: 'visible', maxWidth: '100%' }}>
            <table className="w-full" style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }}>
              <thead className="bg-[#21262d]">
                <tr>
                  {activeTab === 'optimization' ? (
                    <>
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: optimizationFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: optimizationFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedOptimizationColumns[0])}>{OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id === selectedOptimizationColumns[0])?.label ?? selectedOptimizationColumns[0]} {sortConfig.key === selectedOptimizationColumns[0] && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedOptimizationColumns[1])}>{OPTIMIZATION_SELECTABLE_COLUMNS.find(c => c.id === selectedOptimizationColumns[1])?.label ?? selectedOptimizationColumns[1]} {sortConfig.key === selectedOptimizationColumns[1] && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: optimizationFixedWidths.recommendation }}>Recommendation</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: optimizationFixedWidths.view }}>View</th>
                    </>
                  ) : (activeTab === 'inactive' || activeTab === 'incomplete') ? (
                    <>
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: '10%' }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: '29%' }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '8%' }}>B2B Pricing</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '53%' }}>Issues</th>
                    </>
                  ) : activeTab === 'active' ? (
                    <>
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.asin }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.title }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: productFixedWidths.issues }} onClick={() => handleSort('issueCount')}>Issues {sortConfig.key === 'issueCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedProductColumns[0] === 'reviews' ? 'numRatings' : selectedProductColumns[0] === 'starRating' ? 'starRatings' : selectedProductColumns[0])}>{PRODUCT_SELECTABLE_COLUMNS.find(c => c.id === selectedProductColumns[0])?.label ?? selectedProductColumns[0]} {sortConfig.key === (selectedProductColumns[0] === 'reviews' ? 'numRatings' : selectedProductColumns[0] === 'starRating' ? 'starRatings' : selectedProductColumns[0]) && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: chosenColumnWidth }} onClick={() => handleSort(selectedProductColumns[1] === 'reviews' ? 'numRatings' : selectedProductColumns[1] === 'starRating' ? 'starRatings' : selectedProductColumns[1])}>{PRODUCT_SELECTABLE_COLUMNS.find(c => c.id === selectedProductColumns[1])?.label ?? selectedProductColumns[1]} {sortConfig.key === (selectedProductColumns[1] === 'reviews' ? 'numRatings' : selectedProductColumns[1] === 'starRating' ? 'starRatings' : selectedProductColumns[1]) && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: productFixedWidths.view }}>View</th>
                    </>
                  ) : (activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') ? (
                    <>
                      <th className="px-1.5 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: '12%' }} onClick={() => handleSort('asin')}>ASIN/SKU {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="pl-1 pr-2 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: '48%' }} onClick={() => handleSort('title')}>Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300 border-b border-[#30363d]" style={{ width: '15%' }} onClick={() => handleSort('status')}>Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '15%' }}>{activeTab === 'withoutAPlus' ? 'A+' : 'Ads'}</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#30363d]" style={{ width: '10%' }}>View</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {displayedProducts.length > 0 ? (
                  displayedProducts.map((product, index) => {
                    const statusBadge = getStatusBadge(product.status);
                    
                    // Optimization tab
                    if (activeTab === 'optimization') {
                      const perf = product.performance || {};
                      const rec = product.primaryRecommendation;
                      return (
                        <tr key={`opt-${product.asin}-${index}`} onClick={() => navigate(`/seller-central-checker/${product.asin}`)} className="border-b border-[#30363d] hover:bg-[#21262d] cursor-pointer transition-colors">
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
                                  <span className="text-xs text-gray-400 bg-gray-700/50 px-1.5 py-0.5 rounded" title={`${product.recommendations.length - 1} more`}>+{product.recommendations.length - 1}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/seller-central-checker/${product.asin}`); }} className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors">View</button>
                          </td>
                        </tr>
                      );
                    }
                    
                    // Inactive/Incomplete tabs
                    if (activeTab === 'inactive' || activeTab === 'incomplete') {
                      const issueCount = product.issues?.length || 0;
                      return (
                        <tr key={`${product.asin}-${index}`} className="border-b border-[#30363d]">
                          <td className="px-1.5 py-2 text-left align-top">
                            <div className="flex flex-col gap-1 items-start">
                              <code className="text-xs font-mono text-gray-100 bg-[#21262d] px-1.5 py-0.5 rounded break-all">{product.asin || '—'}</code>
                              <span className="text-xs font-medium text-gray-400 break-words">{product.sku || '—'}</span>
                            </div>
                          </td>
                          <td className="pl-1 pr-2 py-2 text-left align-top">
                            <span className="text-sm text-gray-100 font-medium leading-relaxed block break-words">{product.title || '—'}</span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            {product.has_b2b_pricing ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />}
                          </td>
                          <td className="px-2 py-2 text-left align-top issues-cell">
                            {issueCount > 0 ? (
                              <div className="space-y-2 issues-content">
                                {product.issues.map((issue, issueIndex) => {
                                  const { hasHTML, processedHTML } = processIssueHTML(issue);
                                  return (
                                    <div key={issueIndex} className="flex items-start gap-2.5 p-2.5 bg-[#21262d] border border-[#30363d] rounded hover:border-yellow-500/40 hover:bg-[#1c2128] transition-all min-w-0">
                                      <div className="flex-shrink-0 mt-0.5">
                                        <AlertTriangle size={14} className="text-yellow-400" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <FormattedIssueText text={issue} hasHTML={hasHTML} processedHTML={processedHTML} />
                                      </div>
                                    </div>
                                  );
                                })}
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
                    
                    // Active tab (no A+/Ads columns)
                    if (activeTab === 'active') {
                      const issueCount = product.issueCount || 0;
                      const badge = getIssuesBadge(issueCount);
                      const renderProductChosenCell = (colId) => {
                        if (colId === 'price') return <span className="text-xs font-medium text-gray-100 whitespace-nowrap">{product.price ? formatCurrencyWithLocale(parseFloat(product.price), currency, 2) : '—'}</span>;
                        if (colId === 'quantity') return <span className="text-xs font-semibold text-gray-100 whitespace-nowrap">{product.quantity !== undefined && product.quantity !== null ? parseInt(product.quantity).toLocaleString() : '—'}</span>;
                        if (colId === 'video') return product.hasVideo ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
                        if (colId === 'b2b') return product.has_b2b_pricing ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />;
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
                            <span className="text-xs text-gray-100 break-words line-clamp-2" title={product.title}>{product.title || '—'}</span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border-2 ${issueCount > 0 ? 'border-red-500 text-red-400' : 'border-green-500 text-green-400'}`}>
                              {issueCount > 0 && <AlertTriangle size={12} />}
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">{renderProductChosenCell(selectedProductColumns[0])}</td>
                          <td className="px-2 py-2 text-center align-top">{renderProductChosenCell(selectedProductColumns[1])}</td>
                          <td className="px-2 py-2 text-center align-top">
                            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/seller-central-checker/${product.asin}`); }} className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors">View</button>
                          </td>
                        </tr>
                      );
                    }
                    
                    // Without A+ and Not Targeted to Ads tabs
                    if (activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') {
                      return (
                        <tr key={`${product.asin}-${index}`} className="border-b border-[#30363d]">
                          <td className="px-1.5 py-2 text-left align-top">
                            <div className="flex flex-col gap-1">
                              <code className="text-xs font-mono text-gray-100 break-all">{product.asin || '—'}</code>
                              <span className="text-xs text-gray-400 break-words">{product.sku || '—'}</span>
                            </div>
                          </td>
                          <td className="pl-1 pr-2 py-2 text-left align-top">
                            <span className="text-xs text-gray-100 break-words line-clamp-2" title={product.title}>{product.title || '—'}</span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <span className={`text-xs font-medium ${product.status === 'Active' ? 'text-white' : 'text-gray-400'}`}>{product.status || '—'}</span>
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            {activeTab === 'withoutAPlus' ? (
                              product.hasAPlus ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />
                            ) : (
                              product.isTargetedInAds ? <Check size={16} className="text-green-400 font-bold mx-auto" strokeWidth={3} /> : <X size={16} className="text-red-400 font-bold mx-auto" strokeWidth={3} />
                            )}
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/seller-central-checker/${product.asin}`); }} className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors">View</button>
                          </td>
                        </tr>
                      );
                    }
                    
                    return null;
                  })
                ) : (
                  <tr>
                    <td colSpan={activeTab === 'optimization' ? optimizationTableColCount : (activeTab === 'inactive' || activeTab === 'incomplete') ? 4 : (activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') ? 5 : productTableColCount} className="px-4 py-12 text-center text-gray-400">
                      {activeTab === 'optimization'
                        ? (optimizationProducts.length === 0 ? 'No optimization data yet. Data loads when you open this tab.' : 'No products match your current filters.')
                        : (products.length === 0 ? 'No products found. Please ensure your account is connected and data is synced.' : 'No products match your current filters.')}
                    </td>
                  </tr>
                )}
                
                {loadingMore && displayedProducts.length > 0 && activeTab !== 'optimization' && (
                  <tr>
                    <td colSpan={(activeTab === 'inactive' || activeTab === 'incomplete') ? 4 : (activeTab === 'withoutAPlus' || activeTab === 'notTargetedInAds') ? 5 : productTableColCount} className="px-4 py-8 text-center bg-[#21262d]">
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

          {activeTab !== 'optimization' && hasMoreFromBackend && !loadingMore && (
            <div className="px-4 py-3 border-t border-[#30363d] bg-[#21262d] flex items-center justify-center gap-3">
              <button onClick={handleLoadMoreFromBackend} disabled={loadingMore} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Load More
                <ChevronDown size={16} />
              </button>
            </div>
          )}
          {activeTab === 'optimization' && displayedProducts.length > 0 && (hasMoreOptimizationClientSide || hasMoreOptimizationFromBackend) && (
            <div className="px-4 py-3 border-t border-[#30363d] bg-[#21262d] flex items-center justify-center gap-3">
              {hasMoreOptimizationClientSide ? (
                <button type="button" onClick={loadMoreOptimization} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors">
                  Load More
                  <ChevronDown size={16} />
                </button>
              ) : hasMoreOptimizationFromBackend && !loadingMore ? (
                <button type="button" onClick={handleLoadMoreFromBackend} disabled={loadingMore} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Load More
                  <ChevronDown size={16} />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YourProducts;
