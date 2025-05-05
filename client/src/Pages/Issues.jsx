import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from 'react-redux';
import OverView from "../Components/Issues_pages/OverView.jsx";
import Category from "../Components/Issues_pages/Category.jsx";
import Products from "../Components/Issues_pages/Products.jsx";
import Account from "../Components/Issues_pages/Account.jsx";
import DropDown from '../assets/Icons/drop-down.png';
import { useNavigate } from "react-router-dom";
import dropdown from '../assets/Icons/Arrow.png'

export default function Dashboard() {
  const [issuesPages, setIssuesPages] = useState("Overview");
  const [prevPage, setPrevPage] = useState("Overview");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [issuesSelectedOption, setIssuesSelectedOption] = useState("All");
  const categoryTabRef = useRef(null);
  const navigate = useNavigate();

  const getDirection = () => {
    const order = ["Overview", "Category", "Account"];
    return order.indexOf(issuesPages) > order.indexOf(prevPage) ? 1 : -1;
  };

  const direction = getDirection();

  const pageVariants = {
    enter: (direction) => ({
      x: direction > 0 ? "100%" : "80vw",
      opacity: 0,
      position: "absolute",
      width: "100%",
    }),
    center: {
      x: 0,
      opacity: 1,
      position: "relative",
      width: "100%",
      transition: { duration: 0.5, ease: "easeInOut" },
    },
    exit: (direction) => ({
      x: direction > 0 ? "-80vw" : "100%",
      opacity: 0,
      position: "absolute",
      width: "100%",
      transition: { duration: 0.5, ease: "easeInOut" },
    }),
  };

  const renderComponent = (page) => {
    switch (page) {
      case "Overview":
        return <OverView />;
      case "Category":
        return <Category issuesSelectedOption={issuesSelectedOption} />;
      case "Account":
        return <Account />;
      default:
        return null;
    }
  };

  const handleTabClick = (nextPage) => {
    if (nextPage === issuesPages) return;
    setPrevPage(issuesPages);
    setIssuesPages(nextPage);
    setHasInteracted(true);
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
      <p className="text-sm">ISSUES</p>

      {/* Tab Menu */}
      <div className="mt-5">
        <div className="flex justify-between items-center px-4 py-2 relative">
          <div className="flex gap-4 flex-wrap text-sm relative">
            {["Overview", "Category", "Account"].map((item) => {
              const isActive = issuesPages === item;
              const isCategory = item === "Category";

              return (
                <div
                  key={item}
                  className="relative pb-3 cursor-pointer"
                  onClick={() => handleTabClick(item)}
                  ref={isCategory ? categoryTabRef : null}
                  onMouseEnter={() => isCategory && setShowCategoryDropdown(true)}
                  onMouseLeave={() => isCategory && setShowCategoryDropdown(false)}
                >
                  <p
                    style={{
                      color: isActive ? "#333651" : "#000000a0",
                      fontWeight: isActive ? "bold" : "normal",
                      position: "relative",
                    }}
                  >
                    {item === "Category"
                      ? <>Issues By Category <img src={dropdown} alt="dropdown" className="w-2 h-1 inline" /></>
                      : item === "Account"
                        ? "Account Issues"
                        : item}
                  </p>

                  {/* Animated underline */}
                  {isActive && (
                    <motion.div
                      layoutId="underline"
                      className="absolute bottom-0 left-0 right-0 h-[4px] bg-[#333651] rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}

                  {/* Category Dropdown on Hover with Framer Motion */}
                  <AnimatePresence>
                    {isCategory && showCategoryDropdown && (
                      <motion.div
                        className="absolute top-[100%] mt-2 w-[12rem] bg-white border rounded-md shadow-md z-[100] overflow-hidden"
                        onMouseEnter={() => setShowCategoryDropdown(true)}
                        onMouseLeave={() => setShowCategoryDropdown(false)}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      >
                        <ul className="p-2 text-sm text-gray-700 space-y-1">
                          {["Conversion", "Ranking", "All"].map((label, index) => (
                            <li
                              key={index}
                              className="px-2 py-1 hover:bg-[#333651] hover:text-white cursor-pointer rounded-md"
                              onClick={() => { setIssuesSelectedOption(label); setShowCategoryDropdown(false) }}
                            >
                              {label}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* Product Selector */}
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
                  className="w-[30rem] h-[30rem] overflow-x-hidden overflow-y-auto z-[99] bg-white absolute right-4 top-12 py-2 px-2 border-[1px] border-gray-300 shadow-md origin-top"
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

        <hr className="w-full h-[2px] bg-gray-200 mt-[-1px]" />
      </div>

      {/* Page Transition Area */}
      <div className="relative w-full min-h-[400px] overflow-hidden">
        <AnimatePresence custom={direction} mode="sync">
          <motion.div
            key={issuesPages}
            custom={direction}
            variants={pageVariants}
            initial={hasInteracted ? "enter" : false}
            animate="center"
            exit="exit"
          >
            {renderComponent(issuesPages)}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
