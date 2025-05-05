import React from 'react'
import Chart from "react-apexcharts";
import { useSelector } from 'react-redux';

const Health = () => {

  const info = useSelector(state => state.Dashboard.DashBoardInfo)

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
            fontSize: "30px",
            fontWeight: "bold",
            color: "#1E1E3F",
            offsetY: 0.5,
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

  const series = [info.accountHealthPercentage.Percentage];
  return (
    <>
      <div className="relative w-64 lg:w-full min-h-[170px]">
        <Chart options={options} series={series} type="radialBar" height={200} />
        <p className="absolute text-sm font-medium bottom-9 left-1/2 transform -translate-x-1/2 text-[#1e1e3f]">
          {info.accountHealthPercentage.status}
        </p>
       
      </div>
      <p className="flex items-center justify-center  text-sm w-full">Account Health</p>

    </>
  )
}

export default Health