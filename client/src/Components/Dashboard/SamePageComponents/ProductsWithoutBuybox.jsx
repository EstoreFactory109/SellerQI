import React from 'react'
import issue from '../../../assets/Icons/error.png'
import { useSelector } from 'react-redux';

const ProductsWithoutBuybox = () => {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)
    return (
        <div className='w-full lg:w-[20vw] bg-white  p-4 border-2 border-gray-200 rounded-md'>
            <div className='w-full h-[1vh] flex items-center  gap-2 mb-3'>
                <p className='text-sm'>Products Without Buybox</p>
                <img src={issue} alt='' className='w-4 h-4' />
            </div>
            <div className='w-full '>
                <p className='font-bold text-base'>{info.productsWithOutBuyboxError}</p>
            </div>
        </div>
    )
}

export default ProductsWithoutBuybox