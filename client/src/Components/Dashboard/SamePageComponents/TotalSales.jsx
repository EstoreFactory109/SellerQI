import React, { useState, useEffect, useMemo } from "react";
import { Info, Currency, PieChart } from 'lucide-react';
import Chart from "react-apexcharts";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import axios from 'axios';
import TooltipBox from "../../ToolTipBox/ToolTipBoxBottom";
import ToolTipBoxLeft from '../../ToolTipBox/ToolTipBoxBottomLeft';
import { formatCurrencyWithLocale } from '../../../utils/currencyUtils.js';
import { parseLocalDate } from '../../../utils/dateUtils.js';
import { buildTotalSalesFilterUrl, shouldUseCalendarDateRange } from '../../../utils/totalSalesFilterUrl.js';
import { pickSnapshotFeeTotalsForCalendar } from '../../../utils/expenseSnapshotCalendar.js';
import { fetchLatestPPCMetrics, selectPPCSummary, selectPPCDateWiseMetrics, selectLatestPPCMetricsLoading } from '../../../redux/slices/PPCMetricsSlice.js';
import { SkeletonChart } from '../../../Components/Skeleton/PageSkeletons.jsx';
import { SkeletonContent } from '../../../Components/Skeleton/Skeleton.jsx';

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

/** Match ProfitibilityDashboard: default → last30 window; period query is 7 | 14 | 30. */
const getProfitabilityPeriodDays = (calendarMode) => {
  const periodTypeRaw = calendarMode || 'default';
  const periodType = periodTypeRaw === 'default' ? 'last30' : periodTypeRaw;
  if (periodType === 'last7') return 7;
  if (periodType === 'last14') return 14;
  return 30;
};

