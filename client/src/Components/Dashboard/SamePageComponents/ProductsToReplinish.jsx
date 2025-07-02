import React from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useSelector } from 'react-redux'

const ProductsToReplinish = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  return (
    <div className='p-6 h-full'>
      <div className='flex items-center gap-2 mb-4'>
        <RefreshCw className='w-5 h-5 text-amber-600' />
        <h3 className='text-lg font-semibold text-gray-900'>To Replenish</h3>
      </div>
      
      <div className='space-y-4'>
        <div className='text-center'>
          <div className='text-3xl font-bold text-amber-600 mb-1'>
            {info?.InventoryAnalysis?.replenishment?.length || 0}
          </div>
          <p className='text-sm text-gray-500'>Products low in stock</p>
        </div>
        
        <div className='flex items-center justify-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-sm font-medium w-fit mx-auto'>
          <AlertTriangle className='w-4 h-4' />
          <span>Action needed</span>
        </div>
      </div>
    </div>
  )
}

export default ProductsToReplinish