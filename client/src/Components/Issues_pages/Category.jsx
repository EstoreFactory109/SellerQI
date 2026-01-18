import React, { useState, useRef, useEffect } from 'react';
import { useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, TrendingUp, Package, Filter, ChevronDown, Eye, Activity, BarChart3, Search, Layers, ShoppingCart } from 'lucide-react';
import dropdown from '../../assets/Icons/Arrow.png'

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message) => {
  if (!message) return { mainText: '', highlightedText: '' };
  
  // Patterns to extract and highlight on a separate line
  // These patterns match the exact formats from the backend
  const patterns = [
    // Ranking - Restricted words patterns (exact backend formats)
    /^(.*?)(The Characters used are:\s*.+)$/i,  // Title - restricted words
    /^(.*?)(The characters which are used:\s*.+)$/i,  // Title - special characters
    /^(.*?)(The words Used are:\s*.+)$/,  // Bullet Points - restricted words (case sensitive 'Used')
    /^(.*?)(The words used are:\s*.+)$/i,  // Description - restricted words
    /^(.*?)(The special characters used are:\s*.+)$/i,  // Bullet Points & Description - special characters
    
    // Inventory patterns - units available
    /^(.*?)(Only \d+ units available.*)$/i,
    /^(.*?)(Currently \d+ units available.*)$/i,
    /^(.*?)(\d+ units available.*)$/i,
    
    // Inventory - Stranded reason
    /^(.*?)(Reason:\s*.+)$/i,
    
    // Inventory - Inbound non-compliance problem
    /^(.*?)(Problem:\s*.+)$/i,
    
    // Buy Box patterns
    /^(.*?)(With \d+ page views.+)$/i,
    
    // Amazon recommends pattern
    /^(.*?)(Amazon recommends replenishing \d+ units.*)$/i,
    
    // Unfulfillable inventory quantity
    /^(.*?)(Unfulfillable Quantity:\s*\d+\s*units)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[2]) {
      return {
        mainText: match[1].trim(),
        highlightedText: match[2].trim()
      };
    }
  }
  
  return { mainText: message, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessage = ({ message }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message);
  
  return (
    <>
      {mainText && <span>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          <strong className="text-gray-900 mt-1 block">{highlightedText}</strong>
        </>
      )}
    </>
  );
};

