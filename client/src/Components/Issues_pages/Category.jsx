import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, TrendingUp, Box, Filter, ChevronDown, Activity, LineChart, Layers, ShoppingBag } from 'lucide-react';
import { IssuesTableRowsSkeleton, IssuesCategoryPageSkeleton } from '../Skeleton/PageSkeletons.jsx';
import {
  fetchIssuesSummary,
  fetchRankingIssues,
  fetchConversionIssues,
  fetchInventoryIssues,
  fetchAccountIssues
} from '../../redux/slices/PageDataSlice';

/**
 * Build a Map from ASIN to product info for O(1) lookups.
 * @param {Array} productList - TotalProduct or productWiseError array
 * @returns {Map<string, object>}
 */
const buildProductInfoMap = (productList) => {
  const map = new Map();
  if (Array.isArray(productList)) {
    productList.forEach(p => {
      if (p?.asin) map.set(p.asin, p);
    });
  }
  return map;
};

const formatMessageWithHighlight = (message) => {
  if (!message) return { mainText: '', highlightedText: '' };
  
  const patterns = [
    /^(.*?)(The Characters used are:\s*.+)$/i,
    /^(.*?)(The characters which are used:\s*.+)$/i,
    /^(.*?)(The words Used are:\s*.+)$/,
    /^(.*?)(The words used are:\s*.+)$/i,
    /^(.*?)(The special characters used are:\s*.+)$/i,
    /^(.*?)(Only \d+ units available.*)$/i,
    /^(.*?)(Currently \d+ units available.*)$/i,
    /^(.*?)(\d+ units available.*)$/i,
    /^(.*?)(Reason:\s*.+)$/i,
    /^(.*?)(Problem:\s*.+)$/i,
    /^(.*?)(With \d+ page views.+)$/i,
    /^(.*?)(Amazon recommends replenishing \d+ units.*)$/i,
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

const FormattedMessage = ({ message }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message);
  
  return (
    <>
      {mainText && <span>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          <strong className="text-gray-100 mt-1 block">{highlightedText}</strong>
        </>
      )}
    </>
  );
};

