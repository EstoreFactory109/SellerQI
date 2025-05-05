import React,{useState} from 'react';
import issue from "../../assets/Icons/error.png";
import { useSelector } from 'react-redux';
import TooltipForGrossProfit from '../ToolTipBox/ToolTipBoxBottomLeft'
import TooltipForCenter from '../ToolTipBox/ToolTipBoxBottom'
import ToolTipForReplenishment from '../ToolTipBox/ToolTipBottomRight'

const Reports_First_Row = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)

  const [openToolTipForGrossProfit,setOpenToolTipForGrossProfit]=useState(false)
  const [openToolTipForTotalSales,setOpenToolTipForTotalSales]=useState(false)
  const [openTollTipForBuyBox,setOpenTollTipForBuyBox]=useState(false)
  const [openToolTipForReplinish,setOpenToolTipForReplinish]=useState(false)
  const [openToolTipFromActiveProducts,setOpenToolTipFromActiveProducts]=useState(false)

  return (
    <div className='w-full h-full flex flex-wrap lg:flex-nowrap justify-between gap-4 lg:gap-2'>
        <div className='h-full w-full lg:w-[20%] p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Gross Profit</p>
            <div className='relative fit-content'>
            <img src={issue} className='w-3 h-3 cursor-pointer' onMouseEnter={() => setOpenToolTipForGrossProfit(true)} onMouseLeave={() => setOpenToolTipForGrossProfit(false)}/>
           { openToolTipForGrossProfit && <TooltipForGrossProfit Information='Gross profit after deducting ad spend, storage fees, FBA fees, and product return refunds from sales revenue.'/>}
            </div>
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>${info.accountFinance.Gross_Profit}</p>
           {/* <p className='text-[10px] text-[#68a88f] bg-[#edfdfb] w-12 h-4 px-1 rounded-full'>+2.50%</p>*/}
          </div>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-[20%] p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Total Sales</p>
            <div className='relative fit-content'>
            <img src={issue} className='w-3 h-3 cursor-pointer' onMouseEnter={() => setOpenToolTipForTotalSales(true)} onMouseLeave={() => setOpenToolTipForTotalSales(false)} />
            { openToolTipForTotalSales && <TooltipForCenter Information='Total revenue generated during the selected date range.'/>}
            </div>
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>${info.TotalWeeklySale.toFixed(2)}</p>
           {/* <p className='text-[10px] text-[#d87a81] bg-[#fef2ef] w-12 h-4 px-1 rounded-full'>-15.05%</p>*/}
          </div>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-[20%] p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Products Without Buybox</p>
            <div className='relative fit-content'>
            <img src={issue} className='w-3 h-3 cursor-pointer' onMouseEnter={() => setOpenTollTipForBuyBox(true)} onMouseLeave={() => setOpenTollTipForBuyBox(false)} />
            { openTollTipForBuyBox && <TooltipForCenter Information='Products without BuyBox which are not eligible for Sponsored ads.'/>}
            </div>
          </div>
          <div className='flex items-center w-full justify-between mt-3'>
            <p className='font-bold'>{info.productsWithOutBuyboxError}</p>
           { /*<p className='text-[10px] text-[#68a88f] bg-[#edfdfb] w-8 h-4 px-2 rounded-full'>+2</p>*/}
          </div>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-[20%] p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Active Products</p>
            <div className='relative fit-content'>
            <img src={issue} className='w-3 h-3 cursor-pointer' onMouseEnter={() => setOpenToolTipFromActiveProducts(true)} onMouseLeave={() => setOpenToolTipFromActiveProducts(false)} />
            { openToolTipFromActiveProducts && <TooltipForCenter Information='Active products with fulfillable inventory.'/>}
            </div>
          </div>
          <p className='font-bold mt-3'>{info.ActiveProducts.length}/{info.TotalProduct.length}</p>
        </div>
        <hr className='hidden md:block w-[2px] h-[9vh] bg-slate-200 my-auto mx-2'/>
        <div className='h-full w-full lg:w-[20%] p-2'>
          <div className='flex gap-3 items-center'>
            <p className='text-xs'>Products to Replenish</p>
            <div className='relative fit-content'>
            <img src={issue} className='w-3 h-3 cursor-pointer' onMouseEnter={() => setOpenToolTipForReplinish(true)} onMouseLeave={() => setOpenToolTipForReplinish(false)} />
            { openToolTipForReplinish && <ToolTipForReplenishment Information='Number of products that are ready to be replenished.'/>}
            </div>
          </div>
          <p className='font-bold mt-3'>{info.replenishmentQty.length}</p>
        </div>
    </div>
  );
}

export default Reports_First_Row;
