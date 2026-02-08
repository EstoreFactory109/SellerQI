import React,{useState, useEffect} from 'react'
import { Info } from 'lucide-react';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';

const AllIssues = () => {
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
              width: 200,
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
  
  return (
   <>
     <div className='w-full h-full bg-white p-3  rounded-md'>
          <div className='w-full h-[58%] '>
            <div className='w-full flex items-center justify-between'>
              
            </div>
            <div className='w-full flex  justify-between'>
              <div className='relative flex justify-center items-center'>
                <Chart options={chartData.options} series={chartData.series} type="donut" width={200} height={200} />
                <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none'>
                  <div className='text-3xl font-bold text-gray-900'>{totalErrors}</div>
                  <div className='text-xs font-normal text-red-600'>ERRORS</div>
                </div>
              </div>
              <ul className='w-[50%]  py-4 pr-3'>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#fad12a]' ></div>
                    <p className='mr-5'>{LableData[0]}</p>
                  </div>
                  <p>{seriesData[0] || 0}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#b92533]' ></div>
                    <p className='mr-5'>{LableData[1]}</p>
                  </div>
                  <p>{seriesData[1] || 0}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#ff6b35]' ></div>
                    <p className='mr-5'>{LableData[2]}</p>
                  </div>
                  <p>{seriesData[2] || 0}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#90acc7]' ></div>
                    <p className='mr-5'>{LableData[3]}</p>
                  </div>
                  <p>{seriesData[3] || 0}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#05724e]' ></div>
                    <p className='mr-5'>{LableData[4]}</p>
                  </div>
                  <p>{seriesData[4] || 0}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#333651]' ></div>
                    <p className='mr-5'>{LableData[5]}</p>
                  </div>
                  <p>{seriesData[5] || 0}</p>
                </li>
              </ul>
            </div>
          
          </div>
         
        </div>
   </>
  )
}

export default AllIssues