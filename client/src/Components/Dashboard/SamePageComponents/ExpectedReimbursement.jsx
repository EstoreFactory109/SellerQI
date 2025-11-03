import React, { useState, useEffect } from 'react'
import { DollarSign, TrendingUp, AlertCircle, ArrowRight, Clock } from 'lucide-react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { getReimbursementSummary } from '../../../services/reimbursementService'

const ExpectedReimbursement = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  const currency = useSelector(state => state.currency?.currency) || '$'
  const navigate = useNavigate()
  
  const [reimbursementData, setReimbursementData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchReimbursementData = async () => {
      try {
        setLoading(true)
        setError(null)
        console.log('[ExpectedReimbursement] Fetching reimbursement summary...')
        const response = await getReimbursementSummary()
        console.log('[ExpectedReimbursement] Reimbursement response:', response)
        
        if (response && response.data) {
          setReimbursementData(response.data)
          console.log('[ExpectedReimbursement] Reimbursement data set:', {
            totalPotential: response.data.totalPotential,
            totalReceived: response.data.totalReceived,
            reimbursementCount: response.data.reimbursementCount
          })
        } else {
          console.warn('[ExpectedReimbursement] Invalid response format:', response)
          setReimbursementData(null)
          setError('Invalid response format from server')
        }
      } catch (err) {
        console.error('[ExpectedReimbursement] Error fetching reimbursement data:', err)
        console.error('[ExpectedReimbursement] Error details:', {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
          statusText: err.response?.statusText
        })
        setError(err.response?.data?.message || err.message || 'Failed to fetch reimbursement data')
        setReimbursementData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchReimbursementData()
  }, [])

  const formatCurrency = (value) => {
    if (!value) return `${currency}0.00`
    return `${currency}${Number(value).toFixed(2)}`
  }

  // Show loading state
  if (loading) {
    return (
      <div className='p-6 h-full flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2'></div>
          <p className='text-sm text-gray-500'>Loading...</p>
        </div>
      </div>
    )
  }

  // Show error state (but don't block the UI)
  if (error) {
    return (
      <div className='p-6 h-full'>
        <div className='flex items-center gap-2 mb-4'>
          <DollarSign className='w-5 h-5 text-emerald-600' />
          <h3 className='text-lg font-semibold text-gray-900'>Expected Reimbursement</h3>
        </div>
        
        <div className='space-y-4'>
          <div className='text-center'>
            <div className='text-3xl font-bold text-gray-900 mb-1'>
              {formatCurrency(0)}
            </div>
            <p className='text-sm text-gray-500'>No data available yet</p>
          </div>
          
          <div className='flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-full text-sm font-medium w-fit mx-auto'>
            <Clock className='w-4 h-4' />
            <span>Data syncing...</span>
          </div>
        </div>
      </div>
    )
  }

  const totalPotential = reimbursementData?.totalPotential || 0
  const totalReceived = reimbursementData?.totalReceived || 0
  const claimsExpiring = reimbursementData?.claimsExpiringIn7Days || 0
  const totalClaims = totalPotential + totalReceived

  // Show zero state if no reimbursements
  if (totalClaims === 0) {
    return (
      <div className='p-6 h-full'>
        <div className='flex items-center gap-2 mb-4'>
          <DollarSign className='w-5 h-5 text-emerald-600' />
          <h3 className='text-lg font-semibold text-gray-900'>Expected Reimbursement</h3>
        </div>
        
        <div className='space-y-4'>
          <div className='text-center'>
            <div className='text-3xl font-bold text-gray-900 mb-1'>
              {formatCurrency(0)}
            </div>
            <p className='text-sm text-gray-500'>No reimbursements found</p>
          </div>
          
          <div className='text-xs text-gray-500 text-center'>
            Reimbursement claims will appear here when detected
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className='p-6 h-full flex flex-col'>
      <div className='flex items-center justify-between mb-4'>
        <div className='flex items-center gap-2'>
          <DollarSign className='w-5 h-5 text-emerald-600' />
          <h3 className='text-lg font-semibold text-gray-900'>Expected Reimbursement</h3>
        </div>
        {claimsExpiring > 0 && (
          <div className='flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 rounded-full text-xs font-medium'>
            <AlertCircle className='w-3 h-3' />
            <span>{claimsExpiring} expiring</span>
          </div>
        )}
      </div>
      
      <div className='space-y-4 flex-1'>
        {/* Total Potential Amount */}
        <div>
          <div className='text-3xl font-bold text-emerald-600 mb-1'>
            {formatCurrency(totalPotential)}
          </div>
          <p className='text-sm text-gray-600'>Potential Claims</p>
        </div>
        
        {/* Stats */}
        <div className='space-y-2'>
          {totalReceived > 0 && (
            <div className='flex items-center justify-between text-sm'>
              <span className='text-gray-600'>Received (Last 30d)</span>
              <span className='font-semibold text-gray-900'>{formatCurrency(totalReceived)}</span>
            </div>
          )}
          
          {totalPotential > 0 && (
            <div className='flex items-center justify-between text-sm'>
              <span className='text-gray-600'>Pending Claims</span>
              <span className='font-semibold text-orange-600'>{formatCurrency(totalPotential)}</span>
            </div>
          )}
        </div>

        {/* Quick Insights */}
        {claimsExpiring > 0 && (
          <div className='p-3 bg-orange-50 border border-orange-200 rounded-lg'>
            <div className='flex items-start gap-2'>
              <AlertCircle className='w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0' />
              <div className='text-xs text-orange-800'>
                <span className='font-semibold'>{claimsExpiring} claim{claimsExpiring > 1 ? 's' : ''}</span> expiring within 7 days. File soon!
              </div>
            </div>
          </div>
        )}

        {/* View Details Button */}
        <button
          onClick={() => navigate('/seller-central-checker/reimbursement-dashboard')}
          className='w-full mt-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all duration-200 text-sm font-medium group'
        >
          <span>View Details</span>
          <ArrowRight className='w-4 h-4 group-hover:translate-x-1 transition-transform' />
        </button>
      </div>
    </div>
  )
}

export default ExpectedReimbursement