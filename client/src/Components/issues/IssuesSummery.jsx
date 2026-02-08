import React,{useState, useEffect} from 'react'
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';
import { Info } from 'lucide-react';
import TooltipBox from '../ToolTipBox/ToolTipBoxBottomLeft';

const IssuesSummery = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  // Get error counts from Redux - these are now pre-calculated during analysis
  const profitabilityErrors = info?.totalProfitabilityErrors || 0;
  const sponsoredAdsErrors = info?.totalSponsoredAdsErrors || 0;
  const inventoryErrors = info?.totalInventoryErrors || 0;
  
  const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, inventoryErrors, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  const [LableData,setDableData]=useState(["Rankings", "Conversion", "Inventory", "Account Health", "Profitability", "Sponsored Ads"])
    
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
      
  useEffect(() => {
    // Update series data when errors change
    setSeriesData([info.TotalRankingerrors, info.totalErrorInConversion, inventoryErrors, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  }, [info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
    
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
      },
      labels: LableData, 
      colors:["#fad12a", "#b92533", "#ff6b35", "#90acc7", "#05724e", "#333651"],
      
      legend: {
        show: false// Hides legend globally
      },
      dataLabels: {
        enabled: false, // Hide percentages on the chart
      },
      plotOptions: {
        pie: {
          donut: {
            size: '65%',
            labels: {
              show: true,
              name: {
                show: false
              },
              value: {
                show: false
              },
              total: {
                show: false
              }
            }
          }
        }
      },
      responsive: [
        {
          breakpoint: 764,
          options: {
            chart: {
              width: 180,
            },
          },
        },
        {
          breakpoint: 480,
          options: {
            chart: {
              width: 160,
            },
          },
        },
      ],
    },
  });
  
  useEffect(() => {
    // Update chart data when series data changes
    setChartData(prevData => ({
      ...prevData,
      series: seriesData
    }));
  }, [seriesData]);

  const [tooltipForProductChecker, setToolTipForProductChecker] = useState(false);
  return (
   <>
     <div className='lg:w-[45vw] w-full min-h-[320px] bg-white p-4 rounded-md shadow-sm'>
          <div className='w-full flex flex-col'>
            {/* Header Section */}
            <div className='flex items-center gap-3 mb-4'>
              <h2 className='text-sm font-medium text-gray-700'>ALL ISSUES</h2>
              <div className='relative'>
                <Info className='w-4 h-4 cursor-pointer text-gray-400 hover:text-blue-400 transition-colors' 
                onMouseEnter={() => setToolTipForProductChecker(true)}
                onMouseLeave={() => setToolTipForProductChecker(false)}
                />
                {tooltipForProductChecker && <TooltipBox Information='A total number of issues in all products and the Amazon account that required attention.​ ' />}
              </div>
            </div>
            
            {/* Chart and Legend Section */}
            <div className='w-full flex flex-col lg:flex-row lg:items-center gap-6'>
              {/* Chart Container */}
              <div className='flex-shrink-0 flex justify-center lg:justify-start'>
                <div className='relative'>
                  <Chart options={chartData.options} series={chartData.series} type="donut" width={200} height={200} />
                  <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
                    <div className='text-2xl font-bold text-gray-900'>{totalErrors}</div>
                    <div className='text-xs font-normal text-red-600'>ERRORS</div>
                  </div>
                </div>
              </div>
              
              {/* Legend Container */}
              <div className='flex-1 min-w-0'>
                <ul className='space-y-3'>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#fad12a] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[0]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[0] || 0}</p>
                  </li>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#b92533] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[1]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[1] || 0}</p>
                  </li>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#ff6b35] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[2]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[2] || 0}</p>
                  </li>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#90acc7] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[3]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[3] || 0}</p>
                  </li>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#05724e] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[4]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[4] || 0}</p>
                  </li>
                  <li className='flex items-center justify-between text-sm'>
                    <div className='flex items-center gap-2 min-w-0 flex-1'>
                      <div className='w-3 h-3 rounded-full bg-[#333651] flex-shrink-0'></div>
                      <p className='truncate'>{LableData[5]}</p>
                    </div>
                    <p className='text-gray-600 font-medium ml-2 flex-shrink-0'>{seriesData[5] || 0}</p>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
   </>
  )
}

export default IssuesSummery