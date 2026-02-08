import React,{useState} from 'react'
import { Info, LineChart, Box, AlertTriangle, XCircle, Activity, Shield } from 'lucide-react';
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
  const AccountErrors = info?.AccountErrors || {};
  
  // Key metrics to display
  const keyMetrics = [
    { 
      key: 'CancellationRate', 
      label: 'CR', 
      value: AccountErrors?.CancellationRate?.status === 'Error' ? 'Issues' : 'Good',
      icon: Box,
      isError: AccountErrors?.CancellationRate?.status === 'Error'
    },
    { 
      key: 'NCX', 
      label: 'NCX', 
      value: AccountErrors?.NCX?.status === 'Error' ? 'Issues' : 'Good',
      icon: XCircle,
      isError: AccountErrors?.NCX?.status === 'Error'
    },
    { 
      key: 'PolicyViolations', 
      label: 'Policy', 
      value: AccountErrors?.PolicyViolations?.status === 'Error' ? 'Issues' : 'Good',
      icon: AlertTriangle,
      isError: AccountErrors?.PolicyViolations?.status === 'Error'
    },
    { 
      key: 'orderWithDefectsStatus', 
      label: 'ODR', 
      value: AccountErrors?.orderWithDefectsStatus?.status === 'Error' ? 'Issues' : 'Good',
      icon: Activity,
      isError: AccountErrors?.orderWithDefectsStatus?.status === 'Error'
    }
  ];

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
          background: "#21262d",
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
        shade: "dark",
        type: "horizontal",
        shadeIntensity: 0.6,
        gradientToColors: ["#2563eb"],
        inverseColors: false,
        opacityFrom: 1,
        opacityTo: 0.85,
        stops: [0, 100]
      }
    },
    stroke: {
      lineCap: "round",
      width: 3,
    },
    colors: ["#2563eb"], // blue-600 - deep vibrant blue for dark theme
    labels: ["Health"],
  };

  const series = [healthPercentage];

  const viewFullReport=(e)=>{
    e.preventDefault();
    navigatie('/seller-central-checker/issues?tab=account')
  }

  return (
    <div className='p-1.5 h-full flex flex-col'>
      <div className='flex items-center justify-between mb-1'>
        <div className='flex items-center gap-1'>
          <LineChart className='w-3 h-3 text-blue-400' />
          <h2 className='text-xs font-semibold text-gray-100'>Account Health</h2>
          <div className='relative'> 
            {tooltip && <TooltipBox Information='Overall account health score reflects key performance metrics such as feedback, policy compliance, shipping reliability, and customer service responsiveness.​ ' />}
            <Info 
              className='w-3 h-3 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors'
              onMouseEnter={() => setToolTip(true)}
              onMouseLeave={() => setToolTip(false)}
            />
          </div>
        </div>
        <button 
          onClick={viewFullReport} 
          className='px-1.5 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors'
        >
          View Report
        </button>
      </div>
      
      <div className='flex-1 flex flex-col items-center justify-center w-full'>
        <div className='relative w-full flex-1 flex items-center justify-center'>
          <Chart options={options} series={series} type="radialBar" height={240} width="100%" />
          <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
            <p className='text-3xl font-bold text-gray-100' style={{ marginTop: '-20px' }}>
              {healthPercentage}%
            </p>
            <p className={`text-sm font-semibold mt-1 ${
              healthStatus === 'GOOD' || healthStatus === 'Healthy' ? 'text-blue-400' : 
              healthStatus === 'FAIR' || healthStatus === 'At Risk' ? 'text-gray-300' : 'text-red-400'
            }`}>
              {healthStatus?.toUpperCase()}
            </p>
          </div>
        </div>
        
        <div className='w-full mt-1'>
          <div className='grid grid-cols-2 gap-1'>
            {keyMetrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div 
                  key={metric.key}
                  className='flex items-center gap-1 p-1.5 bg-[#21262d] rounded border border-[#30363d]'
                >
                  <Icon className={`w-3 h-3 ${metric.isError ? 'text-red-400' : 'text-green-400'}`} />
                  <div className='flex-1 min-w-0'>
                    <p className='text-xs text-gray-400 truncate'>{metric.label}</p>
                    <p className={`text-xs font-semibold ${metric.isError ? 'text-red-400' : 'text-green-400'}`}>
                      {metric.value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccountHealth