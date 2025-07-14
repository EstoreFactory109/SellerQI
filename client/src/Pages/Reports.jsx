import React, { useRef,useState,useEffect } from 'react'
import calenderIcon from '../assets/Icons/Calender.png'
import Download from '../assets/Icons/download.png'
import "../styles/Reports/style.css"
import RowOne from '../Components/Reports/Reports_First_Row.jsx'
import Health from '../Components/Reports/Reports_Third_Row/Health.jsx'
import AllIssues from '../Components/Reports/Reports_Third_Row/AllIssues.jsx'
import RowFour from '../Components/Reports/Reports_Fourth_Row.jsx'
import TopSalesChart from '../Components/Reports/Reports_Second_Row.jsx'
import Calender from '../Components/Calender/Calender.jsx'
import { AnimatePresence, motion } from 'framer-motion';
import DownloadReport from '../Components/DownloadReport/DownloadReport.jsx';
import { useSelector } from 'react-redux';




const Reports = () => {
   const [openCalender, setOpenCalender] = useState(false)
    const CalenderRef = useRef(null);
    const info = useSelector(state => state.Dashboard.DashBoardInfo);

   useEffect(() => {
     const handleClickOutside = (event) => {
       if (CalenderRef.current && !CalenderRef.current.contains(event.target)) {
         setOpenCalender(false);
       }
     };
     document.addEventListener('mousedown', handleClickOutside);
     return () => {
       document.removeEventListener('mousedown', handleClickOutside);
     };
   }, [])

   // Prepare data for CSV/Excel export
   const prepareReportsData = () => {
     const exportData = [];
     
     // Add summary data
     if (info) {
       // First Row - Financial and Product Metrics
       exportData.push({
         Category: 'Financial Metrics',
         Metric: 'Gross Profit',
         Value: `$${info.accountFinance?.Gross_Profit || 0}`,
         Details: 'Gross profit after deducting ad spend, storage fees, FBA fees, and product return refunds'
       });
       
       exportData.push({
         Category: 'Financial Metrics',
         Metric: 'Total Sales',
         Value: `$${info.TotalWeeklySale || 0}`,
         Details: 'Total revenue generated during the selected date range'
       });
       
       exportData.push({
         Category: 'Product Metrics',
         Metric: 'Products Without Buybox',
         Value: info.productsWithOutBuyboxError || 0,
         Details: 'Products without BuyBox which are not eligible for Sponsored ads'
       });
       
       exportData.push({
         Category: 'Product Metrics',
         Metric: 'Active Products',
         Value: `${info.ActiveProducts?.length || 0}/${info.TotalProduct?.length || 0}`,
         Details: 'Active products with fulfillable inventory'
       });
       
       exportData.push({
         Category: 'Product Metrics',
         Metric: 'Products to Replenish',
         Value: info?.InventoryAnalysis?.replenishment?.length || 0,
         Details: 'Number of products that are ready to be replenished'
       });
       
       // Account Health Section
       exportData.push({
         Category: 'Account Health',
         Metric: 'Health Score',
         Value: `${info.accountHealthPercentage?.Percentage || 0}%`,
         Details: info.accountHealthPercentage?.status || 'Unknown'
       });
       
       // Product Checker - Issues Breakdown
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Total Errors',
         Value: (info.TotalRankingerrors || 0) + (info.totalErrorInConversion || 0) + (info.totalErrorInAccount || 0) + (info.totalProfitabilityErrors || 0) + (info.totalSponsoredAdsErrors || 0) + (info.totalInventoryErrors || 0),
         Details: 'Total number of all errors across all categories'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Ranking Errors',
         Value: info.TotalRankingerrors || 0,
         Details: 'Issues related to product rankings'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Conversion Errors',
         Value: info.totalErrorInConversion || 0,
         Details: 'Issues affecting conversion rates'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Inventory Errors',
         Value: info.totalInventoryErrors || 0,
         Details: 'Issues with inventory management'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Account Health Errors',
         Value: info.totalErrorInAccount || 0,
         Details: 'Account-level health issues'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Profitability Errors',
         Value: info.totalProfitabilityErrors || 0,
         Details: 'Issues affecting profitability'
       });
       
       exportData.push({
         Category: 'Product Checker',
         Metric: 'Sponsored Ads Errors',
         Value: info.totalSponsoredAdsErrors || 0,
         Details: 'Issues with sponsored advertising'
       });
       
       // Issues Section (Fourth Row)
       exportData.push({
         Category: 'Issues Summary',
         Metric: 'Total Issues',
         Value: (info.TotalRankingerrors || 0) + (info.totalErrorInConversion || 0) + (info.totalErrorInAccount || 0),
         Details: 'Total number of issues in all products and Amazon account'
       });
       
       exportData.push({
         Category: 'Issues Summary',
         Metric: 'Potential Reimbursements',
         Value: `$${info.reimbustment?.totalReimbursement || 0}`,
         Details: 'Estimated amount eligible to recover from Amazon'
       });
       
       exportData.push({
         Category: 'Issues Summary',
         Metric: 'Amazon Ready Products',
         Value: `${info.amazonReadyProducts?.length || 0}/${info.TotalProduct?.length || 0}`,
         Details: 'Products with no issues or improvement needed'
       });
       
       // Sales Trend Data (if needed)
       if (info.TotalSales && info.TotalSales.length > 0) {
         exportData.push({
           Category: 'Sales Trend',
           Metric: 'Latest Period Sales',
           Value: `$${info.TotalSales[info.TotalSales.length - 1]?.TotalAmount || 0}`,
           Details: info.TotalSales[info.TotalSales.length - 1]?.interval || ''
         });
       }
       
       // Add individual product issues if available
       if (info.productWiseError && info.productWiseError.length > 0) {
         info.productWiseError.forEach((product, index) => {
           exportData.push({
             Category: 'Product Details',
             Metric: `Product ${index + 1} - ${product.name}`,
             Value: product.asin,
             Details: `SKU: ${product.sku}, Price: $${product.price}, Sales: $${product.sales}`
           });
         });
       }
     }
     
     return exportData;
   };

  return (
    <div className='bg-[#eeeeee] w-full h-auto lg:h-[90vh] p-6 overflow-y-auto lg:mt-0 mt-[10vh]'>
      <div className='w-full flex flex-wrap items-center justify-between cursor-pointer mb-4'>
        <p className='text-sm'>REPORTS</p>
        <div className='flex gap-4 flex-wrap'>
        <div className='fit-content relative ' ref={CalenderRef}>
          <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200 cursor-pointer calendar-selector' onClick={() => setOpenCalender(!openCalender)}>
            <p className='font-semi-bold text-xs'>
              {(info?.calendarMode === 'custom' && info?.startDate && info?.endDate)
                ? `${new Date(info.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(info.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : info?.calendarMode === 'last7'
                ? 'Last 7 Days'
                : 'Last 30 Days'
              }
            </p>
            <img src={calenderIcon} alt='' className='w-4 h-4' />
          </div>
          <AnimatePresence>
            {openCalender && (
              <motion.div

                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute top-full right-0 z-50 bg-white shadow-md rounded-md origin-top"
              >
                <Calender setOpenCalender={setOpenCalender}/>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
          <DownloadReport
            prepareDataFunc={prepareReportsData}
            filename="Dashboard_Report"
            buttonText="Export"
            showIcon={true}
          />
        </div>
      </div>
      <div className='w-full min-h-[12vh] md:min-h-[10vh] mt-7 bg-white px-4 py-3 shadow-sm rounded-lg'>
        <RowOne  />
      </div>


      <div className='w-full h-[70vh]  md:h-[65vh]  mt-7'>
        <TopSalesChart/>
      </div>
      
      <div className='w-full h-[40rem] lg:h-auto mt-5'>
        <p className='text-sm mb-4'>ACCOUNT AUDIT</p>
        <div className='w-full   lg:flex items-center justify-between  rounded-md relative gap-4'>
          <div className='w-full lg:w-1/2 h-[350px]  lg:h-[250px] shadow-sm rounded-2xl'>
            <Health />
          </div>
          <div className='lg:w-1/2 w-full  lg:h-[250px] lg:mt-0 mt-4 bg-white shadow-sm p-3 flex flex-col items-center justify-center rounded-2xl'>
          <AllIssues />
          </div>
        </div>
      </div>
      <div className='w-full lg:mt-5' > 
        <p className='text-sm mb-5'>ISSUES</p>
        <div className='w-full min-h-[12vh] md:min-h-[10vh]  bg-white px-4 py-3 shadow-sm rounded-lg'>
        <RowFour  />
      </div>
      </div>
    </div>
  )
}

export default Reports
