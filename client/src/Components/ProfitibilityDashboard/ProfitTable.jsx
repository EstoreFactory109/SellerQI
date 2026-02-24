import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Check, AlertTriangle, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Table, TrendingDown, DollarSign, Package, Target, Loader2, CheckCircle2, Calendar } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { setCogsValue, fetchCogs, saveCogsToDb, selectCogsSaving, selectSavedCogsValues } from '../../redux/slices/cogsSlice';
import { updateProfitabilityErrors } from '../../redux/slices/errorsSlice';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils';
import { parseLocalDate } from '../../utils/dateUtils';
import axiosInstance from '../../config/axios.config';
import { SkeletonBar } from '../Skeleton/Skeleton.jsx';

// Currency symbol mapping by country code
const CURRENCY_SYMBOLS = {
  US: '$',
  CA: 'CA$',
  MX: 'MX$',
  BR: 'R$',
  UK: '£',
  GB: '£',
  DE: '€',
  FR: '€',
  IT: '€',
  ES: '€',
  NL: '€',
  BE: '€',
  SE: 'kr',
  PL: 'zł',
  JP: '¥',
  AU: 'A$',
  SG: 'S$',
  IN: '₹',
  AE: 'AED',
  SA: 'SAR',
  TR: '₺',
  EG: 'E£',
};

