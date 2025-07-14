import React from 'react'
import { useSelector } from 'react-redux';

const ProductsWithoutBuybox = () => {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)
    
    return (
        <div className='w-full lg:w-[20vw] bg-white p-6 border-2 border-gray-200 rounded-md h-full'>
            <div className='flex items-center gap-2 mb-4'>
                <div className='w-5 h-5 bg-red-600 rounded-full flex items-center justify-center'>
                    <svg className='w-3 h-3 text-white' fill='currentColor' viewBox='0 0 20 20'>
                        <path fillRule='evenodd' d='M10 2L3 7v11a2 2 0 002 2h10a2 2 0 002-2V7l-7-5zM10 18a8 8 0 100-16 8 8 0 000 16z' clipRule='evenodd' />
                    </svg>
                </div>
                <h3 className='text-lg font-semibold text-gray-900'>Products with no buy box</h3>
            </div>
            
            <div className='space-y-4'>
                <div className='text-center'>
                    <div className='text-3xl font-bold text-red-600 mb-1'>
                        {info?.productsWithOutBuyboxError || 0}
                    </div>
                    <p className='text-sm text-gray-500'>Products affected</p>
                </div>
                
                <div className='flex items-center justify-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-full text-sm font-medium w-fit mx-auto'>
                    <svg className='w-4 h-4' fill='currentColor' viewBox='0 0 20 20'>
                        <path fillRule='evenodd' d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z' clipRule='evenodd' />
                    </svg>
                    <span>Review pricing</span>
                </div>
            </div>
        </div>
    )
}

export default ProductsWithoutBuybox