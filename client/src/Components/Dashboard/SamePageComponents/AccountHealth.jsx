import React,{useState} from 'react'
import { AlertCircle, TrendingUp, BarChart3 } from 'lucide-react';
import Chart from "react-apexcharts";
import { useSelector } from 'react-redux';
import {useNavigate} from 'react-router-dom'
import TooltipBox from '../../ToolTipBox/ToolTipBoxBottom.jsx'

const AccountHealth = () => {
const info = useSelector(state => state.Dashboard?.DashBoardInfo)
const [tooltip,setToolTip] = useState(false)  
console.log(info)
const navigatie = useNavigate()

  const healthPercentage = info?.accountHealthPercentage?.Percentage || 0;
  const healthStatus = info?.accountHealthPercentage?.status || 'POOR' ;

  const options = {
    chart: {
      type: "radialBar",
      sparkline: {
        enabled: false
      }
    },
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        track: {
          background: "#f1f5f9",
          strokeWidth: "100%",
        },
        hollow: {
          size: "75%",
        },
        dataLabels: {
          name: {
            show: false,
          },
          value: {
            show: false,
          },
        },
      },
    },
    fill: {
      type: "gradient",
      gradient: {
        shade: "light",
        type: "horizontal",
        shadeIntensity: 0.25,
        gradientToColors: ["#3b82f6"],
        inverseColors: false,
        opacityFrom: 1,
        opacityTo: 1,
        stops: [0, 100]
      }
    },
    stroke: {
      lineCap: "round",
    },
    colors: ["#2563eb"],
    labels: ["Health"],
  };

  const series = [healthPercentage];

  const viewFullReport=(e)=>{
    e.preventDefault();
    navigatie('/seller-central-checker/issues?tab=account')
  }

  return (
    <div className='p-6 h-full min-h-[400px]'>
      <div className='flex items-center justify-between mb-4'>
        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2'>
            <BarChart3 className='w-5 h-5 text-blue-600' />
            <h2 className='text-lg font-semibold text-gray-900'>Account Health</h2>
          </div>
          <div className='relative'> 
            {tooltip && <TooltipBox Information='Overall account health score reflects key performance metrics such as feedback, policy compliance, shipping reliability, and customer service responsiveness.​ ' />}
            <AlertCircle 
              className='w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors'
              onMouseEnter={() => setToolTip(true)}
              onMouseLeave={() => setToolTip(false)}
            />
          </div>
        </div>
        <button 
          onClick={viewFullReport} 
          className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow'
        >
          View Report
        </button>
      </div>
      
      <div className='flex flex-col items-center justify-center h-full'>
        <div className='relative'>
          <Chart options={options} series={series} type="radialBar" height={280} width={280} />
          {/* Percentage Text */}
          <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
            <div className='text-center'>
              <p className='text-3xl font-bold text-gray-800' style={{ marginTop: '-15px' }}>
                {healthPercentage}%
              </p>
            </div>
          </div>
          {/* Status Text */}
          <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
            <div className='text-center'>
              <p className={`text-sm font-semibold ${
                healthStatus === 'GOOD' ? 'text-emerald-600' : 
                healthStatus === 'FAIR' ? 'text-amber-600' : 'text-red-600'
              }`} style={{ marginTop: '25px' }}>
                {healthStatus?.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
        
        <div className='mt-4 flex items-center gap-1 justify-center'>
          <TrendingUp className='w-3 h-3 text-emerald-600' />
          <span className='text-xs text-emerald-600 font-medium'>+2.00% from last month</span>
        </div>
      </div>
    </div>
  )
}

export default AccountHealth