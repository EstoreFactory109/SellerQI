import React, { useState,useEffect } from 'react';
import { AlertCircle, TrendingUp, BarChart3, Eye, Package2 } from 'lucide-react';
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
   
   const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, inventoryErrors, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
   const [LableData, setDableData] = useState(["Rankings", "Conversion", "Inventory", "Account Health", "Profitability", "Sponsored Ads"])
   const [productErrors, setProductErrors] = useState([]);
   
   useEffect(() => {
     let tempArr = [];
     tempArr.push(info.first);
     tempArr.push(info.second);
     tempArr.push(info.third);
     tempArr.push(info.fourth);
     console.log("Product errors data:", tempArr);
     setProductErrors(tempArr)
   }, [info])
 
  useEffect(() => {
    // Update series data when info changes
    setSeriesData([info.TotalRankingerrors, info.totalErrorInConversion, inventoryErrors, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors]);
  }, [info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
  
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
  
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
        fontFamily: "'Inter', sans-serif",
      },
      labels: LableData,
      colors: ["#fad12a", "#b92533", "#ff6b35", "#90acc7", "#05724e", "#333651"],
      legend: {
        show: false
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        pie: {
          donut: {
            size: '60%',
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
      stroke: {
        width: 3,
        colors: ['#ffffff']
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
    setChartData(prevData => ({
      ...prevData,
      series: seriesData,
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
  const [hoveredProductIndex, setHoveredProductIndex] = useState(null)

  return (
    <div className='p-6 h-full'>
      {/* Header Section */}
      <div className='flex items-center justify-between mb-6'>
        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2'>
            <BarChart3 className='w-5 h-5 text-blue-600' />
            <h2 className='text-lg font-semibold text-gray-900'>Product Issues</h2>
          </div>
          <div className='relative'>
            <AlertCircle 
              className='w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors' 
              onMouseEnter={() => setToolTipForProductChecker(true)}
              onMouseLeave={() => setToolTipForProductChecker(false)}
            />
            {tooltipForProductChecker && <TooltipBox Information='Quick overview of product issues categorized by ranking, conversion, and account impact to assist you in prioritizing fixes efficiently.' />}
          </div>
        </div>
        <button 
          onClick={navigateToIssue} 
          className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow'
        >
          View All Issues
        </button>
      </div>

      {/* Chart and Legend Section */}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8'>
        {/* Chart */}
        <div className='flex justify-center items-center'>
          <div className='relative'>
            <Chart options={chartData.options} series={chartData.series} type="donut" width={240} height={240} />
            <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
              <div className='text-3xl font-bold text-gray-900'>{totalErrors}</div>
              <div className='text-sm font-medium text-red-600'>TOTAL ISSUES</div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className='space-y-3'>
          {LableData.map((label, index) => (
            <div key={index} className='flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors'>
              <div className='flex items-center gap-3'>
                <div 
                  className='w-3 h-3 rounded-full flex-shrink-0' 
                  style={{ backgroundColor: chartData.options.colors[index] }}
                ></div>
                <p className='text-sm font-medium text-gray-700'>{label}</p>
              </div>
              <span className='text-sm font-semibold text-gray-900'>{seriesData[index] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Products to Optimize */}
      <div className='border-t border-gray-200 pt-6'>
        <div className='flex items-center gap-3 mb-4'>
          <div className='flex items-center gap-2'>
            <Package2 className='w-5 h-5 text-amber-600' />
            <h3 className='text-lg font-semibold text-gray-900'>Top Products to Optimize</h3>
          </div>
          <div className='relative'>
            <AlertCircle 
              className='w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors'
              onMouseEnter={() => setToolTipForProductWithIssues(true)}
              onMouseLeave={() => setToolTipForProductWithIssues(false)}
            />
            {tooltipForProductWithIssues && <TooltipBox Information='Products with the highest number of issues that require immediate attention for optimal performance.' />}
          </div>
        </div>

        <div className='space-y-3'>
          {productErrors.slice(0, 4).map((product, index) => {
            if (!product) return null;
            return (
              <div 
                key={index} 
                onClick={() => navigateToProductWithIssuesPage(product.asin)}
                className='flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-all duration-200'
              >
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center'>
                    <Package2 className='w-5 h-5 text-gray-600' />
                  </div>
                                     <div>
                     <p className='font-medium text-gray-900'>{product.asin}</p>
                     <p className='text-sm text-gray-500'>{product.errors || product.totalErrors || 0} issues found</p>
                   </div>
                </div>
                                 <div className='flex items-center gap-2'>
                   {(() => {
                     const errorCount = product.errors || product.totalErrors || 0;
                     return (
                       <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                         errorCount > 5 
                           ? 'bg-red-50 text-red-700' 
                           : errorCount > 2 
                           ? 'bg-amber-50 text-amber-700' 
                           : 'bg-red-50 text-red-700'
                       }`}>
                         {errorCount > 5 ? 'High' : errorCount > 2 ? 'Medium' : 'High Priority'}
                       </span>
                     );
                   })()}
                   <div className='relative'>
                     <Eye 
                       className='w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors'
                       onMouseEnter={() => setHoveredProductIndex(index)}
                       onMouseLeave={() => setHoveredProductIndex(null)}
                     />
                     {hoveredProductIndex === index && (
                       <div className='absolute bottom-full right-0 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-50'>
                         Total Issues: {product.errors || product.totalErrors || 0}
                         <div className='absolute top-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                       </div>
                     )}
                   </div>
                 </div>
              </div>
            );
          })}
        </div>

        {productErrors.filter(p => p).length === 0 && (
          <div className='text-center py-8'>
            <Package2 className='w-12 h-12 text-gray-300 mx-auto mb-3' />
            <p className='text-gray-500'>No product issues found</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProductChecker
