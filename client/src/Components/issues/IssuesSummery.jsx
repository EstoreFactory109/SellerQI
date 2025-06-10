import React,{useState, useEffect} from 'react'
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';
import issue from "../../assets/Icons/error.png";
import TooltipBox from '../ToolTipBox/ToolTipBoxBottomLeft';

const IssuesSummery = () => {
  const info = useSelector(state => state.Dashboard.DashBoardInfo)
  
  // Get error counts from Redux - these are now pre-calculated during analysis
  const profitabilityErrors = info?.totalProfitabilityErrors || 0;
  const sponsoredAdsErrors = info?.totalSponsoredAdsErrors || 0;
  
  const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  const [LableData,setDableData]=useState(["Rankings", "Conversion", "Account Health", "Profitability", "Sponsored Ads"])
    
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
      
  useEffect(() => {
    // Update series data when errors change
    setSeriesData([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  }, [info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
    
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
     <div className='lg:w-[45vw] w-full h-[30vh] bg-white p-3  rounded-md'>
          <div className='w-full h-[58%] '>
          <div className='flex items-center gap-3 my-2'>
            <h2 className='text-sm'>ALL ISSUES</h2>
            <div className='relative fit-content'>
              <img src={issue} alt='' className='w-4 h-4 cursor-pointer' 
              onMouseEnter={() => setToolTipForProductChecker(true)}
              onMouseLeave={() => setToolTipForProductChecker(false)}
              />
              {tooltipForProductChecker && <TooltipBox Information='A total number of issues in all products and the Amazon account that required attention.​ ' />}
            </div>
          </div>
            <div className='w-full flex  justify-between'>
              <div className='relative'>
                <Chart options={chartData.options} series={chartData.series} type="donut" width={200} />
                <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
                  <div className='text-2xl font-bold text-gray-900'>{totalErrors}</div>
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

export default IssuesSummery