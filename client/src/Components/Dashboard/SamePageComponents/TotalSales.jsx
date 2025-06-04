import React, { useState } from "react";
import issue from "../../../assets/Icons/error.png";
import Chart from "react-apexcharts";
import { useSelector } from "react-redux";
import TooltipBox from "../../ToolTipBox/ToolTipBoxBottom";
import ToolTipBoxLeft from '../../ToolTipBox/ToolTipBoxBottomLeft'

const TotalSales = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const [openToolTipGrossProfit, setOpenToolTipGrossProfit] = useState(false);
  const [openToolTipTopSales, setOpenToolTipTopSales] = useState(false);

  const labelData = [
    "Gross Profit",
    "PPC Spent",
    "FBA Fees",
    "Storage Fees",
    "Refunds",
  ];

 const grossProfitRaw = Number(info.accountFinance?.Gross_Profit) || 0;
 
  const grossProfit = Math.abs(grossProfitRaw);

  // Update grossProfitColor based on value


  const saleValues = [
    grossProfit,
    Number(info.accountFinance?.ProductAdsPayment || 0),
    Number(info.accountFinance?.FBA_Fees || 0),
    Number(info.accountFinance?.Storage || 0),
    Number(info.accountFinance?.Refunds || 0),
  ];

  const chartData = {
    series: saleValues,
    options: {
      chart: { type: "pie" },
      labels: labelData,
      colors: [
        grossProfitRaw < 0 ? "#90adc7" : "#04724e",
        "#fcd02a",
        "#ff8c43",
        "#b92533",
        "#8a4f7c",
      ],
      legend: { show: false },
      dataLabels: { enabled: false },
    },
  };

  return (
    <div className="h-[60vh] lg:h-[43vh] bg-white p-4 border-2 border-gray-200 rounded-md">
      {/* Header Section */}
      <div className="w-full flex flex-wrap items-center justify-between pr-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm sm:text-base">TOTAL SALES</h2>
          <div className="relative fit-content">
          <img src={issue} alt="" className="w-4 h-4 sm:w-5 sm:h-5 cursor-pointer" onMouseEnter={() => setOpenToolTipTopSales(true)} onMouseLeave={() => setOpenToolTipTopSales(false)} />
          {openToolTipTopSales && <ToolTipBoxLeft Information="Total revenue generated during the selected date range."/>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-sm sm:text-base">GROSS PROFIT</h2>
          <div className="relative fit-content">
          <img src={issue} alt="" className="w-4 h-4 sm:w-5 sm:h-5 cursor-pointer" onMouseEnter={() => setOpenToolTipGrossProfit(true)} onMouseLeave={() => setOpenToolTipGrossProfit(false)} />
          {openToolTipGrossProfit && <TooltipBox Information="Gross profit after deducting ad spend, storage fees, FBA fees, and product return refunds from sales revenue."/>}
          </div>
        </div>
      </div>

      {/* Sales Numbers */}
      <div className="w-full mt-2 flex flex-wrap items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">
            ${Number(info?.TotalWeeklySale || 0).toFixed(2)}
          </h2>
          <p className="text-xs sm:text-sm bg-[#edfef9] text-[#4f997e] px-2 py-1 rounded-full">
            {info?.startDate} - {info?.endDate}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">
            ${grossProfitRaw}
          </h2>
          <div className="  px-2 py-1">
            
          </div>
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
          {labelData.map((label, index) => (
            <li
              key={index}
              className="flex w-full items-center justify-between text-sm mb-3"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: chartData.options.colors[index] }}
                ></div>
                <p>{label}</p>
              </div>
              <div className="flex gap-2">
                <p>{
                  index === 0 ? info.accountFinance?.Gross_Profit :
                    saleValues[index]
                }</p>
                <p className="bg-[#fff7eb] text-[#dcb084] w-9 flex items-center justify-center rounded-full text-xs sm:text-[10px]">
                  {Math.round((saleValues[index] / info?.TotalWeeklySale) * 100)}%
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
