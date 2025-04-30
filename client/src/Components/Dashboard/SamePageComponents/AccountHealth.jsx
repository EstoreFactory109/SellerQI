import React from 'react'
import issue from '../../../assets/Icons/error.png';
import Chart from "react-apexcharts";
import { useSelector } from 'react-redux';
const AccountHealth = () => {
const info = useSelector(state => state.Dashboard?.DashBoardInfo)
 
console.log(info)

  const options = {
    chart: {
      type: "radialBar",
    },
    plotOptions: {
      radialBar: {
        startAngle: -130, // Start the arc from this angle
        endAngle: 130, // End at this angle
        track: {
          background: "#EEEEEE", // Light grey background track
          strokeWidth: "100%", // Thickness of background
        },
        hollow: {
          size: "60%", // Controls the inner empty space (higher means thinner arc)
        },
        dataLabels: {
          name: {
            show: false, // Hide the label (optional)
          },
          value: {
            fontSize: "25px",
            fontWeight: "bold",
            color: "#1E1E3F",
            offsetY:0.5,
            formatter: function (val) {
              return `${val}%`;
            },
          },
        },
      },
    },
    fill: {
      colors: ["#1E1E3F"], // Dark color for progress bar
    },
    stroke: {
      lineCap: "round", // Rounded edges
    },
    labels: ["Progress"],
  };

  const series = [info?.accountHealthPercentage?.Percentage];

  return (
    <div className='min-h-[35vh] bg-white p-3 border-2 border-gray-200 rounded-md pb-4'>
      <div className='w-full flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <h2 className='text-sm'>ACCOUNT HEALTH</h2>
          <img src={issue} alt='' className='w-4 h-4' />
        </div>
        <button className='bg-[#333651] text-xs text-white font-bold px-2 py-2 rounded-md'>
          View Full Report
        </button>
      </div>
      <div className='relative w-fit m-auto'>
        <Chart options={options} series={series} type="radialBar" height={250} />
        <p className='absolute text-xs bottom-8 left-[40%] text-[#82b4a5]'>{info?.accountHealthPercentag?.status.toUpperCase()}</p>
        <p className='absolute text-xs text-[#82b4a5] bg-[#edfef0] px-1 rounded-full left-[40%] bottom-0'>+2.00%</p>
      </div>
    </div>
  )
}

export default AccountHealth