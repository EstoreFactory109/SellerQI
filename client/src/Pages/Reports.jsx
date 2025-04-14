import React, { useEffect, useState } from 'react'
import calenderIcon from '../assets/Icons/Calender.png'
import Download from '../assets/Icons/Download.png'
import "../styles/Reports/style.css"
import RowOne from '../Components/Reports/Reports_First_Row.jsx'
import Health from '../Components/Reports/Reports_Third_Row/Health.jsx'
import AllIssues from '../Components/Reports/Reports_Third_Row/AllIssues.jsx'
import RowFour from '../Components/Reports/Reports_Fourth_Row.jsx'
import TopSalesChart from '../Components/Reports/Reports_Second_Row.jsx'



const Reports = () => {
  

 

  return (
    <div className='bg-[#eeeeee] w-full h-auto lg:h-[90vh] p-6 overflow-y-auto lg:mt-0 mt-[10vh]'>
      <div className='w-full flex flex-wrap items-center justify-between cursor-pointer mb-4'>
        <p className='text-sm'>REPORTS</p>
        <div className='flex gap-4 flex-wrap'>
          <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200'>
            <p className='font-semibold text-xs'>Last 30 Days</p>
            <img src={calenderIcon} alt='' className='w-4 h-4' />
          </div>
          <button className='flex items-center text-xs bg-[#333651] text-white gap-2 px-3 py-2 rounded-md'>
            Download PDF
            <img src={Download} className='w-4 h-4' />
          </button>
        </div>
      </div>
      <div className='w-full min-h-[12vh] md:min-h-[10vh] mt-7 bg-white px-4 py-3 shadow-sm rounded-lg'>
        <RowOne  />
      </div>


      <div className='w-full h-[70vh]  md:h-[65vh]  mt-7'>
        <TopSalesChart/>
      </div>
      
      <div className='w-full h-[40rem] lg:h-auto mt-5'>
        <p className='text-sm mb-4'>ACCOUNT AUDIT</p>
        <div className='w-full   lg:flex items-center justify-between  rounded-md relative gap-4'>
          <div className='w-full lg:w-1/2 h-[350px]  lg:h-[250px] bg-white shadow-sm flex flex-col items-center justify-center rounded-2xl'>
            <Health />
          </div>
          <div className='lg:w-1/2 w-full  lg:h-[250px] lg:mt-0 mt-4 bg-white shadow-sm p-3 flex flex-col items-center justify-center rounded-2xl'>
          <AllIssues />
          </div>
        </div>
      </div>
      <div className='w-full lg:mt-5' > 
        <p className='text-sm mb-5'>ISSUES</p>
        <div className='w-full min-h-[12vh] md:min-h-[10vh]  bg-white px-4 py-3 shadow-sm rounded-lg'>
        <RowFour  />
      </div>
      </div>
    </div>
  )
}

export default Reports
