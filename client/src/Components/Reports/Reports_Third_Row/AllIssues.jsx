import React,{useState} from 'react'
import issue from '../../../assets/Icons/error.png';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';

const AllIssues = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  // Get error counts from Redux - these are now pre-calculated during analysis
  const profitabilityErrors = info?.totalProfitabilityErrors || 0;
  const sponsoredAdsErrors = info?.totalSponsoredAdsErrors || 0;
  
  const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  const [LableData,setDableData]=useState(["Rankings", "Conversion", "Account Health", "Profitability", "Sponsored Ads"])
  
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
    
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
      },
      labels: LableData, 
      colors:["#fad12a", "#b92533", "#90acc7", "#05724e", "#333651"],
      
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
  return (
   <>
     <div className='w-full h-full bg-white p-3  rounded-md'>
          <div className='w-full h-[58%] '>
            <div className='w-full flex items-center justify-between'>
              
            </div>
            <div className='w-full flex  justify-between'>
              <div className='relative'>
                <Chart options={chartData.options} series={chartData.series} type="donut" width={200} />
                <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
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
                  <p>{seriesData[0]}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#b92533]' ></div>
                    <p className='mr-5'>{LableData[1]}</p>
                  </div>
                  <p>{seriesData[1]}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#90acc7]' ></div>
                    <p className='mr-5'>{LableData[2]}</p>
                  </div>
                  <p>{seriesData[2]}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm mb-3'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#05724e]' ></div>
                    <p className='mr-5'>{LableData[3]}</p>
                  </div>
                  <p>{profitabilityErrors}</p>
                </li>
                <li className='flex w-full items-center justify-between text-sm'>
                  <div className='flex items-center gap-2'>
                    <div className='w-3 h-3 rounded-full bg-[#333651]' ></div>
                    <p className='mr-5'>{LableData[4]}</p>
                  </div>
                  <p>{sponsoredAdsErrors}</p>
                </li>
              </ul>
            </div>
          
          </div>
         
        </div>
   </>
  )
}

export default AllIssues