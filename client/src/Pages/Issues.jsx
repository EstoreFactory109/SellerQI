import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from 'react-redux';
import OverView from "../Components/Issues_pages/OverView.jsx";
import Category from "../Components/Issues_pages/Category.jsx";
import Products from "../Components/Issues_pages/Products.jsx";
import Account from "../Components/Issues_pages/Account.jsx";
import DropDown from '../assets/Icons/drop-down.png';
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
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="bg-[#eeeeee] p-6 space-y-6 lg:h-[90vh] lg:mt-0 mt-[10vh] overflow-y-auto relative">
      {/* Header with title and product selector */}
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">ISSUES</p>
        
        {/* Product Selector moved here */}
        <div className="w-fit" ref={dropdownRef}>
          <div
            className="w-[12rem] bg-white flex justify-center items-center px-2 py-1 border-[1px] border-gray-300 rounded-md text-sm text-gray-400 gap-3 cursor-pointer"
            onClick={() => setOpenSelector(!openSelector)}
          >
            <p>Select Your Product</p>
            <img src={DropDown} />
          </div>
          <AnimatePresence>
            {openSelector && (
              <motion.ul
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                style={{ transformOrigin: "top" }}
                className="w-[30rem] h-[30rem] overflow-x-hidden overflow-y-auto z-[99] bg-white absolute right-0 top-12 py-2 px-2 border-[1px] border-gray-300 shadow-md origin-top"
              >
                {info?.productWiseError?.map((item, index) => (
                  <li
                    className="flex justify-center items-center px-2 py-2 cursor-pointer hover:bg-[#333651] hover:text-white rounded-md text-sm text-justify"
                    key={index}
                    onClick={() => navigate(`/seller-central-checker/issues/${item.asin}`)}
                  >
                    {item.asin} | {item.name}...
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Page Content */}
      <div className="w-full">
        {renderComponent()}
      </div>
    </div>
  );
}
