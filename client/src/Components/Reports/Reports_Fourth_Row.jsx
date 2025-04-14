import React from 'react';
import issue from "../../assets/Icons/error.png";
import { useSelector } from 'react-redux';

const Reports_Fourth_Row = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  

  return (
    <div className='w-full h-full flex flex-wrap lg:flex-nowrap justify-between gap-4 lg:gap-2 '>
        <div className='h-full w-full lg:w-[33%] p-2 '>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Total Issues</p>
            <img src={issue} className='w-3 h-3' />
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>{info.TotalRankingerrors+info.totalErrorInConversion+info.totalErrorInAccount}</p>
           {/* <p className='text-[10px] text-[#68a88f] bg-[#edfdfb] w-12 h-4 px-1 rounded-full'>+2.50%</p>*/}
          </div>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-1/3 p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Potential Reimburstments</p>
            <img src={issue} className='w-3 h-3' />
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>${info.reimbustment.totalReimbursement}</p>
           {/* <p className='text-[10px] text-[#d87a81] bg-[#fef2ef] w-12 h-4 px-1 rounded-full'>-15.05%</p>*/}
          </div>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-1/3 p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Amazon Ready Products</p>
            <img src={issue} className='w-3 h-3' />
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>{info.amazonReadyProducts.length}/{info.TotalProduct.length}</p>
           { /*<p className='text-[10px] text-[#68a88f] bg-[#edfdfb] w-8 h-4 px-2 rounded-full'>+2</p>*/}
          </div>
        </div>
       
    </div>
  );
}

export default Reports_Fourth_Row;