const RankingTableSection = ({ data, pagination, loading, onLoadMore }) => {
  const navigate = useNavigate();

  const flattenedData = useMemo(() => {
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

    const extractErrors = (item) => {
      const errorRows = [];
      const sku = item.sku || '';

      sections.forEach((sectionKey) => {
        const section = item.data?.[sectionKey];

        if (section) {
          if (sectionKey === 'charLim') {
            if (section.status === 'Error') {
              errorRows.push({
                asin: item.asin,
                sku: sku,
                title: item.Title || item.data?.Title || 'N/A',
                issueHeading: `${sectionLabels[sectionKey]}`,
                message: section.Message,
                solution: section.HowTOSolve
              });
            }
          } else {
            Object.keys(issueLabels).forEach((checkKey) => {
              if (checkKey === 'charLim') return;
              const check = section[checkKey];
              if (check?.status === 'Error') {
                errorRows.push({
                  asin: item.asin,
                  sku: sku,
                  title: item.Title || item.data?.Title || 'N/A',
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

    return (data ?? []).flatMap(extractErrors);
  }, [data]);

  const hasMore = pagination?.hasMore ?? false;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="mb-2"
    >
      <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
        <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-red-400" />
            <div>
              <h2 className="text-sm font-bold text-gray-100">Ranking Optimization</h2>
              <p className="text-xs text-gray-400">Optimization opportunities for better search rankings</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-[#21262d]">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {flattenedData.map((row, idx) => (
                <tr 
                  key={idx} 
                  role="button"
                  tabIndex={0}
                  onClick={() => row.asin && navigate(`/seller-central-checker/${row.asin}`)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && row.asin) { e.preventDefault(); navigate(`/seller-central-checker/${row.asin}`); } }}
                  className="text-sm text-gray-200 cursor-pointer border-b border-[#30363d] hover:bg-[#21262d]/50"
                >
                  <td className="py-2 px-2 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs bg-[#21262d] px-1.5 py-0.5 rounded block break-words text-gray-100" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-500/10 px-1.5 py-0.5 rounded block break-words text-blue-400" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="flex items-start gap-1.5">
                      <Box className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <span className="font-medium text-gray-100 text-xs leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="space-y-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                        {row.issueHeading}
                      </span>
                      <p className="text-xs text-gray-300 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                      </p>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">{row.solution}</p>
                  </td>
                </tr>
              ))}
              {loading && <IssuesTableRowsSkeleton rows={5} />}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-[#21262d] px-2 py-2 border-t border-[#30363d]">
            <button
              className="w-full bg-red-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : `Load More (${pagination?.total - data?.length || 0} remaining)`}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ConversionTableSection = ({ data, buyBoxData, pagination, loading, onLoadMore }) => {
  const navigate = useNavigate();

  const productInfoMap = useMemo(() => buildProductInfoMap(data), [data]);

  const flattenData = useMemo(() => {
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

    const conversionErrors = (data || []).flatMap((item) => {
      const sku = item.sku || '';

      return getFormattedErrors(item).map((err) => ({
        asin: item.asin,
        sku: sku,
        title: item.Title || 'N/A',
        issueHeading: `${err.heading} | ${err.subheading}`,
        message: err.message,
        solution: err.solution
      }));
    });

    const buyboxErrors = [];
    if (Array.isArray(buyBoxData)) {
      buyBoxData.forEach((item) => {
        if (item.buyBoxPercentage === 0 || item.buyBoxPercentage < 50) {
          const asin = item.childAsin || item.parentAsin;
          const productDetails = productInfoMap.get(asin);
          const productTitle = productDetails?.Title || productDetails?.name || 'N/A';
          const sku = productDetails?.sku || '';

          let issueHeading, message, solution;
          if (item.buyBoxPercentage === 0) {
            issueHeading = 'Buy Box | No Buy Box';
            message = `This product has 0% Buy Box ownership. With ${item.pageViews || 0} page views and ${item.sessions || 0} sessions, you're losing potential sales to competitors who own the Buy Box.`;
            solution = 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics, and consider using repricing tools.';
          } else {
            issueHeading = 'Buy Box | Low Buy Box Percentage';
            message = `This product has only ${item.buyBoxPercentage.toFixed(1)}% Buy Box ownership. A significant portion of potential sales are going to competitors.`;
            solution = 'Improve your Buy Box percentage by optimizing pricing, maintaining competitive shipping, and improving seller metrics.';
          }

          buyboxErrors.push({ asin, sku, title: productTitle, issueHeading, message, solution });
        }
      });
    }

    const filteredConversionErrors = conversionErrors.filter(
      err => !err.issueHeading.includes('Buy Box')
    );

    return [...filteredConversionErrors, ...buyboxErrors];
  }, [data, buyBoxData, productInfoMap]);

  const hasMore = pagination?.hasMore ?? false;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 }}
      className="mb-2"
    >
      <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
        <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <LineChart className="w-4 h-4 text-blue-400" />
            <div>
              <h2 className="text-sm font-bold text-gray-100">Conversion Optimization</h2>
              <p className="text-xs text-gray-400">Enhance product appeal and customer conversion rates</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-[#21262d]">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {flattenData.map((row, idx) => (
                <tr 
                  key={idx} 
                  role="button"
                  tabIndex={0}
                  onClick={() => row.asin && navigate(`/seller-central-checker/${row.asin}`)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && row.asin) { e.preventDefault(); navigate(`/seller-central-checker/${row.asin}`); } }}
                  className="text-sm text-gray-200 cursor-pointer border-b border-[#30363d] hover:bg-[#21262d]/50"
                >
                  <td className="py-2 px-2 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs bg-[#21262d] px-1.5 py-0.5 rounded block break-words text-gray-100" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-500/10 px-1.5 py-0.5 rounded block break-words text-blue-400" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="flex items-start gap-1.5">
                      <Box className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="font-medium text-gray-100 text-xs leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="space-y-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        {row.issueHeading}
                      </span>
                      <p className="text-xs text-gray-300 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                      </p>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">{row.solution}</p>
                  </td>
                </tr>
              ))}
              {loading && <IssuesTableRowsSkeleton rows={5} />}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-[#21262d] px-2 py-2 border-t border-[#30363d]">
            <button
              className="w-full bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : `Load More (${pagination?.total - data?.length || 0} remaining)`}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const InventoryTableSection = ({ data, pagination, loading, onLoadMore }) => {
  const navigate = useNavigate();

  const flattenedData = useMemo(() => {
    const extractInventoryErrors = (item) => {
      const errorRows = [];
      const defaultSku = item.sku || '';

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

      if (item.replenishmentErrorData) {
        if (Array.isArray(item.replenishmentErrorData)) {
          item.replenishmentErrorData.forEach(error => {
            const sku = error.sku || defaultSku;
            errorRows.push({
              asin: item.asin,
              sku: sku,
              title: item.Title || 'N/A',
              issueHeading: `Replenishment | Low Inventory Risk`,
              message: error.Message,
              solution: error.HowToSolve,
              recommendedReplenishmentQty: error.recommendedReplenishmentQty || error.data || null
            });
          });
        } else {
          const sku = item.replenishmentErrorData.sku || defaultSku;
          errorRows.push({
            asin: item.asin,
            sku: sku,
            title: item.Title || 'N/A',
            issueHeading: `Replenishment | Low Inventory Risk`,
            message: item.replenishmentErrorData.Message,
            solution: item.replenishmentErrorData.HowToSolve,
            recommendedReplenishmentQty: item.replenishmentErrorData.recommendedReplenishmentQty || item.replenishmentErrorData.data || null
          });
        }
      }

      return errorRows;
    };

    return (data || []).flatMap(extractInventoryErrors);
  }, [data]);

  const hasMore = pagination?.hasMore ?? false;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="mb-2"
    >
      <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
        <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-green-400" />
            <div>
              <h2 className="text-sm font-bold text-gray-100">Inventory Management</h2>
              <p className="text-xs text-gray-400">Manage inventory levels and warehouse operations</p>
            </div>
          </div>
        </div>
        
        <div className="w-full">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-[#21262d]">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-40">ASIN/SKU</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/5">Product Title</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Issue Details</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {flattenedData.map((row, idx) => (
                <tr 
                  key={idx} 
                  role="button"
                  tabIndex={0}
                  onClick={() => row.asin && navigate(`/seller-central-checker/${row.asin}`)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && row.asin) { e.preventDefault(); navigate(`/seller-central-checker/${row.asin}`); } }}
                  className="text-sm text-gray-200 cursor-pointer border-b border-[#30363d] hover:bg-[#21262d]/50"
                >
                  <td className="py-2 px-2 align-top w-40">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs bg-[#21262d] px-1.5 py-0.5 rounded block break-words text-gray-100" title={row.asin}>{row.asin}</span>
                      {row.sku && (
                        <span className="font-mono text-xs bg-blue-500/10 px-1.5 py-0.5 rounded block break-words text-blue-400" title={row.sku}>{row.sku}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="flex items-start gap-1.5">
                      <Box className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="font-medium text-gray-100 text-xs leading-relaxed break-words">{row.title}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <div className="space-y-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                        {row.issueHeading}
                      </span>
                      <p className="text-xs text-gray-300 leading-relaxed break-words">
                        <FormattedMessage message={row.message} />
                        {row.recommendedReplenishmentQty !== null && row.recommendedReplenishmentQty !== undefined && row.recommendedReplenishmentQty > 0 && (
                          <>
                            <br />
                            <strong className="text-gray-100 mt-1 block">Recommended Restock Quantity: {row.recommendedReplenishmentQty} units</strong>
                          </>
                        )}
                      </p>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <p className="text-xs text-green-400 bg-green-500/10 p-2 rounded border border-green-500/30 leading-relaxed break-words">{row.solution}</p>
                  </td>
                </tr>
              ))}
              {loading && <IssuesTableRowsSkeleton rows={5} />}
            </tbody>
          </table>
        </div>
        
        {hasMore && (
          <div className="bg-[#21262d] px-2 py-2 border-t border-[#30363d]">
            <button
              className="w-full bg-green-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-green-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : `Load More (${pagination?.total - data?.length || 0} remaining)`}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const OptimizationDashboard = () => {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  
  // Get paginated state from Redux
  const summary = useSelector((state) => state.pageData?.issuesPaginated?.summary);
  const ranking = useSelector((state) => state.pageData?.issuesPaginated?.ranking);
  const conversion = useSelector((state) => state.pageData?.issuesPaginated?.conversion);
  const inventory = useSelector((state) => state.pageData?.issuesPaginated?.inventory);
  
  const getInitialFilter = () => {
    if (!filterParam) return "All";
    const filterMap = {
      'Ranking': 'Ranking',
      'Conversion': 'Conversion',
      'Inventory': 'Inventory',
    };
    return filterMap[filterParam] || "All";
  };
  
  const [issuesSelectedOption, setIssuesSelectedOption] = useState(getInitialFilter());
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef(null);
  
  // Track which categories have been fetched to prevent re-fetching
  const fetchedCategoriesRef = useRef({ ranking: false, conversion: false, inventory: false });

  // Fetch summary on mount
  useEffect(() => {
    dispatch(fetchIssuesSummary());
  }, [dispatch]);

  // Fetch category-specific data when filter changes or on mount
  useEffect(() => {
    if (issuesSelectedOption === 'All' || issuesSelectedOption === 'Ranking') {
      if (!fetchedCategoriesRef.current.ranking) {
        fetchedCategoriesRef.current.ranking = true;
        dispatch(fetchRankingIssues({ page: 1, limit: 10 }));
      }
    }
    if (issuesSelectedOption === 'All' || issuesSelectedOption === 'Conversion') {
      if (!fetchedCategoriesRef.current.conversion) {
        fetchedCategoriesRef.current.conversion = true;
        dispatch(fetchConversionIssues({ page: 1, limit: 10 }));
      }
    }
    if (issuesSelectedOption === 'All' || issuesSelectedOption === 'Inventory') {
      if (!fetchedCategoriesRef.current.inventory) {
        fetchedCategoriesRef.current.inventory = true;
        dispatch(fetchInventoryIssues({ page: 1, limit: 10 }));
      }
    }
  }, [dispatch, issuesSelectedOption]);

  useEffect(() => {
    if (filterParam) {
      const filterMap = {
        'Ranking': 'Ranking',
        'Conversion': 'Conversion',
        'Inventory': 'Inventory',
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

  // Load more handlers
  const handleLoadMoreRanking = useCallback(() => {
    const nextPage = (ranking.pagination?.page || 1) + 1;
    dispatch(fetchRankingIssues({ page: nextPage, limit: 10, append: true }));
  }, [dispatch, ranking.pagination?.page]);

  const handleLoadMoreConversion = useCallback(() => {
    const nextPage = (conversion.pagination?.page || 1) + 1;
    dispatch(fetchConversionIssues({ page: nextPage, limit: 10, append: true }));
  }, [dispatch, conversion.pagination?.page]);

  const handleLoadMoreInventory = useCallback(() => {
    const nextPage = (inventory.pagination?.page || 1) + 1;
    dispatch(fetchInventoryIssues({ page: nextPage, limit: 10, append: true }));
  }, [dispatch, inventory.pagination?.page]);

  // Get counts from summary
  const rankingIssues = summary.data?.totalRankingErrors || 0;
  const conversionIssues = summary.data?.totalConversionErrors || 0;
  const inventoryIssues = summary.data?.totalInventoryErrors || 0;
  const totalIssues = rankingIssues + conversionIssues + inventoryIssues;
  
  const isInitialLoading = summary.loading && !summary.data;

  if (isInitialLoading) {
    return <IssuesCategoryPageSkeleton />;
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a]">
      {/* Header Section */}
      <div className="bg-[#161b22] border border-[#30363d] rounded mb-2">
        <div className="px-2 py-2">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-4 h-4 text-blue-400" />
                <h1 className="text-lg font-bold text-gray-100">
                  Category Issues
                </h1>
              </div>
              <p className="text-xs text-gray-400">Detailed breakdown of issues by category</p>
              {totalIssues > 0 && (
                <div className="flex items-center gap-1 mt-1 text-xs text-orange-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Action required</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xl font-bold text-orange-400 mb-0.5">
                  {totalIssues}
                </div>
                <div className="text-xs text-gray-400 font-medium uppercase">Total Issues</div>
                <div className="text-xs text-gray-500 mt-0.5">(Ranking + Conversion + Inventory)</div>
              </div>
              <div className="w-10 h-10 bg-blue-500/20 rounded flex items-center justify-center border border-blue-500/30">
                <Layers className="w-5 h-5 text-blue-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-2 py-2">
        {/* Filter Section */}
        <div className="mb-2">
          <div className="bg-[#161b22] rounded border border-[#30363d] p-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-100 mb-0.5">Filter Issues</h3>
                <p className="text-xs text-gray-400">Choose a category to view specific issues</p>
              </div>
              
              <div className="relative" ref={categoryDropdownRef}>
                <button
                  className="flex items-center justify-between gap-2 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all min-w-[140px]"
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                >
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3 h-3" />
                    <span>{issuesSelectedOption}</span>
                  </div>
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showCategoryDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {showCategoryDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-1 w-56 bg-[#21262d] border border-[#30363d] rounded shadow-xl z-50 overflow-hidden"
                    >
                      <div className="py-1">
                        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-[#161b22] border-b border-[#30363d]">
                          Issue Categories
                        </div>
                        {["All", "Ranking", "Conversion", "Inventory"].map((option) => (
                          <button
                            key={option}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-[#161b22] transition-all ${
                              issuesSelectedOption === option 
                                ? 'bg-blue-500/20 text-blue-400 font-semibold border-r-2 border-blue-500' 
                                : 'text-gray-300 hover:text-gray-200'
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
        <div className="space-y-2">
          {issuesSelectedOption === "All" ? (
            <>
              {(rankingIssues > 0 || ranking.data?.length > 0) && (
                <RankingTableSection 
                  data={ranking.data} 
                  pagination={ranking.pagination}
                  loading={ranking.loading}
                  onLoadMore={handleLoadMoreRanking}
                />
              )}
              {(conversionIssues > 0 || conversion.data?.length > 0) && (
                <ConversionTableSection 
                  data={conversion.data} 
                  buyBoxData={conversion.buyBoxData}
                  pagination={conversion.pagination}
                  loading={conversion.loading}
                  onLoadMore={handleLoadMoreConversion}
                />
              )}
              {(inventoryIssues > 0 || inventory.data?.length > 0) && (
                <InventoryTableSection 
                  data={inventory.data}
                  pagination={inventory.pagination}
                  loading={inventory.loading}
                  onLoadMore={handleLoadMoreInventory}
                />
              )}
              {totalIssues === 0 && !isInitialLoading && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#161b22] rounded border border-[#30363d] p-8 text-center"
                >
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4 mx-auto border border-green-500/30">
                    <Activity className="w-8 h-8 text-green-400" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-100 mb-1">No Issues Found</h3>
                  <p className="text-gray-400">Your products are performing excellently across all categories!</p>
                </motion.div>
              )}
            </>
          ) : issuesSelectedOption === "Ranking" ? (
            rankingIssues > 0 || ranking.data?.length > 0 ? (
              <RankingTableSection 
                data={ranking.data} 
                pagination={ranking.pagination}
                loading={ranking.loading}
                onLoadMore={handleLoadMoreRanking}
              />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#161b22] rounded border border-[#30363d] p-8 text-center"
              >
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 mx-auto border border-red-500/30">
                  <TrendingUp className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-100 mb-1">No Ranking Issues</h3>
                <p className="text-gray-400">Your products have optimal ranking performance!</p>
              </motion.div>
            )
          ) : issuesSelectedOption === "Conversion" ? (
            conversionIssues > 0 || conversion.data?.length > 0 ? (
              <ConversionTableSection 
                data={conversion.data} 
                buyBoxData={conversion.buyBoxData}
                pagination={conversion.pagination}
                loading={conversion.loading}
                onLoadMore={handleLoadMoreConversion}
              />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#161b22] rounded border border-[#30363d] p-8 text-center"
              >
                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4 mx-auto border border-blue-500/30">
                  <LineChart className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-100 mb-1">No Conversion Issues</h3>
                <p className="text-gray-400">Your products have excellent conversion optimization!</p>
              </motion.div>
            )
          ) : issuesSelectedOption === "Inventory" ? (
            inventoryIssues > 0 || inventory.data?.length > 0 ? (
              <InventoryTableSection 
                data={inventory.data}
                pagination={inventory.pagination}
                loading={inventory.loading}
                onLoadMore={handleLoadMoreInventory}
              />
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#161b22] rounded border border-[#30363d] p-8 text-center"
              >
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4 mx-auto border border-green-500/30">
                  <Box className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-100 mb-1">No Inventory Issues</h3>
                <p className="text-gray-400">Your inventory management is performing perfectly!</p>
              </motion.div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default OptimizationDashboard;
