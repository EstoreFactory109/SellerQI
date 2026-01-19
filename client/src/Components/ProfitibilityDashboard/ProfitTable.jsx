import React, { useState, useEffect, useMemo } from 'react';
import { Check, AlertTriangle, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Table, TrendingDown, DollarSign, Package, Target, Loader2, CheckCircle2, Calendar } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { setCogsValue, fetchCogs, saveCogsToDb, selectCogsSaving, selectSavedCogsValues } from '../../redux/slices/cogsSlice';
import { updateProfitabilityErrors } from '../../redux/slices/errorsSlice';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils';
import { parseLocalDate } from '../../utils/dateUtils';
import axiosInstance from '../../config/axios.config';

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

const ProfitTable = ({ setSuggestionsData }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRows, setExpandedRows] = useState(new Set());
    const dispatch = useDispatch();
    const productsPerPage = 10;
    
    // State for ASIN-wise sales data (fetched separately for big accounts)
    const [asinWiseSalesData, setAsinWiseSalesData] = useState([]);
    const [isLoadingAsinData, setIsLoadingAsinData] = useState(false);
    const [asinDataError, setAsinDataError] = useState(null);
    
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
            // Skip if economicsMetrics is not available yet
            if (!economicsMetrics) {
                console.log('ProfitTable: economicsMetrics not available yet');
                return;
            }
            
            const hasAsinData = economicsMetrics?.asinWiseSales && economicsMetrics.asinWiseSales.length > 0;
            const isBigAccount = economicsMetrics?.isBig === true;
            const totalSales = economicsMetrics?.totalSales?.amount || 0;
            
            // Check if this might be a big account that needs data fetched
            // - Explicitly marked as big (isBig=true) with no asinWiseSales
            // - OR has high totalSales (>5000) but empty asinWiseSales (legacy data issue)
            const needsFetch = (!hasAsinData && isBigAccount) || 
                              (!hasAsinData && totalSales > 5000);
            
            console.log('ProfitTable ASIN data check:', {
                hasAsinData,
                isBigAccount,
                totalSales,
                needsFetch,
                asinWiseSalesLength: economicsMetrics?.asinWiseSales?.length || 0
            });
            
            if (needsFetch) {
                setIsLoadingAsinData(true);
                setAsinDataError(null);
                
                try {
                    console.log('Fetching ASIN-wise sales data for big account...');
                    const response = await axiosInstance.get('/page-data/asin-wise-sales');
                    
                    if (response.data?.success && response.data?.data?.asinWiseSales) {
                        console.log('Fetched ASIN-wise sales:', response.data.data.asinWiseSales.length, 'records');
                        setAsinWiseSalesData(response.data.data.asinWiseSales);
                    } else {
                        console.warn('No ASIN-wise sales data in response');
                        setAsinWiseSalesData([]);
                    }
                } catch (error) {
                    console.error('Error fetching ASIN-wise sales data:', error);
                    setAsinDataError(error.message);
                    setAsinWiseSalesData([]);
                } finally {
                    setIsLoadingAsinData(false);
                }
            } else if (hasAsinData) {
                // Normal account with data - use data from Redux
                setAsinWiseSalesData(economicsMetrics.asinWiseSales);
            }
        };
        
        fetchAsinWiseSalesForBigAccount();
    }, [economicsMetrics?.isBig, economicsMetrics?.asinWiseSales?.length, economicsMetrics?.totalSales?.amount]);
    
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
    
    // Debug logging
    useEffect(() => {
        if (asinWiseSalesData?.length > 0) {
            const sample = asinWiseSalesData.slice(0, 5);
            console.log('=== ProfitTable Debug ===');
            console.log('Total asinWiseSales records:', asinWiseSalesData.length);
            console.log('Is big account:', economicsMetrics?.isBig);
            console.log('Sample data:', sample);
            console.log('Has date field:', sample.some(item => item.date));
            console.log('Has parentAsin field:', sample.some(item => item.parentAsin));
            console.log('Date filter active:', isDateRangeSelected);
            if (isDateRangeSelected) {
                console.log('Date range:', startDate, 'to', endDate);
            }
        }
    }, [asinWiseSalesData, economicsMetrics?.isBig, isDateRangeSelected, startDate, endDate]);
    
    /**
     * MAIN DATA PROCESSING:
     * 1. Get all asinWiseSales from economicsMetrics
     * 2. Filter by date range if selected
     * 3. Aggregate by ASIN to get totals
     * 4. Group by parentAsin - show parent first, children on expand
     */
    const processedProducts = useMemo(() => {
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
                
                console.log(`Date filter applied: ${asinWiseSales.length} -> ${filteredData.length} records`);
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
                
                // Check if this parent has multiple children (variations)
                const hasMultipleChildren = parent.children.length > 1;
                // Or if it's a single child that's different from parent
                const hasDifferentChild = parent.children.length === 1 && parent.children[0].asin !== parentAsin;
                const isExpandable = hasMultipleChildren || hasDifferentChild;
                
                // Build children array for expansion
                const childrenForDisplay = parent.children
                    .filter(child => child.asin !== parentAsin || parent.children.length === 1) // Show all if different, or single child
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
                    childrenCount: parent.children.length
                });
            });
            
            // Sort by sales descending
            products.sort((a, b) => b.sales - a.sales);
            
            console.log(`Processed ${products.length} parent ASINs with ${asinAggregates.size} total child ASINs`);
            
            return products;
        }
        
        // Fallback to profitabilityData if no economics data
        console.log('Using fallback profitabilityData');
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
    }, [asinWiseSalesData, profitibilityData, totalProducts, cogsValues, isDateRangeSelected, startDate, endDate]);
    
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
      
      dispatch(updateProfitabilityErrors({ totalErrors, errorDetails }));
    }, [processedProducts, dispatch]);
    
    // Send suggestions data to parent component
    useEffect(() => {
      if (setSuggestionsData && typeof setSuggestionsData === 'function') {
        const allSuggestions = [];
        
        processedProducts.forEach(product => {
          const suggestions = generateSuggestions(product);
          if (suggestions.length > 0) {
            allSuggestions.push(...suggestions);
          }
        });
        
        setSuggestionsData(allSuggestions);
      }
    }, [processedProducts, setSuggestionsData]);
    
    // Calculate total pages
    const totalPages = Math.ceil(processedProducts.length / productsPerPage);
    
    // Calculate current products to display
    const indexOfLastProduct = currentPage * productsPerPage;
    const indexOfFirstProduct = indexOfLastProduct - productsPerPage;
    const currentProducts = processedProducts.slice(indexOfFirstProduct, indexOfLastProduct);
    
    // Navigation functions
    const goToPreviousPage = () => {
      setCurrentPage(prev => Math.max(prev - 1, 1));
    };
    
    const goToNextPage = () => {
      setCurrentPage(prev => Math.min(prev + 1, totalPages));
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
  
    // Show loading state when fetching ASIN data for big accounts
    if (isLoadingAsinData) {
      return (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Table className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Product Profitability Analysis</h3>
                <p className="text-sm text-gray-600">Loading ASIN-wise sales data...</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
            <p className="text-gray-600">Loading product data for analysis...</p>
            <p className="text-sm text-gray-400 mt-2">This may take a moment for accounts with many products</p>
          </div>
        </div>
      );
    }
    
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Enhanced Header */}
        <div className="p-6 bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Table className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Product Profitability Analysis</h3>
                <p className="text-sm text-gray-600">
                  ASIN-wise breakdown with daily data
                  {isDateRangeSelected && (
                    <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      <Calendar className="w-3 h-3 inline mr-1" />
                      {parseLocalDate(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {parseLocalDate(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-sm text-gray-600">Parent ASINs</div>
                <div className="text-2xl font-bold text-emerald-600">{processedProducts.length}</div>
              </div>
              <div className="w-px h-12 bg-gray-300"></div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Child ASINs</div>
                <div className="text-2xl font-bold text-purple-600">{processedProducts.reduce((sum, p) => sum + (p.childrenCount || 0), 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {cogsLoading && (
          <div className="flex items-center justify-center py-4 bg-blue-50 border-b border-blue-100">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin mr-2" />
            <span className="text-sm text-blue-700">Loading saved COGS data...</span>
          </div>
        )}

        {/* Table */}
        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-200">
                <th className="w-8 px-2 py-4 text-center text-xs font-semibold text-gray-500">#</th>
                <th className="w-1/5 px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                <th className="w-28 px-4 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">ASIN</th>
                <th className="w-16 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">Units</th>
                <th className="w-32 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">COGS</th>
                <th className="w-24 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">Ad Spend</th>
                <th className="w-24 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">Amz Fees</th>
                <th className="w-24 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">Gross</th>
                <th className="w-24 px-3 py-4 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">Net</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <AnimatePresence>
                {currentProducts.length > 0 ? (
                  currentProducts.map((product, index) => (
                    <React.Fragment key={product.asin}>
                      {/* Product Row */}
                      <motion.tr 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                        className={`hover:bg-gray-50 transition-colors duration-200 ${
                          product.isExpandable ? 'cursor-pointer' : ''
                        } ${expandedRows.has(product.asin) ? 'bg-blue-50/50' : ''}`}
                      >
                        {/* Row number */}
                        <td className="px-2 py-5 align-middle text-center">
                          <span className="text-xs text-gray-400">#{indexOfFirstProduct + index + 1}</span>
                        </td>
                        <td className="px-4 py-5 align-middle">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 leading-relaxed break-words" title={product.name}>
                              {product.name}
                            </div>
                            {product.isExpandable && (
                              <div className="text-xs text-blue-600 mt-0.5">
                                {product.childrenCount} variation{product.childrenCount > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 align-middle">
                          <div className="flex flex-col">
                            <span className={`text-sm font-mono px-2 py-1 rounded whitespace-nowrap font-semibold ${
                              product.isExpandable 
                                ? 'text-blue-700 bg-blue-100' 
                                : 'text-gray-600 bg-gray-100'
                            }`} title={product.isExpandable ? `Parent: ${product.asin}` : product.asin}>
                              {product.asin}
                            </span>
                            {product.isExpandable && (
                              <span className="text-xs text-blue-600 mt-0.5 font-medium">Parent</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-5 text-center align-middle">
                          <span className="text-sm font-semibold text-gray-900">{product.units.toLocaleString()}</span>
                        </td>
                        <td className="px-3 py-5 text-center align-middle">
                          {/* For parents with children: show expand button instead of COGS */}
                          {product.isExpandable ? (
                            <button
                              onClick={() => toggleExpanded(product.asin)}
                              className={`flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg transition-all duration-200 ${
                                expandedRows.has(product.asin)
                                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                  : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 border border-gray-200 hover:border-blue-300'
                              }`}
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
                              <span className="text-sm text-gray-500 font-medium min-w-[20px]">{cogsCurrencySymbol}</span>
                              <div className="relative">
                                <input
                                  type="number"
                                  value={cogsValues[product.asin] || ''}
                                  onChange={(e) => handleCogsChange(product.asin, e.target.value)}
                                  placeholder="0"
                                  className={`w-14 px-2 py-1.5 text-sm text-center border rounded focus:outline-none focus:ring-1 transition-all duration-200 ${
                                    isSaved(product.asin) 
                                      ? 'border-green-300 bg-green-50 focus:ring-green-500 focus:border-green-500' 
                                      : needsSave(product.asin)
                                        ? 'border-amber-300 bg-amber-50 focus:ring-amber-500 focus:border-amber-500'
                                        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                                  }`}
                                  step="0.01"
                                  min="0"
                                />
                              </div>
                              <button
                                onClick={() => handleSaveCogs(product.asin, product.sku)}
                                disabled={cogsSaving[product.asin] || !needsSave(product.asin)}
                                className={`p-1 rounded transition-all duration-200 ${
                                  cogsSaving[product.asin]
                                    ? 'text-gray-400 cursor-wait'
                                    : isSaved(product.asin)
                                      ? 'text-green-600 cursor-default'
                                      : needsSave(product.asin)
                                        ? 'text-blue-600 hover:bg-blue-100 hover:text-blue-700 cursor-pointer'
                                        : 'text-gray-300 cursor-not-allowed'
                                }`}
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
                        <td className="px-3 py-5 text-center align-middle min-w-0 overflow-hidden">
                          <div className="text-sm font-semibold text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrencyWithLocale(product.adSpend, currency)}>
                            {formatCurrencyWithLocale(product.adSpend, currency)}
                          </div>
                        </td>
                        <td className="px-3 py-5 text-center align-middle min-w-0 overflow-hidden">
                          <div className="text-sm font-semibold text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrencyWithLocale(product.amazonFees, currency)}>
                            {formatCurrencyWithLocale(product.amazonFees, currency)}
                          </div>
                        </td>
                        <td className="px-3 py-5 text-center align-middle min-w-0 overflow-hidden">
                          <div className={`text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis ${product.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`} title={formatCurrencyWithLocale(product.grossProfit, currency)}>
                            {formatCurrencyWithLocale(product.grossProfit, currency)}
                          </div>
                        </td>
                        <td className="px-3 py-5 text-center relative align-middle min-w-0 overflow-hidden">
                          {/* For parents: show hint to expand for Net Profit */}
                          {product.isExpandable ? (
                            <span className="text-xs text-gray-400 italic">See children</span>
                          ) : (
                            /* For standalone: show Net Profit with COGS blur */
                            <>
                              <div className={`${
                                !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                                  ? 'filter blur-sm' 
                                  : ''
                              }`}>
                                <div className={`text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis ${
                                  !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                                    ? 'text-gray-400' 
                                    : product.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'
                                }`} title={formatCurrencyWithLocale(product.netProfit, currency)}>
                                  {formatCurrencyWithLocale(product.netProfit, currency)}
                                </div>
                              </div>
                              {(!cogsValues[product.asin] || cogsValues[product.asin] === 0) && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 shadow-sm">
                                    +COGS
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </motion.tr>
                      
                      {/* Expanded Child ASINs */}
                      <AnimatePresence>
                        {expandedRows.has(product.asin) && product.isExpandable && product.children && (
                          <>
                            {product.children.map((child, childIndex) => (
                              <motion.tr
                                key={child.asin}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2, delay: childIndex * 0.03 }}
                                className="bg-gradient-to-r from-purple-50/60 to-indigo-50/40 hover:from-purple-100/60 hover:to-indigo-100/40 transition-colors"
                              >
                                <td className="px-2 py-4 align-middle">
                                  <div className="ml-2 w-0.5 h-6 bg-purple-300 rounded"></div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="min-w-0 pl-2">
                                    <div className="text-sm text-gray-700 leading-relaxed break-words">
                                      {child.name}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="flex flex-col">
                                    <span className="text-xs font-mono text-purple-700 bg-purple-100 px-2 py-1 rounded whitespace-nowrap" title={`Child: ${child.asin}`}>
                                      {child.asin}
                                    </span>
                                    <span className="text-xs text-purple-600 mt-0.5">Child</span>
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-center align-middle">
                                  <span className="text-sm text-gray-700">{child.units?.toLocaleString() || 0}</span>
                                </td>
                                <td className="px-3 py-4 text-center align-middle">
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="text-xs text-gray-500">{cogsCurrencySymbol}</span>
                                    <input
                                      type="number"
                                      value={cogsValues[child.asin] || ''}
                                      onChange={(e) => handleCogsChange(child.asin, e.target.value)}
                                      placeholder="0"
                                      className={`w-12 px-1.5 py-1 text-xs text-center border rounded focus:outline-none focus:ring-1 ${
                                        isSaved(child.asin) 
                                          ? 'border-green-300 bg-green-50' 
                                          : needsSave(child.asin)
                                            ? 'border-amber-300 bg-amber-50'
                                            : 'border-gray-300'
                                      }`}
                                      step="0.01"
                                      min="0"
                                    />
                                    <button
                                      onClick={() => handleSaveCogs(child.asin, child.sku)}
                                      disabled={cogsSaving[child.asin] || !needsSave(child.asin)}
                                      className={`p-0.5 rounded ${
                                        cogsSaving[child.asin] ? 'text-gray-400' :
                                        isSaved(child.asin) ? 'text-green-600' :
                                        needsSave(child.asin) ? 'text-blue-600 hover:bg-blue-100' :
                                        'text-gray-300'
                                      }`}
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
                                <td className="px-3 py-4 text-center align-middle min-w-0 overflow-hidden">
                                  <div className="text-sm text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrencyWithLocale(child.adSpend || 0, currency)}>
                                    {formatCurrencyWithLocale(child.adSpend || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-center align-middle min-w-0 overflow-hidden">
                                  <div className="text-sm text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrencyWithLocale(child.amazonFees || 0, currency)}>
                                    {formatCurrencyWithLocale(child.amazonFees || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-center align-middle min-w-0 overflow-hidden">
                                  <div className={`text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${(child.grossProfit || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`} title={formatCurrencyWithLocale(child.grossProfit || 0, currency)}>
                                    {formatCurrencyWithLocale(child.grossProfit || 0, currency)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-center align-middle relative min-w-0 overflow-hidden">
                                  {cogsValues[child.asin] ? (
                                    <div className={`text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
                                      (child.netProfit || 0) < 0 ? 'text-red-600' : 'text-emerald-600'
                                    }`} title={formatCurrencyWithLocale(child.netProfit || 0, currency)}>
                                      {formatCurrencyWithLocale(child.netProfit || 0, currency)}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                                      +COGS
                                    </span>
                                  )}
                                </td>
                              </motion.tr>
                            ))}
                          </>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="px-3 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                          <Package className="w-8 h-8 text-gray-400" />
                        </div>
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">No profitability data available</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            {isDateRangeSelected 
                              ? 'No data found for the selected date range. Try a different date range.' 
                              : 'Data will appear here once products are analyzed'}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {processedProducts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-4 bg-gradient-to-r from-gray-50 to-slate-50 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 font-medium">
                Showing {indexOfFirstProduct + 1} - {Math.min(indexOfLastProduct, processedProducts.length)} of {processedProducts.length}
              </span>
              <span className="text-xs text-gray-500 hidden sm:inline">
                ({productsPerPage} per page)
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Previous Button */}
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  currentPage === 1
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-300 shadow-sm'
                }`}
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
                        className="w-8 h-8 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        1
                      </button>
                    );
                    if (startPage > 2) {
                      pages.push(
                        <span key="start-ellipsis" className="px-1 text-gray-400">...</span>
                      );
                    }
                  }
                  
                  // Visible pages
                  for (let i = startPage; i <= endPage; i++) {
                    pages.push(
                      <button
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${
                          currentPage === i
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                      >
                        {i}
                      </button>
                    );
                  }
                  
                  // Last page + ellipsis
                  if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                      pages.push(
                        <span key="end-ellipsis" className="px-1 text-gray-400">...</span>
                      );
                    }
                    pages.push(
                      <button
                        key={totalPages}
                        onClick={() => setCurrentPage(totalPages)}
                        className="w-8 h-8 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        {totalPages}
                      </button>
                    );
                  }
                  
                  return pages;
                })()}
              </div>
              
              {/* Next Button */}
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  currentPage === totalPages
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-300 shadow-sm'
                }`}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
};

export default ProfitTable;
