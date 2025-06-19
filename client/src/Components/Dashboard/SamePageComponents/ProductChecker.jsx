import React, { useState,useEffect } from 'react';
import issue from '../../../assets/Icons/error.png';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import TooltipBox from '../../ToolTipBox/ToolTipBoxBottom.jsx'

const ProductChecker = () => {
   const info = useSelector(state => state.Dashboard.DashBoardInfo)
   console.log(info)
   const navigate = useNavigate()
   
   // Get error counts from Redux - these are now pre-calculated during analysis
   const profitabilityErrors = info?.totalProfitabilityErrors || 0;
   const sponsoredAdsErrors = info?.totalSponsoredAdsErrors || 0;
   const inventoryErrors = info?.totalInventoryErrors || 0;
   
   const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
   const [LableData, setDableData] = useState(["Rankings", "Conversion", "Account Health", "Profitability", "Sponsored Ads", "Inventory"])
   const [productErrors, setProductErrors] = useState([]);
   
   useEffect(() => {
     let tempArr = [];
     tempArr.push(info.first);
     tempArr.push(info.second);
     tempArr.push(info.third);
     tempArr.push(info.fourth);
     setProductErrors(tempArr)
   }, [info])
 
  useEffect(() => {
    // Update series data when info changes
    setSeriesData([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
  }, [info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
  
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
  
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
      },
      labels: LableData,
      colors: ["#fad12a", "#b92533", "#90acc7", "#05724e", "#333651", "#ff6b35"],

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
      series: seriesData,
      options: {
        ...prevData.options,
        plotOptions: {
          ...prevData.options.plotOptions,
          pie: {
            ...prevData.options.plotOptions?.pie,
            donut: {
              ...prevData.options.plotOptions?.pie?.donut,
              labels: {
                ...prevData.options.plotOptions?.pie?.donut?.labels,
                total: {
                  show: false
                }
              }
            }
          }
        }
      }
    }));
  }, [seriesData, totalErrors]);

  const navigateToIssue=(e)=>{
    e.preventDefault();
    navigate('/seller-central-checker/issues')
  }

  const navigateToProductWithIssuesPage=(asin)=>{
    if(asin){
      navigate(`/seller-central-checker/issues/${asin}`)
    }
  }

  const [tooltipForProductChecker,setToolTipForProductChecker] = useState(false) 
  const [tooltipForProductWithIssues,setToolTipForProductWithIssues] = useState(false)

  return (
    <div className='h-[62vh] lg:h-[55vh] bg-white p-3 border-2 border-gray-200 rounded-md'>
      <div className='w-full h-[58%] '>
        <div className='w-full flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <h2 className='text-sm'>PRODUCT CHECKER</h2>
            <div className='relative fit-content'>
              <img src={issue} alt='' className='w-4 h-4 cursor-pointer' 
              onMouseEnter={() => setToolTipForProductChecker(true)}
              onMouseLeave={() => setToolTipForProductChecker(false)}
              />
              {tooltipForProductChecker && <TooltipBox Information='Quick overview of product issues categorized by ranking, conversion, and account impact to assist you in prioritizing fixes efficiently.' />}
            </div>
          </div>
          <button onClick={navigateToIssue} className='bg-[#333651] text-xs text-white font-bold px-2 py-2 rounded-md'>
            View Full Report
          </button>
        </div>
        <div className='w-full flex  justify-between'>
          <div className='relative'>
            <Chart options={chartData.options} series={chartData.series} type="donut" width={220} />
            <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
              <div className='text-3xl font-bold text-gray-900'>{totalErrors}</div>
              <div className='text-xs font-normal text-red-600'>ERRORS</div>
            </div>
          </div>
          <ul className='w-[50%]  py-4 pr-3'>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#fad12a]' ></div>
                <p>{LableData[0]}</p>
              </div>
              <p>{seriesData[0] || 0}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#b92533]' ></div>
                <p>{LableData[1]}</p>
              </div>
              <p>{seriesData[1] || 0}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#90acc7]' ></div>
                <p>{LableData[2]}</p>
              </div>
              <p>{seriesData[2] || 0}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#05724e]' ></div>
                <p>{LableData[3]}</p>
              </div>
              <p>{profitabilityErrors || 0}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#333651]' ></div>
                <p>{LableData[4]}</p>
              </div>
              <p>{sponsoredAdsErrors || 0}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#ff6b35]' ></div>
                <p>{LableData[5]}</p>
              </div>
              <p>{inventoryErrors || 0}</p>
            </li>
          </ul>
        </div>
      </div>
      <div className='w-full h-[40%] '>
        <div className='flex items-center gap-3'>
          <h2 className='text-sm'>TOP PRODUCTS TO OPTIMIZE</h2>
          <div className='relative fit-content'>
          <img src={issue}  className='w-4 h-4 cursor-pointer' 
          onMouseEnter={() => setToolTipForProductWithIssues(true)}
          onMouseLeave={() => setToolTipForProductWithIssues(false)}
          />
              {tooltipForProductWithIssues &&<TooltipBox Information='Top 4 products with the most issues, allowing you to focus on optimizing the listings that require the most attention.' />}
          </div>
        </div>
        <ul className='mt-3 border-2 border-gray-300 h-[85%] flex flex-col justify-center gap-2  px-2'>
          {
            productErrors.map((item, index) => {
              return item &&<li className='text-xs  flex items-center justify-between' key={index}>
                <p className='w-[80%] hover:underline cursor-pointer' onClick={()=>navigateToProductWithIssuesPage(item?.asin)}>{item?.asin} | {item?.name}</p>
                <div className='text-[#d6737c] text-[10px] font-bold bg-[#fef1f3] px-2 py-1 rounded-full cursor-pointer active:scale-95 transition-all ease-in-out duration-300 hover:scale-110  ' onClick={()=>navigateToProductWithIssuesPage(item?.asin)}>{item?.errors} issues</div>
              </li>
            })
          }

        </ul>
      </div>
    </div>
  );
};

export default ProductChecker;
