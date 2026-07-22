import React, { useState, useEffect, useMemo } from "react";
import { useTheme } from '../../../hooks/useTheme.js';
import { Info, Currency, PieChart } from 'lucide-react';
import Chart from "react-apexcharts";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import axios from 'axios';
import TooltipBox from "../../ToolTipBox/ToolTipBoxBottom";
import ToolTipBoxLeft from '../../ToolTipBox/ToolTipBoxBottomLeft';
import { formatCurrencyWithLocale } from '../../../utils/currencyUtils.js';
import { parseLocalDate } from '../../../utils/dateUtils.js';
import { resolveProfitabilityQueryDates } from '../../../utils/profitabilityDateRange.js';
import { fetchLatestPPCMetrics, selectPPCSummary, selectPPCDateWiseMetrics, selectLatestPPCMetricsLoading } from '../../../redux/slices/PPCMetricsSlice.js';
import { fetchCogs } from '../../../redux/slices/cogsSlice.js';
import { computeTotalCogs } from '../../../utils/cogsCalculations.js';
import { SkeletonChart } from '../../../Components/Skeleton/PageSkeletons.jsx';
import { SkeletonContent } from '../../../Components/Skeleton/Skeleton.jsx';

const OVERHEAD_EXCLUDE = new Set([
  'Disbursement', 'Reserve Hold', 'Reserve Release',
  'Seller Reward', 'Reimbursement', 'SAFE-T Reimbursement',
  'SERRAC Reimbursement', 'EBT Refund Reimbursement',
  'Fulfillment Fee Refund',
]);

