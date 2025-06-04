import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import MetricCard from '../Components/ProfitibilityDashboard/MetricCard';
import ProfitTable from '../Components/ProfitibilityDashboard/ProfitTable';
import SuggestionList from '../Components/ProfitibilityDashboard/SuggestionList';
import calenderIcon from '../assets/Icons/Calender.png'
import { useSelector } from "react-redux";

const chartData = [
  { date: 'Apr 1', spend: 150, netProfit: 350 },
  { date: 'Apr 5', spend: 180, netProfit: 420 },
  { date: 'Apr 8', spend: 200, netProfit: 380 },
  { date: 'Apr 12', spend: 175, netProfit: 450 },
  { date: 'Apr 15', spend: 190, netProfit: 390 },
  { date: 'Apr 18', spend: 165, netProfit: 480 },
  { date: 'Apr 22', spend: 185, netProfit: 410 },
  { date: 'Apr 25', spend: 170, netProfit: 440 },
  { date: 'Apr 28', spend: 195, netProfit: 395 },
  { date: 'Apr 30', spend: 160, netProfit: 460 },
];

const ProfitabilityDashboard = () => {
  const [suggestionsData, setSuggestionsData] = useState([]);
  const [openCalender, setOpenCalender] = useState(false);

  const info = useSelector((state) => state.Dashboard.DashBoardInfo);

  const metrics = [
    { label: 'Total Sales', value: `$${Number(info?.TotalWeeklySale || 0).toFixed(2)}`, icon: 'dollar-sign' },
    { label: 'Gross Profit', value: `$${Number(info.accountFinance?.Gross_Profit) || 0}`, icon: 'dollar-sign' },
    { label: 'Avg Profit Margin', value: `${((Number(info.accountFinance?.Gross_Profit || 0))/(Number(info?.TotalWeeklySale || 1).toFixed(2)) * 100).toFixed(2)} %`, icon: 'percent' },
    { label: 'Total Ad Spend', value: '$5,200', icon: 'dollar-sign' },
    { label: 'Total Amaz Fees', value: `$${Number(info.accountFinance?.FBA_Fees || 0)+Number(info.accountFinance?.Storage || 0)}`, icon: 'list' },
  ];

  const suggestions = [
    'Reduce ad spend on Ceramic Bowl',
    'Consider removing Tea Cup Set',
  ];

  return (
    <div className="bg-[#eeeeee] h-screen overflow-y-auto">
      <div className="p-6">
        <div className="max-w-[1400px] mx-auto pb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-sm text-gray-900">PROFITIBILITY</h1>
            <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200  cursor-pointer' onClick={() => setOpenCalender(!openCalender)}>
              <p className='font-semi-bold text-xs'>Last 30 Days</p>
              <img src={calenderIcon} alt='' className='w-4 h-4' />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {metrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
            ))}
          </div>

          {/* Line Chart for Spend and Net Profit */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Spend vs Net Profit Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  stroke="#E5E7EB"
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  stroke="#E5E7EB"
                  tickLine={false}
                  tickFormatter={(value) => `${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '8px'
                  }}
                  formatter={(value) => `${value}`}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#EF4444"
                  name="Ad Spend"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="netProfit"
                  stroke="#10B981"
                  name="Net Profit"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-6">
            <ProfitTable setSuggestionsData={setSuggestionsData} />
          </div>

          <SuggestionList suggestionsData={suggestionsData} />
          <div className='w-full h-[3rem]'></div>
          <div className='w-full h-[3rem]'></div>
    
        </div>
      </div>
    </div>
  );
};

export default ProfitabilityDashboard;