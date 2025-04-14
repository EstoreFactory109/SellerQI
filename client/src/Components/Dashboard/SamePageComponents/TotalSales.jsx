import React, { useState } from "react";
import issue from "../../../assets/Icons/error.png";
import Chart from "react-apexcharts";
import { useSelector } from 'react-redux';

const TotalSales = () => {
     const info = useSelector(state => state.Dashboard.DashBoardInfo)
     console.log(info)
  const [LableData, setLableData] = useState([
    "Gross Profit",
    "PPC Spent",
    "FBA Fees",
    "Storage Fees",
    "Refunds",
  ]);
  const [saleValues, setSaleValues] = useState([
    Number(info.accountFinance.Gross_Profit), Number(info.accountFinance.ProductAdsPayment), Number(info.accountFinance.FBA_Fees),  Number(info.accountFinance.Storage), Number(info.accountFinance.Refunds),
  ]);

  const [chartData, setChartData] = useState({
    series: saleValues,
    options: {
      chart: {
        type: "pie",
      },
      labels: LableData,
      colors: [
        "#04724e",
        "#fcd02a",
        "#ff8c43",
        "#b92533",
        "#8a4f7c",
        "#333651",
        "#90acc7",
      ],
      legend: {
        show: false,
      },
      dataLabels: {
        enabled: false,
      },
    },
  });

  return (
    <div className="h-[75vh] lg:h-[65vh] bg-white p-4 border-2 border-gray-200 rounded-md">
      {/* Header Section */}
      <div className="w-full flex flex-wrap items-center justify-between pr-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm sm:text-base">TOP SALES</h2>
          <img src={issue} alt="" className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-sm sm:text-base">GROSS PROFIT</h2>
          <img src={issue} alt="" className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
      </div>

      {/* Sales Numbers */}
      <div className="w-full mt-2 flex flex-wrap items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">${info.TotalWeeklySale.toFixed(2)}</h2>
          <p className="text-xs sm:text-sm bg-[#edfef9] text-[#4f997e] px-2 py-1 rounded-full">
            +6.78%
          </p>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">${info.accountFinance.Gross_Profit}</h2>
          <p className="text-xs sm:text-sm bg-[#edfef9] text-[#4f997e] px-2 py-1 rounded-full">
            -2%
          </p>
        </div>
      </div>

      {/* Chart & Legend */}
      <div className="w-full flex flex-col md:flex-row items-center justify-between mt-4">
        {/* Chart */}
        <div className="w-full md:w-1/2 flex justify-center">
          <Chart
            options={chartData.options}
            series={chartData.series}
            type="pie"
            width="250"
          />
        </div>

        {/* Legend */}
        <ul className="w-full md:w-1/2 py-4 pr-3">
          {LableData.map((label, index) => (
            <li key={index} className="flex w-full items-center justify-between text-sm mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: chartData.options.colors[index] }}
                ></div>
                <p>{label}</p>
              </div>
              <div className="flex gap-2">
                <p>{saleValues[index]}</p>
                <p className="bg-[#fff7eb] text-[#dcb084] px-2 rounded-full text-xs sm:text-sm">
                  {Math.round((saleValues[index] / 10000) * 100)}%
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default TotalSales;
