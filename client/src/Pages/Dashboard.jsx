import React, { useState, useRef, useEffect } from 'react'
import calenderIcon from '../assets/Icons/Calender.png'
import ExpectedReimbursement from '../Components/Dashboard/SamePageComponents/ExpectedReimbursement.jsx'
import ProductsToReplinish from '../Components/Dashboard/SamePageComponents/ProductsToReplinish.jsx'
import ProductsWithoutBuybox from '../Components/Dashboard/SamePageComponents/ProductsWithoutBuybox.jsx'
import AmazonReadyProducts from '../Components/Dashboard/SamePageComponents/AmazonReadyProducts.jsx'
import ProductChecker from '../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender from '../Components/Calender/Calender.jsx'
import { AnimatePresence, motion } from 'framer-motion';

const Dashboard = () => {

  const [openCalender, setOpenCalender] = useState(false)
  const CalenderRef = useRef(null);

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

  return (
    <div id='dashboard-main' className='bg-[#eeeeee] p-5 w-full min-h-[90vh] lg:mt-0 mt-[12vh] overflow-hidden'>
      <div className='w-full flex items-center justify-between cursor-pointer mb-4'>
        <p className='text-sm'>ACCOUNT ANALYTICS</p>
        <div className='fit-content relative' ref={CalenderRef}>
          <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200  cursor-pointer' onClick={() => setOpenCalender(!openCalender)}>
            <p className='font-semi-bold text-xs'>Last 30 Days</p>
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
                <Calender setOpenCalender={setOpenCalender} />
              </motion.div>
            )}
          </AnimatePresence>

        </div>

      </div>
      <div className='w-full h-full lg:h-[79vh]   lg:flex gap-2'>
        <div className='w-full lg:w-1/2 h-full'>
          <div id='account-health' className='mb-2'>
            <AccountHealth />
          </div>
          <div id='total-sales'>
            <TotalSales />
          </div>
        </div>
        <div className='w-full lg:w-1/2 h-full mt-2'>
          <div id='product-checker' className='mb-2'>
            <ProductChecker />
          </div>
          <div className='w-full lg:h-[35vh]'>
            <div className='lg:flex w-full mb-2 gap-2'>
              <div id='expected-reimburstment' className='mb-2 lg:mb-0'>
                <ExpectedReimbursement />
              </div>
              <div id='amazon-ready-products'>
                <AmazonReadyProducts />
              </div>
            </div>
            <div className='lg:flex w-full gap-2 '>
              <div id='products-to-replenish' className='mb-2 lg:mb-0' >
                <ProductsToReplinish />
              </div>
              <div id='products-without-buybox'>
                <ProductsWithoutBuybox />
              </div>
            </div>
          </div>

        </div>





      </div>
    </div>
  )
}

export default Dashboard