import React from 'react'
import { DollarSign, Clock } from 'lucide-react'
import { useSelector } from 'react-redux'

const ExpectedReimbursement = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  return (
    <div className='p-6 h-full'>
      <div className='flex items-center gap-2 mb-4'>
        <DollarSign className='w-5 h-5 text-emerald-600' />
        <h3 className='text-lg font-semibold text-gray-900'>Expected Reimbursement</h3>
      </div>
      
      <div className='space-y-4'>
        <div className='text-center'>
          <div className='text-3xl font-bold text-gray-400 mb-1'>
            Coming Soon
          </div>
          <p className='text-sm text-gray-500'>Feature in development</p>
        </div>
        
        <div className='flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-full text-sm font-medium w-fit mx-auto'>
          <Clock className='w-4 h-4' />
          <span>Under development</span>
        </div>
      </div>
    </div>
  )
}

export default ExpectedReimbursement