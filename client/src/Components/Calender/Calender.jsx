import React, { useState } from 'react';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import axios from 'axios'
import {useDispatch} from 'react-redux'
import {UpdateDashboardInfo} from '../../redux/slices/DashboardSlice.js'
import PulseLoader from "react-spinners/PulseLoader";
import { useNavigate } from 'react-router-dom';

import {
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  sub,
} from 'date-fns';

export default function DateFilter({setOpenCalender, setSelectedPeriod}) {
  const navigate=useNavigate();
  const dispatch=useDispatch()
  const [Loader,setLoader]=useState(false);
  const [selectedRange, setSelectedRange] = useState({
    startDate: subDays(new Date(), 30),
    endDate: subDays(new Date(), 1),
    key: 'selection',
  });

  const [sevenDaysActive,setSevenDaysActive]=useState(false);
  const [thirtyDaysActive,setThirtyDaysActive]=useState(true);
  const [thisMonthActive,setThisMonthActive]=useState(false);
  const [lastMonthActive,setLastMonthActive]=useState(false);
  const [customActive,setCustomActive]=useState(false);

  const handleActive=(btnValue)=>{
    switch(btnValue){
      case 'last7':
        setSevenDaysActive(true);
        setThirtyDaysActive(false);
        setThisMonthActive(false);
        setLastMonthActive(false);
        setCustomActive(false);
        break;
      case 'last30':
        setSevenDaysActive(false);
        setThirtyDaysActive(true);
        setThisMonthActive(false);
        setLastMonthActive(false);
        setCustomActive(false);
        break;
      case 'thisMonth':
        setSevenDaysActive(false);
        setThirtyDaysActive(false);
        setThisMonthActive(true);
        setLastMonthActive(false);
        setCustomActive(false);
        break;    
      case 'lastMonth':
        setSevenDaysActive(false);
        setThirtyDaysActive(false);
        setThisMonthActive(false);
        setLastMonthActive(true);
        setCustomActive(false);
        break;
      case 'custom':
        setSevenDaysActive(false);
        setThirtyDaysActive(false);
        setThisMonthActive(false);
        setLastMonthActive(false);
        setCustomActive(true);
        break;
      default:
        setSevenDaysActive(false);
        setThirtyDaysActive(false);
        setThisMonthActive(false);
        setLastMonthActive(false);
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

    await applyDateRange(selectedRange);
  }

  const handlePreset = async (type) => {
    const today = new Date();// hide calendar unless 'custom' is selected

    let newRange;
    switch (type) {
      case 'last7':
        handleActive('last7');
        newRange = {
          startDate: subDays(today, 7),
          endDate: subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(newRange);
        if (setSelectedPeriod) setSelectedPeriod('Last 7 Days');
        await applyDateRange(newRange);
        break;
      case 'last30':
        handleActive('last30');
        newRange = {
          startDate: subDays(today, 30),
          endDate: subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(newRange);
        if (setSelectedPeriod) setSelectedPeriod('Last 30 Days');
        await applyDateRange(newRange);
        break;
      case 'thisMonth':
        handleActive('thisMonth');
        newRange = {
          startDate: startOfMonth(today),
          endDate: subDays(today, 1),
          key: 'selection',
        };
        setSelectedRange(newRange);
        if (setSelectedPeriod) setSelectedPeriod('This Month');
        await applyDateRange(newRange);
        break;
      case 'lastMonth':
        handleActive('lastMonth');
        const lastMonth = subMonths(today, 1);
        newRange = {
          startDate: startOfMonth(lastMonth),
          endDate: endOfMonth(lastMonth),
          key: 'selection',
        };
        setSelectedRange(newRange);
        if (setSelectedPeriod) setSelectedPeriod('Last Month');
        await applyDateRange(newRange);
        break;
      case 'custom':
        handleActive('custom');
        setSelectedRange({
          startDate:new Date(),
          endDate: new Date(),
          key: 'selection',
        })
        break;
      default:
        break;
    }
  };

  const applyDateRange = async (range) => {
    setLoader(true);
    const startDate = range.startDate;
    const endDate = range.endDate;

    try {
      const dateResponse = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/analyse/getDataFromDate?startDate=${startDate}&endDate=${endDate}`, {withCredentials: true});

      if (dateResponse.status !== 200) {
        navigate(`/error/${dateResponse.status}`);
      }

      dispatch(UpdateDashboardInfo({
        startDate: dateResponse.data.data.endDate,
        endDate: dateResponse.data.data.startDate,
        financeData: dateResponse.data.data.FinanceData,
        reimburstmentData: dateResponse.data.data.reimburstmentData,
        WeeklySales: dateResponse.data.data.TotalSales.totalSales,
        TotalSales: dateResponse.data.data.TotalSales.dateWiseSales
      }));

    } catch (error) {
      navigate('/error/500');
    } finally {
      setLoader(false);
      setOpenCalender(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-xl border-0 shadow-none w-[580px] max-h-full overflow-y-auto">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Select Date Range</h3>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => handlePreset('last7')} 
            disabled={Loader}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              sevenDaysActive 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
            } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {Loader && sevenDaysActive ? <PulseLoader color="#ffffff" size={4} /> : 'Last 7 Days'}
          </button>
          <button 
            onClick={() => handlePreset('last30')} 
            disabled={Loader}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              thirtyDaysActive 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
            } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {Loader && thirtyDaysActive ? <PulseLoader color="#ffffff" size={4} /> : 'Last 30 Days'}
          </button>
          <button 
            onClick={() => handlePreset('thisMonth')} 
            disabled={Loader}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              thisMonthActive 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
            } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {Loader && thisMonthActive ? <PulseLoader color="#ffffff" size={4} /> : 'This Month'}
          </button>
          <button 
            onClick={() => handlePreset('lastMonth')} 
            disabled={Loader}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              lastMonthActive 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
            } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {Loader && lastMonthActive ? <PulseLoader color="#ffffff" size={4} /> : 'Last Month'}
          </button>
          <button 
            onClick={() => handlePreset('custom')} 
            disabled={Loader}
            className={`col-span-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              customActive 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
            } ${Loader ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Custom Range
          </button>
        </div>
      </div>

      {customActive && (
        <div className='flex flex-col items-center max-h-80 overflow-y-auto'>
          <div className="scale-90 origin-top">
            <DateRange
              ranges={[selectedRange]}
              onChange={(item) => setSelectedRange(item.selection)}
              moveRangeOnFirstSelection={false}
              editableDateInputs={true}
              rangeColors={['#2563eb']}
              color="#2563eb"
              months={1}
              direction="horizontal"
            />
          </div>
          <button 
            className='mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed' 
            onClick={submitdateRange}
            disabled={Loader}
          >
            {Loader ? <PulseLoader color="#ffffff" size={4} /> : "Apply Custom Range"}
          </button>
        </div>
      )}
    </div>
  );
}
