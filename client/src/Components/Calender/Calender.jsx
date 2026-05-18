import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import './Calendar.css';
import axios from 'axios'
import {useDispatch, useSelector} from 'react-redux'
import {UpdateDashboardInfo, setDashboardInfo, setCalendarMode, setDashboardDateRange} from '../../redux/slices/DashboardSlice.js'
import { fetchTop4Products, fetchProfitabilityDateRange, setProfitabilityDateRange } from '../../redux/slices/PageDataSlice.js'
import { addBrand } from '../../redux/slices/authSlice.js'
// PPC metrics are now filtered locally in Dashboard based on ppcDateWiseMetrics
// No need to fetch filtered metrics from API
import PulseLoader from "react-spinners/PulseLoader";
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check } from 'lucide-react';

import {
  subDays,
  subMonths,
  addMonths,
  addYears,
  setMonth,
  setYear,
  startOfMonth,
  format,
} from 'date-fns';
import { parseLocalDate } from '../../utils/dateUtils.js';

/** Use in mousedown handlers so portaled dropdown clicks don’t close the picker */
export function isClickInsideGaCalDropdown(target) {
  return Boolean(target?.closest?.('[data-ga-cal-dropdown="true"]'));
}

const gaCalLayoutSpring = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.92,
};

/** Match react-date-range Calendar visible months (forwards / backwards). */
function visibleMonthAtIndex(focus, index, monthsShown, calendarFocus) {
  if (calendarFocus === 'backwards') {
    return subMonths(focus, monthsShown - 1 - index);
  }
  return addMonths(focus, index);
}

function readPortalStyle(anchorRef) {
  if (!anchorRef?.current || typeof window === 'undefined') return null;
  const r = anchorRef.current.getBoundingClientRect();
  const gap = 8;
  return {
    position: 'fixed',
    top: r.bottom + gap,
    right: document.documentElement.clientWidth - r.right,
    left: 'auto',
    zIndex: 10050,
  };
}

