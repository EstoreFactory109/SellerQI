import React,{useState} from 'react'
import issue from '../../../assets/Icons/error.png'
import { useSelector } from 'react-redux';
import TooltipBox from '../../ToolTipBox/TootTipBoxTop.jsx';

const ProductsToReplinish = () => {
   const info = useSelector(state => state.Dashboard.DashBoardInfo)
   const [opentToottip,setOpenToolTip]=useState(false)
  return (
    <div className='w-full lg:w-[20vw] bg-white p-4 border-2 border-gray-200 rounded-md'>
            <div className='w-full h-[1vh] flex items-center  gap-2 mb-3'>
                <p className='text-sm'>Products To Replinish</p>
                <div className='relative fit-content'>
                <img src={issue} alt='' className='w-4 h-4 cursor-pointer' onMouseEnter={() => setOpenToolTip(true)} onMouseLeave={() => setOpenToolTip(false)} />
                {opentToottip &&<TooltipBox Information='Number of products with low inventory.'/>}
                </div>
            </div>
            <div className='w-full '>
                <p className='font-bold text-base'>{info.replenishmentQty.length}</p>
            </div>
        </div>
  )
}

export default ProductsToReplinish