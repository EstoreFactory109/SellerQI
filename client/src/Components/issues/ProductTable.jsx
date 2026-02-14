import React, { useState, useRef, useEffect } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import ScaleLoader from "react-spinners/ScaleLoader";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from 'lucide-react';

const priorityColors = {
  High: "text-red-500",
  Medium: "text-yellow-500",
  Low: "text-green-500",
};

export default function ProductTable() {

  const navigate = useNavigate();

  const openProductWithIssuePage = (asin) => {
    if (asin) {
      navigate(`/seller-central-checker/${asin}`)
    }
  }


  const info = useSelector((state) => state.Dashboard.DashBoardInfo);

  const allProducts = info.productWiseError || [];
  
  // Get GetOrderData array for calculating quantities
  const getOrderData = Array.isArray(info?.GetOrderData) ? info.GetOrderData : [];
  
  // Function to calculate total quantities ASIN-wise from GetOrderData
  const calculateAsinQuantities = (orderData) => {
    const asinQuantities = {};
    
    // Only consider shipped, unshipped, and partially shipped orders
    const validStatuses = ['Shipped', 'Unshipped', 'PartiallyShipped'];
    
    orderData.forEach(order => {
      if (!order || !order.asin || !validStatuses.includes(order.orderStatus)) {
        return;
      }
      
      const asin = order.asin;
      const quantity = Number(order.quantity) || 0;
      
      if (asinQuantities[asin]) {
        asinQuantities[asin] += quantity;
      } else {
        asinQuantities[asin] = quantity;
      }
    });
    
    return asinQuantities;
  };
  
  // Calculate quantities from GetOrderData
  const asinQuantities = calculateAsinQuantities(getOrderData);
  
  // Debug logging
  console.log('ProductTable - GetOrderData length:', getOrderData.length);
  console.log('ProductTable - Calculated ASIN quantities:', asinQuantities);
  
  // Update products with calculated quantities
  const allProductsWithUpdatedQuantities = allProducts.map(product => ({
    ...product,
    quantity: asinQuantities[product.asin] || 0
  }));

  console.log('ProductTable - Updated products with quantities:', allProductsWithUpdatedQuantities.map(p => ({ asin: p.asin, oldQuantity: allProducts.find(op => op.asin === p.asin)?.quantity, newQuantity: p.quantity })));

  const itemsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestion] = useState([])
  const [openSuggestion, setOpenSuggestion] = useState(false)
  const [sortBy, setSortBy] = useState('revenue') // Default sorting by revenue
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const sortDropdownRef = useRef(null)
  
  const totalPages = Math.ceil(allProducts.length / itemsPerPage);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target)) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // First, sort ALL products based on selected criteria and assign priorities globally
  const getSortedProducts = (products, criteria) => {
    switch (criteria) {
      case 'revenue':
        return [...products].sort((a, b) => Number(b.sales ?? 0) - Number(a.sales ?? 0));
      case 'unitsSold':
        return [...products].sort((a, b) => Number(b.quantity ?? 0) - Number(a.quantity ?? 0));
      case 'issues':
        return [...products].sort((a, b) => Number(b.errors ?? 0) - Number(a.errors ?? 0));
      default:
        return [...products].sort((a, b) => Number(b.sales ?? 0) - Number(a.sales ?? 0));
    }
  };

  const sortedAllProducts = getSortedProducts(allProductsWithUpdatedQuantities, sortBy);

  const totalProducts = sortedAllProducts.length;
  const highThreshold = Math.ceil(totalProducts * 0.3); // Top 30% are High priority
  const mediumThreshold = Math.ceil(totalProducts * 0.7); // Next 40% are Medium priority
  // Remaining 30% are Low priority

  const allPrioritizedProducts = sortedAllProducts.map((product, index) => ({
    ...product,
    priority: index < highThreshold ? "High" : index < mediumThreshold ? "Medium" : "Low",
  }));

  // Then apply pagination to the prioritized products
  const startIndex = (currentPage - 1) * itemsPerPage;
  const prioritizedProducts = allPrioritizedProducts.slice(startIndex, startIndex + itemsPerPage);

  const getPageNumbers = () => {
    const maxPages = 5;
    const pageNumbers = [];

    if (totalPages <= maxPages) {
      for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
      let start = Math.max(1, currentPage - 2);
      let end = start + maxPages - 1;

      if (end > totalPages) {
        end = totalPages;
        start = end - maxPages + 1;
      }

      for (let i = start; i <= end; i++) {
        pageNumbers.push(i);
      }
    }

    return pageNumbers;
  };

  const pageNumbers = getPageNumbers();

  const getSortDisplayText = (sortValue) => {
    switch (sortValue) {
      case 'revenue':
        return 'Top 10 products by revenue';
      case 'unitsSold':
        return 'Top 10 products by unit sold';
      case 'issues':
        return 'Top 10 products by issues';
      default:
        return 'Top 10 products by revenue';
    }
  };

  const handleSortChange = (newSortBy) => {
    setSortBy(newSortBy);
    setCurrentPage(1);
    setShowSortDropdown(false);
  };

  const handleSuggestions = (e) => {
    setQuery(e.target.value)
    let inputValue = e.target.value;
    if (inputValue.length === 0) {
      setSuggestion([])
      setOpenSuggestion(false)
    } else {
      setOpenSuggestion(true)
      const suggestedProducts = sortedAllProducts.filter(product => product.asin.toLowerCase().startsWith(inputValue.toLowerCase()) || product.name.toLowerCase().startsWith(inputValue.toLowerCase())).slice(0, 5)
      setSuggestion(suggestedProducts)
    }
  }

  const handleSearch = (query) => {
    if (!query) {
      return
    }
    const value = query.trim()
    const getProduct = sortedAllProducts.find(product => product.asin.toLowerCase() === value.toLowerCase() || product.name.toLowerCase() === value.toLowerCase());
    if (getProduct) {
      navigate(`/seller-central-checker/${getProduct.asin}`)
    }
  }

  const handleEnterKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch(query)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold">Top Products to Optimize</h2>
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative" ref={sortDropdownRef}>
            <button
              className="flex items-center justify-between gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-50 outline-none w-[20rem]"
              onClick={() => setShowSortDropdown(!showSortDropdown)}
            >
              <span>{getSortDisplayText(sortBy)}</span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showSortDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            <AnimatePresence>
              {showSortDropdown && (
                <motion.div
                  className="absolute top-full mt-1 w-[20rem] bg-white border border-gray-300 rounded-md shadow-lg z-10 overflow-hidden"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <ul className="py-1 text-sm text-gray-700">
                    <li
                      className="px-4 py-2 hover:bg-[#333651] hover:text-white cursor-pointer"
                      onClick={() => handleSortChange('revenue')}
                    >
                      Top 10 products by revenue
                    </li>
                    <li
                      className="px-4 py-2 hover:bg-[#333651] hover:text-white cursor-pointer"
                      onClick={() => handleSortChange('unitsSold')}
                    >
                      Top 10 products by unit sold
                    </li>
                    <li
                      className="px-4 py-2 hover:bg-[#333651] hover:text-white cursor-pointer"
                      onClick={() => handleSortChange('issues')}
                    >
                      Top 10 products by issues
                    </li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="border p-2 rounded-md outline-none w-[20rem] flex relative">
            <input
              type="text"
              placeholder="Search for ASIN or Product Title"
              className=" outline-none w-[90%] pl-2"
              onChange={handleSuggestions}
              value={query}
              onKeyDown={handleEnterKeyDown}
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#90adc7"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="cursor-pointer"
              onClick={() => handleSearch(query)}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <AnimatePresence>
              {openSuggestion && (
                <motion.ul
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  style={{ transformOrigin: "top" }}
                  className="py-2 px-2 w-[20rem] bg-white absolute top-[110%] right-0 z-[99] shadow-md border flex flex-col items-center justify-center origin-top"
                >
                  {suggestions.length === 0 ? (
                    <ScaleLoader color="#90adc7" height={10} width={3} />
                  ) : (
                    suggestions.map((product) => (
                      <li
                        key={product.asin}
                        onClick={() => navigate(`/seller-central-checker/${product.asin}`)}
                        className="text-sm cursor-pointer hover:scale-105 hover:bg-gray-100 transition-all ease-in-out duration-300 py-2 px-2 w-full"
                      >
                        {product.asin} - {product.name}...
                      </li>
                    ))
                  )}
                </motion.ul>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
      <div className="overflow-auto">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[768px] text-sm text-left table-fixed">
            <thead className="bg-[#333651] text-white">
              <tr>
                <th className="pl-2 w-[128px] min-w-[100px]">ASIN</th>
                <th className="pl-2 w-[400px] min-w-[200px]">Product Name</th>
                <th className="p-2 w-[160px] min-w-[120px]">Priority</th>
                <th className="p-2 w-[8rem] min-w-[80px]">Unit Sold</th>
                <th className="p-2 w-[6rem] min-w-[60px]">Sales</th>
                <th className="p-2 min-w-[80px]">Issues</th>
              </tr>
            </thead>
            <tbody className="min-h-[450px]">
              {prioritizedProducts.map((product, index) => (
                <tr key={index} className="border-t">
                  <td className="pl-2 w-[128px] break-words hover:underline cursor-pointer" onClick={() => openProductWithIssuePage(product.asin)}>{product.asin}</td>
                  <td className="p-2 w-[400px] truncate hover:underline cursor-pointer" onClick={() => openProductWithIssuePage(product.asin)}>
                    {product.name?.length > 50 ? `${product.name.slice(0, 50)}...` : product.name}
                  </td>
                  <td className={`p-2 w-[160px] font-bold ${priorityColors[product.priority]}`}>
                    {product.priority}
                  </td>
                  <td className="p-2  w-[8rem]">{product.quantity ?? "-"}</td>
                  <td className="p-2 w-[6rem]">{product.sales ?? "-"}</td>
                  <td className="p-2 text-blue-600 hover:underline cursor-pointer" onClick={() => openProductWithIssuePage(product.asin)}>{product.errors ?? 0} Issues</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      <div className="flex justify-center mt-4 gap-2 flex-wrap">
        <button
          className="border rounded-md px-3 py-1"
          onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          disabled={currentPage === 1}
        >
          &lt;
        </button>

        {pageNumbers[0] > 1 && <span className="px-2">...</span>}

        {pageNumbers.map((page) => (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            className={`rounded-md px-3 py-1 text-sm ${currentPage === page ? "bg-gray-900 text-white" : "border"
              }`}
          >
            {page}
          </button>
        ))}

        {pageNumbers[pageNumbers.length - 1] < totalPages && <span className="px-2">...</span>}

        <button
          className="border rounded-md px-3 py-1"
          onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
          disabled={currentPage === totalPages}
        >
          &gt;
        </button>
      </div>
    </div>
  );
}
