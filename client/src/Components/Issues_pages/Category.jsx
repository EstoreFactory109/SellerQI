import React, { useState, useRef, useEffect } from 'react';
import { useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import dropdown from '../../assets/Icons/Arrow.png'

const RankingTableSection = ({ title, data }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 5;

  const extractErrors = (item) => {
    const errorRows = [];
    const sections = ['TitleResult', 'BulletPoints', 'Description'];
    const sectionLabels = {
      TitleResult: 'Title',
      BulletPoints: 'Bullet Points',
      Description: 'Description'
    };

    const issueLabels = {
      RestictedWords: 'Restricted Words',
      checkSpecialCharacters: 'Special Characters',
      charLim: 'Character Limit'
    };

    sections.forEach((sectionKey) => {
      const section = item.data[sectionKey];
      if (section) {
        Object.keys(issueLabels).forEach((checkKey) => {
          const check = section[checkKey];
          if (check?.status === 'Error') {
            errorRows.push({
              asin: item.asin,
              title:
                item.data?.Title?.length > 30
                  ? item.data.Title.slice(0, 30) + '...'
                  : item.data?.Title || 'N/A',
              issueHeading: `${sectionLabels[sectionKey]} | ${issueLabels[checkKey]}`,
              message: check.Message,
              solution: check.HowTOSolve
            });
          }
        });
      }
    });

    return errorRows;
  };

  const flattenedData = data.flatMap(extractErrors);
  const displayedData = flattenedData.slice(0, page * itemsPerPage);
  const hasMore = flattenedData.length > displayedData.length;

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
      <div className="overflow-x-auto rounded-lg shadow">
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
              <th className="px-4 py-3 border">ASIN</th>
              <th className="px-4 py-3 border">Product Title</th>
              <th className="px-4 py-3 border">Issue</th>
              <th className="px-4 py-3 border">How to solve</th>
            </tr>
          </thead>
          <tbody>
            {displayedData.map((row, idx) => (
              <tr key={idx} className="border-t text-sm text-gray-700">
                <td className="px-4 py-3 border">{row.asin}</td>
                <td className="px-4 py-3 border">{row.title}</td>
                <td className="px-4 py-3 border">
                  <span className="font-semibold">{row.issueHeading}:</span> {row.message}
                </td>
                <td className="px-4 py-3 border">{row.solution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            className="bg-[#333651] text-white px-4 py-2 rounded hover:bg-[#1e2031] transition"
            onClick={() => setPage((prev) => prev + 1)}
          >
            View More
          </button>
        </div>
      )}
    </div>
  );
};

const ConversionTableSection = ({ title, data }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 5;

  const getFormattedErrors = (item) => {
    const sections = [
      ['Images', item.imageResultErrorData],
      ['Videos', item.videoResultErrorData],
      ['Reviews', item.productReviewResultErrorData],
      ['Rating', item.productStarRatingResultErrorData],
      ['Buy Box', item.productsWithOutBuyboxErrorData],
      ['A Plus', item.aplusErrorData]
    ];

    return sections
      .filter(([_, value]) => value)
      .map(([label, errorObj]) => ({
        heading: label,
        subheading: errorObj.type || 'Issue',
        message: errorObj.Message,
        solution: errorObj.HowToSolve
      }));
  };

  const flattenData = data.flatMap((item) =>
    getFormattedErrors(item).map((err) => ({
      asin: item.asin,
      title:
        item.Title?.length > 30 ? item.Title.slice(0, 30) + '...' : item.Title,
      issueHeading: `${err.heading} | ${err.subheading}`,
      message: err.message,
      solution: err.solution
    }))
  );

  const displayedData = flattenData.slice(0, page * itemsPerPage);
  const hasMore = flattenData.length > displayedData.length;

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
      <div className="overflow-x-auto rounded-lg shadow">
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
              <th className="px-4 py-3 border">ASIN</th>
              <th className="px-4 py-3 border">Product Title</th>
              <th className="px-4 py-3 border">Issue</th>
              <th className="px-4 py-3 border">How to solve</th>
            </tr>
          </thead>
          <tbody>
            {displayedData.map((row, idx) => (
              <tr key={idx} className="border-t text-sm text-gray-700">
                <td className="px-4 py-3 border">{row.asin}</td>
                <td className="px-4 py-3 border">{row.title}</td>
                <td className="px-4 py-3 border">
                  <span className="font-semibold">{row.issueHeading}:</span> {row.message}
                </td>
                <td className="px-4 py-3 border">{row.solution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            className="bg-[#333651] text-white px-4 py-2 rounded hover:bg-[#1e2031] transition"
            onClick={() => setPage((prev) => prev + 1)}
          >
            View More
          </button>
        </div>
      )}
    </div>
  );
};

const OptimizationDashboard = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const [issuesSelectedOption, setIssuesSelectedOption] = useState("All");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Category Filter Dropdown */}
      <div className="mb-6" ref={categoryDropdownRef}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Filter by:</span>
          <div className="relative">
            <button
              className="flex items-center justify-between gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#333651] focus:border-transparent w-32"
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
            >
              <span>{issuesSelectedOption}</span>
              <img src={dropdown} alt="dropdown" className="w-2 h-1" />
            </button>
            
            <AnimatePresence>
              {showCategoryDropdown && (
                <motion.div
                  className="absolute top-full mt-1 w-32 bg-white border border-gray-300 rounded-md shadow-lg z-10 overflow-hidden"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <ul className="py-1 text-sm text-gray-700">
                    {["All", "Conversion", "Ranking"].map((option) => (
                      <li
                        key={option}
                        className="px-4 py-2 hover:bg-[#333651] hover:text-white cursor-pointer"
                        onClick={() => {
                          setIssuesSelectedOption(option);
                          setShowCategoryDropdown(false);
                        }}
                      >
                        {option}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Tables based on selection */}
      {issuesSelectedOption === "All" ? (
        <>
          <RankingTableSection title="Ranking Optimization" data={info.rankingProductWiseErrors} />
          <ConversionTableSection title="Conversion Optimization" data={info.conversionProductWiseErrors} />
        </>
      ) : issuesSelectedOption === "Ranking" ? (
        <RankingTableSection title="Ranking Optimization" data={info.rankingProductWiseErrors} />
      ) : (
        <ConversionTableSection title="Conversion Optimization" data={info.conversionProductWiseErrors} />
      )}
    </div>
  );
};

export default OptimizationDashboard;