export default function DateFilter({ setOpenCalender, setSelectedPeriod, anchorRef }) {
  const navigate=useNavigate();
  const location = useLocation();
  const dispatch=useDispatch()
  const [Loader,setLoader]=useState(false);
  const isDemoRoute = location.pathname.includes('/seller-central-checker-demo');
  const isProfitabilityRoute = location.pathname.includes('profitibility');
  
  // Get createdAccountDate from Redux
  const dashboardInfo = useSelector(state => state.Dashboard?.DashBoardInfo);
  const createdAccountDate = dashboardInfo?.createdAccountDate;
  
  // Calculate minimum selectable date (one month before account creation date)
  const getMinimumDate = () => {
    if (createdAccountDate) {
      const accountCreationDate = new Date(createdAccountDate.createdAt);
      return subMonths(accountCreationDate, 1);
    }
    // Fallback to 6 months ago if no account date is available
    return subMonths(new Date(), 6);
  };
  
  const minimumDate = getMinimumDate();
  
  // Initialize state based on current Redux calendar mode
  const initializeCalendarState = () => {
    const calendarMode = dashboardInfo?.calendarMode || 'default';
    
    if (calendarMode === 'custom') {
      // Custom range is selected - initialize with those dates
      return {
        selectedRange: {
          startDate: parseLocalDate(dashboardInfo.startDate),
          endDate: parseLocalDate(dashboardInfo.endDate),
          key: 'selection',
        },
        thirtyDaysActive: false,
        sevenDaysActive: false,
        fourteenDaysActive: false,
        customActive: true
      };
    } else if (calendarMode === 'last7') {
      // Last 7 days: Use backend's endDate as reference (no calculation from current date)
      // startDate = endDate - 6 days (gives 7 days total)
      const hasBackendDates = dashboardInfo?.startDate && dashboardInfo?.endDate;
      const backendEndDate = hasBackendDates ? parseLocalDate(dashboardInfo.endDate) : subDays(new Date(), 1);
      return {
        selectedRange: {
          startDate: subDays(backendEndDate, 6), // 6 days before backend endDate
          endDate: backendEndDate,               // backend endDate
          key: 'selection',
        },
        thirtyDaysActive: false,
        sevenDaysActive: true,
        fourteenDaysActive: false,
        customActive: false
      };
    } else if (calendarMode === 'last14') {
      const hasBackendDates = dashboardInfo?.startDate && dashboardInfo?.endDate;
      const backendEndDate = hasBackendDates ? parseLocalDate(dashboardInfo.endDate) : subDays(new Date(), 1);
      return {
        selectedRange: {
          startDate: subDays(backendEndDate, 13),
          endDate: backendEndDate,
          key: 'selection',
        },
        thirtyDaysActive: false,
        sevenDaysActive: false,
        fourteenDaysActive: true,
        customActive: false
      };
    } else {
      // Default "Last 30 days" - use actual data range from backend if available
      // This ensures calendar shows the correct date range based on when data was actually fetched
      // Falls back to calculated dates only if backend dates are not available
      const hasBackendDates = dashboardInfo?.startDate && dashboardInfo?.endDate;
      return {
        selectedRange: {
          startDate: hasBackendDates ? parseLocalDate(dashboardInfo.startDate) : subDays(new Date(), 30),
          endDate: hasBackendDates ? parseLocalDate(dashboardInfo.endDate) : subDays(new Date(), 1),
          key: 'selection',
        },
        thirtyDaysActive: true,
        sevenDaysActive: false,
        fourteenDaysActive: false,
        customActive: false
      };
    }
  };
  
  const initialState = initializeCalendarState();
  
  const [selectedRange, setSelectedRange] = useState(initialState.selectedRange);
  const [thirtyDaysActive,setThirtyDaysActive]=useState(initialState.thirtyDaysActive);
  const [sevenDaysActive,setSevenDaysActive]=useState(initialState.sevenDaysActive);
  const [customActive,setCustomActive]=useState(initialState.customActive);
  const [fourteenDaysActive, setFourteenDaysActive] = useState(initialState.fourteenDaysActive || false);
  /** True only after user picks Custom — calendar + apply show on the right */
  const [customPanelOpen, setCustomPanelOpen] = useState(Boolean(initialState.customActive));
  /** Keeps split popover layout until custom panel exit animation finishes (avoids layout jump) */
  const [splitLayout, setSplitLayout] = useState(Boolean(initialState.customActive));

  const [portalPosition, setPortalPosition] = useState(() => readPortalStyle(anchorRef));

  useEffect(() => {
    if (customPanelOpen) setSplitLayout(true);
  }, [customPanelOpen]);

  const updatePortalPosition = useCallback(() => {
    setPortalPosition(readPortalStyle(anchorRef));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!anchorRef) {
      setPortalPosition(null);
      return undefined;
    }
    updatePortalPosition();
    window.addEventListener('resize', updatePortalPosition);
    document.addEventListener('scroll', updatePortalPosition, true);
    return () => {
      window.removeEventListener('resize', updatePortalPosition);
      document.removeEventListener('scroll', updatePortalPosition, true);
    };
  }, [anchorRef, updatePortalPosition, customPanelOpen, splitLayout]);

  // NOTE: We no longer sync with Redux state changes while the calendar is open.
  // The calendar initializes from Redux state when it mounts (via initializeCalendarState),
  // and user interactions control the state from that point forward.
  // This prevents the calendar from resetting or closing when the user is switching between filters.

  const formatPillDate = (date) =>
    date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) || '';

  const handleActive=(btnValue)=>{
    switch(btnValue){
      case 'last30':
        setThirtyDaysActive(true);
        setSevenDaysActive(false);
        setFourteenDaysActive(false);
        setCustomActive(false);
        break;
      case 'last7':
        setThirtyDaysActive(false);
        setSevenDaysActive(true);
        setFourteenDaysActive(false);
        setCustomActive(false);
        break;
      case 'custom':
        setThirtyDaysActive(false);
        setSevenDaysActive(false);
        setFourteenDaysActive(false);
        setCustomActive(true);
        break;
      case 'last14':
        setThirtyDaysActive(false);
        setSevenDaysActive(false);
        setFourteenDaysActive(true);
        setCustomActive(false);
        break;
      default:
        setThirtyDaysActive(false);
        setSevenDaysActive(false);
        setFourteenDaysActive(false);
        setCustomActive(false);
        break;
    }
  }

  const submitdateRange = async (e) => {
    e.preventDefault();
    
    // Update selected period text for custom range
    if (customActive && setSelectedPeriod) {
      const formatDate = (date) => date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
      setSelectedPeriod(`${formatDate(selectedRange.startDate)} - ${formatDate(selectedRange.endDate)}`);
    }

    await applyDateRange(selectedRange, 'custom');
    // Interaction flag will be reset in applyDateRange's finally block
  }

  const handlePreset = async (type) => {
    const today = new Date();

    switch (type) {
      case 'last30':
        setCustomPanelOpen(false);
        handleActive('last30');
        // Use existing backend dates if available, otherwise fallback to calculated dates
        // This prevents showing incorrect dates before the API call returns
        const hasExistingBackendDates = dashboardInfo?.startDate && dashboardInfo?.endDate;
        const defaultRange = {
          startDate: hasExistingBackendDates ? parseLocalDate(dashboardInfo.startDate) : subDays(today, 30),
          endDate: hasExistingBackendDates ? parseLocalDate(dashboardInfo.endDate) : subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(defaultRange);
        if (setSelectedPeriod) setSelectedPeriod('Last 30 Days');
        
        // Set calendar mode to default
        dispatch(setCalendarMode('default'));

        if (isDemoRoute) {
          await applyDateRange(defaultRange, 'last30');
        } else if (isProfitabilityRoute) {
          dispatch(setCalendarMode('default'));
          try {
            const result = await dispatch(fetchProfitabilityDateRange()).unwrap();
            if (result?.startDate && result?.endDate) {
              setSelectedRange({
                startDate: parseLocalDate(result.startDate),
                endDate: parseLocalDate(result.endDate),
                key: 'selection',
              });
              dispatch(setDashboardDateRange({
                startDate: result.startDate,
                endDate: result.endDate,
                calendarMode: 'default',
              }));
            }
          } catch (err) {
            console.error('Profitability date range reset failed:', err);
          }
          setOpenCalender(false);
        } else {
          await applyDefaultDateRange();
        }
        break;
      case 'last7':
        setCustomPanelOpen(false);
        handleActive('last7');
        // Last 7 days: Use backend's endDate as reference (no calculation from current date)
        // endDate = from backend, startDate = endDate - 6 days (gives 7 days total)
        const hasBackendDatesFor7 = dashboardInfo?.startDate && dashboardInfo?.endDate;
        const backendEndDateFor7 = hasBackendDatesFor7 ? parseLocalDate(dashboardInfo.endDate) : subDays(today, 1);
        const last7Range = {
          startDate: subDays(backendEndDateFor7, 6), // 6 days before backend endDate
          endDate: backendEndDateFor7,               // backend endDate
          key: 'selection',
        };
        setSelectedRange(last7Range);
        if (setSelectedPeriod) setSelectedPeriod('Last 7 Days');
        
        // Set calendar mode to last7
        dispatch(setCalendarMode('last7'));
        
        // Make API call with last 7 days range (relative to backend endDate)
        await applyDateRange(last7Range, 'last7');
        break;
      case 'last14':
        setCustomPanelOpen(false);
        handleActive('last14');
        const hasBackendDatesFor14 = dashboardInfo?.startDate && dashboardInfo?.endDate;
        const backendEndDateFor14 = hasBackendDatesFor14 ? parseLocalDate(dashboardInfo.endDate) : subDays(today, 1);
        const last14Range = {
          startDate: subDays(backendEndDateFor14, 13),
          endDate: backendEndDateFor14,
          key: 'selection',
        };
        setSelectedRange(last14Range);
        if (setSelectedPeriod) setSelectedPeriod('Last 14 Days');
        dispatch(setCalendarMode('last14'));
        await applyDateRange(last14Range, 'last14');
        break;
      case 'custom':
        handleActive('custom');
        setSplitLayout(true);
        setCustomPanelOpen(true);
        break;
      default:
        break;
    }
  };

  const applyDefaultDateRange = async () => {
    setLoader(true);
    
    try {
      // NEW: Fetch pre-calculated dashboard data from the page-wise endpoint
      // The backend now handles all calculations
      const response = await axios.get(`${import.meta.env.VITE_BASE_URI}/api/pagewise/dashboard`, {
        withCredentials: true
      });

      if (response.status !== 200) {
        navigate(`/error/${response.status}`);
        return;
      }

      // Dashboard data is now pre-calculated by the backend
      const dashboardData = response.data?.data?.dashboardData;

      // Update Redux store with complete dashboard data while preserving
      // phase-4 top-products fields that are loaded separately.
      const existingDashboard = dashboardInfo || {};
      dispatch(setDashboardInfo({
        ...dashboardData,
        first: existingDashboard.first ?? dashboardData?.first ?? null,
        second: existingDashboard.second ?? dashboardData?.second ?? null,
        third: existingDashboard.third ?? dashboardData?.third ?? null,
        fourth: existingDashboard.fourth ?? dashboardData?.fourth ?? null,
        topPriorityProductsSales: existingDashboard.topPriorityProductsSales ?? []
      }));

      // Ensure Top Products to Fix (sales/issues tabs) is refreshed after switching back
      // to default 30-day mode.
      dispatch(fetchTop4Products());
      
      // PPC metrics are now filtered locally in Dashboard
      // When calendarMode is 'default', Dashboard will use ppcSummaryLatest
      console.log('=== Calendar: Last 30 days selected, Dashboard will use latest PPC metrics ===');
      
      // Update the calendar's selected range to match the actual backend dates
      // This ensures the calendar displays the correct date range based on when data was actually fetched
      if (dashboardData?.startDate && dashboardData?.endDate) {
        setSelectedRange({
          startDate: parseLocalDate(dashboardData.startDate),
          endDate: parseLocalDate(dashboardData.endDate),
          key: 'selection',
        });
        console.log('Calendar: Updated selectedRange from backend dates:', dashboardData.startDate, 'to', dashboardData.endDate);
      }
      
      // Dispatch brand name if available
      if (dashboardData?.Brand) {
        dispatch(addBrand(dashboardData.Brand));
      }

    } catch (error) {
      console.error('Error fetching default dashboard data:', error);
      navigate('/error/500');
    } finally {
      setLoader(false);
      setOpenCalender(false);
    }
  };

  const applyDateRange = async (range, periodType = null) => {
    setLoader(true);
    const startDate = range.startDate;
    const endDate = range.endDate;

    // Format dates properly for URL (ISO format: YYYY-MM-DD)
    const formatDateForURL = (date) => {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formattedStartDate = formatDateForURL(startDate);
    const formattedEndDate = formatDateForURL(endDate);

    // Profitability page: update isolated date slice only (no legacy analyse / TotalSales refresh)
    if (isProfitabilityRoute) {
      try {
        let calendarMode = 'custom';
        if (periodType === 'last7') calendarMode = 'last7';
        else if (periodType === 'last14') calendarMode = 'last14';
        else if (periodType === 'last30' || periodType === 'last31') calendarMode = 'default';

        dispatch(setProfitabilityDateRange({
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          calendarMode,
        }));
        dispatch(setDashboardDateRange({
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          calendarMode,
        }));
        dispatch(setCalendarMode(calendarMode));
      } catch (error) {
        console.error('Profitability calendar update failed:', error);
      } finally {
        setLoader(false);
        setOpenCalender(false);
      }
      return;
    }
    
    try {
      // Add periodType as query parameter - properly encode dates
      const url = `${import.meta.env.VITE_BASE_URI}/app/analyse/getDataFromDate?startDate=${encodeURIComponent(formattedStartDate)}&endDate=${encodeURIComponent(formattedEndDate)}${periodType ? `&periodType=${periodType}` : ''}`;
      const dateResponse = await axios.get(url, {withCredentials: true});

      if (dateResponse.status !== 200) {
        navigate(`/error/${dateResponse.status}`);
      }

      // Determine calendar mode based on periodType
      let calendarMode = 'custom'; // default
      if (periodType === 'last7') {
        calendarMode = 'last7';
      } else if (periodType === 'last14') {
        calendarMode = 'last14';
      } else if (periodType === 'last30' || periodType === 'last31') {
        calendarMode = 'default';
      } else if (periodType === 'custom') {
        calendarMode = 'custom';
      }

      const responseStartDate = dateResponse?.data?.data?.startDate;
      const responseEndDate = dateResponse?.data?.data?.endDate;
      const resolvedStartDate = responseStartDate || formattedStartDate;
      const resolvedEndDate = responseEndDate || formattedEndDate;
      
      dispatch(UpdateDashboardInfo({
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        financeData: dateResponse.data.data.FinanceData,
        reimburstmentData: dateResponse.data.data.reimburstmentData,
        WeeklySales: dateResponse.data.data.TotalSales.totalSales,
        TotalSales: dateResponse.data.data.TotalSales.dateWiseSales,
        GetOrderData: dateResponse.data.data.GetOrderData,
        calendarMode: calendarMode, // Use determined calendar mode
        createdAccountDate: createdAccountDate
      }));
      
      // PPC metrics are now filtered locally in Dashboard based on ppcDateWiseMetrics
      // No need for separate API call - Dashboard will recalculate when dates change

    } catch (error) {
      console.error('Calendar API Error:', error);
      navigate('/error/500');
    } finally {
      setLoader(false);
      setOpenCalender(false);
    }
  };

  const handleRangeChange = (item) => {
    // Only allow changes if in custom mode
    if (customActive) {
      setSelectedRange(item.selection);
    }
  };

  const presets = [
    { id: 'last30', label: 'Last 30 days', active: thirtyDaysActive },
    { id: 'last7', label: 'Last 7 days', active: sevenDaysActive },
    { id: 'last14', label: 'Last 14 days', active: fourteenDaysActive },
    { id: 'custom', label: 'Custom', active: customActive },
  ];

  /** Apply in the same row as month/year dropdowns + arrows (navigatorRenderer API) */
  const customNavigatorRenderer = useCallback(
    (focusedDate, changeShownDate, calProps) => {
      const {
        showMonthArrow,
        minDate: navMinDate,
        maxDate: navMaxDate,
        showMonthAndYearPickers,
        ariaLabels = {},
        months: monthsProp = 1,
        calendarFocus = 'forwards',
        direction = 'vertical',
        monthDisplayFormat = 'MMM yyyy',
        locale: navLocale,
      } = calProps;
      const monthsShown = Math.max(1, monthsProp);
      const isDualHeader =
        monthsShown >= 2 && direction === 'horizontal';
      const dateFmtOpts = { locale: navLocale };

      const upperYearLimit = (navMaxDate || addYears(new Date(), 20)).getFullYear();
      const lowerYearLimit = (navMinDate || addYears(new Date(), -100)).getFullYear();
      const monthNames = [...Array(12).keys()].map((i) => calProps.locale.localize.month(i));

      const applyPickerChange = (columnIndex, monthDate, mode, value) => {
        const v = Number(value);
        const updated =
          mode === 'month'
            ? startOfMonth(setMonth(monthDate, v))
            : startOfMonth(setYear(monthDate, v));
        if (isDualHeader && columnIndex === 1) {
          changeShownDate(subMonths(updated, 1), 'set');
        } else {
          changeShownDate(updated, 'set');
        }
      };

      const renderMonthYearSelects = (columnIndex) => {
        const monthDate = isDualHeader
          ? visibleMonthAtIndex(focusedDate, columnIndex, monthsShown, calendarFocus)
          : focusedDate;
        const monthAria =
          columnIndex === 0
            ? ariaLabels.monthPicker
            : ariaLabels.monthPickerSecond || 'Second visible month';
        const yearAria =
          columnIndex === 0
            ? ariaLabels.yearPicker
            : ariaLabels.yearPickerSecond || 'Second visible month year';

        return (
          <span
            key={columnIndex}
            className="rdrMonthAndYearPickers ga-cal__monthNavPickers"
          >
            <span className="rdrMonthPicker">
              <select
                value={monthDate.getMonth()}
                onChange={(e) => applyPickerChange(columnIndex, monthDate, 'month', e.target.value)}
                aria-label={monthAria}
              >
                {monthNames.map((monthName, i) => (
                  <option key={i} value={i}>
                    {monthName}
                  </option>
                ))}
              </select>
            </span>
            <span className="rdrMonthAndYearDivider ga-cal__monthNavDivider" aria-hidden />
            <span className="rdrYearPicker">
              <select
                value={monthDate.getFullYear()}
                onChange={(e) => applyPickerChange(columnIndex, monthDate, 'year', e.target.value)}
                aria-label={yearAria}
              >
                {new Array(upperYearLimit - lowerYearLimit + 1)
                  .fill(upperYearLimit)
                  .map((val, i) => {
                    const year = val - i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
              </select>
            </span>
          </span>
        );
      };

      const renderTextMonthLabels = () => {
        if (isDualHeader) {
          const m0 = visibleMonthAtIndex(focusedDate, 0, monthsShown, calendarFocus);
          const m1 = visibleMonthAtIndex(focusedDate, 1, monthsShown, calendarFocus);
          return (
            <span className="rdrMonthAndYearPickers ga-cal__monthNavPickers ga-cal__monthNavPickers--labels">
              <span className="ga-cal__monthNavLabel">{format(m0, monthDisplayFormat, dateFmtOpts)}</span>
              <span className="ga-cal__monthNavBetweenPickers" aria-hidden />
              <span className="ga-cal__monthNavLabel">{format(m1, monthDisplayFormat, dateFmtOpts)}</span>
            </span>
          );
        }
        return (
          <span className="rdrMonthAndYearPickers ga-cal__monthNavPickers ga-cal__monthNavPickers--labels">
            <span className="ga-cal__monthNavLabel">
              {monthNames[focusedDate.getMonth()]} {focusedDate.getFullYear()}
            </span>
          </span>
        );
      };

      return (
        <div
          onMouseUp={(e) => e.stopPropagation()}
          className="rdrMonthAndYearWrapper ga-cal__monthNavRow"
        >
          <div className="ga-cal__monthNavLeft">
            <div
              className={`ga-cal__monthNavCluster${isDualHeader ? ' ga-cal__monthNavCluster--dual' : ''}`}
              role="group"
              aria-label={isDualHeader ? 'Visible calendar months' : 'Calendar month and year'}
            >
              {showMonthArrow ? (
                <button
                  type="button"
                  className="rdrNextPrevButton rdrPprevButton ga-cal__monthNavArrow"
                  onClick={() => changeShownDate(-1, 'monthOffset')}
                  aria-label={ariaLabels.prevButton}
                >
                  <i />
                </button>
              ) : null}
              {showMonthAndYearPickers ? (
                isDualHeader ? (
                  <>
                    {renderMonthYearSelects(0)}
                    <span className="ga-cal__monthNavBetweenPickers" aria-hidden />
                    {renderMonthYearSelects(1)}
                  </>
                ) : (
                  renderMonthYearSelects(0)
                )
              ) : (
                renderTextMonthLabels()
              )}
              {showMonthArrow ? (
                <button
                  type="button"
                  className="rdrNextPrevButton rdrNextButton ga-cal__monthNavArrow"
                  onClick={() => changeShownDate(+1, 'monthOffset')}
                  aria-label={ariaLabels.nextButton}
                >
                  <i />
                </button>
              ) : null}
            </div>
          </div>
          <div className="ga-cal__monthNavRight">
            <button
              type="button"
              onClick={submitdateRange}
              className="ga-cal__btn ga-cal__btn--primary ga-cal__btn--navApply"
              disabled={Loader}
            >
              {Loader ? (
                <span className="ga-cal__btnLoading">
                  <PulseLoader color="#ffffff" size={4} />
                  <span>Applying…</span>
                </span>
              ) : (
                'Apply'
              )}
            </button>
          </div>
        </div>
      );
    },
    [Loader, submitdateRange]
  );

  const fixedPortalStyle = anchorRef
    ? (portalPosition ?? readPortalStyle(anchorRef))
    : undefined;

  const dropdown = (
    <motion.div
      data-ga-cal-dropdown="true"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={`ga-cal-dropdown${anchorRef ? ' ga-cal-dropdown--portal' : ''}`}
      style={fixedPortalStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <motion.div
        layout
        layoutDependency={customPanelOpen}
        role="listbox"
        aria-label="Date range"
        className={`ga-cal-popover ${splitLayout ? 'ga-cal-popover--split' : ''}`}
        transition={{ layout: gaCalLayoutSpring }}
        style={{ borderRadius: 8 }}
      >
        <div className="ga-cal-menu">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.active}
              onClick={() => handlePreset(p.id)}
              disabled={Loader}
              className={`ga-cal-menuItem ${p.active ? 'is-active' : ''}`}
            >
              <span className="ga-cal-menuItemLabel">{p.label}</span>
              <span className="ga-cal-menuItemAffix">
                {p.active ? (
                  <Check className="w-4 h-4" aria-hidden />
                ) : p.id === 'custom' && !customPanelOpen && !splitLayout ? (
                  <ChevronRight className="w-4 h-4 opacity-50" aria-hidden />
                ) : null}
              </span>
            </button>
          ))}
        </div>

        <AnimatePresence
          onExitComplete={() => {
            if (!customPanelOpen) setSplitLayout(false);
          }}
        >
          {customPanelOpen && (
            <motion.div
              key="ga-cal-custom-pane"
              className="ga-cal-customPane"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{
                opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                x: { ...gaCalLayoutSpring },
              }}
              style={{ transformOrigin: 'left center' }}
            >
              <div className="ga-cal__rangePills ga-cal__rangePills--compact">
                <div className="ga-cal__pill is-active">
                  <div className="ga-cal__pillLabel">From</div>
                  <div className="ga-cal__pillValue">{formatPillDate(selectedRange?.startDate)}</div>
                </div>
                <div className="ga-cal__pill is-active">
                  <div className="ga-cal__pillLabel">To</div>
                  <div className="ga-cal__pillValue">{formatPillDate(selectedRange?.endDate)}</div>
                </div>
              </div>

              <div className="calendar-container ga-cal__calendar ga-cal__calendar--embedded">
                <DateRange
                  ranges={[selectedRange]}
                  onChange={handleRangeChange}
                  moveRangeOnFirstSelection={false}
                  editableDateInputs
                  rangeColors={['#3b82f6']}
                  color="#3b82f6"
                  months={2}
                  direction="horizontal"
                  minDate={minimumDate}
                  maxDate={new Date()}
                  showDateDisplay={false}
                  className="modern-calendar"
                  navigatorRenderer={customNavigatorRenderer}
                />
              </div>

              <div className="ga-cal__footer ga-cal__footer--custom ga-cal__footer--backOnly">
                <button
                  type="button"
                  onClick={() => setCustomPanelOpen(false)}
                  className="ga-cal__btn ga-cal__btn--ghost"
                  disabled={Loader}
                >
                  Back
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );

  if (anchorRef) {
    return createPortal(dropdown, document.body);
  }
  return dropdown;
}
