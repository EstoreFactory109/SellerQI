import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import './Calendar.css';
import axios from 'axios'
import {useDispatch, useSelector} from 'react-redux'
import {UpdateDashboardInfo, setDashboardInfo, setCalendarMode} from '../../redux/slices/DashboardSlice.js'
import { addBrand } from '../../redux/slices/authSlice.js'
import PulseLoader from "react-spinners/PulseLoader";
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, Sparkles } from 'lucide-react';

import {
  subDays,
  subMonths,
} from 'date-fns';

export default function DateFilter({setOpenCalender, setSelectedPeriod}) {
  const navigate=useNavigate();
  const dispatch=useDispatch()
  const [Loader,setLoader]=useState(false);
  
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
          startDate: new Date(dashboardInfo.startDate),
          endDate: new Date(dashboardInfo.endDate),
          key: 'selection',
        },
        thirtyDaysActive: false,
        sevenDaysActive: false,
        customActive: true
      };
    } else if (calendarMode === 'last7') {
      // Last 7 days is selected
      return {
        selectedRange: {
          startDate: subDays(new Date(), 8),
          endDate: subDays(new Date(), 1),
          key: 'selection',
        },
        thirtyDaysActive: false,
        sevenDaysActive: true,
        customActive: false
      };
    } else {
      // Default "Last 30 days" or no dates - default to last 29 days (28 days before yesterday to yesterday)
      // Due to 24-hour data delay, we show data from 28 days ago to yesterday
      return {
        selectedRange: {
          startDate: subDays(new Date(), 29),
          endDate: subDays(new Date(), 1),
          key: 'selection',
        },
        thirtyDaysActive: true,
        sevenDaysActive: false,
        customActive: false
      };
    }
  };
  
  const initialState = initializeCalendarState();
  
  const [selectedRange, setSelectedRange] = useState(initialState.selectedRange);
  const [thirtyDaysActive,setThirtyDaysActive]=useState(initialState.thirtyDaysActive);
  const [sevenDaysActive,setSevenDaysActive]=useState(initialState.sevenDaysActive);
  const [customActive,setCustomActive]=useState(initialState.customActive);

  // Debug: Log initial calendar state
  console.log('=== Calendar Component Initialization ===');
  console.log('Dashboard startDate:', dashboardInfo?.startDate);
  console.log('Dashboard endDate:', dashboardInfo?.endDate);
  console.log('Calendar mode from Redux:', dashboardInfo?.calendarMode);
  console.log('Is custom range:', dashboardInfo?.calendarMode === 'custom');
  console.log('Is last 7 days:', dashboardInfo?.calendarMode === 'last7');
  console.log('Initial thirtyDaysActive:', initialState.thirtyDaysActive);
  console.log('Initial sevenDaysActive:', initialState.sevenDaysActive);
  console.log('Initial customActive:', initialState.customActive);
  console.log('Initial selectedRange:', initialState.selectedRange);

  // NOTE: We no longer sync with Redux state changes while the calendar is open.
  // The calendar initializes from Redux state when it mounts (via initializeCalendarState),
  // and user interactions control the state from that point forward.
  // This prevents the calendar from resetting or closing when the user is switching between filters.

  const handleActive=(btnValue)=>{
    switch(btnValue){
      case 'last30':
        setThirtyDaysActive(true);
        setSevenDaysActive(false);
        setCustomActive(false);
        break;
      case 'last7':
        setThirtyDaysActive(false);
        setSevenDaysActive(true);
        setCustomActive(false);
        break;
      case 'custom':
        setThirtyDaysActive(false);
        setSevenDaysActive(false);
        setCustomActive(true);
        break;
      default:
        setThirtyDaysActive(false);
        setSevenDaysActive(false);
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
        handleActive('last30');
        // Set the range to show last 29 days (28 days before yesterday to yesterday)
        // Due to 24-hour data delay, we show data from 28 days ago to yesterday
        const defaultRange = {
          startDate: subDays(today, 29),
          endDate: subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(defaultRange);
        if (setSelectedPeriod) setSelectedPeriod('Last 30 Days');
        
        // Set calendar mode to default
        dispatch(setCalendarMode('default'));
        
        // Make API call to get the default dashboard data
        await applyDefaultDateRange();
        break;
      case 'last7':
        handleActive('last7');
        // Set the range to show last 7 days (8 days ago to 1 day ago)
        const last7Range = {
          startDate: subDays(today, 8),
          endDate: subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(last7Range);
        if (setSelectedPeriod) setSelectedPeriod('Last 7 Days');
        
        // Set calendar mode to last7
        dispatch(setCalendarMode('last7'));
        
        // Make API call with last 7 days range
        await applyDateRange(last7Range, 'last7');
        break;
      case 'custom':
        handleActive('custom');
        // Keep current range for custom selection - user will select dates and click Apply
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

      // Update Redux store with the complete dashboard data
      dispatch(setDashboardInfo(dashboardData));
      
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

    console.log('startDate', formattedStartDate);
    console.log('endDate', formattedEndDate);
    
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
      } else if (periodType === 'custom') {
        calendarMode = 'custom';
      }
      
      console.log('=== applyDateRange: Setting calendar mode ===');
      console.log('periodType:', periodType);
      console.log('calendarMode:', calendarMode);

      dispatch(UpdateDashboardInfo({
        startDate: formattedStartDate,
        endDate: formattedEndDate,
        financeData: dateResponse.data.data.FinanceData,
        reimburstmentData: dateResponse.data.data.reimburstmentData,
        WeeklySales: dateResponse.data.data.TotalSales.totalSales,
        TotalSales: dateResponse.data.data.TotalSales.dateWiseSales,
        GetOrderData: dateResponse.data.data.GetOrderData,
        calendarMode: calendarMode, // Use determined calendar mode
        createdAccountDate: createdAccountDate
      }));

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

  const closeCalendar = () => {
    setOpenCalender(false);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
        onClick={closeCalendar}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 300, damping: 30 }}
          className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 p-6 text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 left-0 w-32 h-32 bg-white rounded-full -translate-x-16 -translate-y-16"></div>
              <div className="absolute bottom-0 right-0 w-24 h-24 bg-white rounded-full translate-x-12 translate-y-12"></div>
            </div>
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Select Date Range</h2>
                  <p className="text-blue-100 text-sm">Choose your preferred time period for data analysis</p>
                </div>
              </div>
              <button
                onClick={closeCalendar}
                className="w-10 h-10 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center transition-all duration-200 backdrop-blur-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex h-[600px]">
            {/* Left Panel - Options */}
            <div className="w-80 bg-gradient-to-b from-gray-50 to-gray-100 p-6 border-r border-gray-200">
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-6">
                  <Clock className="w-5 h-5 text-gray-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Time Periods</h3>
                </div>

                {/* Last 30 Days Option */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handlePreset('last30')}
                  disabled={Loader}
                  className={`w-full p-4 rounded-xl transition-all duration-300 text-left relative overflow-hidden ${
                    thirtyDaysActive
                      ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 hover:border-gray-300 hover:shadow-md'
                  } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {thirtyDaysActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-purple-500/20"></div>
                  )}
                  <div className="relative z-10">
                    {Loader && thirtyDaysActive ? (
                      <div className="flex items-center justify-center">
                        <PulseLoader color="#ffffff" size={6} />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${thirtyDaysActive ? 'bg-white' : 'bg-blue-500'}`}></div>
                          <div className="font-semibold">Last 30 Days</div>
                        </div>
                        <div className={`text-sm ${thirtyDaysActive ? 'text-blue-100' : 'text-gray-500'}`}>
                          {thirtyDaysActive ? 'Currently active period' : 'Most recent 30 days of data'}
                        </div>
                        {thirtyDaysActive && (
                          <div className="flex items-center gap-1 mt-2">
                            <Sparkles className="w-3 h-3 text-yellow-300" />
                            <span className="text-xs text-yellow-100">Recommended</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.button>

                {/* Last 7 Days Option */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handlePreset('last7')}
                  disabled={Loader}
                  className={`w-full p-4 rounded-xl transition-all duration-300 text-left relative overflow-hidden ${
                    sevenDaysActive
                      ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 hover:border-gray-300 hover:shadow-md'
                  } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {sevenDaysActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-purple-500/20"></div>
                  )}
                  <div className="relative z-10">
                    {Loader && sevenDaysActive ? (
                      <div className="flex items-center justify-center">
                        <PulseLoader color="#ffffff" size={6} />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${sevenDaysActive ? 'bg-white' : 'bg-blue-500'}`}></div>
                          <div className="font-semibold">Last 7 Days</div>
                        </div>
                        <div className={`text-sm ${sevenDaysActive ? 'text-blue-100' : 'text-gray-500'}`}>
                          {sevenDaysActive ? 'Currently active period' : 'Most recent 7 days of data'}
                        </div>
                        {sevenDaysActive && (
                          <div className="flex items-center gap-1 mt-2">
                            <Sparkles className="w-3 h-3 text-yellow-300" />
                            <span className="text-xs text-yellow-100">Quick view</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.button>

                {/* Custom Range Option */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handlePreset('custom')}
                  disabled={Loader}
                  className={`w-full p-4 rounded-xl transition-all duration-300 text-left relative overflow-hidden ${
                    customActive
                      ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 hover:border-gray-300 hover:shadow-md'
                  } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {customActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-pink-500/20"></div>
                  )}
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${customActive ? 'bg-white' : 'bg-purple-500'}`}></div>
                      <div className="font-semibold">Custom Range</div>
                    </div>
                    <div className={`text-sm ${customActive ? 'text-purple-100' : 'text-gray-500'}`}>
                      {customActive ? 'Select your specific date range' : 'Choose any date range you need'}
                    </div>
                    {customActive && (
                      <div className="flex items-center gap-1 mt-2">
                        <Calendar className="w-3 h-3 text-pink-200" />
                        <span className="text-xs text-pink-100">Active selection</span>
                      </div>
                    )}
                  </div>
                </motion.button>

                {/* Account Info */}
                {createdAccountDate && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-8 p-4 bg-white rounded-xl border border-gray-200 shadow-sm"
                  >
                    <h4 className="font-medium text-gray-900 mb-2 text-sm">Account Information</h4>
                    <div className="space-y-1 text-xs text-gray-600">
                      <div>Created: {new Date(createdAccountDate.createdAt).toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}</div>
                      <div>Data from: {minimumDate.toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}</div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Right Panel - Calendar */}
            <div className="flex-1 p-6 flex flex-col">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {customActive ? 'Select Your Date Range' : 'Current Date Range'}
                </h3>
                <p className="text-sm text-gray-600">
                  {customActive 
                    ? 'Click and drag to select your preferred date range' 
                    : 'Showing the last 30 days of data'
                  }
                </p>
              </div>

              {/* Calendar Container */}
              <div className="flex-1 flex items-center justify-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                  className={`calendar-container ${!customActive ? 'opacity-60 pointer-events-none' : ''}`}
                  style={{
                    transform: 'scale(1.1)',
                    filter: customActive ? 'none' : 'grayscale(50%)'
                  }}
                >
                  <DateRange
                    ranges={[selectedRange]}
                    onChange={handleRangeChange}
                    moveRangeOnFirstSelection={false}
                    editableDateInputs={customActive}
                    rangeColors={customActive ? ['#8B5CF6'] : ['#6B7280']}
                    color={customActive ? '#8B5CF6' : '#6B7280'}
                    months={2}
                    direction="horizontal"
                    minDate={minimumDate}
                    maxDate={new Date()}
                    showDateDisplay={false}
                    className="modern-calendar"
                  />
                </motion.div>
              </div>

              {/* Apply Button - Only show when custom is active */}
              <AnimatePresence>
                {customActive && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.3 }}
                    className="flex justify-center mt-6"
                  >
                    <button
                      onClick={submitdateRange}
                      disabled={Loader}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
                    >
                      {Loader ? (
                        <div className="flex items-center gap-2">
                          <PulseLoader color="#ffffff" size={4} />
                          <span>Applying Range...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>Apply Custom Range</span>
                        </div>
                      )}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
