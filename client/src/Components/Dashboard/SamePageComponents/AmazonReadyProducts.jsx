import React from 'react'
import { Package, CheckCircle } from 'lucide-react'
import { useSelector } from 'react-redux'

const AmazonReadyProducts = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  return (
    <div className='p-6 h-full'>
      <div className='flex items-center gap-2 mb-4'>
        <Package className='w-5 h-5 text-blue-600' />
        <h3 className='text-lg font-semibold text-gray-900'>Amazon Ready</h3>
      </div>
      
      <div className='space-y-4'>
        <div className='text-center'>
          <div className='text-3xl font-bold text-blue-600 mb-1'>
            {info?.amazonReadyProducts?.length || 0}
          </div>
          <p className='text-sm text-gray-500'>Products ready</p>
        </div>
        
        <div className='flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium w-fit mx-auto'>
          <CheckCircle className='w-4 h-4' />
          <span>Ready to list</span>
        </div>
      </div>
    </div>
  )
}

export default AmazonReadyProducts