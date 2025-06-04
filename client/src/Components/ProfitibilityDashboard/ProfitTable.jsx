import React, { useState, useEffect, useMemo } from 'react';
import { Check, AlertTriangle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSelector } from 'react-redux';

const ProfitTable = ({ setSuggestionsData }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [cogsValues, setCogsValues] = useState({});
    const productsPerPage = 10;
    
    // Get profitability data from Redux store
    const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
    const totalProducts = useSelector((state) => state.Dashboard.DashBoardInfo?.TotalProduct) || [];
    
    // Handle COGS input change
    const handleCogsChange = (asin, value) => {
      const numValue = parseFloat(value) || 0;
      setCogsValues(prev => ({
        ...prev,
        [asin]: numValue
      }));
    };
    
    // Generate suggestions based on profitability metrics
    const generateSuggestions = (product) => {
      const suggestions = [];
      const margin = product.sales > 0 ? (product.netProfit / product.sales) * 100 : 0;
      const cogsPercentage = product.sales > 0 ? (product.totalCogs / product.sales) * 100 : 0;
      
      // 1. Negative Profit
      if (product.netProfit < 0) {
        suggestions.push(
          `ASIN ${product.asin}: This product is incurring a loss. Consider increasing price, reducing PPC spend, or reviewing Amazon fees.`,
          `ASIN ${product.asin}: You are losing money on each sale. Temporarily pause ads for this SKU.`
        );
      }
      
      // 2. Low Profit Margin (Below 15%)
      if (margin < 15 && margin >= 0) {
        suggestions.push(
          `ASIN ${product.asin}: Very low margin. Consider increasing selling price or negotiating a lower COGS with your supplier.`
        );
      }
      
      // 3. High COGS %
      if (cogsPercentage > 50) {
        suggestions.push(
          `ASIN ${product.asin}: Your COGS is consuming over half of your sales. Explore alternative suppliers or reduce packaging costs.`
        );
      }
      
      // 4. Unprofitable despite high sales
      if (product.sales > 1000 && product.netProfit < 100) {
        suggestions.push(
          `ASIN ${product.asin}: This SKU is a revenue driver but not profitable. Audit PPC spend and fulfillment fees closely.`,
          `ASIN ${product.asin}: Optimize listing and reduce ad spend to improve margins.`
        );
      }
      
      // 5. Low Volume, High Margin (Missed opportunity)
      if (product.units < 10 && margin > 40) {
        suggestions.push(
          `ASIN ${product.asin}: This product is very profitable. Increase visibility through PPC or bundling.`,
          `ASIN ${product.asin}: Test discounts or Amazon Deals to boost volume.`
        );
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
        
        // Calculate net profit: sales - (cogs * quantity) - ads - fees
        const netProfit = (item.sales || 0) - totalCogs - (item.ads || 0) - (item.amzFee || 0);
        
        // Determine status based on profit margin
        let status = 'good';
        const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
        if (profitMargin < 10 && profitMargin >= 0) status = 'warn';
        if (profitMargin < 0) status = 'bad';
        
        const productData = {
          name: productDetails.title || `Product ${item.asin}`,
          asin: item.asin,
          units: item.quantity || 0,
          sales: item.sales || 0,
          cogsPerUnit: cogsPerUnit,
          totalCogs: totalCogs,
          adSpend: item.ads || 0,
          fees: item.amzFee || 0,
          netProfit: netProfit,
          status: status
        };
        
        // Add suggestions to the product data
        productData.suggestions = generateSuggestions(productData);
        
        return productData;
      });
    }, [profitibilityData, cogsValues, totalProducts]);
    
    // Send suggestions data to parent component
    useEffect(() => {
      if (setSuggestionsData && typeof setSuggestionsData === 'function') {
        // Create a flat array of all suggestions
        const allSuggestions = [];
        
        products.forEach(product => {
          if (product.suggestions && product.suggestions.length > 0) {
            allSuggestions.push(...product.suggestions);
          }
        });
        
        // Call the parent's setSuggestionsData function with the flat array
        setSuggestionsData(allSuggestions);
      }
    }, [profitibilityData, cogsValues, setSuggestionsData]);
    
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
      if (status === 'good') return <Check className="w-4 h-4 text-green-600" />;
      if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      return <X className="w-4 h-4 text-red-600" />;
    };
  
    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Product</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">ASIN</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Units</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Sales</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">COGS/unit</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Ad Spend</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Amazon Fees</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Net Profit</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {currentProducts.length > 0 ? (
              currentProducts.map((product, index) => (
                <tr key={indexOfFirstProduct + index} className="border-b border-gray-200">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-blue-500 rounded-full"></div>
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]" title={product.name}>
                        {product.name.length > 40 ? `${product.name.substring(0, 40)}...` : product.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600">{product.asin}</td>
                  <td className="px-4 py-4 text-sm text-gray-900 text-center">{product.units.toLocaleString()}</td>
                  <td className="px-4 py-4 text-sm text-gray-900 text-center">${product.sales.toFixed(2)}</td>
                  <td className="px-4 py-4 text-center">
                    <div className="flex items-center justify-center">
                      <span className="text-sm text-gray-500 mr-1">$</span>
                      <input
                        type="number"
                        value={cogsValues[product.asin] || ''}
                        onChange={(e) => handleCogsChange(product.asin, e.target.value)}
                        placeholder="0.00"
                        className="w-20 px-2 py-1 text-sm text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-900 text-center">${product.adSpend.toFixed(2)}</td>
                  <td className="px-4 py-4 text-sm text-gray-900 text-center">
                    ${product.fees.toFixed(2)}
                  </td>
                  <td className={`px-4 py-4 text-sm font-medium text-center ${product.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    ${product.netProfit < 0 ? `-${Math.abs(product.netProfit).toFixed(2)}` : product.netProfit.toFixed(2)}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {getStatusIcon(product.status)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="9" className="px-4 py-8 text-center text-gray-500">
                  No profitability data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
        
        {/* Pagination Controls */}
        {products.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
            <div className="text-sm text-gray-700">
              Showing {products.length > 0 ? indexOfFirstProduct + 1 : 0} to {Math.min(indexOfLastProduct, products.length)} of {products.length} products
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1 || products.length === 0}
                className={`p-2 rounded-md transition-colors ${
                  currentPage === 1 || products.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                }`}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <span className="px-3 py-1 text-sm text-gray-700">
                Page {currentPage} of {totalPages || 1}
              </span>
              
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages || products.length === 0}
                className={`p-2 rounded-md transition-colors ${
                  currentPage === totalPages || products.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
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