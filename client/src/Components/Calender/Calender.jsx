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

export default function DateFilter({setOpenCalender}) {
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


  const submitdateRange= async(e)=>{
    e.preventDefault();
    setLoader(true)
      let startDate=selectedRange.startDate;
      let endDate=selectedRange.endDate
    

    try {
      const dateResponse=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/analyse/getDataFromDate?startDate=${startDate}&endDate=${endDate}`,{withCredentials:true})

      if(dateResponse.status!==200){
        navigate(`/error/${dateResponse.status}`)
      }

      
       
        dispatch(UpdateDashboardInfo({
          startDate:dateResponse.data.data.endDate,
          endDate:dateResponse.data.data.startDate,
          financeData:dateResponse.data.data.FinanceData,
          reimburstmentData:dateResponse.data.data.reimburstmentData,
          WeeklySales:dateResponse.data.data.TotalSales.totalSales,
         TotalSales:dateResponse.data.data.TotalSales.dateWiseSales
         
      }))
      
    } catch (error) {
      navigate('/error/500')
    }finally{
      setLoader(false)
      setOpenCalender(false)
    }
  }

  const handlePreset = (type) => {
    const today = new Date();// hide calendar unless 'custom' is selected

    switch (type) {
      case 'last7':
        handleActive('last7');
        setSelectedRange({
          startDate: subDays(today, 7),
          endDate: subDays(today, 1),
          key: 'selection',
        });
        break;
      case 'last30':
        handleActive('last30');
        setSelectedRange({
          startDate: subDays(today, 30),
          endDate: subDays(today, 1),
          key: 'selection',
        });
        break;
      case 'thisMonth':
        handleActive('thisMonth');
        setSelectedRange({
          startDate: startOfMonth(today),
          endDate: subDays(today, 1),
          key: 'selection',
        });
        break;
      case 'lastMonth':
        handleActive('lastMonth');
        const lastMonth = subMonths(today, 1);
        setSelectedRange({
          startDate: startOfMonth(lastMonth),
          endDate: endOfMonth(lastMonth),
          key: 'selection',
        });
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

  return (
    <div className="p-6  max-w-xl mx-auto bg-white shadow-md rounded absolute right-0 top-[130%] z-[99] flex gap-4 border-[2px] border-gray-300">
  

      <div className="flex flex-wrap gap-3">
        <button onClick={() => handlePreset('last7')} className={`w-[10rem] px-4 py-2 text-sm ${ sevenDaysActive?`bg-[#333651] text-white`:`bg-gray-200`} rounded hover:scale-105 transition-all ease-in-out duration-300`}>
          Last 7 Days
        </button>
        <button onClick={() => handlePreset('last30')} className={`w-[10rem] px-4 py-2 text-sm ${ thirtyDaysActive?`bg-[#333651] text-white`:`bg-gray-200`} rounded hover:scale-105 transition-all ease-in-out duration-300`}>
          Last 30 Days
        </button>
        <button onClick={() => handlePreset('thisMonth')} className={`w-[10rem] px-4 py-2 text-sm ${ thisMonthActive?`bg-[#333651] text-white`:`bg-gray-200`} rounded hover:scale-105 transition-all ease-in-out duration-300`}>
          This Month
        </button>
        <button onClick={() => handlePreset('lastMonth')} className={`w-[10rem] px-4 py-2 text-sm ${ lastMonthActive?`bg-[#333651] text-white`:`bg-gray-200`} rounded hover:scale-105 transition-all ease-in-out duration-300`}>
          Last Month
        </button>
        <button onClick={() => handlePreset('custom')} className={`w-[10rem] px-4 py-2 text-sm ${ customActive?`bg-[#333651] text-white`:`bg-gray-200`} rounded hover:scale-105 transition-all ease-in-out duration-300`}>
          Custom Range
        </button>
      </div>
    <div className='flex flex-col items-end' >
      <DateRange
          ranges={[selectedRange]}
          onChange={(item) => setSelectedRange(item.selection)}
          moveRangeOnFirstSelection={false}
          editableDateInputs={true}
          rangeColors={['#333651']}
          color="#333651"
        />
        <button className='bg-[#333651] text-white px-4 py-2 rounded active:scale-95 transition-all ease-in-out duration-200' onClick={submitdateRange}>{
          Loader?<PulseLoader color="#ffffff" size={7}/>:"Apply"
          }
          </button>
      </div>
    </div>
  );
}