const ProfitTable = ({ 
    setSuggestionsData,
    // Phased loading props (server-side pagination)
    phasedTableData = null,
    tablePagination = null,
    tableLoading = false,
    hasMore = false,
    currentPage: serverCurrentPage = 1,
    totalPages: serverTotalPages = 1,
    totalItems: serverTotalItems = 0,
    // Total counts across ALL data (not page-wise)
    totalParents: serverTotalParents = 0,
    totalChildren: serverTotalChildren = 0,
    totalProducts: serverTotalProducts = 0,
    onLoadMore = null,
    onPageChange = null
}) => {
    // Use phased loading if pagination handler is provided (indicates phased loading mode)
    // This prevents falling back to legacy data while waiting for server response
    const usePhasedLoading = onPageChange !== null || tablePagination !== null;
    
    // Check if phased data is actually loaded (not just in phased mode)
    const hasPhasedData = phasedTableData !== null && phasedTableData.length > 0;
    
    const [localCurrentPage, setLocalCurrentPage] = useState(1);
    const [expandedRows, setExpandedRows] = useState(new Set());
    const dispatch = useDispatch();
    const productsPerPage = 10;
    
    // State for ASIN-wise sales data (fetched separately for big accounts)
    const [asinWiseSalesData, setAsinWiseSalesData] = useState([]);
    const [isLoadingAsinData, setIsLoadingAsinData] = useState(false);
    const [asinDataError, setAsinDataError] = useState(null);
    
    // Ref to track last processed economicsMetrics to prevent infinite loops
    const lastProcessedMetricsRef = useRef(null);
    // Ref to track last dispatched errors to prevent infinite loops
    const lastDispatchedErrorsRef = useRef(null);
    // Ref to track last processedProducts to prevent unnecessary effect runs
    const lastProcessedProductsRef = useRef(null);
    
    // Get profitability data from Redux store
    const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
    const totalProducts = useSelector((state) => state.Dashboard.DashBoardInfo?.TotalProduct) || [];
    
    // Get EconomicsMetrics data from Redux store (preferred source for fees and gross profit)
    // Note: Backend returns 'economicsMetrics' (lowercase 'e')
    const economicsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.economicsMetrics);
    
    // Get date filter state from Redux
    const calendarMode = useSelector(state => state.Dashboard.DashBoardInfo?.calendarMode);
    const startDate = useSelector(state => state.Dashboard.DashBoardInfo?.startDate);
    const endDate = useSelector(state => state.Dashboard.DashBoardInfo?.endDate);
    
    // Check if date range is selected
    const isDateRangeSelected = (calendarMode === 'custom' || calendarMode === 'last7') && startDate && endDate;
    
    // Fetch ASIN-wise sales data for big accounts
    // When economicsMetrics.isBig is true, the asinWiseSales array is empty to save memory
    // We need to fetch it from a separate endpoint
    // Also check if totalSales > 5000 and asinWiseSales is empty (for legacy data before isBig was added)
    useEffect(() => {
        const fetchAsinWiseSalesForBigAccount = async () => {
            // If economicsMetrics is not available yet, try to fetch from endpoint anyway
            if (!economicsMetrics) {
                // Try fetching directly - might be a big account or data might be available
                try {
                    const response = await axiosInstance.get('/api/pagewise/asin-wise-sales');
                    // ApiResponse returns statusCode (not success) - check for 200 statusCode
                    if (response.data?.statusCode === 200 && response.data?.data?.asinWiseSales) {
                        setAsinWiseSalesData(response.data.data.asinWiseSales);
                        return;
                    }
                } catch (error) {
                    // Silently fail - will retry when economicsMetrics is available
                }
                return;
            }
            
            // Create a stable key to compare if we've already processed this data
            const isBig = economicsMetrics?.isBig;
            const asinLength = economicsMetrics?.asinWiseSales?.length || 0;
            const totalSales = economicsMetrics?.totalSales?.amount || 0;
            const metricsKey = `${isBig}_${asinLength}_${totalSales}`;
            
            // Skip if we've already processed this exact data
            if (lastProcessedMetricsRef.current === metricsKey) {
                return;
            }
            
            const hasAsinData = asinLength > 0;
            const isBigAccount = isBig === true;
            
            // Check if we need to fetch data from the API
            // Fetch if:
            // - No ASIN data in Redux (always try to fetch if empty)
            // - Explicitly marked as big (isBig=true)
            // - OR has high totalSales (>5000) but empty asinWiseSales
            const needsFetch = !hasAsinData;  // Always fetch if no data in Redux
            
            if (needsFetch) {
                setIsLoadingAsinData(true);
                setAsinDataError(null);
                
                try {
                    const response = await axiosInstance.get('/api/pagewise/asin-wise-sales');
                    
                    // ApiResponse returns statusCode (not success) - check for 200 statusCode
                    if (response.data?.statusCode === 200 && response.data?.data?.asinWiseSales) {
                        const fetchedData = response.data.data.asinWiseSales;
                        setAsinWiseSalesData(fetchedData);
                        lastProcessedMetricsRef.current = metricsKey;
                    } else {
                        setAsinWiseSalesData([]);
                        lastProcessedMetricsRef.current = metricsKey;
                    }
                } catch (error) {
                    setAsinDataError(error.message);
                    setAsinWiseSalesData([]);
                    lastProcessedMetricsRef.current = metricsKey;
                } finally {
                    setIsLoadingAsinData(false);
                }
            } else if (hasAsinData) {
                // Normal account with data - use data from Redux
                // Set the data directly - the metricsKey check above already prevents redundant processing
                setAsinWiseSalesData(economicsMetrics.asinWiseSales);
                lastProcessedMetricsRef.current = metricsKey;
            } else {
                // No data case - mark as processed
                lastProcessedMetricsRef.current = metricsKey;
            }
        };
        
        fetchAsinWiseSalesForBigAccount();
    }, [economicsMetrics, economicsMetrics?.isBig, economicsMetrics?.asinWiseSales?.length, economicsMetrics?.totalSales?.amount]);
    
    // Calculate total active products
    const totalActiveProducts = totalProducts.filter(product => product.status === "Active").length;
    
    // Get COGs values from Redux store
    const cogsValues = useSelector((state) => state.cogs.cogsValues);
    const savedCogsValues = useSelector(selectSavedCogsValues);
    const cogsSaving = useSelector(selectCogsSaving);
    const cogsLoading = useSelector((state) => state.cogs.loading);
    
    // Get currency and country from Redux
    const currency = useSelector(state => state.currency?.currency) || '$';
    const country = useSelector(state => state.currency?.country);
    
    // Get the currency symbol for COGS input based on country
    const cogsCurrencySymbol = useMemo(() => {
      if (country && CURRENCY_SYMBOLS[country]) {
        return CURRENCY_SYMBOLS[country];
      }
      return currency || '$';
    }, [country, currency]);

    // Fetch COGS from database on component mount
    useEffect(() => {
      dispatch(fetchCogs());
    }, [dispatch]);

    // Handle COGS input change (local state only)
    const handleCogsChange = (asin, value) => {
      const numValue = parseFloat(value) || 0;
      dispatch(setCogsValue({ asin, value: numValue }));
    };

    // Handle save COGS to database
    const handleSaveCogs = async (asin, sku) => {
      const cogsValue = cogsValues[asin];
      if (cogsValue !== undefined && cogsValue !== null) {
        dispatch(saveCogsToDb({ asin, sku, cogs: cogsValue }));
      }
    };

    // Check if a COGS value needs to be saved
    const needsSave = (asin) => {
      const currentValue = cogsValues[asin];
      const savedValue = savedCogsValues[asin];
      return currentValue !== undefined && 
             currentValue !== null && 
             currentValue !== '' && 
             currentValue !== savedValue;
    };

    // Check if a COGS value is saved
    const isSaved = (asin) => {
      const currentValue = cogsValues[asin];
      const savedValue = savedCogsValues[asin];
      return currentValue !== undefined && 
             currentValue !== null && 
             currentValue !== '' && 
             currentValue === savedValue;
    };
    
    // Toggle expanded state for a row
    const toggleExpanded = (asin) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(asin)) {
                newSet.delete(asin);
            } else {
                newSet.add(asin);
            }
            return newSet;
        });
    };
    
    // Format date for display
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    
    
    /**
     * MAIN DATA PROCESSING:
     * 
     * PHASED LOADING (NEW):
     * When phasedTableData is provided, use server-side processed data directly.
     * This is pre-calculated and paginated on the backend for fast loading.
     * 
     * LEGACY LOADING:
     * 1. Get all asinWiseSales from economicsMetrics
     * 2. Filter by date range if selected
     * 3. Aggregate by ASIN to get totals
     * 4. Group by parentAsin - show parent first, children on expand
     */
    const processedProducts = useMemo(() => {
        // PHASED LOADING MODE: If we're in phased loading mode, ONLY use phased data
        // This prevents flashing legacy data while waiting for server response
        if (usePhasedLoading) {
            // If phased data hasn't arrived yet, return empty array (skeleton will show)
            if (!hasPhasedData) {
                return [];
            }
            
            // Helper to transform a product (parent or child) to display format
            const transformProduct = (product) => {
                const cogsPerUnit = cogsValues[product.asin] || 0;
                const quantity = product.quantity ?? 0;
                const totalCogs = cogsPerUnit * quantity;
                const netProfit = (product.grossProfit || 0) - totalCogs;
                const netMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
                
                return {
                    ...product,
                    name: product.itemName || product.name || `Product ${product.asin}`,
                    units: quantity,
                    cogsPerUnit,
                    totalCogs,
                    netProfit,
                    netMargin,
                    profitStatus: product.grossProfit >= 0 ? 'profitable' : 'unprofitable',
                    source: product.source || 'economicsMetrics',
                    adSpend: product.ads,
                    fees: product.totalFees ?? product.amzFee,
                    amazonFees: product.amazonFees ?? product.amzFee,
                    fbaFees: product.fbaFees,
                    storageFees: product.storageFees,
                    status: netMargin < 0 ? 'bad' : netMargin < 10 ? 'warn' : 'good'
                };
            };
            
            // Transform server data including children
            return phasedTableData.map(product => {
                const transformed = transformProduct(product);
                
                // Transform children if present
                if (product.children && product.children.length > 0) {
                    transformed.children = product.children.map(child => transformProduct(child));
                    // Parent row: show Ad Spend, Amz Fees, and total fees as sum of parent + all children (like amz fees).
                    const childAdSpend = transformed.children.reduce((sum, c) => sum + (Number(c.adSpend) || 0), 0);
                    const childAmazonFees = transformed.children.reduce((sum, c) => sum + (Number(c.amazonFees) || 0), 0);
                    const childFees = transformed.children.reduce((sum, c) => sum + (Number(c.fees) || 0), 0);
                    transformed.adSpend = (Number(transformed.adSpend) || 0) + childAdSpend;
                    transformed.amazonFees = (Number(transformed.amazonFees) || 0) + childAmazonFees;
                    transformed.fees = (Number(transformed.fees) || 0) + childFees;
                    // Recalculate parent gross profit: sales - fees - adSpend (totals including children)
                    const sales = Number(transformed.sales) || 0;
                    const fees = Number(transformed.fees) || 0;
                    const adSpend = Number(transformed.adSpend) || 0;
                    transformed.grossProfit = sales - fees - adSpend;
                } else {
                    transformed.children = [];
                }
                
                // Preserve parent-child structure from server
                transformed.isParent = product.isParent ?? true;
                transformed.isExpandable = product.isExpandable ?? (transformed.children.length > 0);
                transformed.childrenCount = product.childrenCount ?? transformed.children.length;
                
                return transformed;
            });
        }
        
        // LEGACY LOADING: Process data client-side (only when NOT in phased loading mode)
        // Create a map of ASIN to product details for quick lookup
        const productDetailsMap = new Map();
        totalProducts.forEach(product => {
            productDetailsMap.set(product.asin, product);
        });
        
        // Helper function to create product object
        const createProductObject = (asin, agg, productDetails) => {
            const cogsPerUnit = cogsValues[asin] || 0;
            const totalCogs = cogsPerUnit * agg.unitsSold;
            const netProfit = agg.grossProfit - totalCogs;
            
            let status = 'good';
            const profitMargin = agg.sales > 0 ? (netProfit / agg.sales) * 100 : 0;
            if (profitMargin < 10 && profitMargin >= 0) status = 'warn';
            if (profitMargin < 0) status = 'bad';
            
            return {
                name: productDetails.itemName || productDetails.title || `Product ${asin}`,
                asin: asin,
                parentAsin: agg.parentAsin,
                sku: productDetails.sku || '',
                units: agg.unitsSold,
                sales: agg.sales,
                cogsPerUnit: cogsPerUnit,
                totalCogs: totalCogs,
                adSpend: agg.ppcSpent,
                fees: agg.totalFees,
                amazonFees: agg.amazonFees,
                fbaFees: agg.fbaFees,
                storageFees: agg.storageFees,
                grossProfit: agg.grossProfit,
                netProfit: netProfit,
                refunds: agg.refunds,
                status: status
            };
        };
        
        // Use asinWiseSalesData (either from Redux for normal accounts, or fetched separately for big accounts)
        if (asinWiseSalesData && Array.isArray(asinWiseSalesData) && asinWiseSalesData.length > 0) {
            const asinWiseSales = asinWiseSalesData;
            
            // Check if data has dates (for daily breakdown)
            const hasDateData = asinWiseSales.some(item => item.date);
            
            // Step 1: Filter by date range if applicable
            let filteredData = asinWiseSales;
                if (isDateRangeSelected && hasDateData) {
                    const start = parseLocalDate(startDate);
                    const end = parseLocalDate(endDate);
                    start.setHours(0, 0, 0, 0);
                    end.setHours(23, 59, 59, 999);
                    
                    filteredData = asinWiseSales.filter(item => {
                        if (!item.date) return true;
                        const itemDate = new Date(item.date);
                        return itemDate >= start && itemDate <= end;
                    });
                }
            
            // Step 2: Aggregate by child ASIN first
            const asinAggregates = new Map();
            
            filteredData.forEach(item => {
                const asin = item.asin;
                if (!asin) return;
                
                if (!asinAggregates.has(asin)) {
                    asinAggregates.set(asin, {
                        asin: asin,
                        parentAsin: item.parentAsin || asin, // Default to self if no parent
                        sales: 0,
                        grossProfit: 0,
                        unitsSold: 0,
                        ppcSpent: 0,
                        fbaFees: 0,
                        storageFees: 0,
                        totalFees: 0,
                        amazonFees: 0,
                        refunds: 0,
                        currencyCode: item.sales?.currencyCode || 'USD'
                    });
                }
                
                const agg = asinAggregates.get(asin);
                agg.sales += item.sales?.amount || 0;
                agg.grossProfit += item.grossProfit?.amount || 0;
                agg.unitsSold += item.unitsSold || 0;
                agg.ppcSpent += item.ppcSpent?.amount || 0;
                agg.fbaFees += item.fbaFees?.amount || 0;
                agg.storageFees += item.storageFees?.amount || 0;
                agg.totalFees += item.totalFees?.amount || 0;
                agg.amazonFees += item.amazonFees?.amount || 0;
                agg.refunds += item.refunds?.amount || 0;
            });
            
            // Step 3: Group by parentAsin
            const parentGroups = new Map();
            
            asinAggregates.forEach((agg, asin) => {
                const parentAsin = agg.parentAsin || asin;
                
                if (!parentGroups.has(parentAsin)) {
                    parentGroups.set(parentAsin, {
                        parentAsin: parentAsin,
                        children: [],
                        // Aggregated totals for parent
                        totalSales: 0,
                        totalGrossProfit: 0,
                        totalUnitsSold: 0,
                        totalPpcSpent: 0,
                        totalFbaFees: 0,
                        totalStorageFees: 0,
                        totalFees: 0,
                        totalAmazonFees: 0,
                        totalRefunds: 0
                    });
                }
                
                const parent = parentGroups.get(parentAsin);
                
                // Add this ASIN as a child (including the parent ASIN itself if it has sales)
                parent.children.push({
                    ...agg,
                    productDetails: productDetailsMap.get(asin) || {}
                });
                
                // Aggregate totals
                parent.totalSales += agg.sales;
                parent.totalGrossProfit += agg.grossProfit;
                parent.totalUnitsSold += agg.unitsSold;
                parent.totalPpcSpent += agg.ppcSpent;
                parent.totalFbaFees += agg.fbaFees;
                parent.totalStorageFees += agg.storageFees;
                parent.totalFees += agg.totalFees;
                parent.totalAmazonFees += agg.amazonFees;
                parent.totalRefunds += agg.refunds;
            });
            
            // Step 4: Convert to display format
            const products = [];
            
            parentGroups.forEach((parent, parentAsin) => {
                const productDetails = productDetailsMap.get(parentAsin) || {};
                const cogsPerUnit = cogsValues[parentAsin] || 0;
                const totalCogs = cogsPerUnit * parent.totalUnitsSold;
                const netProfit = parent.totalGrossProfit - totalCogs;
                
                let status = 'good';
                const profitMargin = parent.totalSales > 0 ? (netProfit / parent.totalSales) * 100 : 0;
                if (profitMargin < 10 && profitMargin >= 0) status = 'warn';
                if (profitMargin < 0) status = 'bad';
                
                // Count actual child ASINs (those different from the parent ASIN)
                const actualChildren = parent.children.filter(child => child.asin !== parentAsin);
                const actualChildCount = actualChildren.length;
                
                // Check if this parent has actual child variations
                const hasMultipleChildren = actualChildCount > 0;
                // Or if it's a single child that's different from parent
                const hasDifferentChild = parent.children.length === 1 && parent.children[0].asin !== parentAsin;
                const isExpandable = hasMultipleChildren || hasDifferentChild;
                
                // Build children array for expansion - only show actual children (different from parent)
                const childrenForDisplay = actualChildren
                    .map(child => createProductObject(child.asin, child, child.productDetails))
                    .sort((a, b) => b.sales - a.sales);
                
                products.push({
                    name: productDetails.itemName || productDetails.title || `Product ${parentAsin}`,
                    asin: parentAsin,
                    parentAsin: null, // This IS the parent
                    sku: productDetails.sku || '',
                    units: parent.totalUnitsSold,
                    sales: parent.totalSales,
                    cogsPerUnit: cogsPerUnit,
                    totalCogs: totalCogs,
                    adSpend: parent.totalPpcSpent,
                    fees: parent.totalFees,
                    amazonFees: parent.totalAmazonFees,
                    fbaFees: parent.totalFbaFees,
                    storageFees: parent.totalStorageFees,
                    grossProfit: parent.totalGrossProfit,
                    netProfit: netProfit,
                    refunds: parent.totalRefunds,
                    status: status,
                    isExpandable: isExpandable,
                    isParent: true,
                    children: childrenForDisplay,
                    childrenCount: actualChildCount  // Only count actual child variations, not the parent itself
                });
            });
            
            // Sort by sales descending
            products.sort((a, b) => b.sales - a.sales);
            
            return products;
        }
        
        // Fallback to profitabilityData if no economics data
        return profitibilityData.map(item => {
            const productDetails = productDetailsMap.get(item.asin) || {};
            const cogsPerUnit = cogsValues[item.asin] || 0;
            const unitsSold = item.quantity || 0;
            const sales = item.sales || 0;
            // For EconomicsMetrics data, amzFee is already total, don't multiply
            // For legacy data, amzFee might be per-unit, so multiply
            const totalFees = item.source === 'economicsMetrics' 
              ? (item.amzFee || 0) 
              : ((item.amzFee || 0) * unitsSold);
            const adSpend = item.ads || 0;
            const grossProfit = sales - adSpend - totalFees;
            const totalCogs = cogsPerUnit * unitsSold;
            const netProfit = grossProfit - totalCogs;
            
            let status = 'good';
            const profitMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
            if (profitMargin < 10 && profitMargin >= 0) status = 'warn';
            if (profitMargin < 0) status = 'bad';
            
            return {
                name: productDetails.itemName || productDetails.title || `Product ${item.asin}`,
                asin: item.asin,
                sku: productDetails.sku || item.sku || '',
                units: unitsSold,
                sales: sales,
                cogsPerUnit: cogsPerUnit,
                totalCogs: totalCogs,
                adSpend: adSpend,
                fees: totalFees,
                amazonFees: totalFees,
                grossProfit: grossProfit,
                netProfit: netProfit,
                status: status,
                isExpandable: false,
                isParent: true,
                children: [],
                childrenCount: 0
            };
        }).sort((a, b) => b.sales - a.sales);
    }, [asinWiseSalesData, profitibilityData, totalProducts, cogsValues, isDateRangeSelected, startDate, endDate, usePhasedLoading, hasPhasedData, phasedTableData]);
    
    // Generate suggestions based on profitability metrics
    const generateSuggestions = (product) => {
      const suggestions = [];
      const margin = product.sales > 0 ? (product.netProfit / product.sales) * 100 : 0;
      const cogsPercentage = product.sales > 0 ? (product.totalCogs / product.sales) * 100 : 0;
      
      if (product.status === 'bad' || product.status === 'warn') {
        if (product.netProfit < 0) {
          suggestions.push(
            `ASIN ${product.asin}: This product is incurring a loss. Consider increasing price, reducing PPC spend, or reviewing Amazon fees.`
          );
        } else if (margin < 10 && margin >= 0) {
          suggestions.push(
            `ASIN ${product.asin}: Very low margin (${margin.toFixed(1)}%). Consider increasing selling price or negotiating a lower COGS.`
          );
          
          if (cogsPercentage > 50) {
            suggestions.push(
              `ASIN ${product.asin}: Your COGS is consuming ${cogsPercentage.toFixed(1)}% of your sales. Explore alternative suppliers.`
            );
          }
        }
      }
      
      return suggestions;
    };
    
    // Update profitability errors in Redux when products change
    useEffect(() => {
      const totalErrors = processedProducts.filter(product => 
        product.status === 'bad' || product.status === 'warn'
      ).length;
      
      const errorDetails = processedProducts
        .filter(product => product.status === 'bad' || product.status === 'warn')
        .map(product => ({
          asin: product.asin,
          sales: product.sales,
          netProfit: product.netProfit,
          profitMargin: product.sales > 0 ? (product.netProfit / product.sales) * 100 : 0,
          errorType: product.status === 'bad' ? 'negative_profit' : 'low_margin',
          cogsPerUnit: product.cogsPerUnit
        }));
      
      // Create a stable key to compare if errors actually changed
      const errorsKey = `${totalErrors}_${errorDetails.length}_${errorDetails[0]?.asin || ''}`;
      
      // Only dispatch if errors actually changed
      if (lastDispatchedErrorsRef.current !== errorsKey) {
        dispatch(updateProfitabilityErrors({ totalErrors, errorDetails }));
        lastDispatchedErrorsRef.current = errorsKey;
      }
    }, [processedProducts, dispatch]);
    
    // Ref to track last suggestions to prevent infinite loops
    const lastSuggestionsRef = useRef(null);
    // Ref to store the setSuggestionsData function to avoid dependency issues
    const setSuggestionsDataRef = useRef(setSuggestionsData);
    
    // Update ref when function changes
    useEffect(() => {
      setSuggestionsDataRef.current = setSuggestionsData;
    }, [setSuggestionsData]);
    
    // Send suggestions data to parent component
    useEffect(() => {
      const setSuggestions = setSuggestionsDataRef.current;
      if (setSuggestions && typeof setSuggestions === 'function') {
        const allSuggestions = [];
        
        processedProducts.forEach(product => {
          const suggestions = generateSuggestions(product);
          if (suggestions.length > 0) {
            allSuggestions.push(...suggestions);
          }
        });
        
        // Only update if suggestions actually changed (compare by length and first item)
        const suggestionsKey = `${allSuggestions.length}_${allSuggestions[0]?.asin || ''}`;
        if (lastSuggestionsRef.current !== suggestionsKey) {
          setSuggestions(allSuggestions);
          lastSuggestionsRef.current = suggestionsKey;
        }
      }
    }, [processedProducts]);
    
    // Calculate total pages - use server values for phased loading
    const totalPages = usePhasedLoading 
        ? serverTotalPages 
        : Math.ceil(processedProducts.length / productsPerPage);
    
    // Current page - use server value for phased loading
    const currentPage = usePhasedLoading ? serverCurrentPage : localCurrentPage;
    const setCurrentPage = usePhasedLoading 
        ? (page) => onPageChange && onPageChange(typeof page === 'function' ? page(serverCurrentPage) : page) 
        : setLocalCurrentPage;
    
    // Calculate current products to display
    // For phased loading, data is already paginated from server
    const indexOfLastProduct = usePhasedLoading ? processedProducts.length : currentPage * productsPerPage;
    const indexOfFirstProduct = usePhasedLoading ? 0 : indexOfLastProduct - productsPerPage;
    const currentProducts = usePhasedLoading 
        ? processedProducts 
        : processedProducts.slice(indexOfFirstProduct, indexOfLastProduct);
    
    // Navigation functions
    const goToPreviousPage = () => {
      if (usePhasedLoading && onPageChange) {
        onPageChange(Math.max(currentPage - 1, 1));
      } else {
        setLocalCurrentPage(prev => Math.max(prev - 1, 1));
      }
    };
    
    const goToNextPage = () => {
      if (usePhasedLoading && onPageChange) {
        onPageChange(Math.min(currentPage + 1, totalPages));
      } else {
        setLocalCurrentPage(prev => Math.min(prev + 1, totalPages));
      }
    };

    // Calculate summary stats
    const summaryStats = useMemo(() => {
      const totalSales = processedProducts.reduce((sum, product) => sum + product.sales, 0);
      const totalNetProfit = processedProducts.reduce((sum, product) => sum + product.netProfit, 0);
      const totalGrossProfit = processedProducts.reduce((sum, product) => sum + product.grossProfit, 0);
      const profitableProducts = processedProducts.filter(product => product.netProfit > 0).length;
      const criticalProducts = processedProducts.filter(product => product.status === 'bad').length;
      
      return {
        totalSales,
        totalNetProfit,
        totalGrossProfit,
        profitableProducts,
        criticalProducts,
        totalProducts: processedProducts.length
      };
    }, [processedProducts]);
  
    return (
      <div className="rounded-lg overflow-hidden" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        {/* Enhanced Header */}
        <div className="p-3 border-b" style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4" style={{ color: '#3b82f6' }} />
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Product Profitability Analysis</h3>
                {isDateRangeSelected && (
                  <span className="ml-0 mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                    <Calendar className="w-2.5 h-2.5 inline mr-1" />
                    {parseLocalDate(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {parseLocalDate(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Loading state - COGS (text only, no spinner) */}
        {cogsLoading && (
          <div className="flex items-center justify-center py-2 border-b" style={{ background: 'rgba(59, 130, 246, 0.1)', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
            <span className="text-xs" style={{ color: '#60a5fa' }}>Loading saved COGS data...</span>
          </div>
        )}

        {/* Table */}
        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
                <th className="w-8 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>#</th>
                <th className="w-1/5 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Product</th>
                <th className="w-28 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>ASIN</th>
                <th className="w-24 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Sales</th>
                <th className="w-16 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Units</th>
                <th className="w-32 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>COGS</th>
                <th className="w-24 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Ad Spend</th>
                <th className="w-24 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Amz Fees</th>
                <th className="w-24 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Gross</th>
                <th className="w-24 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {currentProducts.length > 0 ? (
                  currentProducts.map((product, index) => (
                    <React.Fragment key={product.asin}>
                      {/* Product Row */}
                      <tr
                        className="transition-colors duration-200"
                        style={{ borderBottom: '1px solid #30363d', background: 'transparent' }}
                      >
                        {/* Row number */}
                        <td className="px-2 py-2 align-middle text-center">
                          <span className="text-[11px]" style={{ color: '#6b7280' }}>#{indexOfFirstProduct + index + 1}</span>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium leading-relaxed break-words" style={{ color: '#f3f4f6' }} title={product.name}>
                              {product.name}
                            </div>
                            {product.isExpandable && (
                              <div className="text-[10px] mt-0.5" style={{ color: '#60a5fa' }}>
                                {product.childrenCount} variation{product.childrenCount > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex flex-col">
                            <span className={`text-sm font-mono px-2 py-1 rounded whitespace-nowrap font-semibold ${
                              product.isExpandable 
                                ? '' 
                                : ''
                            }`} style={product.isExpandable ? { color: '#60a5fa', background: 'rgba(59, 130, 246, 0.2)' } : { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)' }} title={product.isExpandable ? `Parent: ${product.asin}` : product.asin}>
                              {product.asin}
                            </span>
                            {product.isExpandable && (
                              <span className="text-xs mt-0.5 font-medium" style={{ color: '#60a5fa' }}>Parent</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                          <div className="text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(product.sales, currency)}>
                            {formatCurrencyWithLocale(product.sales, currency)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center align-middle">
                          <span className="text-[11px] font-semibold" style={{ color: '#f3f4f6' }}>{(product.units ?? product.quantity ?? 0).toLocaleString()}</span>
                        </td>
                        <td className="px-2 py-2 text-center align-middle">
                          {/* For parents with children: show expand button instead of COGS */}
                          {product.isExpandable ? (
                            <button
                              onClick={() => toggleExpanded(product.asin)}
                              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer"
                              style={expandedRows.has(product.asin) ? { background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', border: '1px solid #3b82f6' } : { background: '#1a1a1a', color: '#3b82f6', border: '1px solid #3b82f6' }}
                              title={expandedRows.has(product.asin) ? 'Collapse children' : 'Expand to add COGS per child'}
                            >
                              {expandedRows.has(product.asin) ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  <span className="text-xs font-medium">Collapse</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-4 h-4" />
                                  <span className="text-xs font-medium">Expand</span>
                                </>
                              )}
                            </button>
                          ) : (
                            /* For standalone products: show COGS input */
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-sm font-medium min-w-[20px]" style={{ color: '#9ca3af' }}>{cogsCurrencySymbol}</span>
                              <div className="relative">
                                <input
                                  type="number"
                                  value={cogsValues[product.asin] || ''}
                                  onChange={(e) => handleCogsChange(product.asin, e.target.value)}
                                  placeholder="0"
                                  className="w-14 px-2 py-1.5 text-sm text-center border rounded focus:outline-none focus:ring-1 transition-all duration-200"
                                  style={isSaved(product.asin) ? { background: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.3)', color: '#f3f4f6' } : needsSave(product.asin) ? { background: 'rgba(251, 191, 36, 0.1)', borderColor: 'rgba(251, 191, 36, 0.3)', color: '#f3f4f6' } : { background: '#1a1a1a', borderColor: '#30363d', color: '#f3f4f6' }}
                                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                  onBlur={(e) => e.target.style.borderColor = isSaved(product.asin) ? 'rgba(34, 197, 94, 0.3)' : needsSave(product.asin) ? 'rgba(251, 191, 36, 0.3)' : '#30363d'}
                                  step="0.01"
                                  min="0"
                                />
                              </div>
                              <button
                                onClick={() => handleSaveCogs(product.asin, product.sku)}
                                disabled={cogsSaving[product.asin] || !needsSave(product.asin)}
                                className="p-1 rounded transition-all duration-200"
                                style={cogsSaving[product.asin] ? { color: '#6b7280', cursor: 'wait' } : isSaved(product.asin) ? { color: '#22c55e', cursor: 'default' } : needsSave(product.asin) ? { color: '#60a5fa', cursor: 'pointer' } : { color: '#6b7280', cursor: 'not-allowed' }}
                                onMouseEnter={(e) => needsSave(product.asin) && !cogsSaving[product.asin] && (e.target.style.color = '#3b82f6')}
                                onMouseLeave={(e) => needsSave(product.asin) && !cogsSaving[product.asin] && (e.target.style.color = '#60a5fa')}
                                title={
                                  cogsSaving[product.asin] 
                                    ? 'Saving...' 
                                    : isSaved(product.asin)
                                      ? 'Saved'
                                      : needsSave(product.asin)
                                        ? 'Click to save COGS'
                                        : 'Enter COGS value to save'
                                }
                              >
                                {cogsSaving[product.asin] ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : isSaved(product.asin) ? (
                                  <CheckCircle2 className="w-4 h-4" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                          <div className="text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(product.adSpend, currency)}>
                            {formatCurrencyWithLocale(product.adSpend, currency)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                          <div className="text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(product.amazonFees, currency)}>
                            {formatCurrencyWithLocale(product.amazonFees, currency)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                          <div className={`text-[11px] font-bold whitespace-nowrap overflow-hidden text-ellipsis`} style={{ color: product.grossProfit < 0 ? '#f87171' : '#22c55e' }} title={formatCurrencyWithLocale(product.grossProfit, currency)}>
                            {formatCurrencyWithLocale(product.grossProfit, currency)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center relative align-middle min-w-0 overflow-hidden">
                          {/* For parents: show hint to expand for Net Profit */}
                          {product.isExpandable ? (
                            <span className="text-[10px] italic" style={{ color: '#6b7280' }}>See children</span>
                          ) : (
                            /* For standalone: show Net Profit with COGS blur */
                            <>
                              <div className={`${
                                !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                                  ? 'filter blur-sm' 
                                  : ''
                              }`}>
                                <div className={`text-[11px] font-bold whitespace-nowrap overflow-hidden text-ellipsis`} style={{ color: (!cogsValues[product.asin] || cogsValues[product.asin] === 0) ? '#6b7280' : (product.netProfit < 0 ? '#f87171' : '#22c55e') }} title={formatCurrencyWithLocale(product.netProfit, currency)}>
                                  {formatCurrencyWithLocale(product.netProfit, currency)}
                                </div>
                              </div>
                              {(!cogsValues[product.asin] || cogsValues[product.asin] === 0) && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                                    +COGS
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                      
                      {/* Expanded Child ASINs */}
                      {expandedRows.has(product.asin) && product.isExpandable && product.children && (
                            product.children.map((child) => (
                              <tr
                                key={child.asin}
                                className="transition-colors"
                                style={{ background: 'rgba(59, 130, 246, 0.1)', borderBottom: '1px solid #30363d' }}
                              >
                                <td className="px-2 py-2 align-middle">
                                  <div className="ml-2 w-0.5 h-4 rounded" style={{ background: '#3b82f6' }}></div>
                                </td>
                                <td className="px-3 py-2 align-middle">
                                  <div className="min-w-0 pl-2">
                                    <div className="text-[11px] leading-relaxed break-words" style={{ color: '#f3f4f6' }}>
                                      {child.name}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-middle">
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.2)' }} title={`Child: ${child.asin}`}>
                                      {child.asin}
                                    </span>
                                    <span className="text-[10px] mt-0.5" style={{ color: '#3b82f6' }}>Child</span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                                  <div className="text-[11px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(child.sales || 0, currency)}>
                                    {formatCurrencyWithLocale(child.sales || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                  <span className="text-[11px]" style={{ color: '#f3f4f6' }}>{child.units?.toLocaleString() || 0}</span>
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="text-xs" style={{ color: '#9ca3af' }}>{cogsCurrencySymbol}</span>
                                    <input
                                      type="number"
                                      value={cogsValues[child.asin] || ''}
                                      onChange={(e) => handleCogsChange(child.asin, e.target.value)}
                                      placeholder="0"
                                      className="w-12 px-1.5 py-1 text-xs text-center border rounded focus:outline-none focus:ring-1"
                                      style={isSaved(child.asin) ? { background: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.3)', color: '#f3f4f6' } : needsSave(child.asin) ? { background: 'rgba(251, 191, 36, 0.1)', borderColor: 'rgba(251, 191, 36, 0.3)', color: '#f3f4f6' } : { background: '#1a1a1a', borderColor: '#30363d', color: '#f3f4f6' }}
                                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                      onBlur={(e) => e.target.style.borderColor = isSaved(child.asin) ? 'rgba(34, 197, 94, 0.3)' : needsSave(child.asin) ? 'rgba(251, 191, 36, 0.3)' : '#30363d'}
                                      step="0.01"
                                      min="0"
                                    />
                                    <button
                                      onClick={() => handleSaveCogs(child.asin, child.sku)}
                                      disabled={cogsSaving[child.asin] || !needsSave(child.asin)}
                                      className="p-0.5 rounded"
                                      style={cogsSaving[child.asin] ? { color: '#6b7280' } : isSaved(child.asin) ? { color: '#22c55e' } : needsSave(child.asin) ? { color: '#60a5fa' } : { color: '#6b7280' }}
                                      onMouseEnter={(e) => needsSave(child.asin) && !cogsSaving[child.asin] && (e.target.style.color = '#3b82f6')}
                                      onMouseLeave={(e) => needsSave(child.asin) && !cogsSaving[child.asin] && (e.target.style.color = '#60a5fa')}
                                    >
                                      {cogsSaving[child.asin] ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : isSaved(child.asin) ? (
                                        <CheckCircle2 className="w-3 h-3" />
                                      ) : (
                                        <Check className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                                  <div className="text-[11px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(child.adSpend || 0, currency)}>
                                    {formatCurrencyWithLocale(child.adSpend || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                                  <div className="text-[11px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#f3f4f6' }} title={formatCurrencyWithLocale(child.amazonFees || 0, currency)}>
                                    {formatCurrencyWithLocale(child.amazonFees || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle min-w-0 overflow-hidden">
                                  <div className={`text-[11px] font-medium whitespace-nowrap overflow-hidden text-ellipsis`} style={{ color: (child.grossProfit || 0) < 0 ? '#f87171' : '#22c55e' }} title={formatCurrencyWithLocale(child.grossProfit || 0, currency)}>
                                    {formatCurrencyWithLocale(child.grossProfit || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center align-middle relative min-w-0 overflow-hidden">
                                  {cogsValues[child.asin] ? (
                                    <div className={`text-[11px] font-medium whitespace-nowrap overflow-hidden text-ellipsis`} style={{ color: (child.netProfit || 0) < 0 ? '#f87171' : '#22c55e' }} title={formatCurrencyWithLocale(child.netProfit || 0, currency)}>
                                      {formatCurrencyWithLocale(child.netProfit || 0, currency)}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                                      +COGS
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                      )}
                    </React.Fragment>
                  ))
                ) : (tableLoading || isLoadingAsinData || (usePhasedLoading && !hasPhasedData)) ? (
                  /* Skeleton loader: same columns as table - only loading indicator */
                  Array.from({ length: 10 }).map((_, rowIndex) => (
                    <tr key={`skeleton-${rowIndex}`} style={{ borderBottom: '1px solid #30363d', background: 'transparent' }}>
                      <td className="px-2 py-2 align-middle text-center">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="1.25rem" className="rounded" /></div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <SkeletonBar height="0.75rem" width="85%" className="rounded" />
                        <SkeletonBar height="0.5rem" width="50%" className="rounded mt-1" />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <SkeletonBar height="0.875rem" width="4.5rem" className="rounded" />
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="2.5rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="1.5rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="1.25rem" width="3rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="2.5rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="2.5rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="2.5rem" className="rounded" /></div>
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <div className="flex justify-center"><SkeletonBar height="0.75rem" width="2.5rem" className="rounded" /></div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="px-3 py-8 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="w-6 h-6" style={{ color: '#6b7280' }} />
                        <div>
                          <h3 className="text-sm font-medium" style={{ color: '#f3f4f6' }}>No profitability data available</h3>
                          <p className="text-xs mt-1" style={{ color: '#9ca3af' }}>
                            {isDateRangeSelected 
                              ? 'No data found for the selected date range. Try a different date range.' 
                              : 'Data will appear here once products are analyzed'}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {(processedProducts.length > 0 || tableLoading || isLoadingAsinData || (usePhasedLoading && !hasPhasedData)) && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 border-t" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium truncate" style={{ color: '#9ca3af' }}>
                {usePhasedLoading ? (
                  <>{Math.min((currentPage - 1) * productsPerPage + 1, serverTotalParents || serverTotalItems)}–{Math.min(currentPage * productsPerPage, serverTotalParents || serverTotalItems)} of {serverTotalParents || serverTotalItems}</>
                ) : (
                  <>{indexOfFirstProduct + 1}–{Math.min(indexOfLastProduct, processedProducts.length)} of {processedProducts.length}</>
                )}
              </span>
              {usePhasedLoading && serverTotalChildren > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }} title={`${serverTotalChildren} children`}>
                  +{serverTotalChildren}
                </span>
              )}
              <span className="text-[10px] shrink-0" style={{ color: '#6b7280' }}>
                {productsPerPage}/page
              </span>
            </div>
            
            <div className="flex items-center justify-center gap-2">
              {/* Previous Button - not disabled during load so page change is immediate */}
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  currentPage === 1 ? 'cursor-not-allowed' : ''
                }`}
                style={(currentPage === 1) ? { background: '#21262d', color: '#6b7280' } : { background: '#1a1a1a', color: '#f3f4f6', border: '1px solid #30363d' }}
                onMouseEnter={(e) => currentPage !== 1 && (e.target.style.borderColor = '#3b82f6')}
                onMouseLeave={(e) => currentPage !== 1 && (e.target.style.borderColor = '#30363d')}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              {/* Page Numbers */}
              <div className="flex items-center gap-1">
                {(() => {
                  const pages = [];
                  const maxVisiblePages = 5;
                  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
                  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
                  
                  if (endPage - startPage + 1 < maxVisiblePages) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                  }
                  
                  // First page + ellipsis
                  if (startPage > 1) {
                    pages.push(
                      <button
                        key={1}
                        onClick={() => setCurrentPage(1)}
                        className="w-8 h-8 text-sm font-medium rounded-lg transition-colors"
                        style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
                        onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
                      >
                        1
                      </button>
                    );
                    if (startPage > 2) {
                      pages.push(
                        <span key="start-ellipsis" className="px-1" style={{ color: '#6b7280' }}>...</span>
                      );
                    }
                  }
                  
                  // Visible pages - not disabled during load so page change is immediate
                  for (let i = startPage; i <= endPage; i++) {
                    pages.push(
                      <button
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        disabled={false}
                        className="w-8 h-8 text-sm font-medium rounded-lg transition-colors"
                        style={currentPage === i ? { background: '#3b82f6', color: 'white' } : { background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onMouseEnter={(e) => currentPage !== i && (e.target.style.borderColor = '#3b82f6')}
                        onMouseLeave={(e) => currentPage !== i && (e.target.style.borderColor = '#30363d')}
                      >
                        {i}
                      </button>
                    );
                  }
                  
                  // Last page + ellipsis
                  if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                      pages.push(
                        <span key="end-ellipsis" className="px-1" style={{ color: '#6b7280' }}>...</span>
                      );
                    }
                    pages.push(
                      <button
                        key={totalPages}
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={false}
                        className="w-8 h-8 text-sm font-medium rounded-lg transition-colors"
                        style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
                        onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
                      >
                        {totalPages}
                      </button>
                    );
                  }
                  
                  return pages;
                })()}
              </div>
              
              {/* Next Button - not disabled during load so page change is immediate */}
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  currentPage === totalPages ? 'cursor-not-allowed' : ''
                }`}
                style={(currentPage === totalPages) ? { background: '#21262d', color: '#6b7280' } : { background: '#1a1a1a', color: '#f3f4f6', border: '1px solid #30363d' }}
                onMouseEnter={(e) => currentPage !== totalPages && (e.target.style.borderColor = '#3b82f6')}
                onMouseLeave={(e) => currentPage !== totalPages && (e.target.style.borderColor = '#30363d')}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div aria-hidden="true" />
          </div>
        )}
      </div>
    );
};

export default ProfitTable;