const RankingTableSection = ({ title, data }) => {
  console.log("data: ",data)
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const productInfo = info?.TotalProduct || info?.productWiseError || [];

  const extractErrors = (item) => {
    
    const errorRows = [];
    const sections = ['TitleResult', 'BulletPoints', 'Description', 'charLim'];
    const sectionLabels = {
      TitleResult: 'Title',
      BulletPoints: 'Bullet Points',
      Description: 'Description',
      charLim: 'Backend Keywords'
    };

    const issueLabels = {
      RestictedWords: 'Restricted Words',
      checkSpecialCharacters: 'Special Characters',
      charLim: 'Character Limit'
    };

    // Get SKU from productInfo
    const productDetails = productInfo.find(p => p.asin === item.asin);
    const sku = productDetails?.sku || item.sku || '';

    sections.forEach((sectionKey) => {
      
      const section = item.data[sectionKey];

      if (section) {
        // charLim section has a different structure - it's a direct object with status, Message, HowTOSolve
        if (sectionKey === 'charLim') {
          if (section.status === 'Error') {
              errorRows.push({
                asin: item.asin,
                sku: sku,
                title: item.data?.Title || 'N/A',
                issueHeading: `${sectionLabels[sectionKey]}`,
                message: section.Message,
                solution: section.HowTOSolve
              });
          }
        } else {
          // For other sections (TitleResult, BulletPoints, Description), check nested properties
          Object.keys(issueLabels).forEach((checkKey) => {
            // Skip charLim check for non-charLim sections
            if (checkKey === 'charLim') return;
            
            const check = section[checkKey];
            if (check?.status === 'Error') {
              errorRows.push({
                asin: item.asin,
                sku: sku,
                title: item.data?.Title || 'N/A',
                issueHeading: `${sectionLabels[sectionKey]} | ${issueLabels[checkKey]}`,
                message: check.Message,
                solution: check.HowTOSolve
              });
            }
          });
        }
      }
    });

    return errorRows;
  };

  const flattenedData = data.flatMap(extractErrors);
  const displayedData = flattenedData.slice(0, page * itemsPerPage);
  const hasMore = flattenedData.length > displayedData.length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="mb-8"
    >
      <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
        <div className="bg-gradient-to-r from-red-50 via-red-50 to-orange-50 px-6 py-4 border-b border-red-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center shadow-md">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-600">Optimization opportunities for better search rankings</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedData.map((row, idx) => (
                <motion.tr 
                  key={idx} 
                  whileHover={{ backgroundColor: '#f8fafc' }}
                  className="text-sm text-gray-700 hover:shadow-sm transition-all duration-200"
                >
                  <td className="py-5 px-4 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded block break-words" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-50 px-2 py-0.5 rounded block break-words text-blue-700" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Package className="w-3 h-3 text-blue-600" />
                      </div>
                      <span className="font-medium text-gray-900 text-sm leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="space-y-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        {row.issueHeading}
                      </span>
                      <p className="text-sm text-gray-600 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                      </p>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <p className="text-sm text-green-700 bg-green-50 p-3 rounded-lg leading-relaxed break-words">{row.solution}</p>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-100">
            <button
              className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white px-6 py-3 rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
              onClick={() => setPage((prev) => prev + 1)}
            >
              Load More ({flattenedData.length - displayedData.length} remaining)
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ConversionTableSection = ({ title, data, buyBoxData, productInfo }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const getFormattedErrors = (item) => {
    const sections = [
      ['Images', item.imageResultErrorData],
      ['Videos', item.videoResultErrorData],
      ['Rating', item.productStarRatingResultErrorData],
      ['Buy Box', item.productsWithOutBuyboxErrorData],
      ['A Plus', item.aplusErrorData],
      ['Brand Story', item.brandStoryErrorData]
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

  // Extract buybox errors from buyBoxData (products with 0% or <50% buybox)
  const getBuyboxErrors = () => {
    if (!buyBoxData || !Array.isArray(buyBoxData)) return [];
    
    const buyboxErrors = [];
    
    buyBoxData.forEach((item) => {
      // Only show products with buybox issues (0% or low buybox < 50%)
      if (item.buyBoxPercentage === 0 || item.buyBoxPercentage < 50) {
        const asin = item.childAsin || item.parentAsin;
        
        // Find product title from productInfo
        const productDetails = productInfo?.find(p => p.asin === asin);
        const productTitle = productDetails?.name || productDetails?.itemName || 'N/A';
        
        // Determine issue type and generate appropriate message/solution
        let issueHeading, message, solution;
        
        if (item.buyBoxPercentage === 0) {
          issueHeading = 'Buy Box | No Buy Box';
          message = `This product has 0% Buy Box ownership. With ${item.pageViews || 0} page views and ${item.sessions || 0} sessions, you're losing potential sales to competitors who own the Buy Box.`;
          solution = 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics (shipping time, order defect rate), and consider using repricing tools. Also ensure your product is Prime eligible if possible.';
        } else {
          issueHeading = 'Buy Box | Low Buy Box Percentage';
          message = `This product has only ${item.buyBoxPercentage.toFixed(1)}% Buy Box ownership. With ${item.pageViews || 0} page views and ${item.sessions || 0} sessions, a significant portion of potential sales are going to competitors.`;
          solution = 'Improve your Buy Box percentage by optimizing your pricing, maintaining competitive shipping options, improving seller metrics (late shipment rate, cancellation rate), and ensuring inventory availability. Consider FBA if you\'re currently using FBM.';
        }
        
        // Get SKU from productDetails
        const sku = productDetails?.sku || '';
        
        buyboxErrors.push({
          asin,
          sku: sku,
          title: productTitle,
          issueHeading,
          message,
          solution
        });
      }
    });
    
    return buyboxErrors;
  };

  // Get conversion errors from data
  const conversionErrors = data.flatMap((item) => {
    // Get SKU from productInfo
    const productDetails = productInfo?.find(p => p.asin === item.asin);
    const sku = productDetails?.sku || item.sku || '';
    
    return getFormattedErrors(item).map((err) => ({
      asin: item.asin,
      sku: sku,
      title: item.Title || 'N/A',
      issueHeading: `${err.heading} | ${err.subheading}`,
      message: err.message,
      solution: err.solution
    }));
  });

  // Get buybox errors and combine with conversion errors
  const buyboxErrors = getBuyboxErrors();
  
  // Filter out buybox errors from conversionErrors that are already in buyboxErrors (avoid duplicates)
  const filteredConversionErrors = conversionErrors.filter(
    err => !err.issueHeading.includes('Buy Box')
  );
  
  // Combine conversion errors with buybox errors
  const flattenData = [...filteredConversionErrors, ...buyboxErrors];

  const displayedData = flattenData.slice(0, page * itemsPerPage);
  const hasMore = flattenData.length > displayedData.length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 }}
      className="mb-8"
    >
      <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
        <div className="bg-gradient-to-r from-blue-50 via-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-md">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-600">Enhance product appeal and customer conversion rates</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedData.map((row, idx) => (
                <motion.tr 
                  key={idx} 
                  whileHover={{ backgroundColor: '#f8fafc' }}
                  className="text-sm text-gray-700 hover:shadow-sm transition-all duration-200"
                >
                  <td className="py-5 px-4 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded block break-words" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-50 px-2 py-0.5 rounded block break-words text-blue-700" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-green-100 to-green-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Package className="w-3 h-3 text-green-600" />
                      </div>
                      <span className="font-medium text-gray-900 text-sm leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="space-y-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {row.issueHeading}
                      </span>
                      <p className="text-sm text-gray-600 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                      </p>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <p className="text-sm text-green-700 bg-green-50 p-3 rounded-lg leading-relaxed break-words">{row.solution}</p>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-100">
            <button
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
              onClick={() => setPage((prev) => prev + 1)}
            >
              Load More ({flattenData.length - displayedData.length} remaining)
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const InventoryTableSection = ({ title, data }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;
  console.log("InventoryTableSection: ", data);
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const productInfo = info?.TotalProduct || info?.productWiseError || [];
  
  const extractInventoryErrors = (item) => {
    console.log("extractInventoryErrors - processing item:", item);
    const errorRows = [];
    
    // Get SKU from productInfo (fallback to item.sku if available)
    const productDetails = productInfo.find(p => p.asin === item.asin);
    const defaultSku = productDetails?.sku || item.sku || '';

    // Process inventory planning errors
    if (item.inventoryPlanningErrorData) {
      const planning = item.inventoryPlanningErrorData;
      if (planning.longTermStorageFees?.status === "Error") {
        errorRows.push({
          asin: item.asin,
          sku: defaultSku,
          title: item.Title || 'N/A',
          issueHeading: 'Inventory Planning | Long-Term Storage Fees',
          message: planning.longTermStorageFees.Message,
          solution: planning.longTermStorageFees.HowToSolve
        });
      }
      if (planning.unfulfillable?.status === "Error") {
        errorRows.push({
          asin: item.asin,
          sku: defaultSku,
          title: item.Title || 'N/A',
          issueHeading: 'Inventory Planning | Unfulfillable Inventory',
          message: planning.unfulfillable.Message,
          solution: planning.unfulfillable.HowToSolve
        });
      }
    }

    // Process stranded inventory errors
    if (item.strandedInventoryErrorData) {
      errorRows.push({
        asin: item.asin,
        sku: defaultSku,
        title: item.Title || 'N/A',
        issueHeading: 'Stranded Inventory | Product Not Listed',
        message: item.strandedInventoryErrorData.Message,
        solution: item.strandedInventoryErrorData.HowToSolve
      });
    }

    // Process inbound non-compliance errors
    if (item.inboundNonComplianceErrorData) {
      errorRows.push({
        asin: item.asin,
        sku: defaultSku,
        title: item.Title || 'N/A',
        issueHeading: 'Inbound Non-Compliance | Shipment Issue',
        message: item.inboundNonComplianceErrorData.Message,
        solution: item.inboundNonComplianceErrorData.HowToSolve
      });
    }

    // Process replenishment/restock errors - handles single or multiple
    if (item.replenishmentErrorData) {
      if (Array.isArray(item.replenishmentErrorData)) {
        // Multiple errors for same ASIN (different SKUs)
        item.replenishmentErrorData.forEach(error => {
          // Use SKU from error if available, otherwise use default
          const sku = error.sku || defaultSku;
          errorRows.push({
            asin: item.asin,
            sku: sku,
            title: item.Title || 'N/A',
            issueHeading: `Replenishment | Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
            message: error.Message,
            solution: error.HowToSolve,
            recommendedReplenishmentQty: error.recommendedReplenishmentQty || error.data || null
          });
        });
      } else {
        // Single error - use SKU from error data if available
        const sku = item.replenishmentErrorData.sku || defaultSku;
        errorRows.push({
          asin: item.asin,
          sku: sku,
          title: item.Title || 'N/A',
          issueHeading: `Replenishment | Low Inventory Risk ${item.replenishmentErrorData.sku ? `(SKU: ${item.replenishmentErrorData.sku})` : ''}`,
          message: item.replenishmentErrorData.Message,
          solution: item.replenishmentErrorData.HowToSolve,
          recommendedReplenishmentQty: item.replenishmentErrorData.recommendedReplenishmentQty || item.replenishmentErrorData.data || null
        });
      }
    }

    return errorRows;
  };

  const flattenedData = data.flatMap(extractInventoryErrors);
  const displayedData = flattenedData.slice(0, page * itemsPerPage);
  const hasMore = flattenedData.length > displayedData.length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="mb-8"
    >
      <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
        <div className="bg-gradient-to-r from-green-50 via-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-md">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-600">Manage inventory levels and warehouse operations</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedData.map((row, idx) => (
                <motion.tr 
                  key={idx} 
                  whileHover={{ backgroundColor: '#f8fafc' }}
                  className="text-sm text-gray-700 hover:shadow-sm transition-all duration-200"
                >
                  <td className="py-5 px-4 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded block break-words" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-50 px-2 py-0.5 rounded block break-words text-blue-700" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Package className="w-3 h-3 text-yellow-600" />
                      </div>
                      <span className="font-medium text-gray-900 text-sm leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="space-y-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {row.issueHeading}
                      </span>
                      <p className="text-sm text-gray-600 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                        {row.recommendedReplenishmentQty !== null && row.recommendedReplenishmentQty !== undefined && row.recommendedReplenishmentQty > 0 && (
                          <>
                            <br />
                            <strong className="text-gray-900 mt-1 block">Recommended Restock Quantity: {row.recommendedReplenishmentQty} units</strong>
                          </>
                        )}
                      </p>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <p className="text-sm text-green-700 bg-green-50 p-3 rounded-lg leading-relaxed break-words">{row.solution}</p>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-100">
            <button
              className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-xl hover:from-green-600 hover:to-green-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
              onClick={() => setPage((prev) => prev + 1)}
            >
              Load More ({flattenedData.length - displayedData.length} remaining)
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const BuyboxTableSection = ({ title, data, productInfo }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const extractBuyboxErrors = (buyboxData) => {
    if (!buyboxData || !Array.isArray(buyboxData)) return [];
    
    const errorRows = [];
    
    buyboxData.forEach((item) => {
      // Only show products with buybox issues (0% or low buybox < 50%)
      if (item.buyBoxPercentage === 0 || item.buyBoxPercentage < 50) {
        const asin = item.childAsin || item.parentAsin;
        
        // Find product title from productInfo
        const productDetails = productInfo?.find(p => p.asin === asin);
        const productTitle = productDetails?.name || productDetails?.itemName || 'N/A';
        
        // Determine issue type and generate appropriate message/solution
        let issueHeading, message, solution;
        
        if (item.buyBoxPercentage === 0) {
          issueHeading = 'Buy Box | No Buy Box';
          message = `This product has 0% Buy Box ownership. With ${item.pageViews || 0} page views and ${item.sessions || 0} sessions, you're losing potential sales to competitors who own the Buy Box.`;
          solution = 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics (shipping time, order defect rate), and consider using repricing tools. Also ensure your product is Prime eligible if possible.';
        } else {
          issueHeading = 'Buy Box | Low Buy Box Percentage';
          message = `This product has only ${item.buyBoxPercentage.toFixed(1)}% Buy Box ownership. With ${item.pageViews || 0} page views and ${item.sessions || 0} sessions, a significant portion of potential sales are going to competitors.`;
          solution = 'Improve your Buy Box percentage by optimizing your pricing, maintaining competitive shipping options, improving seller metrics (late shipment rate, cancellation rate), and ensuring inventory availability. Consider FBA if you\'re currently using FBM.';
        }
        
        // Get SKU from productDetails
        const sku = productDetails?.sku || '';
        
        errorRows.push({
          asin,
          sku: sku,
          title: productTitle,
          issueHeading,
          message,
          solution,
          buyBoxPercentage: item.buyBoxPercentage,
          pageViews: item.pageViews,
          sessions: item.sessions
        });
      }
    });
    
    // Sort by buybox percentage (lowest first)
    return errorRows.sort((a, b) => a.buyBoxPercentage - b.buyBoxPercentage);
  };

  const flattenedData = extractBuyboxErrors(data);
  const displayedData = flattenedData.slice(0, page * itemsPerPage);
  const hasMore = flattenedData.length > displayedData.length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="mb-8"
    >
      <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
        <div className="bg-gradient-to-r from-purple-50 via-purple-50 to-indigo-50 px-6 py-4 border-b border-purple-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-600">Products losing sales due to Buy Box issues</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedData.map((row, idx) => (
                <motion.tr 
                  key={idx} 
                  whileHover={{ backgroundColor: '#f8fafc' }}
                  className="text-sm text-gray-700 hover:shadow-sm transition-all duration-200"
                >
                  <td className="py-5 px-4 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded block break-words" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-50 px-2 py-0.5 rounded block break-words text-blue-700" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <ShoppingCart className="w-3 h-3 text-purple-600" />
                      </div>
                      <span className="font-medium text-gray-900 text-sm leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <div className="space-y-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {row.issueHeading}
                      </span>
                      <p className="text-sm text-gray-600 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                      </p>
                    </div>
                  </td>
                  <td className="py-5 px-4 align-top">
                    <p className="text-sm text-green-700 bg-green-50 p-3 rounded-lg leading-relaxed break-words">{row.solution}</p>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-100">
            <button
              className="w-full bg-gradient-to-r from-purple-500 to-purple-600 text-white px-6 py-3 rounded-xl hover:from-purple-600 hover:to-purple-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
              onClick={() => setPage((prev) => prev + 1)}
            >
              Load More ({flattenedData.length - displayedData.length} remaining)
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const OptimizationDashboard = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  console.log("info: ",info)
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  
  // Map URL filter values to component filter options
  const getInitialFilter = () => {
    if (!filterParam) return "All";
    const filterMap = {
      'Ranking': 'Ranking',
      'Conversion': 'Conversion',
      'Inventory': 'Inventory',
      'Profitability': 'Profitability',
      'SponsoredAds': 'SponsoredAds'
    };
    return filterMap[filterParam] || "All";
  };
  
  const [issuesSelectedOption, setIssuesSelectedOption] = useState(getInitialFilter());
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef(null);

  // Update filter when URL parameter changes
  useEffect(() => {
    if (filterParam) {
      const filterMap = {
        'Ranking': 'Ranking',
        'Conversion': 'Conversion',
        'Inventory': 'Inventory',
        'Profitability': 'Profitability',
        'SponsoredAds': 'SponsoredAds'
      };
      const newFilter = filterMap[filterParam] || "All";
      setIssuesSelectedOption(newFilter);
    }
  }, [filterParam]);

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

  // Calculate issue counts for summary cards
  // Use the same fields as dashboard to ensure consistency
  const rankingIssues = info?.TotalRankingerrors || 0;
  const conversionIssues = info?.totalErrorInConversion || 0;
  const inventoryIssues = info?.totalInventoryErrors || 0;
  
  // Calculate buybox issues count (for display purposes only, already included in conversionIssues)
  const buyboxIssues = (() => {
    if (!info?.buyBoxData?.asinBuyBoxData) return 0;
    return info.buyBoxData.asinBuyBoxData.filter(
      item => item.buyBoxPercentage === 0 || item.buyBoxPercentage < 50
    ).length;
  })();
  
  // Total issues should match dashboard: sum of ranking, conversion, and inventory
  const totalIssues = rankingIssues + conversionIssues + inventoryIssues;

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-slate-800 via-gray-900 to-slate-900 rounded-2xl mx-6 mt-6 shadow-lg">
        <div className="px-6 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="text-white relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Category Issues
                </h1>
              </div>
              <p className="text-gray-300 text-lg mb-4">Detailed breakdown of issues by category</p>
              {totalIssues > 0 && (
                <div className="flex items-center gap-2 text-sm text-orange-300">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Action required</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-6 text-white">
              <div className="text-center lg:text-right">
                <div className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent mb-1">
                  {totalIssues}
                </div>
                <div className="text-sm text-gray-300 font-medium tracking-wide uppercase">Total Issues</div>
                <div className="text-xs text-gray-400 mt-1">(Ranking + Conversion + Inventory)</div>
                {totalIssues > 0 && (
                  <div className="text-xs text-orange-300 mt-1">Requires optimization</div>
                )}
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Layers className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-8">
        {/* Filter Section */}
        <div className="mb-8">
          <div className="bg-white rounded-2xl shadow-lg border-0 p-6 hover:shadow-xl transition-all duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Filter Issues</h3>
                <p className="text-sm text-gray-600">Choose a category to view specific issues</p>
              </div>
              
              <div className="relative" ref={categoryDropdownRef}>
                <button
                  className="flex items-center justify-between gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-md hover:shadow-lg min-w-[160px]"
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                >
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    <span className="font-medium">{issuesSelectedOption}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showCategoryDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {showCategoryDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      <div className="py-2">
                        <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                          Issue Categories
                        </div>
                        {["All", "Ranking", "Conversion", "Inventory"].map((option) => (
                          <button
                            key={option}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition-all duration-150 ${
                              issuesSelectedOption === option 
                                ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-500' 
                                : 'text-gray-700 hover:text-blue-600'
                            }`}
                            onClick={() => {
                              setIssuesSelectedOption(option);
                              setShowCategoryDropdown(false);
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Tables based on selection */}
        <div className="space-y-8">
          {issuesSelectedOption === "All" ? (
            <>
              {rankingIssues > 0 && <RankingTableSection title="Ranking Optimization" data={info.rankingProductWiseErrors} />}
              {conversionIssues > 0 && <ConversionTableSection title="Conversion Optimization (includes Buy Box)" data={info.conversionProductWiseErrors} buyBoxData={info.buyBoxData?.asinBuyBoxData || []} productInfo={info.TotalProduct || info.productWiseError || []} />}
              {inventoryIssues > 0 && <InventoryTableSection title="Inventory Management" data={info.inventoryProductWiseErrors || []} />}
              {totalIssues === 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl shadow-lg border-0 p-12 text-center"
                >
                  <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg">
                    <Activity className="w-10 h-10 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">No Issues Found</h3>
                  <p className="text-gray-600">Your products are performing excellently across all categories!</p>
                </motion.div>
              )}
            </>
          ) : issuesSelectedOption === "Ranking" ? (
            rankingIssues > 0 ? (
              <RankingTableSection title="Ranking Optimization" data={info.rankingProductWiseErrors} />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-lg border-0 p-12 text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-red-400 to-red-500 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg">
                  <TrendingUp className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No Ranking Issues</h3>
                <p className="text-gray-600">Your products have optimal ranking performance!</p>
              </motion.div>
            )
          ) : issuesSelectedOption === "Conversion" ? (
            conversionIssues > 0 ? (
              <ConversionTableSection title="Conversion Optimization (includes Buy Box)" data={info.conversionProductWiseErrors} buyBoxData={info.buyBoxData?.asinBuyBoxData || []} productInfo={info.TotalProduct || info.productWiseError || []} />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-lg border-0 p-12 text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-500 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg">
                  <BarChart3 className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No Conversion Issues</h3>
                <p className="text-gray-600">Your products have excellent conversion optimization!</p>
              </motion.div>
            )
          ) : issuesSelectedOption === "Inventory" ? (
            inventoryIssues > 0 ? (
              <InventoryTableSection title="Inventory Management" data={info.inventoryProductWiseErrors || []} />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-lg border-0 p-12 text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg">
                  <Package className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No Inventory Issues</h3>
                <p className="text-gray-600">Your inventory management is performing perfectly!</p>
              </motion.div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default OptimizationDashboard;