const formatDateWithOrdinal = (dateString) => {
  if (!dateString) return 'N/A';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  const getOrdinalSuffix = (d) => {
    if (d > 3 && d < 21) return 'th';
    switch (d % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  return `${dayNum}${getOrdinalSuffix(dayNum)} ${monthName}`;
};

const TotalSales = () => {
  const { theme } = useTheme();
  const dispatch = useDispatch();
  const calendarMode = useSelector(state => state.Dashboard.DashBoardInfo?.calendarMode);
  const startDate = useSelector(state => state.Dashboard.DashBoardInfo?.startDate);
  const endDate = useSelector(state => state.Dashboard.DashBoardInfo?.endDate);
  const currency = useSelector(state => state.currency?.currency) || '$';
  const cogsValues = useSelector((state) => state.cogs.cogsValues);
  const navigate = useNavigate();

  const ppcSummary = useSelector(selectPPCSummary);
  const ppcDateWiseMetrics = useSelector(selectPPCDateWiseMetrics);
  const ppcMetricsLoading = useSelector(selectLatestPPCMetricsLoading);
  const ppcMetricsLastFetched = useSelector(state => state.ppcMetrics?.latestMetrics?.lastFetched);

  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000;
    const now = Date.now();
    const shouldFetch = !ppcMetricsLastFetched || (now - ppcMetricsLastFetched) > CACHE_DURATION;
    if (shouldFetch && !ppcMetricsLoading) {
      dispatch(fetchLatestPPCMetrics());
    }
  }, [dispatch, ppcMetricsLastFetched, ppcMetricsLoading]);

  useEffect(() => {
    dispatch(fetchCogs());
  }, [dispatch]);

  const [financeDateRange, setFinanceDateRange] = useState({ startDate: null, endDate: null, ready: false });
  const [financeDashTotals, setFinanceDashTotals] = useState(null);
  const [financeDashAsinWise, setFinanceDashAsinWise] = useState([]);
  const [financeDashOverhead, setFinanceDashOverhead] = useState([]);
  const [financeDashMeta, setFinanceDashMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openToolTipGrossProfit, setOpenToolTipGrossProfit] = useState(false);
  const [openToolTipTopSales, setOpenToolTipTopSales] = useState(false);
  const [hoveredSlice, setHoveredSlice] = useState(null);

  // Bootstrap date window from DataFetchTracking (same as profitability dashboard)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const root = String(import.meta.env.VITE_BASE_URI || '').replace(/\/$/, '');
        const res = await axios.get(`${root}/api/finance-dashboard/date-range`, { withCredentials: true });
        if (cancelled) return;
        const d = res.data?.data;
        if (d?.startDate && d?.endDate) {
          setFinanceDateRange({ startDate: d.startDate, endDate: d.endDate, ready: true });
        }
      } catch {
        if (!cancelled) setFinanceDateRange((prev) => ({ ...prev, ready: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveFinanceDates = useMemo(() => {
    const anchorStart = startDate || financeDateRange.startDate;
    const anchorEnd = endDate || financeDateRange.endDate;
    if (!anchorStart || !anchorEnd) {
      return { startDate: null, endDate: null, ready: false };
    }
    return resolveProfitabilityQueryDates({
      calendarMode: calendarMode || 'default',
      startDate: anchorStart,
      endDate: anchorEnd,
    });
  }, [calendarMode, startDate, endDate, financeDateRange]);

  useEffect(() => {
    if (!effectiveFinanceDates.ready) return undefined;

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const root = String(import.meta.env.VITE_BASE_URI || '').replace(/\/$/, '');
        const { startDate: fdStart, endDate: fdEnd } = effectiveFinanceDates;
        const financeDashUrl = `${root}/api/finance-dashboard?startDate=${encodeURIComponent(fdStart)}&endDate=${encodeURIComponent(fdEnd)}`;

        const fdResp = await axios.get(financeDashUrl, { withCredentials: true }).catch(() => null);
        if (cancelled) return;

        if (fdResp?.data?.data) {
          const fd = fdResp.data.data;
          setFinanceDashTotals(fd.totals || null);
          setFinanceDashAsinWise(fd.asinWise || []);
          setFinanceDashOverhead(fd.overhead || []);
          setFinanceDashMeta(fd.metadata || null);
        } else {
          setFinanceDashTotals(null);
          setFinanceDashAsinWise([]);
          setFinanceDashOverhead([]);
          setFinanceDashMeta(null);
        }
      } catch (error) {
        console.error('Error fetching finance dashboard data:', error);
        if (!cancelled) {
          setFinanceDashTotals(null);
          setFinanceDashAsinWise([]);
          setFinanceDashOverhead([]);
          setFinanceDashMeta(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [effectiveFinanceDates.ready, effectiveFinanceDates.startDate, effectiveFinanceDates.endDate]);

  const filteredPPCMetrics = useMemo(() => {
    if (!effectiveFinanceDates.ready || !ppcDateWiseMetrics.length) return [];
    const start = parseLocalDate(effectiveFinanceDates.startDate);
    const end = parseLocalDate(effectiveFinanceDates.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return ppcDateWiseMetrics.filter((item) => {
      const itemDate = new Date(item.date);
      return itemDate >= start && itemDate <= end;
    });
  }, [ppcDateWiseMetrics, effectiveFinanceDates]);

  const PIE_COLORS = {
    grossProfit: (grossProfitRaw) => (grossProfitRaw < 0 ? '#64748b' : '#059669'),
    ppc: '#d97706',
    amazonFees: '#ea580c',
    refundsPromos: '#9333ea',
    additionalAmazon: '#64748b',
    overhead: '#dc2626',
  };

  const pieMetrics = useMemo(() => {
    const t = financeDashTotals;

    const totalSalesVal = t?.productSales != null
      ? Number(t.productSales)
      : 0;

    let ppcSpentVal = 0;
    if (filteredPPCMetrics.length > 0) {
      ppcSpentVal = filteredPPCMetrics.reduce((sum, item) => sum + (item.spend || 0), 0);
    } else if (Number(t?.adsSpend) > 0) {
      ppcSpentVal = Number(t.adsSpend);
    } else if (ppcSummary?.totalSpend > 0) {
      ppcSpentVal = ppcSummary.totalSpend;
    }

    const reimbursements = t ? Math.abs(t.fbaInventoryReimbursement || 0) : 0;

    const amazonFeesVal = t ? Math.abs(
      (t.fbaFulfillmentFee || 0) +
      (t.referralCommission || 0) +
      (t.closingFee || 0) +
      (t.technologyFee || 0) +
      (t.shippingChargeback || 0) +
      (t.giftWrapChargeback || 0) +
      (t.fbaDisposalFee || 0) +
      (t.fbaReversedReimbursement || 0)
    ) : 0;

    const refundsPromosVal = t ? Math.abs(
      (t.refundedAmount || 0) +
      (t.refundCommission || 0) -
      Math.abs(t.refundedReferralFee || 0) -
      Math.abs(t.refundedPromotion || 0) -
      Math.abs(t.restockingFee || 0) +
      (t.promotionsDiscount || 0) +
      (t.shippingDiscount || 0)
    ) : 0;

    const totalCogsVal = computeTotalCogs(financeDashAsinWise, cogsValues);

    // Uncategorized Amazon fees + COGS (not tax pass-through / TDS / TCS)
    const additionalAmazonBreakdown = (t?.otherExpensesBreakdown || [])
      .filter((item) => Math.abs(item.amount || 0) > 0.01)
      .map((item) => ({ label: item.category, amount: Math.abs(item.amount) }));

    const uncategorizedAmazonFeesVal = additionalAmazonBreakdown.length > 0
      ? additionalAmazonBreakdown.reduce((sum, item) => sum + item.amount, 0)
      : Math.abs(t?.otherExpenses || 0);

    const additionalAmazonFeesBreakdownWithCogs = [
      ...additionalAmazonBreakdown,
      ...(totalCogsVal > 0.01 ? [{ label: 'COGS (Cost of Goods Sold)', amount: totalCogsVal }] : []),
    ];

    const additionalAmazonFeesVal = uncategorizedAmazonFeesVal + totalCogsVal;

    const showAdditionalAmazonSlice = additionalAmazonFeesVal > 0.01;

    const overheadVal = financeDashOverhead
      .filter(item => !item.isRevenue && !OVERHEAD_EXCLUDE.has(item.category))
      .reduce((sum, item) => sum + Math.abs(item.amount || 0), 0);

    // Same per-ASIN expense rollup as ProfitibilityDashboard
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

    const displayTotalExpenses = perAsinExpenses + overheadVal - reimbursements;
    const grossProfitRawVal = totalSalesVal - displayTotalExpenses - ppcSpentVal - totalCogsVal;
    const grossProfitVal = Math.abs(grossProfitRawVal);
    const showGrossProfitSlice = grossProfitRawVal >= 0;

    const grossProfitBreakdown = [
      { label: 'Total Sales', amount: totalSalesVal },
      { label: 'Amazon Fees', amount: -amazonFeesVal },
      { label: 'Refunds & Promotions', amount: -refundsPromosVal },
      ...(showAdditionalAmazonSlice
        ? [{ label: 'Additional Amazon Fees', amount: -additionalAmazonFeesVal }]
        : []),
      { label: 'Overhead', amount: -overheadVal },
      { label: 'Reimbursements', amount: reimbursements },
      { label: 'PPC Spend', amount: -ppcSpentVal },
    ];

    const ppcBreakdown = [
      { label: 'Total Ad Spend', amount: ppcSpentVal },
      ...(t?.adsSpendSP ? [{ label: 'Sponsored Products (SP)', amount: Math.abs(t.adsSpendSP) }] : []),
      ...(t?.adsSpendSD ? [{ label: 'Sponsored Display (SD)', amount: Math.abs(t.adsSpendSD) }] : []),
    ];

    const amazonFeesBreakdown = t ? [
      { label: 'FBA Fulfillment', amount: Math.abs(t.fbaFulfillmentFee || 0) },
      { label: 'Referral Commission', amount: Math.abs(t.referralCommission || 0) },
      { label: 'Closing Fee', amount: Math.abs(t.closingFee || 0) },
      { label: 'Technology Fee', amount: Math.abs(t.technologyFee || 0) },
      { label: 'Shipping Chargeback', amount: Math.abs(t.shippingChargeback || 0) },
      { label: 'Gift Wrap Chargeback', amount: Math.abs(t.giftWrapChargeback || 0) },
      { label: 'FBA Disposal Fee', amount: Math.abs(t.fbaDisposalFee || 0) },
      { label: 'Compensated Clawback', amount: Math.abs(t.fbaReversedReimbursement || 0) },
    ].filter((f) => f.amount > 0.01) : [];

    const refundsPromosBreakdown = t ? [
      { label: 'Refunded Amount', amount: Math.abs(t.refundedAmount || 0) },
      { label: 'Refund Commission', amount: Math.abs(t.refundCommission || 0) },
      { label: 'Promotions Discount', amount: Math.abs(t.promotionsDiscount || 0) },
      { label: 'Shipping Discount', amount: Math.abs(t.shippingDiscount || 0) },
    ].filter((f) => f.amount > 0.01) : [];

    const additionalAmazonFeesBreakdown = additionalAmazonFeesBreakdownWithCogs.length > 0
      ? additionalAmazonFeesBreakdownWithCogs
      : (showAdditionalAmazonSlice ? [{ label: 'Uncategorized fees', amount: uncategorizedAmazonFeesVal }] : []);

    const overheadBreakdown = financeDashOverhead
      .filter((oh) => !oh.isRevenue && !OVERHEAD_EXCLUDE.has(oh.category) && Math.abs(oh.amount || 0) > 0.01)
      .map((oh) => ({ label: oh.category, amount: Math.abs(oh.amount || 0) }))
      .sort((a, b) => b.amount - a.amount);

    const visibleSlices = [
      ...(showGrossProfitSlice ? [{
        id: 'grossProfit',
        label: 'Gross Profit',
        value: grossProfitVal,
        displayAmount: grossProfitRawVal,
        breakdown: grossProfitBreakdown,
      }] : []),
      {
        id: 'ppc',
        label: 'PPC Spend',
        value: ppcSpentVal,
        displayAmount: ppcSpentVal,
        breakdown: ppcBreakdown,
      },
      {
        id: 'amazonFees',
        label: 'Amazon Fees',
        value: amazonFeesVal,
        displayAmount: amazonFeesVal,
        breakdown: amazonFeesBreakdown,
      },
      {
        id: 'refundsPromos',
        label: 'Refunds & Promotions',
        value: refundsPromosVal,
        displayAmount: refundsPromosVal,
        breakdown: refundsPromosBreakdown,
      },
      ...(showAdditionalAmazonSlice ? [{
        id: 'additionalAmazon',
        label: 'Additional Amazon Fees',
        value: additionalAmazonFeesVal,
        displayAmount: additionalAmazonFeesVal,
        breakdown: additionalAmazonFeesBreakdown,
      }] : []),
      {
        id: 'overhead',
        label: 'Overhead',
        value: overheadVal,
        displayAmount: overheadVal,
        breakdown: overheadBreakdown,
      },
    ];

    return {
      totalSales: totalSalesVal,
      ppcSpent: ppcSpentVal,
      grossProfitRaw: grossProfitRawVal,
      grossProfit: grossProfitVal,
      visibleSlices,
      hasFinanceData: !!t,
    };
  }, [
    financeDashTotals,
    financeDashAsinWise,
    financeDashOverhead,
    filteredPPCMetrics,
    ppcSummary,
    cogsValues,
  ]);

  const { totalSales, grossProfitRaw, visibleSlices, hasFinanceData } = pieMetrics;

  const handleNavigateToProfitability = () => {
    navigate('/seller-central-checker/profitibility-dashboard');
  };

  const chartData = useMemo(() => {
    const colors = visibleSlices.map((slice) => {
      if (slice.id === 'grossProfit') return PIE_COLORS.grossProfit(grossProfitRaw);
      return PIE_COLORS[slice.id] || '#64748b';
    });
    return {
      series: visibleSlices.map((s) => s.value),
      options: {
        chart: {
          type: 'pie',
          fontFamily: "'Inter', sans-serif",
          events: {
            dataPointSelection: function () {
              handleNavigateToProfitability();
            },
          },
        },
        labels: visibleSlices.map((s) => s.label),
        colors,
        legend: { show: false },
        dataLabels: { enabled: false },
        plotOptions: {
          pie: { donut: { size: '0%' } },
        },
        stroke: {
          width: 2,
          colors: [theme === 'light' ? '#f7f9fc' : '#161b22'],
        },
        responsive: [{
          breakpoint: 768,
          options: {
            chart: { height: 280, width: 280 },
          },
        }],
      },
    };
  }, [visibleSlices, grossProfitRaw, theme]);

  const displayDates = useMemo(() => {
    if (effectiveFinanceDates.ready) {
      return {
        startDate: effectiveFinanceDates.startDate,
        endDate: effectiveFinanceDates.endDate,
      };
    }
    if (financeDashMeta?.startDate && financeDashMeta?.endDate) {
      return { startDate: financeDashMeta.startDate, endDate: financeDashMeta.endDate };
    }
    return { startDate: null, endDate: null };
  }, [effectiveFinanceDates, financeDashMeta]);

  const showEmptyState = !loading && !hasFinanceData;

  return (
    <div className="p-1.5 h-full bg-transparent rounded relative flex flex-col">
      <div className="flex flex-wrap items-center justify-between mb-1 gap-1">
        <div className="flex items-center gap-1">
          <Currency className="w-3 h-3 text-blue-400" />
          <h2 className="text-xs font-semibold text-gray-100">Total Sales</h2>
          <div className="relative">
            <Info
              className="w-3 h-3 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors"
              onMouseEnter={() => setOpenToolTipTopSales(true)}
              onMouseLeave={() => setOpenToolTipTopSales(false)}
            />
            {openToolTipTopSales && <ToolTipBoxLeft Information="Total product sales from finance data (DailySkuFinance) for the selected date range."/>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PieChart className="w-3 h-3 text-blue-400" />
          <h2 className="text-xs font-semibold text-gray-100">Gross Profit</h2>
          <div className="relative">
            <Info
              className="w-3 h-3 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors"
              onMouseEnter={() => setOpenToolTipGrossProfit(true)}
              onMouseLeave={() => setOpenToolTipGrossProfit(false)}
            />
            {openToolTipGrossProfit && <TooltipBox Information="Sales minus Amazon fees, refunds, overhead, PPC spend, and COGS (when entered) — same calculation as the Profitability dashboard."/>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between mb-1 gap-1">
        <div className="flex flex-col">
          {loading ? (
            <div className="h-8 w-32 rounded bg-[#21262d] animate-pulse" />
          ) : (
            <h2 className="text-xl font-bold text-gray-100">
              {formatCurrencyWithLocale(totalSales, currency)}
            </h2>
          )}
          <p className="text-xs text-gray-400">
            {displayDates.startDate ? formatDateWithOrdinal(displayDates.startDate) : 'N/A'} - {displayDates.endDate ? formatDateWithOrdinal(displayDates.endDate) : 'N/A'}
          </p>
        </div>
        <div className="flex flex-col items-end">
          {loading ? (
            <div className="h-7 w-24 rounded bg-[#21262d] animate-pulse" />
          ) : (
            <h2 className={`text-lg font-bold ${grossProfitRaw >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {formatCurrencyWithLocale(grossProfitRaw, currency)}
            </h2>
          )}
          <p className="text-xs text-gray-400">
            {grossProfitRaw >= 0 ? 'Profit' : 'Loss'}
          </p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-1.5 items-start min-h-0">
        {loading ? (
          <>
            <div className="lg:col-span-2 flex justify-center items-center w-full">
              <SkeletonChart height={260} />
            </div>
            <div className="lg:col-span-3 flex flex-col justify-between h-full gap-2 p-1.5">
              <SkeletonContent rows={5} />
            </div>
          </>
        ) : showEmptyState ? (
          <div className="lg:col-span-5 flex items-center justify-center py-8">
            <p className="text-sm text-gray-400">No finance data available for this period. Run integration to sync finance data.</p>
          </div>
        ) : (
          <>
            <div className="lg:col-span-2 flex justify-center items-center w-full">
              <div className="w-full flex items-center justify-center">
                <Chart
                  options={chartData.options}
                  series={chartData.series}
                  type="pie"
                  width="100%"
                  height={260}
                />
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col justify-between h-full gap-2">
              {visibleSlices.map((slice, index) => {
                const percentage = totalSales > 0 ? Math.round((slice.value / totalSales) * 100) : 0;
                const hasBreakdown = slice.breakdown.length > 0;
                const dropdownAbove = index >= visibleSlices.length - 2;

                return (
                  <div
                    key={slice.id}
                    className="relative flex-1"
                    onMouseEnter={() => hasBreakdown && setHoveredSlice(index)}
                    onMouseLeave={() => setHoveredSlice(null)}
                  >
                    <div
                      onClick={() => handleNavigateToProfitability()}
                      className="flex items-center justify-between p-2.5 bg-[#21262d] rounded hover:bg-blue-500/20 border border-transparent hover:border-blue-500/40 transition-all cursor-pointer group h-full"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: chartData.options.colors[index] }}
                        ></div>
                        <p className="text-sm font-medium text-gray-200 group-hover:text-blue-400 transition-colors">{slice.label}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-100">
                          {formatCurrencyWithLocale(slice.displayAmount, currency)}
                        </p>
                        <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs font-medium min-w-[2.5rem] text-center">
                          {percentage}%
                        </span>
                      </div>
                    </div>

                    {hoveredSlice === index && hasBreakdown && (
                      <div
                        className={`absolute right-0 z-50 w-56 rounded-lg shadow-xl overflow-hidden ${dropdownAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-dark)' }}
                      >
                        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-dark)' }}>
                          <p className="text-[11px] font-semibold text-gray-300 uppercase tracking-wide">{slice.label} Breakdown</p>
                        </div>
                        <div className="p-2 max-h-48 overflow-y-auto">
                          {slice.breakdown.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#21262d]">
                              <span className="text-[11px] text-gray-400 truncate mr-2">{item.label}</span>
                              <span className={`text-[11px] font-medium whitespace-nowrap ${item.amount < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                                {item.amount < 0 ? '-' : ''}{currency}{Math.abs(item.amount).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TotalSales;
