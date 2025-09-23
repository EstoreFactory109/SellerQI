import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from 'react-redux';
import OverView from "../Components/Issues_pages/OverView.jsx";
import Category from "../Components/Issues_pages/Category.jsx";
import Products from "../Components/Issues_pages/Products.jsx";
import Account from "../Components/Issues_pages/Account.jsx";
import { AlertTriangle, ChevronDown, Package, Search } from 'lucide-react';
import { useNavigate, useSearchParams } from "react-router-dom";

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';
  const navigate = useNavigate();

  const renderComponent = () => {
    switch (currentTab) {
      case "overview":
        return <OverView />;
      case "category":
        return <Category />;
      case "account":
        return <Account />;
      default:
        return <OverView />;
    }
  };

  const info = useSelector(state => state.Dashboard.DashBoardInfo);
  const [openSelector, setOpenSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenSelector(false);
        setSearchQuery(''); // Clear search when closing dropdown
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter products based on search query
  const filteredProducts = info?.productWiseError?.filter((item) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.asin.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query)
    );
  }) || [];

  return (
    <div className="min-h-screen bg-gray-50/50 lg:mt-0 mt-[12vh]">
      {/* Modern Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>
                  {currentTab === 'account' ? 'Account Issues' : 'Issues'}
                </h1>
                <p className='text-sm text-gray-600 mt-1'>
                  {currentTab === 'account' 
                    ? 'Monitor and resolve account health issues and policy violations' 
                    : 'Monitor and resolve product issues across your Amazon catalog'}
                </p>
              </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium'>
                <AlertTriangle className='w-2 h-2' />
                Issues detected
              </div>
            </div>
            
            <div className='flex items-center gap-3'>
              {/* Product Selector - Only show for non-account tabs */}
              {currentTab !== 'account' && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    className="flex items-center justify-between gap-3 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow text-sm font-medium text-gray-700 min-w-[180px]"
                    onClick={() => {
                      setOpenSelector(!openSelector);
                      if (!openSelector) {
                        setSearchQuery(''); // Clear search when opening dropdown
                      }
                    }}
                  >
                   <div className="flex items-center gap-2">
                     <Package className="w-4 h-4 text-gray-500" />
                     <span>Select Product</span>
                   </div>
                   <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSelector ? 'rotate-180' : ''}`} />
                 </button>
                 <AnimatePresence>
                   {openSelector && (
                     <motion.div
                       initial={{ opacity: 0, y: -10, scale: 0.95 }}
                       animate={{ opacity: 1, y: 0, scale: 1 }}
                       exit={{ opacity: 0, y: -10, scale: 0.95 }}
                       transition={{ duration: 0.2 }}
                       className="absolute top-full right-0 mt-2 w-96 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50"
                     >
                       <div className="p-3 border-b border-gray-200">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search products..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            />
                          </div>
                          {searchQuery && (
                            <div className="text-xs text-gray-500 mt-2">
                              {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
                            </div>
                          )}
                        </div>
                        <div className="py-2 max-h-64 overflow-y-auto">
                          {filteredProducts.length === 0 ? (
                            <div className="px-4 py-8 text-center text-gray-500 text-sm">
                              {searchQuery ? 'No products found matching your search.' : 'No products available.'}
                            </div>
                          ) : (
                            filteredProducts.map((item, index) => (
                              <button
                                key={`${item.asin}-${index}`}
                                className="w-full px-4 py-3 text-left text-sm hover:bg-blue-50 transition-all duration-150 text-gray-700 hover:text-blue-600 border-b border-gray-100 last:border-b-0"
                                onClick={() => {
                                  navigate(`/seller-central-checker/issues/${item.asin}`);
                                  setOpenSelector(false);
                                  setSearchQuery('');
                                }}
                              >
                                <div className="font-mono text-xs text-blue-600 mb-1">{item.asin}</div>
                                <div className="truncate">{item.name}</div>
                              </button>
                            ))
                          )}
                       </div>
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          {renderComponent()}
        </div>
      </div>
    </div>
  );
}
