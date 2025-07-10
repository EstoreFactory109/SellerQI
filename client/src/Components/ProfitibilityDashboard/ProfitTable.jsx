import React, { useState, useEffect, useMemo } from 'react';
import { Check, AlertTriangle, X, ChevronLeft, ChevronRight, Table, TrendingDown, DollarSign, Package, Target } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { setCogsValue } from '../../redux/slices/cogsSlice';
import { updateProfitabilityErrors } from '../../redux/slices/errorsSlice';
import { motion, AnimatePresence } from 'framer-motion';

const ProfitTable = ({ setSuggestionsData }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const dispatch = useDispatch();
    const productsPerPage = 10;
    
    // Get profitability data from Redux store
    const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
    const totalProducts = useSelector((state) => state.Dashboard.DashBoardInfo?.TotalProduct) || [];
    
    // Get COGs values from Redux store
    const cogsValues = useSelector((state) => state.cogs.cogsValues);
    
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
        
        // Calculate total fees (fee per unit * quantity)
        const totalFees = (item.amzFee || 0) * (item.quantity || 0);
        
        // Calculate gross profit: sales - ads - total fees (no COGS deducted)
        const grossProfit = (item.sales || 0) - (item.ads || 0) - totalFees;
        
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
          adSpend: item.ads || 0,
          fees: totalFees,
          grossProfit: grossProfit,
          netProfit: netProfit,
          status: status
        };
        
        // Add suggestions to the product data
        productData.suggestions = generateSuggestions(productData);
        
        return productData;
      });
    }, [profitibilityData, cogsValues, totalProducts]);
    
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
        totalProducts: products.length
      };
    }, [products]);
  
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
            <div className="text-right">
              <div className="text-sm text-gray-600">Total Products</div>
              <div className="text-2xl font-bold text-gray-900">{products.length}</div>
            </div>
          </div>

          {/* Summary Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-gray-600">Total Sales</span>
              </div>
              <div className="text-lg font-bold text-gray-900">${summaryStats.totalSales.toLocaleString()}</div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-gray-600">Net Profit</span>
              </div>
              <div className={`text-lg font-bold ${summaryStats.totalNetProfit < 0 ? 'text-red-600' : 'text-green-600'}`}>
                ${summaryStats.totalNetProfit.toLocaleString()}
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-gray-600">Profitable</span>
              </div>
              <div className="text-lg font-bold text-emerald-600">
                {summaryStats.profitableProducts}/{summaryStats.totalProducts}
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <X className="w-4 h-4 text-red-600" />
                <span className="text-xs font-medium text-gray-600">Critical</span>
              </div>
              <div className="text-lg font-bold text-red-600">{summaryStats.criticalProducts}</div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-medium text-gray-600">Avg Margin</span>
              </div>
              <div className="text-lg font-bold text-purple-600">
                {summaryStats.totalSales > 0 ? ((summaryStats.totalNetProfit / summaryStats.totalSales) * 100).toFixed(1) : '0.0'}%
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Table */}
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-200">
                <th className="w-1/4 px-3 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                <th className="w-20 px-2 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">ASIN</th>
                <th className="w-16 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Units Sold</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Sales</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">COGS</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Ad Spend</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Fees</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Gross</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Net</th>
                <th className="w-20 px-2 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
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
                       <td className="px-3 py-4">
                         <div className="flex items-center gap-2">
                           <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                             <Package className="w-4 h-4 text-blue-600" />
                           </div>
                           <div className="min-w-0 flex-1">
                             <div className="text-sm font-medium text-gray-900 truncate" title={product.name}>
                               {product.name.length > 35 ? `${product.name.substring(0, 35)}...` : product.name}
                             </div>
                             <div className="text-xs text-gray-500">#{indexOfFirstProduct + index + 1}</div>
                           </div>
                         </div>
                       </td>
                       <td className="px-2 py-4">
                         <span className="text-xs font-mono text-gray-600 bg-gray-100 px-1 py-1 rounded truncate block">{product.asin}</span>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <span className="text-sm font-semibold text-gray-900">{product.units > 999 ? `${(product.units/1000).toFixed(1)}k` : product.units}</span>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <span className="text-sm font-semibold text-gray-900">${product.sales > 999 ? `${(product.sales/1000).toFixed(1)}k` : product.sales.toFixed(0)}</span>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <div className="flex items-center justify-center">
                           <div className="relative">
                             <input
                               type="number"
                               value={cogsValues[product.asin] || ''}
                               onChange={(e) => handleCogsChange(product.asin, e.target.value)}
                               placeholder="0"
                               className="w-16 px-2 py-1 text-xs text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                               step="0.01"
                               min="0"
                             />
                           </div>
                         </div>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <span className="text-sm font-semibold text-gray-900">${product.adSpend > 999 ? `${(product.adSpend/1000).toFixed(1)}k` : product.adSpend.toFixed(0)}</span>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <span className="text-sm font-semibold text-gray-900">${product.fees > 999 ? `${(product.fees/1000).toFixed(1)}k` : product.fees.toFixed(0)}</span>
                       </td>
                       <td className="px-2 py-4 text-center">
                         <span className={`text-sm font-bold ${product.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                           ${product.grossProfit < 0 ? `-${Math.abs(product.grossProfit) > 999 ? `${(Math.abs(product.grossProfit)/1000).toFixed(1)}k` : Math.abs(product.grossProfit).toFixed(0)}` : product.grossProfit > 999 ? `${(product.grossProfit/1000).toFixed(1)}k` : product.grossProfit.toFixed(0)}
                         </span>
                       </td>
                       <td className="px-2 py-4 text-center relative">
                         <div className={`${
                           !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                             ? 'filter blur-sm' 
                             : ''
                         }`}>
                           <span className={`text-sm font-bold ${
                             !cogsValues[product.asin] || cogsValues[product.asin] === 0 
                               ? 'text-gray-400' 
                               : product.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'
                           }`}>
                             ${product.netProfit < 0 ? `-${Math.abs(product.netProfit) > 999 ? `${(Math.abs(product.netProfit)/1000).toFixed(1)}k` : Math.abs(product.netProfit).toFixed(0)}` : product.netProfit > 999 ? `${(product.netProfit/1000).toFixed(1)}k` : product.netProfit.toFixed(0)}
                           </span>
                         </div>
                         {(!cogsValues[product.asin] || cogsValues[product.asin] === 0) && (
                           <div className="absolute inset-0 flex items-center justify-center">
                             <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-200 shadow-sm">
                               +COGS
                             </span>
                           </div>
                         )}
                       </td>
                       <td className="px-2 py-4 text-center">
                         <div className="flex justify-center">
                           {getStatusIcon(product.status)}
                         </div>
                       </td>
                     </motion.tr>
                  ))
                                 ) : (
                   <tr>
                     <td colSpan="10" className="px-3 py-12 text-center">
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
                ({summaryStats.profitableProducts} profitable, {summaryStats.criticalProducts} critical)
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