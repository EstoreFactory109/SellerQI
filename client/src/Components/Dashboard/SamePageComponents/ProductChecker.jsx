import React, { useState,useEffect } from 'react';
import issue from '../../../assets/Icons/error.png';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';

const ProductChecker = () => {
   const info = useSelector(state => state.Dashboard.DashBoardInfo)
   console.log(info)
    const [seriesData,setSeriesData]=useState([info.TotalRankingerrors, info.totalErrorInConversion, info.totalErrorInAccount]);
  const [LableData, setDableData] = useState(["Rankings", "Conversion", "Account Health", "Advertising", "Fulfillment", "Inventory"])
 const [productErrors, setProductErrors] = useState([]);
  useEffect(() => {
     let tempArr = [];
     tempArr.push(info.first);
     tempArr.push(info.second);
     tempArr.push(info.third);
     tempArr.push(info.fourth);
     setProductErrors(tempArr)
     
   }, [info])
  const [chartData, setChartData] = useState({
    series: seriesData, // Data values
    options: {
      chart: {
        type: "donut",
      },
      labels: LableData,
      colors: ["#fad12a", "#b92533", "#333651", "#90acc7", "#dae3f8", "#047248"],

      legend: {
        show: false// Hides legend globally
      },
      dataLabels: {
        enabled: false, // Hide percentages on the chart
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
    <div className='h-[62vh] lg:h-[55vh] bg-white p-3 border-2 border-gray-200 rounded-md'>
      <div className='w-full h-[58%] '>
        <div className='w-full flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <h2 className='text-sm'>PRODUCT CHECKER</h2>
            <img src={issue} alt='' className='w-4 h-4' />
          </div>
          <button className='bg-[#333651] text-xs text-white font-bold px-2 py-2 rounded-md'>
            View Full Report
          </button>
        </div>
        <div className='w-full flex  justify-between'>
          <Chart options={chartData.options} series={chartData.series} type="donut" width={220} />
          <ul className='w-[50%]  py-4 pr-3'>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#fad12a]' ></div>
                <p>{LableData[0]}</p>
              </div>
              <p>{seriesData[0]}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#b92533]' ></div>
                <p>{LableData[1]}</p>
              </div>
              <p>{seriesData[1]}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#333651]' ></div>
                <p>{LableData[2]}</p>
              </div>
              <p>{seriesData[2]}</p>
            </li>

            {/*<li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#90acc7]' ></div>
                <p>{LableData[3]}</p>
              </div>
              <p>{seriesData[3]}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm mb-3'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#dae3f8]' ></div>
                <p>{LableData[4]}</p>
              </div>
              <p>{seriesData[4]}</p>
            </li>
            <li className='flex w-full items-center justify-between text-sm'>
              <div className='flex items-center gap-2'>
                <div className='w-3 h-3 rounded-full bg-[#047248]' ></div>
                <p>{LableData[5]}</p>
              </div>
              <p>{seriesData[5]}</p>
            </li>*/}
          </ul>
        </div>
      </div>
      <div className='w-full h-[40%] '>
        <div className='flex items-center gap-3'>
          <h2 className='text-sm'>TOP PRODUCTS TO OPTIMIZE</h2>
          <img src={issue} alt='' className='w-4 h-4' />
        </div>
        <ul className='mt-3 border-2 border-gray-300 h-[85%] flex flex-col justify-center gap-2  px-2'>
          {
            productErrors.map((item, index) => {
              return item &&<li className='text-xs  flex items-center justify-between' key={index}>
                <p className='w-[80%]'>{item?.asin} | {item?.name}</p>
                <div className='text-[#d6737c] text-[10px] font-bold bg-[#fef1f3] px-2 py-1 rounded-full'>{item?.errors} issues</div>
              </li>
            })
          }

        </ul>
      </div>
    </div>
  );
};

export default ProductChecker;
