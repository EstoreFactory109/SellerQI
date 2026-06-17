import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import MetricCard from '../../Components/ProfitibilityDashboard/MetricCard';
import ProfitTable from '../../Components/ProfitibilityDashboard/ProfitTable';
import SuggestionList from '../../Components/ProfitibilityDashboard/SuggestionList';
import { useSelector, useDispatch } from "react-redux";
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertCircle, TrendingUp, Download, Calendar, BarChart3, TrendingDown, DollarSign, Target, Zap, HelpCircle, Loader2 } from 'lucide-react';
import Calender, { isClickInsideGaCalDropdown } from '../../Components/Calender/Calender.jsx';
import DownloadReport from '../../Components/DownloadReport/DownloadReport.jsx';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';
import { parseLocalDate, formatDateDisplay } from '../../utils/dateUtils.js';
import {
  resolveProfitabilityQueryDates,
  enumerateDatesInRange,
  isYmdInRange,
} from '../../utils/profitabilityDateRange.js';

import { devLog } from '../../utils/devLogger.js';
import axios from 'axios';
import { fetchLatestPPCMetrics, selectPPCSummary, selectPPCDateWiseMetrics, selectLatestPPCMetricsLoading } from '../../redux/slices/PPCMetricsSlice.js';
import { fetchPPCKPISummary, selectPPCKPISummary } from '../../redux/slices/PPCCampaignAnalysisSlice.js';
import {
  fetchProfitabilityDateRange,
  fetchProfitabilityIssues,
  forceRefresh,
} from '../../redux/slices/PageDataSlice.js';
import { setDashboardDateRange } from '../../redux/slices/DashboardSlice.js';
import { fetchCogs } from '../../redux/slices/cogsSlice.js';
import { computeTotalCogs } from '../../utils/cogsCalculations.js';

// Helper function to get actual end date (yesterday due to 24-hour data delay)
const getActualEndDate = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
};

// Chart series for the selected window only (zeros when no rows exist for a day)
const createEmptyProfitabilityData = (startDate, endDate) => {
  if (!startDate || !endDate) return [];
  return enumerateDatesInRange(startDate, endDate).map((ymd) => ({
    date: formatDateDisplay(ymd),
      grossProfit: 0,
    totalSales: 0,
    spend: 0,
  }));
};

/** One point per day in the selected range; values from dailyMap keyed by YYYY-MM-DD. */
const buildConstrainedChartSeries = (queryDates, dailyMap) => {
  if (!queryDates?.ready) return [];
  return enumerateDatesInRange(queryDates.startDate, queryDates.endDate).map((ymd) => {
    const row = dailyMap.get(ymd);
    return {
      date: formatDateDisplay(ymd),
      grossProfit: parseFloat((row?.grossProfit ?? 0).toFixed(2)),
      totalSales: parseFloat((row?.totalSales ?? 0).toFixed(2)),
      spend: parseFloat((row?.spend ?? 0).toFixed(2)),
    };
  });
};

