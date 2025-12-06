import React, { useState, useEffect, useMemo } from 'react';
import { Check, AlertTriangle, X, ChevronLeft, ChevronRight, Table, TrendingDown, DollarSign, Package, Target } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { setCogsValue } from '../../redux/slices/cogsSlice';
import { updateProfitabilityErrors } from '../../redux/slices/errorsSlice';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils';

const ProfitTable = ({ setSuggestionsData }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const dispatch = useDispatch();
    const productsPerPage = 10;
    
    // Get profitability data from Redux store
    const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
    const totalProducts = useSelector((state) => state.Dashboard.DashBoardInfo?.TotalProduct) || [];
    
    // Get EconomicsMetrics data from Redux store (preferred source for fees and gross profit)
    const economicsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.EconomicsMetrics);
    
    // Create a map of ASIN to EconomicsMetrics data for quick lookup
    const economicsAsinMap = useMemo(() => {
        const map = new Map();
        if (economicsMetrics?.asinWiseSales && Array.isArray(economicsMetrics.asinWiseSales)) {
            economicsMetrics.asinWiseSales.forEach(item => {
                if (item.asin) {
                    map.set(item.asin, item);
                }
            });
        }
        return map;
    }, [economicsMetrics]);
    
    // Calculate total active products
    const totalActiveProducts = totalProducts.filter(product => product.status === "Active").length;
    
    // Get COGs values from Redux store
    const cogsValues = useSelector((state) => state.cogs.cogsValues);
    
    // Get currency from Redux
    const currency = useSelector(state => state.currency?.currency) || '$';
    
    // Handle COGS input change
    const handleCogsChange = (asin, value) => {
      const numValue = parseFloat(value) || 0;
      dispatch(setCogsValue({ asin, value: numValue }));
    };
    
    // Generate suggestions based on profitability metrics
    const generateSuggestions = (product) => {
      const suggestions = [];
      const margin = product.sales > 0 ? (product.netProfit / product.sales) * 100 : 0;
      const cogsPercentage = product.sales > 0 ? (product.totalCogs / product.sales) * 100 : 0;
      
      // Only generate suggestions for products with errors (bad or warn status)
      if (product.status === 'bad' || product.status === 'warn') {
        // 1. Negative Profit
        if (product.netProfit < 0) {
          suggestions.push(
            `ASIN ${product.asin}: This product is incurring a loss. Consider increasing price, reducing PPC spend, or reviewing Amazon fees.`,
            `ASIN ${product.asin}: You are losing money on each sale. Temporarily pause ads for this SKU.`
          );
        }
        
        // 2. Low Profit Margin (Below 10% but positive)
        else if (margin < 10 && margin >= 0) {
          suggestions.push(
            `ASIN ${product.asin}: Very low margin (${margin.toFixed(1)}%). Consider increasing selling price or negotiating a lower COGS with your supplier.`
          );
          
          // Additional suggestion if COGS is high
          if (cogsPercentage > 50) {
            suggestions.push(
              `ASIN ${product.asin}: Your COGS is consuming ${cogsPercentage.toFixed(1)}% of your sales. Explore alternative suppliers or reduce packaging costs.`
            );
          }
          
          // Additional suggestion if ad spend is high
          if (product.adSpend > 0 && (product.adSpend / product.sales) * 100 > 20) {
            suggestions.push(
              `ASIN ${product.asin}: Ad spend is ${((product.adSpend / product.sales) * 100).toFixed(1)}% of sales. Optimize PPC campaigns to improve profitability.`
            );
          }
        }
        
        // 3. Unprofitable despite high sales
        if (product.sales > 1000 && product.netProfit < 100) {
          suggestions.push(
            `ASIN ${product.asin}: This SKU is a revenue driver but not profitable. Audit PPC spend and fulfillment fees closely.`
          );
        }
      }
      
      return suggestions;
    };
    
    // Process and format the profitability data
    const products = useMemo(() => {
      // Create a map of ASIN to product details for quick lookup
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      return profitibilityData.map(item => {
        const productDetails = productDetailsMap.get(item.asin) || {};
        
        // Get COGS value from state or default to 0
        const cogsPerUnit = cogsValues[item.asin] || 0;
        
        // Calculate total COGS (COGS per unit * quantity)
        const totalCogs = cogsPerUnit * (item.quantity || 0);
        
        // Get EconomicsMetrics data for this ASIN (preferred source)
        const economicsData = economicsAsinMap.get(item.asin);
        
        // Use EconomicsMetrics totalFees if available, otherwise check profitibilityData, then fallback to legacy calculation
        let totalFees = 0;
        let amazonFees = 0;
        
        if (economicsData?.amazonFees?.amount !== undefined) {
            // Use amazonFees from EconomicsMetrics - MOST ACCURATE
            amazonFees = economicsData.amazonFees?.amount || 0;
            totalFees = amazonFees;
        } else if (item.amazonFees !== undefined) {
            // Use amazonFees from profitibilityData (calculated from EconomicsMetrics in backend)
            amazonFees = item.amazonFees || 0;
            totalFees = amazonFees;
        } else if (economicsData?.totalFees?.amount !== undefined) {
            // Fallback to totalFees from EconomicsMetrics (for backward compatibility)
            totalFees = economicsData.totalFees.amount || 0;
            amazonFees = totalFees;
        } else if (item.totalFees !== undefined) {
            // Use totalFees from profitibilityData (calculated from EconomicsMetrics in backend)
            totalFees = item.totalFees || 0;
            amazonFees = totalFees;
        } else {
            // Fallback to legacy calculation (fee per unit * quantity)
            totalFees = (item.amzFee || 0) * (item.quantity || 0);
            amazonFees = totalFees;
        }
        
        // PRIMARY: Use ads from profitibilityData (from Amazon Ads API - GetPPCProductWise)
        // This is the authoritative source for ASIN-wise PPC spend
        let adSpend = item.ads || 0;
        
        // Use grossProfit from profitibilityData (calculated with Ads API spend in backend)
        // Fallback to EconomicsMetrics grossProfit if profitibilityData doesn't have it
        let grossProfit = 0;
        if (item.grossProfit !== undefined) {
            // PRIMARY: Use grossProfit from profitibilityData (calculated with Ads API spend)
            grossProfit = item.grossProfit || 0;
        } else if (economicsData?.grossProfit?.amount !== undefined) {
            // Fallback: Use EconomicsMetrics grossProfit (uses MCP ppcSpent)
            // Note: This may differ from Ads API calculation
            grossProfit = economicsData.grossProfit.amount || 0;
        } else {
            // Final fallback: Calculate manually using sales - ads - fees
            grossProfit = (item.sales || 0) - adSpend - totalFees;
        }
        
        // Calculate net profit: gross profit - COGS
        const netProfit = grossProfit - totalCogs;
        
        // Determine status based on profit margin
        let status = 'good';
        const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
        if (profitMargin < 10 && profitMargin >= 0) status = 'warn';
        if (profitMargin < 0) status = 'bad';
        
        const productData = {
          name: productDetails.itemName || productDetails.title || `Product ${item.asin}`,
          asin: item.asin,
          units: item.quantity || 0,
          sales: item.sales || 0,
          cogsPerUnit: cogsPerUnit,
          totalCogs: totalCogs,
          adSpend: adSpend,
          fees: totalFees,
          amazonFees: amazonFees,
          grossProfit: grossProfit,
          netProfit: netProfit,
          status: status
        };
        
        // Add suggestions to the product data
        productData.suggestions = generateSuggestions(productData);
        
        return productData;
      });
    }, [profitibilityData, cogsValues, totalProducts, economicsAsinMap]);
    
    // Update profitability errors in Redux when products change
    useEffect(() => {
      const totalErrors = products.filter(product => 
        product.status === 'bad' || product.status === 'warn'
      ).length;
      
      const errorDetails = products
        .filter(product => product.status === 'bad' || product.status === 'warn')
        .map(product => ({
          asin: product.asin,
          sales: product.sales,
          netProfit: product.netProfit,
          profitMargin: product.sales > 0 ? (product.netProfit / product.sales) * 100 : 0,
          errorType: product.status === 'bad' ? 'negative_profit' : 'low_margin',
          cogsPerUnit: product.cogsPerUnit
        }));
      
      // Dispatch the updated errors to Redux
      dispatch(updateProfitabilityErrors({ totalErrors, errorDetails }));
    }, [products, dispatch]);
    
    // Send suggestions data to parent component
    useEffect(() => {
      if (setSuggestionsData && typeof setSuggestionsData === 'function') {
        // Create a flat array of suggestions only from products with errors
        const allSuggestions = [];
        
        products.forEach(product => {
          // Only include suggestions from products with errors (bad or warn status)
          if ((product.status === 'bad' || product.status === 'warn') && product.suggestions && product.suggestions.length > 0) {
            allSuggestions.push(...product.suggestions);
          }
        });
        
        // Call the parent's setSuggestionsData function with the flat array
        setSuggestionsData(allSuggestions);
      }
    }, [products, setSuggestionsData]);
    
    // Calculate total pages
    const totalPages = Math.ceil(products.length / productsPerPage);
    
    // Calculate current products to display
    const indexOfLastProduct = currentPage * productsPerPage;
    const indexOfFirstProduct = indexOfLastProduct - productsPerPage;
    const currentProducts = products.slice(indexOfFirstProduct, indexOfLastProduct);
    
    // Navigation functions
    const goToPreviousPage = () => {
      setCurrentPage(prev => Math.max(prev - 1, 1));
    };
    
    const goToNextPage = () => {
      setCurrentPage(prev => Math.min(prev + 1, totalPages));
    };
    
    const getStatusIcon = (status) => {
      if (status === 'good') return <Check className="w-5 h-5 text-green-600" />;
      if (status === 'warn') return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      return <X className="w-5 h-5 text-red-600" />;
    };

    const getStatusBadge = (status) => {
      if (status === 'good') {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            <Check className="w-3 h-3" />
            Healthy
          </span>
        );
      }
      if (status === 'warn') {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Warning
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
          <X className="w-3 h-3" />
          Critical
        </span>
      );
    };

    // Calculate summary stats
    const summaryStats = useMemo(() => {
      const totalSales = products.reduce((sum, product) => sum + product.sales, 0);
      const totalNetProfit = products.reduce((sum, product) => sum + product.netProfit, 0);
      const totalGrossProfit = products.reduce((sum, product) => sum + product.grossProfit, 0);
      const profitableProducts = products.filter(product => product.netProfit > 0).length;
      const criticalProducts = products.filter(product => product.status === 'bad').length;
      
      return {
        totalSales,
        totalNetProfit,
        totalGrossProfit,
        profitableProducts,
        criticalProducts,
        totalProducts: products.length,
        totalActiveProducts: totalActiveProducts
      };
    }, [products, totalActiveProducts]);
  
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
                <p className="text-sm text-gray-600">Detailed profit breakdown with COGS integration</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-sm text-gray-600">Active Products</div>
                <div className="text-2xl font-bold text-emerald-600">{totalActiveProducts}</div>
              </div>
              <div className="w-px h-12 bg-gray-300"></div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Total Products</div>
                <div className="text-2xl font-bold text-gray-900">{totalProducts.length}</div>
              </div>
            </div>
          </div>


        </div>

        {/* Enhanced Table */}
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-200">
                <th className="w-1/5 px-3 py-6 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                <th className="w-24 px-2 py-6 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">ASIN</th>
                <th className="w-14 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Units</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Sales</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">COGS</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Ad Spend</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Amz Fees</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Gross</th>
                <th className="w-18 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Net</th>
                <th className="w-16 px-2 py-6 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <AnimatePresence>
                {currentProducts.length > 0 ? (
                  currentProducts.map((product, index) => (
                                         <motion.tr 
                       key={indexOfFirstProduct + index}
                       initial={{ opacity: 0, y: 20 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: -20 }}
                       transition={{ duration: 0.3, delay: index * 0.05 }}
                       className="hover:bg-gray-50 transition-colors duration-200"
                     >
                       <td className="px-3 py-8">
                         <div className="flex items-center gap-2">
                           <div className="w-6 h-6 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                             <Package className="w-3 h-3 text-blue-600" />
                           </div>
                           <div className="min-w-0 flex-1">
                             <div className="text-[10px] font-medium text-gray-900 leading-relaxed break-words" title={product.name}>
                               {product.name}
                             </div>
                             <div className="text-[9px] text-gray-500">#{indexOfFirstProduct + index + 1}</div>
                           </div>
                         </div>
                       </td>
                       <td className="px-2 py-8 align-top">
                         <span className="text-xs font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded block whitespace-nowrap" title={product.asin}>{product.asin}</span>
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                         <span className="text-xs font-semibold text-gray-900">{product.units.toLocaleString()}</span>
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                         <span className="text-xs font-semibold text-gray-900">{formatCurrencyWithLocale(product.sales, currency)}</span>
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                         <div className="flex items-center justify-center">
                           <div className="relative">
                             <input
                               type="number"
                               value={cogsValues[product.asin] || ''}
                               onChange={(e) => handleCogsChange(product.asin, e.target.value)}
                               placeholder="0"
                               className="w-14 px-1.5 py-1 text-[10px] text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                               step="0.01"
                               min="0"
                             />
                           </div>
                         </div>
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                         <span className="text-xs font-semibold text-gray-900">{formatCurrencyWithLocale(product.adSpend, currency)}</span>
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                        <span className="text-xs font-semibold text-gray-900">{formatCurrencyWithLocale(product.amazonFees, currency)}</span>
                      </td>
                       <td className="px-2 py-8 text-center align-top">
                         <span className={`text-xs font-bold ${product.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                           {formatCurrencyWithLocale(product.grossProfit, currency)}
                         </span>
                       </td>
                       <td className="px-2 py-8 text-center relative align-top">
                         <div className={`${
                           !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                             ? 'filter blur-sm' 
                             : ''
                         }`}>
                           <span className={`text-xs font-bold ${
                             !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                               ? 'text-gray-400' 
                               : product.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'
                           }`}>
                             {formatCurrencyWithLocale(product.netProfit, currency)}
                           </span>
                         </div>
                         {(!cogsValues[product.asin] || cogsValues[product.asin] === 0) && (
                           <div className="absolute inset-0 flex items-center justify-center">
                             <span className="text-[9px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200 shadow-sm">
                               +COGS
                             </span>
                           </div>
                         )}
                       </td>
                       <td className="px-2 py-8 text-center align-top">
                         <div className="flex justify-center">
                           {getStatusIcon(product.status)}
                         </div>
                       </td>
                     </motion.tr>
                  ))
                                 ) : (
                   <tr>
                    <td colSpan="11" className="px-3 py-12 text-center">
                       <div className="flex flex-col items-center gap-3">
                         <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                           <Package className="w-8 h-8 text-gray-400" />
                         </div>
                         <div>
                           <h3 className="text-lg font-medium text-gray-900">No profitability data available</h3>
                           <p className="text-sm text-gray-500 mt-1">Data will appear here once products are analyzed</p>
                         </div>
                       </div>
                     </td>
                   </tr>
                 )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
                 {/* Enhanced Pagination Controls */}
         {products.length > 0 && (
           <div className="flex items-center justify-between px-3 py-4 bg-gradient-to-r from-gray-50 to-slate-50 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 font-medium">
                Showing {products.length > 0 ? indexOfFirstProduct + 1 : 0} to {Math.min(indexOfLastProduct, products.length)} of {products.length} products
              </span>
              <span className="text-xs text-gray-500">
                ({summaryStats.totalActiveProducts} active, {summaryStats.profitableProducts} profitable, {summaryStats.criticalProducts} critical)
              </span>
            </div>
            
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={goToPreviousPage}
                disabled={currentPage === 1 || products.length === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                  currentPage === 1 || products.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm hover:shadow-md'
                }`}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="text-sm font-medium">Previous</span>
              </motion.button>
              
              <div className="flex items-center gap-2">
                <span className="px-4 py-2 text-sm font-medium text-gray-700 bg-blue-50 border border-blue-200 rounded-lg">
                  {currentPage} of {totalPages || 1}
                </span>
              </div>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={goToNextPage}
                disabled={currentPage === totalPages || products.length === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                  currentPage === totalPages || products.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm hover:shadow-md'
                }`}
                aria-label="Next page"
              >
                <span className="text-sm font-medium">Next</span>
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        )}
      </div>
    );
  };

  export default ProfitTable;