const TotalSales = () => {
  const dispatch = useDispatch();
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const calendarMode = useSelector(state => state.Dashboard.DashBoardInfo?.calendarMode);
  const startDate = useSelector(state => state.Dashboard.DashBoardInfo?.startDate);
  const endDate = useSelector(state => state.Dashboard.DashBoardInfo?.endDate);
  const currency = useSelector(state => state.currency?.currency) || '$';
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

  const [salesData, setSalesData] = useState(null);
  const [profitSummary, setProfitSummary] = useState(null);
  const [expenseReportSnapshot, setExpenseReportSnapshot] = useState(null);
  /** Fallback when summary/snapshot unavailable — same /api/expenses/* totals as before */
  const [expenseFallback, setExpenseFallback] = useState({
    amazonFees: 0,
    totalExpenses: 0,
    refunds: 0,
  });
  const [loading, setLoading] = useState(false);
  const [openToolTipGrossProfit, setOpenToolTipGrossProfit] = useState(false);
  const [openToolTipTopSales, setOpenToolTipTopSales] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const periodDays = getProfitabilityPeriodDays(calendarMode);
        const useRange = shouldUseCalendarDateRange(startDate, endDate, calendarMode);
        const base = import.meta.env.VITE_BASE_URI;
        const root = String(base).replace(/\/$/, '');

        // SalesOnlyMetrics: custom + dates when Redux has range; else last30 (same as ProfitibilityDashboard)
        const salesUrl = buildTotalSalesFilterUrl(base, { startDate, endDate, calendarMode });

        const summaryUrl = useRange
          ? `${root}/api/profitability/summary/date-range?from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
          : `${root}/api/profitability/summary?period=${periodDays}`;

        const snapshotUrl = `${root}/api/expenses/snapshot`;

        const totalExpUrl = useRange
          ? `${root}/api/expenses/total/date-range?from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
          : `${root}/api/expenses/total?period=${periodDays}`;

        const amazonFeesUrl = useRange
          ? `${root}/api/expenses/amazon-fees/date-range?from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
          : `${root}/api/expenses/amazon-fees?period=${periodDays}`;

        const refundsUrl = useRange
          ? `${root}/api/expenses/refunds/date-range?from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
          : `${root}/api/expenses/refunds?period=${periodDays}`;

        const [
          salesResp,
          summaryResp,
          snapshotResp,
          totalExpResp,
          amazonFeesResp,
          refundsResp,
        ] = await Promise.all([
          axios.get(salesUrl, { withCredentials: true }).catch(() => null),
          axios.get(summaryUrl, { withCredentials: true }).catch(() => null),
          axios.get(snapshotUrl, { withCredentials: true }).catch(() => null),
          axios.get(totalExpUrl, { withCredentials: true }).catch(() => null),
          axios.get(amazonFeesUrl, { withCredentials: true }).catch(() => null),
          axios.get(refundsUrl, { withCredentials: true }).catch(() => null),
        ]);

        if (salesResp?.status === 200 && salesResp?.data?.data) {
          setSalesData(salesResp.data.data);
        } else {
          setSalesData(null);
        }

        if (summaryResp?.data?.data) {
          setProfitSummary(summaryResp.data.data);
        } else {
          setProfitSummary(null);
        }

        if (snapshotResp?.data?.data) {
          setExpenseReportSnapshot(snapshotResp.data.data);
        } else {
          setExpenseReportSnapshot(null);
        }

        const totalExp = Math.abs(Number(totalExpResp?.data?.data?.total || 0));
        const amazonFees = Math.abs(Number(amazonFeesResp?.data?.data?.total || 0));
        const refunds = Math.abs(Number(refundsResp?.data?.data?.total || 0));

        setExpenseFallback({ totalExpenses: totalExp, amazonFees, refunds });
      } catch (error) {
        console.error('Error fetching chart data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [calendarMode, startDate, endDate]);

  const filteredPPCMetrics = useMemo(() => {
    if (!shouldUseCalendarDateRange(startDate, endDate, calendarMode) || !ppcDateWiseMetrics.length) return ppcDateWiseMetrics;
    // Align with ProfitibilityDashboard / Campaign Audit: include full days in local time
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return ppcDateWiseMetrics.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate >= start && itemDate <= end;
    });
  }, [ppcDateWiseMetrics, startDate, endDate, calendarMode]);

  const labelData = [
    "Gross Profit",
    "PPC Spent",
    "Amazon Fees",
    "Other Expenses",
    "Refunds",
  ];

  const hasSalesData = salesData !== null;

  /** Expense math aligned with ProfitibilityDashboard (snapshot → profit summary → /api/expenses/* fallback). */
  const pieMetrics = useMemo(() => {
    const useRange = shouldUseCalendarDateRange(startDate, endDate, calendarMode);

    const snapshotFeeTotals = pickSnapshotFeeTotalsForCalendar(
      expenseReportSnapshot,
      calendarMode,
      startDate,
      endDate
    );

    const fbTotal = Math.abs(expenseFallback.totalExpenses);
    const fbAmazon = Math.abs(expenseFallback.amazonFees);
    const fbRefunds = Math.abs(expenseFallback.refunds);

    const displayAmazonFees = snapshotFeeTotals
      ? Math.abs(snapshotFeeTotals.amazonFees)
      : profitSummary
        ? Math.abs(profitSummary.amazonFees || 0)
        : fbAmazon;

    const displayTotalExpenses = snapshotFeeTotals
      ? Math.abs(snapshotFeeTotals.totalExpenses)
      : profitSummary
        ? Math.abs(profitSummary.totalExpenses || 0)
        : fbTotal;

    const displayRefunds = profitSummary
      ? Math.abs(profitSummary.refunds || 0)
      : fbRefunds;

    // Prefer /api/total-sales/filter (sum of datewiseSales in SalesOnlyMetrics) for all calendar modes when loaded
    const hasSalesOnlyTotal =
      salesData?.totalSales?.amount !== undefined && salesData?.totalSales?.amount !== null;
    const totalSalesVal = hasSalesOnlyTotal
      ? Number(salesData.totalSales.amount)
      : profitSummary?.totalSales != null
        ? Number(profitSummary.totalSales)
        : Number(info?.TotalWeeklySale || 0);

    let ppcSpentVal = 0;
    if (useRange && filteredPPCMetrics.length > 0) {
      ppcSpentVal = filteredPPCMetrics.reduce((sum, item) => sum + (item.spend || 0), 0);
    } else if (ppcSummary?.totalSpend > 0) {
      ppcSpentVal = ppcSummary.totalSpend;
    }

    // Gross profit: always subtract PPC spend as well (keeps PPC as an explicit cost bucket)
    const grossProfitRawVal = totalSalesVal - displayTotalExpenses - ppcSpentVal;

    // Ensure refunds are not double-counted: TotalExpenses includes refunds (because refunds are part of ExpenseRawRow aggregation),
    // but refunds are also shown as a separate pie slice.
    const otherExpensesVal = Math.max(0, displayTotalExpenses - displayAmazonFees - displayRefunds);

    const grossProfitVal = Math.abs(grossProfitRawVal);

    const saleValuesVal = [
      grossProfitVal,
      ppcSpentVal,
      displayAmazonFees,
      otherExpensesVal,
      displayRefunds,
    ];

    return {
      totalSales: totalSalesVal,
      ppcSpent: ppcSpentVal,
      grossProfitRaw: grossProfitRawVal,
      grossProfit: grossProfitVal,
      saleValues: saleValuesVal,
    };
  }, [
    salesData,
    profitSummary,
    expenseReportSnapshot,
    expenseFallback,
    calendarMode,
    startDate,
    endDate,
    filteredPPCMetrics,
    ppcSummary,
    info?.TotalWeeklySale,
  ]);

  const { totalSales, grossProfitRaw, grossProfit, saleValues } = pieMetrics;

  const handleNavigateToProfitability = () => {
    navigate('/seller-central-checker/profitibility-dashboard');
  };

  const chartData = {
    series: saleValues,
    options: {
      chart: {
        type: "pie",
        fontFamily: "'Inter', sans-serif",
        events: {
          dataPointSelection: function() {
            handleNavigateToProfitability();
          }
        }
      },
      labels: labelData,
      colors: [
        grossProfitRaw < 0 ? "#64748b" : "#059669",
        "#d97706",
        "#ea580c",
        "#dc2626",
        "#9333ea",
      ],
      legend: { show: false },
      dataLabels: { enabled: false },
      plotOptions: {
        pie: { donut: { size: '0%' } }
      },
      stroke: {
        width: 2,
        colors: ['#161b22']
      },
      responsive: [{
        breakpoint: 768,
        options: {
          chart: { height: 280, width: 280 }
        }
      }]
    },
  };

  const getDisplayDates = () => {
    if (startDate && endDate) return { startDate, endDate };
    if (hasSalesData && salesData?.dateRange?.startDate && salesData?.dateRange?.endDate) {
      return { startDate: salesData.dateRange.startDate, endDate: salesData.dateRange.endDate };
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const calcStart = new Date(yesterday);
    calcStart.setDate(yesterday.getDate() - 30);
    return {
      startDate: calcStart.toISOString().split('T')[0],
      endDate: yesterday.toISOString().split('T')[0],
    };
  };

  const displayDates = getDisplayDates();

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
            {openToolTipTopSales && <ToolTipBoxLeft Information="Total revenue generated during the selected date range."/>}
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
            {openToolTipGrossProfit && <TooltipBox Information="Gross profit after deducting ad spend, storage fees, FBA fees, and product return refunds from sales revenue."/>}
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
              <SkeletonContent rows={6} />
            </div>
          </>
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
              {labelData.map((label, index) => {
                const value = saleValues[index];
                const percentage = totalSales > 0 ? Math.round((value / totalSales) * 100) : 0;

                return (
                  <div
                    key={index}
                    onClick={() => handleNavigateToProfitability()}
                    className="flex items-center justify-between p-2.5 bg-[#21262d] rounded hover:bg-blue-500/20 border border-transparent hover:border-blue-500/40 transition-all cursor-pointer group flex-1"
                    title={`Click to view ${label} details in Profitability Dashboard`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: chartData.options.colors[index] }}
                      ></div>
                      <p className="text-sm font-medium text-gray-200 group-hover:text-blue-400 transition-colors">{label}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-100">
                        {formatCurrencyWithLocale((index === 0 ? grossProfitRaw : value), currency)}
                      </p>
                      <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs font-medium min-w-[2.5rem] text-center">
                        {percentage}%
                      </span>
                    </div>
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