const ProfitabilityDashboard = () => {
  const dispatch = useDispatch();
  const [suggestionsData, setSuggestionsData] = useState([]);
  const [openCalender, setOpenCalender] = useState(false);
  const [showCogsPopup, setShowCogsPopup] = useState(false);
  const [profitabilityTab, setProfitabilityTab] = useState('table'); // 'table' | 'issues'
  const [ppcGraphData, setPpcGraphData] = useState([]);
  const [financeDashTotals, setFinanceDashTotals] = useState(null);
  const [financeDashAsinWise, setFinanceDashAsinWise] = useState(null);
  const [financeDashDateWise, setFinanceDashDateWise] = useState(null);
  const [financeDashOverhead, setFinanceDashOverhead] = useState([]);
  const [financeDashOverheadTotal, setFinanceDashOverheadTotal] = useState(0);
  const [financeDashRelationships, setFinanceDashRelationships] = useState(null);
  const [financeDashLoading, setFinanceDashLoading] = useState(false);
  const CalenderRef = useRef(null);
  const calendarAnchorRef = useRef(null);
  
  // PPCMetrics model data (PRIMARY source for PPC spend)
  const ppcSummary = useSelector(selectPPCSummary);
  const ppcKPISummary = useSelector(selectPPCKPISummary);
  const ppcDateWiseMetrics = useSelector(selectPPCDateWiseMetrics);
  const ppcMetricsLoading = useSelector(selectLatestPPCMetricsLoading);
  const ppcMetricsLastFetched = useSelector(state => state.ppcMetrics?.latestMetrics?.lastFetched);
  
  // Fetch PPC metrics on mount (cached for 5 minutes)
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000;
    const now = Date.now();
    const shouldFetch = !ppcMetricsLastFetched || (now - ppcMetricsLastFetched) > CACHE_DURATION;
    
    if (shouldFetch && !ppcMetricsLoading) {
      dispatch(fetchLatestPPCMetrics());
      dispatch(fetchPPCKPISummary());
    }
  }, [dispatch, ppcMetricsLastFetched, ppcMetricsLoading]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isClickInsideGaCalDropdown(event.target)) return;
      if (CalenderRef.current && !CalenderRef.current.contains(event.target)) {
        setOpenCalender(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Check if COGS popup should be shown (once per session)
  useEffect(() => {
    const hasShownCogsPopup = sessionStorage.getItem('profitability_cogs_popup_shown');
    if (!hasShownCogsPopup) {
      // Show popup after a short delay for better UX
      const timer = setTimeout(() => {
        setShowCogsPopup(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleCloseCogsPopup = () => {
    setShowCogsPopup(false);
    sessionStorage.setItem('profitability_cogs_popup_shown', 'true');
  };

  // Isolated date range — not tied to main dashboard / Total Sales loading
  const profitabilityDates = useSelector((state) => state.pageData?.profitabilityDates || {});
  const issuesState = useSelector((state) => state.pageData?.profitabilityIssues || {});
  const issuesData = issuesState.data || [];
  const issuesSummary = issuesState.summary;
  const issuesPagination = issuesState.pagination;
  const issuesLoading = issuesState.loading;
  const issuesDateRangeRef = useRef({ startDate: null, endDate: null });

  useEffect(() => {
    dispatch(fetchProfitabilityDateRange());
  }, [dispatch]);

  const calendarMode = profitabilityDates.calendarMode || 'default';
  const startDate = profitabilityDates.startDate;
  const endDate = profitabilityDates.endDate;

  const queryDates = useMemo(
    () => resolveProfitabilityQueryDates({ calendarMode, startDate, endDate }),
    [calendarMode, startDate, endDate]
  );

  // Calendar UI reads Dashboard slice — sync dates only (no full dashboard payload)
  useEffect(() => {
    if (!profitabilityDates.bootstrapped || !startDate || !endDate) return;
    dispatch(setDashboardDateRange({ startDate, endDate, calendarMode }));
  }, [profitabilityDates.bootstrapped, startDate, endDate, calendarMode, dispatch]);

  const fetchNextIssuesPage = useCallback(() => {
    const currentPage = issuesPagination?.page || 1;
    const hasMore = issuesPagination?.hasMore ?? true;
    if (hasMore && !issuesLoading) {
      dispatch(fetchProfitabilityIssues({
        page: currentPage + 1,
        limit: 10,
        startDate: issuesDateRangeRef.current.startDate,
        endDate: issuesDateRangeRef.current.endDate,
      }));
    }
  }, [dispatch, issuesPagination, issuesLoading]);
  
  // Get currency from Redux
  const currency = useSelector(state => state.currency?.currency) || '$';

  // Finance dashboard + PPC graph (primary data for KPIs, chart, table) — independent of main dashboard
  useEffect(() => {
    if (!queryDates.ready) return;

    let cancelled = false;
    const { startDate: fdStartDate, endDate: fdEndDate } = queryDates;

    const fetchFinanceDashboardData = async () => {
      setFinanceDashLoading(true);
      try {
        const root = String(import.meta.env.VITE_BASE_URI || '').replace(/\/$/, '');

        const financeDashUrl = `${root}/api/finance-dashboard?startDate=${encodeURIComponent(fdStartDate)}&endDate=${encodeURIComponent(fdEndDate)}`;
        const ppcGraphUrl = `${root}/api/pagewise/ppc-metrics/graph?startDate=${encodeURIComponent(fdStartDate)}&endDate=${encodeURIComponent(fdEndDate)}`;

        const [fdResp, ppcGraphResp] = await Promise.all([
          axios.get(financeDashUrl, { withCredentials: true }).catch((e) => { console.error('Finance dashboard API error:', e?.response?.status, e?.response?.data || e.message); return null; }),
          axios.get(ppcGraphUrl, { withCredentials: true }).catch(() => null),
        ]);

        if (cancelled) return;

        if (fdResp?.data?.data) {
          const fd = fdResp.data.data;
          setFinanceDashTotals(fd.totals || null);
          setFinanceDashAsinWise(fd.asinWise || null);
          setFinanceDashDateWise(fd.dateWise || null);
          setFinanceDashOverhead(fd.overhead || []);
          setFinanceDashOverheadTotal(fd.overheadTotal || 0);
          setFinanceDashRelationships(fd.relationships || null);
        }
        setPpcGraphData(ppcGraphResp?.data?.data?.graphData || []);
      } catch (err) {
        console.error('Error fetching finance dashboard data:', err);
      } finally {
        if (!cancelled) setFinanceDashLoading(false);
      }
    };

    fetchFinanceDashboardData();
    return () => { cancelled = true; };
  }, [queryDates.ready, queryDates.startDate, queryDates.endDate]);

  // Re-fetch profitability issues with the resolved date range so they
  // reflect the same window the rest of the dashboard is showing.
  useEffect(() => {
    if (!queryDates.ready) return;
    issuesDateRangeRef.current = {
      startDate: queryDates.startDate,
      endDate: queryDates.endDate,
    };
    dispatch(forceRefresh('profitabilityIssues'));
    dispatch(fetchProfitabilityIssues({
      page: 1,
      limit: 10,
      startDate: queryDates.startDate,
      endDate: queryDates.endDate,
    }));
  }, [queryDates.ready, queryDates.startDate, queryDates.endDate, dispatch]);

  const chartData = useMemo(() => {
    if (!queryDates.ready) return [];

    const { startDate: rangeStart, endDate: rangeEnd } = queryDates;
    const dailyMap = new Map();
    const ppcByDate = new Map();

    if (Array.isArray(ppcGraphData)) {
      ppcGraphData.forEach((item) => {
        const key = item?.rawDate || item?.date;
        if (!key) return;
        const ymd = String(key).slice(0, 10);
        if (!isYmdInRange(ymd, rangeStart, rangeEnd)) return;
        ppcByDate.set(ymd, Number(item?.spend || 0));
      });
    }

    if (Array.isArray(financeDashDateWise) && financeDashDateWise.length > 0) {
      financeDashDateWise.forEach((item) => {
        const ymd = String(item.date).slice(0, 10);
        if (!isYmdInRange(ymd, rangeStart, rangeEnd)) return;
        const sales = Number(item.productSales || 0);
        const expenses = Math.abs(Number(item.totalExpenses || 0));
        const ppcSpend = Number(ppcByDate.get(ymd) || 0);
        dailyMap.set(ymd, {
          grossProfit: sales - expenses - ppcSpend,
          totalSales: sales,
          spend: expenses + ppcSpend,
        });
      });
      return buildConstrainedChartSeries(queryDates, dailyMap);
    }

    return createEmptyProfitabilityData(rangeStart, rangeEnd);
  }, [queryDates, financeDashDateWise, ppcGraphData]);

  // Get COGs values from Redux store
  const cogsValues = useSelector((state) => state.cogs.cogsValues);

  useEffect(() => {
    dispatch(fetchCogs());
  }, [dispatch]);
  // Optional catalog for CSV export labels only (not used for KPI/chart)
  const dashboardCatalog = useSelector((state) => state.Dashboard.DashBoardInfo) || {};
  
  const metrics = useMemo(() => {
    
    // PPC spend calculation
    let adSpend = 0;
    const isDateRangeSelected = queryDates.ready;
    
    const getFilteredPPCDateBounds = () => {
      const start = parseLocalDate(queryDates.startDate);
      const end = parseLocalDate(queryDates.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    };

    const getFilteredPPCSpend = () => {
      if (!ppcDateWiseMetrics || ppcDateWiseMetrics.length === 0) return 0;
      if (!isDateRangeSelected) return 0;
      const { start, end } = getFilteredPPCDateBounds();
      return ppcDateWiseMetrics
        .filter(item => {
          const itemDate = new Date(item.date);
          return itemDate >= start && itemDate <= end;
        })
        .reduce((sum, item) => sum + (item.spend || 0), 0);
    };

    const getFilteredPPCSales = () => {
      if (!ppcDateWiseMetrics || ppcDateWiseMetrics.length === 0) return 0;
      if (!isDateRangeSelected) return 0;
      const { start, end } = getFilteredPPCDateBounds();
      return ppcDateWiseMetrics
        .filter(item => {
          const itemDate = new Date(item.date);
          return itemDate >= start && itemDate <= end;
        })
        .reduce((sum, item) => sum + (item.sales || 0), 0);
    };

    if (isDateRangeSelected) {
      adSpend = getFilteredPPCSpend();
    } else if ((ppcKPISummary?.spend ?? 0) > 0 || (ppcKPISummary?.sales ?? 0) > 0) {
      adSpend = ppcKPISummary.spend || 0;
    } else if (ppcSummary?.totalSpend > 0) {
      adSpend = ppcSummary.totalSpend;
    }
    
    const totalSales = financeDashTotals?.productSales != null
      ? Number(financeDashTotals.productSales)
      : 0;

    // PPC Sales and ACOS from PPCMetrics only
    let ppcSales = 0;
    let acos = 0;
    if (isDateRangeSelected) {
      ppcSales = getFilteredPPCSales();
    } else if ((ppcKPISummary?.spend ?? 0) > 0 || (ppcKPISummary?.sales ?? 0) > 0) {
      ppcSales = ppcKPISummary.sales || 0;
    } else if (ppcSummary?.totalSales > 0 || ppcSummary?.totalSpend > 0) {
      ppcSales = ppcSummary.totalSales || 0;
    }
    acos = ppcSales > 0 ? (adSpend / ppcSales) * 100 : 0;

    // ── Per-ASIN expenses from financeDashTotals ──
    const t = financeDashTotals;
    const totalUnitsSold = t?.units != null ? Number(t.units) : 0;

    const perAsinExpenses = t ? (
      Math.abs(t.fbaFulfillmentFee || 0) +
      Math.abs(t.referralCommission || 0) +
      Math.abs(t.closingFee || 0) +
      Math.abs(t.technologyFee || 0) +
      Math.abs(t.shippingChargeback || 0) +
      Math.abs(t.giftWrapChargeback || 0) +
      Math.abs(t.fbaDisposalFee || 0) +
      Math.abs(t.fbaReversedReimbursement || 0) +
      Math.abs(t.refundedAmount || 0) +
      Math.abs(t.refundCommission || 0) -
      Math.abs(t.refundedReferralFee || 0) -
      Math.abs(t.refundedPromotion || 0) -
      Math.abs(t.restockingFee || 0) +
      Math.abs(t.promotionsDiscount || 0) +
      Math.abs(t.shippingDiscount || 0) +
      Math.abs(t.taxDiscount || 0) +
      Math.abs(t.shippingTaxDiscount || 0) +
      Math.abs(t.tdsDeducted || 0) +
      Math.abs(t.tcsCollected || 0) +
      Math.abs(t.otherExpenses || 0)
    ) : 0;

    // ── Overhead expenses (only real costs, not disbursements/reserves) ──
    const OVERHEAD_EXCLUDE = new Set([
      'Disbursement', 'Reserve Hold', 'Reserve Release',
      'Seller Reward', 'Reimbursement', 'SAFE-T Reimbursement',
      'SERRAC Reimbursement', 'EBT Refund Reimbursement',
      'Fulfillment Fee Refund',
    ]);

    const overheadExpenseTotal = financeDashOverhead
      .filter(item => !item.isRevenue && !OVERHEAD_EXCLUDE.has(item.category))
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);

    // ── Reimbursements (positive = money back, reduces net expenses) ──
    const reimbursements = t ? Math.abs(t.fbaInventoryReimbursement || 0) : 0;

    // PPC ad spend (same source as former "Total Ad Spend" card)
    const displayAdSpend = adSpend > 0 ? adSpend : Number(t?.adsSpend || 0);
    const financeAdsTotal = Number(t?.adsSpend || 0);
    const useFinanceAdsBreakdown =
      displayAdSpend > 0 &&
      (!(adSpend > 0) || Math.abs(displayAdSpend - financeAdsTotal) < 0.01);

    // ── Final Total Expenses (Amazon fees + overhead + PPC) ──
    const displayTotalExpenses =
      perAsinExpenses + overheadExpenseTotal - reimbursements + displayAdSpend;

    // Expense breakdown for the dropdown
    const expenseBreakdown = [];
    const pushExpense = (label, amount) => {
      const a = Number(amount || 0);
      if (a !== 0) expenseBreakdown.push({ label, amount: a });
    };

    if (t) {
      // Amazon Fees
      pushExpense('FBA Per Unit Fulfillment Fee', t.fbaFulfillmentFee);
      pushExpense('Referral Fee', t.referralCommission);
      pushExpense('Closing Fee', t.closingFee);
      pushExpense('Technology Fee', t.technologyFee);
      pushExpense('Shipping Chargeback', t.shippingChargeback);
      pushExpense('Gift Wrap Chargeback', t.giftWrapChargeback);
      pushExpense('FBA Disposal Fee', t.fbaDisposalFee);
      pushExpense('Compensated Clawback', t.fbaReversedReimbursement);

      // Refund Cost
      pushExpense('Refunded Amount', t.refundedAmount);
      pushExpense('Refund Commission', t.refundCommission);
      pushExpense('Refunded Referral Fee', t.refundedReferralFee);
      pushExpense('Promotion (reversed)', t.refundedPromotion);
      pushExpense('Restocking Fee', t.restockingFee);

      // Reimbursements (reduces expenses)
      pushExpense('FBA Inventory Reimbursement', t.fbaInventoryReimbursement);

      // Promotions & Discounts
      pushExpense('Promotions Discount', t.promotionsDiscount);
      pushExpense('Shipping Discount', t.shippingDiscount);

      // Tax (pass-through, shown for transparency)
      pushExpense('Sales Tax', t.salesTaxCollected);
      pushExpense('Shipping Tax', t.shippingTaxCollected);
      pushExpense('Gift Wrap Tax', t.giftWrapTaxCollected);
      pushExpense('Marketplace Facilitator Tax', t.marketplaceFacilitatorTax);
      pushExpense('Tax Discount', t.taxDiscount);
      pushExpense('Shipping Tax Discount', t.shippingTaxDiscount);
      pushExpense('TDS (India)', t.tdsDeducted);
      pushExpense('TCS (India)', t.tcsCollected);

      // Other
      if (Array.isArray(t.otherExpensesBreakdown)) {
        t.otherExpensesBreakdown.forEach((item) => pushExpense(item.category, item.amount));
      } else {
        pushExpense('Additional Amazon Fees', t.otherExpenses);
      }

      // Account Overhead
      financeDashOverhead.forEach((item) => pushExpense(item.category, item.amount));
    }

    // Advertising / PPC — shown as negative (outflow) in breakdown
    if (displayAdSpend > 0) {
      if (useFinanceAdsBreakdown && t && (Number(t.adsSpendSP) > 0 || Number(t.adsSpendSD) > 0)) {
        pushExpense('Sponsored Products (SP)', -Math.abs(t.adsSpendSP || 0));
        pushExpense('Sponsored Display (SD)', -Math.abs(t.adsSpendSD || 0));
      } else {
        pushExpense('Advertising / PPC', -displayAdSpend);
      }
    }

    const totalCogs = computeTotalCogs(
      Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [],
      cogsValues,
    );
    if (totalCogs > 0.01) {
      pushExpense('COGS (Cost of Goods Sold)', -totalCogs);
    }

    const displayProfit = totalSales - displayTotalExpenses - totalCogs;
    const profitMargin = totalSales > 0 ? ((displayProfit / totalSales) * 100).toFixed(2) : 0;

    const organicSales = Math.max(0, totalSales - ppcSales);
    const salesBreakdown = [
      { label: 'Organic Sales', amount: organicSales },
      { label: 'PPC Sales', amount: ppcSales },
    ];

    const row1 = [
      {
        label: 'Total Sales',
        value: `${currency}${totalSales.toFixed(2)}`,
        icon: 'dollar-sign',
        breakdown: salesBreakdown,
        isExpandable: true,
      },
      {
        label: 'Total Units Sold',
        value: totalUnitsSold.toLocaleString(),
        icon: 'list',
      },
      {
        label: 'Expences',
        value: `${currency}${displayTotalExpenses.toFixed(2)}`,
        icon: 'trending-down',
        breakdown: expenseBreakdown,
        isExpandable: expenseBreakdown.length > 0,
      },
      { label: 'Profit', value: `${currency}${displayProfit.toFixed(2)}`, icon: 'dollar-sign' },
    ];

    const showRow2 = !!financeDashTotals;
    const row2 = showRow2 ? [
      { label: 'ACOS%', value: `${acos.toFixed(2)}%`, icon: 'target' },
      { label: 'Profit Margin', value: `${profitMargin}%`, icon: 'percent' },
    ] : [];

    return { row1, row2 };
  }, [queryDates.ready, queryDates.startDate, queryDates.endDate, ppcSummary, ppcKPISummary, ppcDateWiseMetrics, currency, financeDashTotals, financeDashOverhead, financeDashAsinWise, cogsValues]);

  // Prepare data for CSV/Excel export
  const prepareProfitabilityData = () => {
    try {
      devLog('=== Starting profitability data preparation ===');
      devLog('Input data check:', {
        metricsExists: !!metrics,
        chartDataExists: !!chartData,
        cogsValuesExists: !!cogsValues,
        metricsLength: metrics?.row1 ? metrics.row1.length + (metrics.row2?.length || 0) : 'not object',
        chartDataLength: Array.isArray(chartData) ? chartData.length : 'not array'
      });
      
      const csvData = [];
      
      // Add header information
      csvData.push(['Profitability Dashboard Report - Complete Analysis']);
      csvData.push(['Generated on:', new Date().toLocaleDateString()]);
      let dateRangeText = '—';
      if (queryDates.ready) {
        dateRangeText = `${queryDates.startDate} to ${queryDates.endDate}`;
      }
      csvData.push(['Date Range:', dateRangeText]);
      csvData.push([]);
      
      // Add Executive Summary at the top
      csvData.push(['EXECUTIVE SUMMARY']);
      csvData.push(['='.repeat(50)]);
      
                    // Calculate key executive insights
       devLog('Step 1: Starting executive insights calculation');
       const executiveTotalRevenue = Array.isArray(chartData) ? chartData.reduce((sum, item) => sum + (item?.totalSales || 0), 0) : 0;
       const executiveTotalCosts = Array.isArray(chartData) ? chartData.reduce((sum, item) => sum + (item?.spend || 0), 0) : 0;
       const executiveOverallProfitMargin = executiveTotalRevenue > 0 ? ((executiveTotalRevenue - executiveTotalCosts) / executiveTotalRevenue) * 100 : 0;
       const executiveProfitabilityData = Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [];
       devLog('Step 1 completed: Revenue:', executiveTotalRevenue, 'Costs:', executiveTotalCosts);
                    devLog('Step 2: Starting product categorization');
       const criticalProducts = Array.isArray(executiveProfitabilityData) ? executiveProfitabilityData.filter(product => {
         if (!product || typeof product !== 'object') return false;
         const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
         const totalCogs = cogsPerUnit * (product.quantity || 0);
         // Use totalFees from EconomicsMetrics if available
         // Handle both object format {amount: number} and number format
         // Note: For EconomicsMetrics, fees are already totals (not per-unit)
         let totalFees = 0;
         if (product.totalFees !== undefined && product.totalFees !== null) {
           totalFees = typeof product.totalFees === 'object' ? (product.totalFees.amount || 0) : product.totalFees;
         } else if (product.source === 'economicsMetrics') {
           // For EconomicsMetrics data, amzFee is already total, don't multiply
           totalFees = product.amzFee || 0;
         } else {
           // Legacy data: amzFee might be per-unit, multiply by quantity
           totalFees = (product.amzFee || 0) * (product.quantity || 0);
         }
         const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                            ((product.sales || 0) - (product.ads || 0) - totalFees);
         const netProfit = grossProfit - totalCogs;
         const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
         return profitMargin < 0;
       }).length : 0;
       
       const warningProducts = Array.isArray(executiveProfitabilityData) ? executiveProfitabilityData.filter(product => {
         if (!product || typeof product !== 'object') return false;
         const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
         const totalCogs = cogsPerUnit * (product.quantity || 0);
         // Use totalFees from EconomicsMetrics if available
         // Handle both object format {amount: number} and number format
         // Note: For EconomicsMetrics, fees are already totals (not per-unit)
         let totalFees = 0;
         if (product.totalFees !== undefined && product.totalFees !== null) {
           totalFees = typeof product.totalFees === 'object' ? (product.totalFees.amount || 0) : product.totalFees;
         } else if (product.source === 'economicsMetrics') {
           // For EconomicsMetrics data, amzFee is already total, don't multiply
           totalFees = product.amzFee || 0;
         } else {
           // Legacy data: amzFee might be per-unit, multiply by quantity
           totalFees = (product.amzFee || 0) * (product.quantity || 0);
         }
         const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                            ((product.sales || 0) - (product.ads || 0) - totalFees);
         const netProfit = grossProfit - totalCogs;
         const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
         return profitMargin >= 0 && profitMargin < 10;
       }).length : 0;
       
       const healthyProducts = executiveProfitabilityData.length - criticalProducts - warningProducts;
       devLog('Step 2 completed: Critical:', criticalProducts, 'Warning:', warningProducts, 'Healthy:', healthyProducts);
       
       csvData.push(['Business Health Status:', executiveOverallProfitMargin > 15 ? 'HEALTHY' : executiveOverallProfitMargin > 5 ? 'CAUTION' : 'CRITICAL']);
       csvData.push(['Overall Profit Margin:', `${executiveOverallProfitMargin.toFixed(2)}%`]);
       csvData.push(['Total Products Analyzed:', executiveProfitabilityData.length.toString()]);
      csvData.push(['Products Losing Money (Critical):', criticalProducts.toString()]);
      csvData.push(['Products with Low Margins (Warning):', warningProducts.toString()]);
      csvData.push(['Healthy Products:', healthyProducts.toString()]);
      csvData.push([]);
      
      // Key insights
      csvData.push(['KEY INSIGHTS:']);
      if (criticalProducts > 0) {
        csvData.push(['• URGENT:', `${criticalProducts} products are losing money and need immediate attention`]);
      }
      if (warningProducts > 0) {
        csvData.push(['• WARNING:', `${warningProducts} products have margins below 10% and should be optimized`]);
      }
      if (healthyProducts > 0) {
        csvData.push(['• POSITIVE:', `${healthyProducts} products are performing well with healthy margins`]);
      }
      csvData.push([]);
      
      // Top action items
      csvData.push(['TOP ACTION ITEMS:']);
      csvData.push(['1. Review and fix critical profitability issues immediately']);
      csvData.push(['2. Optimize PPC spend for low-margin products']);
      csvData.push(['3. Negotiate better COGS with suppliers where possible']);
      csvData.push(['4. Consider price adjustments for underperforming products']);
      csvData.push(['5. Monitor Amazon fees and explore cost reduction opportunities']);
      csvData.push([]);
      csvData.push(['='.repeat(50)]);
      csvData.push([]);
    
    // Add metrics summary (with COGS adjustments)
    devLog('Step 3: Processing metrics');
    csvData.push(['Key Metrics (COGS-Adjusted)']);
    const allMetrics = [...(metrics?.row1 || []), ...(metrics?.row2 || [])];
    if (allMetrics.length > 0) {
      allMetrics.forEach((metric, index) => {
        if (metric && typeof metric === 'object' && metric.label && metric.value) {
          csvData.push([metric.label, metric.value]);
        } else {
          devWarn('Invalid metric at index', index, metric);
        }
      });
    } else {
      csvData.push(['No metrics data available']);
    }
    devLog('Step 3 completed: Metrics processed');
    
         // Add comprehensive COGS analysis
     devLog('Step 4: Processing COGS analysis');
     let totalCOGS = 0;
     let totalCOGSProducts = 0;
     let productsWithCOGS = 0;
     let productsWithoutCOGS = 0;
     const cogsProfitibilityData = Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [];
     
     const cogsAnalysis = [];
     if (Array.isArray(cogsProfitibilityData)) {
       cogsProfitibilityData.forEach((product, index) => {
         if (product && typeof product === 'object' && product.asin) {
           const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
           const quantity = product.quantity || 0;
           const productCOGS = cogsPerUnit * quantity;
           totalCOGS += productCOGS;
           totalCOGSProducts++;
           
           if (cogsPerUnit > 0) {
             productsWithCOGS++;
             const cogsPercent = product.sales > 0 ? (productCOGS / product.sales) * 100 : 0;
             cogsAnalysis.push({
               asin: product.asin,
               cogsPerUnit,
               productCOGS,
               cogsPercent,
               sales: product.sales || 0
             });
           } else {
             productsWithoutCOGS++;
           }
         } else {
           devWarn('Invalid product in COGS analysis at index', index, product);
         }
       });
     }
     devLog('Step 4 completed: COGS analysis processed');
    
    csvData.push(['COGS Analysis Summary']);
    csvData.push(['Total COGS Deducted', `${currency}${totalCOGS.toFixed(2)}`]);
    csvData.push(['Products with COGS entered', productsWithCOGS.toString()]);
    csvData.push(['Products missing COGS', productsWithoutCOGS.toString()]);
    csvData.push(['COGS Data Completeness', `${((productsWithCOGS / totalCOGSProducts) * 100).toFixed(1)}%`]);
    
    if (cogsAnalysis.length > 0) {
      const avgCOGSPercent = cogsAnalysis.reduce((sum, item) => sum + item.cogsPercent, 0) / cogsAnalysis.length;
      const highCOGSProducts = cogsAnalysis.filter(item => item.cogsPercent > 60).length;
      csvData.push(['Average COGS %', `${avgCOGSPercent.toFixed(1)}%`]);
      csvData.push(['Products with high COGS (>60%)', highCOGSProducts.toString()]);
    }
    csvData.push([]);
    
    // Add chart data
    if (chartData && chartData.length > 0) {
      csvData.push(['Daily Spend vs Total Sales']);
      csvData.push(['Date', 'Spend', 'Total Sales']);
      chartData.forEach(day => {
        csvData.push([
          day.date || 'N/A',
          `${currency}${(day.spend || 0).toFixed(2)}`,
          `${currency}${(day.totalSales || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    } else {
      csvData.push(['Daily Spend vs Total Sales']);
      csvData.push(['No chart data available']);
      csvData.push([]);
    }
    
    // Add comprehensive profitability table data - ALL PRODUCTS (not paginated)
    const profitabilityTableData = Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [];
    if (profitabilityTableData.length > 0) {
      csvData.push([`Product Profitability Analysis - Total: ${profitabilityTableData.length} products`]);
      csvData.push(['ASIN', 'Product Name', 'Units Sold', 'Sales Revenue', 'Revenue per Unit', 'COGS/Unit', 'COGS %', 'Total COGS', 'Ad Spend', 'Ad Spend %', 'Amazon Fees', 'Fees %', 'Gross Profit', 'Net Profit (with COGS)', 'Profit Margin %', 'Status', 'Issues', 'Recommendations']);
      
      // Get product details and COGS values to match the table display exactly
      const totalProducts = dashboardCatalog?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      // Generate individual product suggestions (same logic as ProfitTable)
      const generateProductSuggestions = (productData) => {
        const suggestions = [];
        const margin = productData.sales > 0 ? (productData.netProfit / productData.sales) * 100 : 0;
        const cogsPercentage = productData.sales > 0 ? (productData.totalCogs / productData.sales) * 100 : 0;
        
        // Generate suggestions for products with issues
        if (margin < 0) {
          suggestions.push('Losing money on each sale - immediate action required');
          suggestions.push('Consider increasing price or reducing PPC spend');
        } else if (margin < 10) {
          suggestions.push(`Low margin (${margin.toFixed(1)}%) - consider price increase`);
          if (cogsPercentage > 50) {
            suggestions.push(`High COGS (${cogsPercentage.toFixed(1)}%) - negotiate with supplier`);
          }
          if (productData.adSpendPercent > 20) {
            suggestions.push(`High ad spend (${productData.adSpendPercent.toFixed(1)}%) - optimize PPC`);
          }
        }
        
        if (productData.sales > 1000 && productData.netProfit < 100) {
          suggestions.push('High revenue but low profit - audit all fees');
        }
        
        return suggestions.join('; ');
      };
      
      profitabilityTableData.forEach(product => {
        const productDetails = productDetailsMap.get(product.asin) || {};
        const cogsPerUnit = cogsValues[product.asin] || 0;
        const totalCogs = cogsPerUnit * (product.quantity || 0);
        
        // Use amazonFees from EconomicsMetrics if available
        // Note: amazonFees from EconomicsMetrics is already a TOTAL (not per-unit)
        // Handle both object format {amount: number} and number format
        let amazonFees = 0;
        if (product.amazonFees !== undefined && product.amazonFees !== null) {
          amazonFees = typeof product.amazonFees === 'object' ? (product.amazonFees.amount || 0) : product.amazonFees;
        } else if (product.totalFees !== undefined && product.totalFees !== null) {
          amazonFees = typeof product.totalFees === 'object' ? (product.totalFees.amount || 0) : product.totalFees;
        } else if (product.source === 'economicsMetrics') {
          // For EconomicsMetrics data, amzFee is already total, don't multiply
          amazonFees = product.amzFee || 0;
        } else {
          // Legacy data: amzFee might be per-unit, multiply by quantity
          amazonFees = (product.amzFee || 0) * (product.quantity || 0);
        }
        const totalFees = amazonFees;
        
        // Use grossProfit from EconomicsMetrics if available, otherwise calculate
        const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                           ((product.sales || 0) - (product.ads || 0) - totalFees);
        
        const netProfit = grossProfit - totalCogs;
        const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
        const revenuePerUnit = product.quantity > 0 ? (product.sales / product.quantity) : 0;
        const cogsPercent = product.sales > 0 ? (totalCogs / product.sales) * 100 : 0;
        const adSpendPercent = product.sales > 0 ? ((product.ads || 0) / product.sales) * 100 : 0;
        
        // Use totalFees for fees percentage calculation
        const feesPercent = product.sales > 0 ? (totalFees / product.sales) * 100 : 0;
        
        // Determine status and issues
        let status = 'Good';
        let issues = '';
        if (profitMargin < 0) {
          status = 'Critical';
          issues = 'Negative profit';
        } else if (profitMargin < 10) {
          status = 'Warning';
          issues = 'Low margin';
        }
        
        if (cogsPercent > 60) {
          issues += (issues ? ', ' : '') + 'High COGS';
        }
        if (adSpendPercent > 25) {
          issues += (issues ? ', ' : '') + 'High ad spend';
        }
        if (feesPercent > 20) {
          issues += (issues ? ', ' : '') + 'High fees';
        }
        
        const productData = {
          asin: product.asin,
          sales: product.sales || 0,
          quantity: product.quantity || 0,
          totalCogs,
          netProfit,
          adSpendPercent
        };
        
        const recommendations = generateProductSuggestions(productData);
        
        csvData.push([
          product.asin,
          productDetails.title || `Product ${product.asin}`,
          (product.quantity || 0).toString(),
          `${currency}${(product.sales || 0).toFixed(2)}`,
          `$${revenuePerUnit.toFixed(2)}`,
          `$${cogsPerUnit.toFixed(2)}`,
          `${cogsPercent.toFixed(1)}%`,
          `$${totalCogs.toFixed(2)}`,
          `${currency}${(product.ads || 0).toFixed(2)}`,
          `${adSpendPercent.toFixed(1)}%`,
          `${currency}${amazonFees.toFixed(2)}`,
          `${feesPercent.toFixed(1)}%`,
          `${currency}${grossProfit.toFixed(2)}`,
          `${currency}${netProfit.toFixed(2)}`,
          `${profitMargin.toFixed(2)}%`,
          status,
          issues || 'None',
          recommendations || 'Continue monitoring'
        ]);
      });
      csvData.push([]);
    }
    
    // Add Sales by Products data - ALL PRODUCTS (not paginated)
    const salesByProducts = dashboardCatalog?.SalesByProducts || [];
    if (salesByProducts.length > 0) {
      csvData.push([`Sales by Products - Total: ${salesByProducts.length} products`]);
      csvData.push(['ASIN', 'Product Name', 'Quantity Sold', 'Sales Amount']);
      
      const totalProducts = dashboardCatalog?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      salesByProducts.forEach(product => {
        const productDetails = productDetailsMap.get(product.asin) || {};
        csvData.push([
          product.asin,
          productDetails.title || `Product ${product.asin}`,
          (product.quantity || 0).toString(),
          `$${(product.amount || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Total Products data - ALL PRODUCTS
    const totalProducts = dashboardCatalog?.TotalProduct || [];
    if (totalProducts.length > 0) {
      csvData.push([`All Products Catalog - Total: ${totalProducts.length} products`]);
      csvData.push(['ASIN', 'Product Title', 'Brand', 'Category', 'Price', 'FBA Fees']);
      
      totalProducts.forEach(product => {
        csvData.push([
          product.asin || 'N/A',
          product.title || 'N/A',
          product.brand || 'N/A',
          product.itemClassification || 'N/A',
          `$${(product.price || 0).toFixed(2)}`,
          `$${(product.fbaFees || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add financial summary
    if (financeDashTotals) {
      let totalCOGSSummary = 0;
      const profitibilityDataSummary = Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [];
      profitibilityDataSummary.forEach((product) => {
        const cogsPerUnit = cogsValues[product.asin] || 0;
        const quantity = product.units || product.quantity || 0;
        totalCOGSSummary += cogsPerUnit * quantity;
      });
      const salesTotal = Number(financeDashTotals.productSales || 0);
      const profitRow = metrics?.row1?.find((m) => m.label === 'Profit');
      const adjustedGrossProfitSummary = salesTotal - totalCOGSSummary;
      
      csvData.push(['Financial Summary (COGS-Adjusted for Profitability Dashboard)']);
      csvData.push(['Total Sales', `${currency}${salesTotal.toFixed(2)}`]);
      csvData.push(['Profit (finance flow)', profitRow?.value || `${currency}0`]);
      csvData.push(['Total COGS Entered', `${currency}${totalCOGSSummary.toFixed(2)}`]);
      csvData.push(['Sales minus COGS (export)', `${currency}${adjustedGrossProfitSummary.toFixed(2)}`]);
      csvData.push(['FBA Fulfillment', `${currency}${Math.abs(financeDashTotals?.fbaFulfillmentFee || 0)}`]);
      csvData.push(['Referral Fee', `${currency}${Math.abs(financeDashTotals?.referralCommission || 0)}`]);
      csvData.push(['Refunded Amount', `${currency}${Math.abs(financeDashTotals?.refundedAmount || 0)}`]);
      csvData.push([]);
    }
    
    // Add Comprehensive Profitability Improvement Suggestions
    csvData.push(['Profitability Improvement Suggestions - Complete Analysis']);
    csvData.push(['Priority', 'Category', 'Recommendation', 'Expected Impact', 'Timeframe']);
    const comprehensiveSuggestions = [
      ['High', 'Product Mix', 'Focus marketing budget on highest margin products (>20% profit margin)', 'High', '1-2 months'],
      ['High', 'Cost Management', 'Optimize overall spend by reducing unnecessary Amazon fees', 'High', '1 week'],
      ['High', 'COGS Management', 'Enter COGS values for accurate profitability and negotiate better supplier rates for products with high COGS', 'Medium-High', '1-3 months'],
      ['Medium', 'Inventory', 'Optimize inventory levels to reduce storage fees', 'Medium', '1-2 months'],
      ['Medium', 'Pricing', 'Review and adjust pricing strategy for low-margin products', 'Medium', '2-4 weeks'],
      ['Medium', 'Product Development', 'Consider discontinuing consistently unprofitable products', 'Medium', '3-6 months'],
      ['Medium', 'Fee Optimization', 'Review FBA fees and consider alternative fulfillment for low-margin items', 'Medium', '2-3 months'],
      ['Low', 'Market Research', 'Analyze competitor pricing and positioning', 'Low-Medium', '1 month'],
      ['Low', 'Customer Analysis', 'Focus on high-value customer segments', 'Low-Medium', '2-4 months'],
      ['Low', 'Operational', 'Review fulfillment options to reduce overall fees', 'Low', '3-6 months']
    ];
    
    comprehensiveSuggestions.forEach(([priority, category, recommendation, impact, timeframe]) => {
      csvData.push([priority, category, recommendation, impact, timeframe]);
    });
    csvData.push([]);
    
    // Add Performance Summary
    csvData.push(['Performance Summary']);
    csvData.push(['Metric', 'Value', 'Status']);
    const totalRevenue = chartData.reduce((sum, item) => sum + item.totalSales, 0);
    const totalCosts = chartData.reduce((sum, item) => sum + item.spend, 0);
    const overallProfitMargin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0;
    
    csvData.push(['Total Revenue', `${currency}${totalRevenue.toFixed(2)}`, totalRevenue > 0 ? 'Good' : 'Poor']);
    csvData.push(['Total Costs', `${currency}${totalCosts.toFixed(2)}`, '']);
    csvData.push(['Overall Profit Margin', `${overallProfitMargin.toFixed(2)}%`, overallProfitMargin > 15 ? 'Good' : overallProfitMargin > 5 ? 'Warning' : 'Poor']);
    csvData.push(['Number of Products', profitabilityTableData.length.toString(), profitabilityTableData.length > 10 ? 'Good' : 'Limited']);
    csvData.push([]);
    
    // Add Category Breakdown (if available)
    const categoryBreakdown = {};
    totalProducts.forEach(product => {
      const category = product.itemClassification || 'Unknown';
      if (!categoryBreakdown[category]) {
        categoryBreakdown[category] = { count: 0, totalSales: 0 };
      }
      categoryBreakdown[category].count++;
      // Find sales data for this product
      const salesData = salesByProducts.find(sale => sale.asin === product.asin);
      if (salesData) {
        categoryBreakdown[category].totalSales += salesData.amount || 0;
      }
    });
    
    if (Object.keys(categoryBreakdown).length > 0) {
      csvData.push(['Category Performance Breakdown']);
      csvData.push(['Category', 'Product Count', 'Total Sales', 'Average Sales per Product']);
      Object.entries(categoryBreakdown).forEach(([category, data]) => {
        const avgSales = data.count > 0 ? data.totalSales / data.count : 0;
        csvData.push([
          category,
          data.count.toString(),
          `${currency}${data.totalSales.toFixed(2)}`,
          `${currency}${avgSales.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Dynamic Suggestions with Priority Analysis
    if (suggestionsData && suggestionsData.length > 0) {
      csvData.push(['Dynamic Suggestions Based on Current Data Analysis']);
      csvData.push(['Priority', 'Suggestion Type', 'Recommendation', 'Action Required']);
      
      // Convert string suggestions to objects with priority analysis
      const prioritizedSuggestions = suggestionsData.map((suggestion) => {
        let priority = 'Medium';
        let actionRequired = 'Monitor';
        let suggestionType = 'Optimization';
        
        if (typeof suggestion === 'string') {
          if (suggestion.toLowerCase().includes('negative profit') || 
              suggestion.toLowerCase().includes('losing money') ||
              suggestion.toLowerCase().includes('unprofitable')) {
            priority = 'Critical';
            actionRequired = 'Immediate';
            suggestionType = 'Profitability Crisis';
          } else if (suggestion.toLowerCase().includes('low margin') ||
                     suggestion.toLowerCase().includes('very low')) {
            priority = 'High';
            actionRequired = 'Within 1 week';
            suggestionType = 'Margin Improvement';
          } else if (suggestion.toLowerCase().includes('optimize') || 
                     suggestion.toLowerCase().includes('consider')) {
            priority = 'Medium';
            actionRequired = 'Within 1 month';
            suggestionType = 'General Optimization';
          }
        }
        
        return {
          priority,
          suggestionType,
          message: suggestion,
          actionRequired
        };
      });
      
      // Sort by priority (Critical first, then High, then Medium)
      const priorityOrder = { 'Critical': 1, 'High': 2, 'Medium': 3 };
      prioritizedSuggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      
      prioritizedSuggestions.forEach((suggestion, index) => {
        csvData.push([
          suggestion.priority,
          suggestion.suggestionType,
          suggestion.message,
          suggestion.actionRequired
        ]);
      });
      
      csvData.push([]);
      
      // Add suggestions summary
      const criticalCount = prioritizedSuggestions.filter(s => s.priority === 'Critical').length;
      const highCount = prioritizedSuggestions.filter(s => s.priority === 'High').length;
      const mediumCount = prioritizedSuggestions.filter(s => s.priority === 'Medium').length;
      
      csvData.push(['Suggestions Summary']);
      csvData.push(['Critical Issues', criticalCount.toString()]);
      csvData.push(['High Priority', highCount.toString()]);
      csvData.push(['Medium Priority', mediumCount.toString()]);
      csvData.push(['Total Suggestions', prioritizedSuggestions.length.toString()]);
      csvData.push([]);
    }
    
    // Add ProductWise Sponsored Ads Data if available
    const productWiseSponsoredAdsGraphData = dashboardCatalog?.ProductWiseSponsoredAdsGraphData || {};
    if (Object.keys(productWiseSponsoredAdsGraphData).length > 0) {
      csvData.push(['Product-wise Sponsored Ads Performance Data']);
      csvData.push(['ASIN', 'Product Name', 'Impressions', 'Clicks', 'CTR %', 'Spend', 'Sales', 'ACOS %', 'ROAS']);
      
      const totalProducts = dashboardCatalog?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      Object.entries(productWiseSponsoredAdsGraphData).forEach(([asin, adsData]) => {
        const productDetails = productDetailsMap.get(asin) || {};
        const impressions = adsData.impressions || 0;
        const clicks = adsData.clicks || 0;
        const spend = adsData.spend || 0;
        const sales = adsData.attributedSales1d || 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const acos = sales > 0 ? (spend / sales) * 100 : 0;
        const roas = spend > 0 ? sales / spend : 0;
        
        csvData.push([
          asin,
          productDetails.title || `Product ${asin}`,
          impressions.toString(),
          clicks.toString(),
          `${ctr.toFixed(2)}%`,
            `${currency}${spend.toFixed(2)}`,
            `${currency}${sales.toFixed(2)}`,
          `${acos.toFixed(2)}%`,
          `${roas.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
      return csvData;
    } catch (error) {
      console.error('Error preparing profitability data:', error);
      console.error('Error stack:', error.stack);
      
      // Return a safe, basic version of the data
      try {
        const basicCsvData = [];
        
        // Basic header
        basicCsvData.push(['Profitability Dashboard Report - Basic Version']);
        basicCsvData.push(['Generated on:', new Date().toLocaleDateString()]);
        basicCsvData.push(['Note:', 'This is a simplified version due to data processing complexity']);
        basicCsvData.push([]);
        
        // Basic metrics if available
        const basicAllMetrics = [...(metrics?.row1 || []), ...(metrics?.row2 || [])];
        if (basicAllMetrics.length > 0) {
          basicCsvData.push(['Key Metrics']);
          basicAllMetrics.forEach(metric => {
            if (metric && metric.label && metric.value) {
              basicCsvData.push([metric.label, metric.value]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Basic chart data if available
        if (Array.isArray(chartData) && chartData.length > 0) {
          basicCsvData.push(['Daily Performance']);
          basicCsvData.push(['Date', 'Spend', 'Sales']);
          chartData.forEach(day => {
            if (day && day.date) {
              basicCsvData.push([
                day.date || 'N/A',
                `${currency}${(day.spend || 0).toFixed(2)}`,
                `${currency}${(day.totalSales || 0).toFixed(2)}`
              ]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Basic product data if available
        const basicProfitabilityData = Array.isArray(financeDashAsinWise) ? financeDashAsinWise : [];
        if (Array.isArray(basicProfitabilityData) && basicProfitabilityData.length > 0) {
          basicCsvData.push(['Product Analysis - Basic']);
          basicCsvData.push(['ASIN', 'Units Sold', 'Sales', 'Ad Spend', 'Fees']);
          basicProfitabilityData.forEach(product => {
            if (product && product.asin) {
              basicCsvData.push([
                product.asin,
                (product.quantity || 0).toString(),
                `${currency}${(product.sales || 0).toFixed(2)}`,
                `${currency}${(product.ads || 0).toFixed(2)}`,
                `$${(product.amzFee || 0).toFixed(2)}`
              ]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Error information
        basicCsvData.push(['Error Information']);
        basicCsvData.push(['Error Type:', 'Data Processing Error']);
        basicCsvData.push(['Error Message:', error.message || 'Unknown error occurred']);
        basicCsvData.push(['Suggestion:', 'Please try refreshing the page or contact support if the issue persists']);
        
        return basicCsvData;
      } catch (fallbackError) {
        console.error('Even basic data preparation failed:', fallbackError);
        return [
          ['Profitability Dashboard Report'],
          ['Generated on:', new Date().toLocaleDateString()],
          ['Error:', 'Unable to generate report due to critical data processing error'],
          ['Message:', error.message || 'Unknown error occurred'],
          ['Fallback Error:', fallbackError.message || 'Unknown fallback error'],
          ['Suggestion:', 'Please refresh the page and try again']
        ];
      }
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* COGS Information Popup */}
      <AnimatePresence>
        {showCogsPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseCogsPopup}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3 }}
              style={{ background: 'var(--bg-surface)', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)', maxWidth: '500px', width: '100%', margin: '0 16px', border: '1px solid #30363d' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                      <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Improve Profit Accuracy</h3>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Get precise profitability insights</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseCogsPopup}
                    className="transition-colors p-1"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="mb-6">
                  <div className="flex items-start gap-3 p-4 rounded-lg mb-4" style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#fbbf24' }} />
                    <div>
                      <h4 className="font-semibold mb-1" style={{ color: '#fbbf24' }}>Important Notice</h4>
                      <p className="text-sm leading-relaxed" style={{ color: '#fde68a' }}>
                        To get accurate gross profit calculations, please add <strong>COGS (Cost of Goods Sold) values per unit</strong> for your products.
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
                        <span className="text-sm font-bold" style={{ color: '#60a5fa' }}>1</span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Navigate to the product table below
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
                        <span className="text-sm font-bold" style={{ color: '#60a5fa' }}>2</span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Click the "Add COGS" button for each product
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
                        <span className="text-sm font-bold" style={{ color: '#60a5fa' }}>3</span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Enter your actual cost per unit for accurate profit margins
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={handleCloseCogsPopup}
                    className="flex-1 px-4 py-2.5 font-medium rounded-lg transition-all duration-200"
                    style={{ background: 'linear-gradient(to right, #3b82f6, #2563eb)', color: 'white' }}
                    onMouseEnter={(e) => e.target.style.background = 'linear-gradient(to right, #2563eb, #1d4ed8)'}
                    onMouseLeave={(e) => e.target.style.background = 'linear-gradient(to right, #3b82f6, #2563eb)'}
                  >
                    Got it, thanks!
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Dashboard Container */}
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div className="w-full">
          {/* Header always visible */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} style={{ marginBottom: '10px' }}>
            <div style={{ background: 'var(--bg-surface)', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" style={{ color: '#34d399' }} />
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Profitability Dashboard</h1>
                    <div className="relative group">
                      <HelpCircle className="w-4 h-4 cursor-help transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'} onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'} />
                      <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                        <div className="text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', width: '256px', border: '1px solid #30363d' }}>
                          Advanced profitability analysis dashboard that tracks gross and net profit margins by product. Add COGS (Cost of Goods Sold) values to get accurate net profit calculations and identify underperforming products that need optimization.
                        </div>
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent" style={{ borderTopColor: '#21262d' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className='relative' ref={CalenderRef}>
                  <motion.button ref={calendarAnchorRef} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className='flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200' onClick={() => setOpenCalender(!openCalender)} style={{ background: 'var(--bg-base)', border: '1px solid #30363d', color: 'var(--text-primary)', fontSize: '12px' }} onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'} onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}>
                    <Calendar className="w-3.5 h-3.5" />
                    <span className='font-medium'>
                      {queryDates.ready
                        ? `${formatDateDisplay(queryDates.startDate)} - ${formatDateDisplay(queryDates.endDate)}`
                        : profitabilityDates.loading
                          ? 'Loading…'
                          : 'Select Date'}
                    </span>
                  </motion.button>
                  {openCalender && (
                    <Calender anchorRef={calendarAnchorRef} setOpenCalender={setOpenCalender} />
                  )}
                </div>
                <DownloadReport prepareDataFunc={prepareProfitabilityData} filename="Profitability_Dashboard_Report" buttonText="Export" showIcon={true} />
              </div>
            </div>
          </motion.div>

            {/* PHASED LOADING: Each section loads independently as data arrives */}
            
            {/* Phase 1: Metrics Cards - Loads first (~50-100ms) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              style={{ marginBottom: '10px' }}
            >
              {/* Show skeleton when loading OR when metricsData is not yet available (initial state) */}
              {(!profitabilityDates.bootstrapped || !queryDates.ready || financeDashLoading || !financeDashTotals) ? (
                <div className="flex flex-nowrap items-stretch gap-2 w-full overflow-visible">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="animate-pulse flex-1 min-w-[120px]" style={{ background: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid #30363d', padding: '16px' }}>
                        <div style={{ background: 'var(--bg-elevated)', height: '14px', width: '60%', borderRadius: '4px', marginBottom: '8px' }}></div>
                        <div style={{ background: 'var(--bg-elevated)', height: '24px', width: '80%', borderRadius: '4px' }}></div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex flex-nowrap items-stretch gap-2 w-full overflow-visible">
                  {[...metrics.row1, ...metrics.row2].map((metric) => (
                    <div key={metric.label} className="flex-1 min-w-[120px] overflow-visible">
                      <MetricCard label={metric.label} value={metric.value} icon={metric.icon} breakdown={metric.breakdown} isExpandable={metric.isExpandable} currency={currency} />
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Phase 2: Chart Section - Loads second (~50-100ms) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              style={{ marginBottom: '10px' }}
            >
              <div style={{ background: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid #30363d', overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #30363d' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" style={{ color: '#60a5fa' }} />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Gross Profit vs Total Sales</h3>
                          {(financeDashLoading || !queryDates.ready) && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#60a5fa' }} />
                          )}
                          <div className="relative group">
                            <HelpCircle className="w-3.5 h-3.5 cursor-help transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'} onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'} />
                            <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                              <div className="text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', width: '256px', border: '1px solid #30363d' }}>
                                Visual comparison of your gross profit (sales minus Amazon fees and ad spend) versus total sales over time. The green area shows your gross profit, while the blue area represents total sales revenue. Use this to identify profitability trends and seasonal patterns.
                              </div>
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent" style={{ borderTopColor: '#21262d' }}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#22c55e' }}></div>
                        <span style={{ color: 'var(--text-secondary)' }}>Gross Profit</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#3b82f6' }}></div>
                        <span style={{ color: 'var(--text-secondary)' }}>Total Sales</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '8px' }}>
                  {(financeDashLoading || !queryDates.ready || !financeDashDateWise) ? (
                    <div className="animate-pulse flex items-center justify-center" style={{ height: 280, background: 'var(--bg-base)', borderRadius: '8px' }}>
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" style={{ color: '#60a5fa' }} />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Loading chart data...</span>
                      </div>
                    </div>
                  ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart
                      data={chartData}
                      margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                    >
                      <defs>
                        <linearGradient id="grossProfitGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.6}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
                        </linearGradient>
                        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: '#9ca3af' }}
                        stroke="#30363d"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: '#9ca3af' }}
                        stroke="#30363d"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${currency}${value}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#21262d',
                          border: '1px solid #30363d',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                          fontSize: '14px',
                          color: 'var(--text-primary)'
                        }}
                        formatter={(value, name) => [`${currency}${value}`, name === 'grossProfit' ? 'Gross Profit' : 'Total Sales']}
                        labelFormatter={(label) => `Date: ${label}`}
                        labelStyle={{ color: 'var(--text-primary)' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalSales"
                        stroke="#3B82F6"
                        fill="url(#salesGradient)"
                        name="totalSales"
                        strokeWidth={3}
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="grossProfit"
                        stroke="#10B981"
                        fill="url(#grossProfitGradient)"
                        name="grossProfit"
                        strokeWidth={3}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Tabs: Profitability Table | Issues & AI Powered Suggestions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              style={{ marginBottom: '10px' }}
            >
              <div style={{ background: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid #30363d', overflow: 'hidden' }}>
                <div className="flex border-b border-[#30363d]" style={{ background: 'var(--bg-elevated)' }}>
                  <button
                    type="button"
                    onClick={() => setProfitabilityTab('table')}
                    className="flex-1 py-3 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    style={{
                      color: profitabilityTab === 'table' ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderBottom: profitabilityTab === 'table' ? '2px solid #60a5fa' : '2px solid transparent',
                      background: profitabilityTab === 'table' ? 'rgba(96, 165, 250, 0.08)' : 'transparent'
                    }}
                  >
                    <BarChart3 className="w-4 h-4" />
                    Profitability Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfitabilityTab('issues')}
                    className="flex-1 py-3 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    style={{
                      color: profitabilityTab === 'issues' ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderBottom: profitabilityTab === 'issues' ? '2px solid #60a5fa' : '2px solid transparent',
                      background: profitabilityTab === 'issues' ? 'rgba(96, 165, 250, 0.08)' : 'transparent'
                    }}
                  >
                    <Target className="w-4 h-4" />
                    Issues & AI Powered Suggestions
                  </button>
                </div>
                <div className="p-0">
                  {profitabilityTab === 'table' && (
                    <ProfitTable 
                      setSuggestionsData={setSuggestionsData} 
                      tableLoading={financeDashLoading}
                      financeDashAsinWise={financeDashAsinWise}
                      financeDashRelationships={financeDashRelationships}
                      financeDashOverhead={financeDashOverhead}
                      useFinanceTableOnly
                    />
                  )}
                  {profitabilityTab === 'issues' && (
                    <SuggestionList 
                      suggestionsData={suggestionsData}
                      issuesData={issuesData}
                      issuesSummary={issuesSummary}
                      issuesLoading={issuesLoading}
                      onLoadMore={fetchNextIssuesPage}
                      hasMore={issuesPagination?.hasMore ?? false}
                    />
                  )}
                </div>
              </div>
            </motion.div>

            {/* Bottom Spacer */}
            <div style={{ width: '100%', height: '20px' }}></div>
          </div>
        </div>
    </div>
  );
};

export default ProfitabilityDashboard;