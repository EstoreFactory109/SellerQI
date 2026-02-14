import React, { useState,useEffect } from 'react';
import { Info, TrendingUp, LineChart, Search, Box } from 'lucide-react';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import TooltipBox from '../../ToolTipBox/ToolTipBoxBottom.jsx'

const ProductChecker = () => {
   const info = useSelector(state => state.Dashboard.DashBoardInfo)
   console.log(info)
   const navigate = useNavigate()
   
   // Get error counts from Redux with better fallbacks - these are now pre-calculated during analysis
   const profitabilityErrors = info?.totalProfitabilityErrors || 0;
   const sponsoredAdsErrors = info?.totalSponsoredAdsErrors || 0;
   const inventoryErrors = info?.totalInventoryErrors || 0;
   const rankingErrors = info?.TotalRankingerrors || 0;
   const conversionErrors = info?.totalErrorInConversion || 0;
   const accountErrors = info?.totalErrorInAccount || 0;
   
   const [seriesData,setSeriesData]=useState([rankingErrors, conversionErrors, inventoryErrors, accountErrors, profitabilityErrors, sponsoredAdsErrors]);
 
   const [LableData, setDableData] = useState(["Rankings", "Conversion", "Inventory", "Account Health", "Profitability", "Sponsored Ads"])
   const [productErrors, setProductErrors] = useState([]);
   
   useEffect(() => {
     let tempArr = [];
     // Safely add product error data with fallbacks
     if (info?.first) tempArr.push(info.first);
     if (info?.second) tempArr.push(info.second);
     if (info?.third) tempArr.push(info.third);
     if (info?.fourth) tempArr.push(info.fourth);
     console.log("Product errors data:", tempArr);
     setProductErrors(tempArr)
   }, [info])
 
  useEffect(() => {
    // Update series data when info changes with safe fallbacks
    setSeriesData([rankingErrors, conversionErrors, inventoryErrors, accountErrors, profitabilityErrors, sponsoredAdsErrors]);
  }, [rankingErrors, conversionErrors, accountErrors, profitabilityErrors, sponsoredAdsErrors, inventoryErrors]);
  
  // Calculate total errors
  const totalErrors = seriesData.reduce((sum, value) => sum + (value || 0), 0);
  console.log("totalErrors",totalErrors)
  
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
        fontFamily: "'Inter', sans-serif",
      },
      labels: LableData,
      colors: ["#ca8a04", "#dc2626", "#ea580c", "#2563eb", "#059669", "#6366f1"], // Rankings: yellow-600 (deep yellow), Conversion: red-600 (deep red), Inventory: orange-600 (deep orange), Account: blue-600 (deep blue), Profitability: emerald-600 (deep green), Sponsored Ads: indigo-600 (deep indigo)
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
        width: 2,
        colors: ['#161b22']
      },
      responsive: [
        {
          breakpoint: 764,
          options: {
            chart: {
              width: 240,
              height: 240,
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
      navigate(`/seller-central-checker/${asin}`)
    }
  }

  const navigateToCategoryPage=(category)=>{
    // Handle direct navigation to dashboard pages for Profitability and Sponsored Ads
    if (category === 'Profitability') {
      navigate('/seller-central-checker/profitibility-dashboard');
      return;
    }
    
    if (category === 'Sponsored Ads') {
      navigate('/seller-central-checker/ppc-dashboard');
      return;
    }
    
    // Map category names to filter values for the category page
    const categoryMap = {
      'Rankings': 'Ranking',
      'Conversion': 'Conversion',
      'Inventory': 'Inventory',
      'Account Health': 'account', // This goes to account tab
    };
    
    const filterValue = categoryMap[category];
    
    if (category === 'Account Health') {
      // Navigate to account issues page
      navigate('/seller-central-checker/issues?tab=account');
    } else if (filterValue) {
      // Navigate to category page with filter
      navigate(`/seller-central-checker/issues?tab=category&filter=${filterValue}`);
    } else {
      // Fallback to category page
      navigate('/seller-central-checker/issues?tab=category');
    }
  }

  const [tooltipForProductChecker,setToolTipForProductChecker] = useState(false) 
  const [tooltipForProductWithIssues,setToolTipForProductWithIssues] = useState(false)
  const [hoveredProductIndex, setHoveredProductIndex] = useState(null)

  return (
    <div className='p-1.5 h-full'>
      <div className='flex items-center justify-between mb-1'>
        <div className='flex items-center gap-1'>
          <LineChart className='w-3 h-3 text-blue-400' />
          <h2 className='text-xs font-semibold text-gray-100'>Product Issues</h2>
          <div className='relative'>
            <Info 
              className='w-3.5 h-3.5 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors' 
              onMouseEnter={() => setToolTipForProductChecker(true)}
              onMouseLeave={() => setToolTipForProductChecker(false)}
            />
            {tooltipForProductChecker && <TooltipBox Information='Quick overview of product issues categorized by ranking, conversion, and account impact to assist you in prioritizing fixes efficiently.' />}
          </div>
        </div>
        <button 
          onClick={navigateToIssue} 
          className='px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors'
        >
          View All
        </button>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-1 mb-1'>
        <div className='flex justify-center items-center w-full'>
          <div className='relative w-full'>
            <Chart options={chartData.options} series={chartData.series} type="donut" width="100%" height={220} />
            <div className='absolute inset-0 flex flex-col items-center justify-center pointer-events-none'>
              <div className='text-xl font-bold text-gray-100'>{totalErrors}</div>
              <div className='text-xs font-medium text-blue-400'>ISSUES</div>
            </div>
          </div>
        </div>

        <div className='flex flex-col justify-center space-y-1'>
          {LableData.map((label, index) => {
            const errorCount = seriesData[index] || 0;
            const hasErrors = errorCount > 0;
            
            return (
              <div 
                key={index} 
                onClick={() => hasErrors && navigateToCategoryPage(label)}
                className={`flex items-center justify-between p-1.5 bg-[#21262d] rounded transition-colors ${
                  hasErrors 
                    ? 'hover:bg-blue-500/10 cursor-pointer border border-transparent hover:border-blue-500/30' 
                    : 'opacity-60 cursor-not-allowed'
                }`}
              >
                <div className='flex items-center gap-2'>
                  <div 
                    className='w-2.5 h-2.5 rounded-full flex-shrink-0' 
                    style={{ backgroundColor: chartData.options.colors[index] }}
                  ></div>
                  <p className='text-sm font-medium text-gray-200'>{label}</p>
                </div>
                <span className='text-sm font-semibold text-gray-100'>{errorCount}</span>
              </div>
            );
          })}
        </div>

        <div className='ml-2'>
          <div className='flex items-center gap-1 mb-1'>
            <Box className='w-3 h-3 text-blue-400' />
            <h3 className='text-xs font-semibold text-gray-100'>Top Products</h3>
            <div className='relative'>
              <Info 
                className='w-3.5 h-3.5 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors'
                onMouseEnter={() => setToolTipForProductWithIssues(true)}
                onMouseLeave={() => setToolTipForProductWithIssues(false)}
              />
              {tooltipForProductWithIssues && <TooltipBox Information='Products with the highest number of issues that require immediate attention for optimal performance.' />}
            </div>
          </div>

          <div className='space-y-1'>
            {productErrors.slice(0, 4).map((product, index) => {
              if (!product) return null;
              return (
                <div 
                  key={index} 
                  onClick={() => navigateToProductWithIssuesPage(product.asin)}
                  className='flex items-center justify-between p-1.5 border border-[#30363d] rounded hover:border-blue-500/40 hover:bg-[#21262d] cursor-pointer transition-all duration-200'
                >
                  <div className='flex items-center gap-1'>
                    <div className='w-6 h-6 bg-[#21262d] rounded flex items-center justify-center'>
                      <Box className='w-3 h-3 text-gray-400' />
                    </div>
                    <div>
                      <p className='font-medium text-gray-100 text-sm'>{product.asin}</p>
                      <p className='text-xs text-gray-400'>{product.errors || product.totalErrors || 0} issues</p>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    {(() => {
                      const errorCount = product.errors || product.totalErrors || 0;
                      return (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          errorCount > 5 
                            ? 'bg-blue-500/20 text-blue-400' 
                            : errorCount > 2 
                            ? 'bg-blue-500/10 text-blue-400' 
                            : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {errorCount > 5 ? 'High' : errorCount > 2 ? 'Medium' : 'High'}
                        </span>
                      );
                    })()}
                    <div className='relative'>
                      <Search 
                        className='w-3.5 h-3.5 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors'
                        onMouseEnter={() => setHoveredProductIndex(index)}
                        onMouseLeave={() => setHoveredProductIndex(null)}
                      />
                      {hoveredProductIndex === index && (
                        <div className='absolute bottom-full right-0 mb-1 px-2 py-1 bg-[#21262d] border border-[#30363d] text-gray-100 text-xs rounded whitespace-nowrap z-50'>
                          Total: {product.errors || product.totalErrors || 0}
                          <div className='absolute top-full right-2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-[#30363d]'></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {productErrors.filter(p => p).length === 0 && (
            <div className='text-center py-2'>
              <Box className='w-8 h-8 text-gray-400 mx-auto mb-1' />
              <p className='text-xs text-gray-400'>No issues found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProductChecker
