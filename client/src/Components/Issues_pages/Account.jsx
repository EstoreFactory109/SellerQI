import React from "react";
import Chart from "react-apexcharts";
import moment from "moment";
import Health from '../Reports/Reports_Third_Row/Health.jsx'
import { useSelector } from 'react-redux';

export default function AccountHealthDashboard() {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)

    const issueData = [
      {
        issue: "Negative Seller Feedback",
        solution:info.AccountErrors.negativeFeedbacks.HowTOSolve.length===0?info.AccountErrors.negativeFeedbacks.Message:info.AccountErrors.negativeFeedbacks.HowTOSolve
      },
      {
        issue: "Policy Violations",
        solution:info.AccountErrors.PolicyViolations.HowTOSolve.length===0?info.AccountErrors.PolicyViolations.Message:info.AccountErrors.PolicyViolations.HowTOSolve
      },
      {
        issue: "Late Shipment Count",
        solution:info.AccountErrors.lateShipmentCount.HowTOSolve.length===0?info.AccountErrors.lateShipmentCount.Message:info.AccountErrors.lateShipmentCount.HowTOSolve
      },
      {
        issue:"Account Status",
        solution:info.AccountErrors.accountStatus.HowTOSolve.length===0?info.AccountErrors.accountStatus.Message:info.AccountErrors.accountStatus.HowTOSolve
      },
      {
        issue:"Response Under 24 Hours",
        solution:info.AccountErrors.responseUnder24HoursCount.HowTOSolve.length===0?info.AccountErrors.responseUnder24HoursCount.Message:info.AccountErrors.responseUnder24HoursCount.HowTOSolve
      }
    ];


  const totalSales = info.TotalSales.slice(-10);

  const chartData = {
    series: [
      {
        name: 'Top Sales',
        data: totalSales.map(item => item.TotalAmount)
      }
    ],
    options: {
      chart: {
        type: 'line',
        toolbar: { show: false },
        height: 300,
        width: '100%'
      },
      stroke: {
        curve: 'smooth',
        width: 3
      },
      xaxis: {
        categories: totalSales.map(item =>
          moment(item.interval.split('--')[0]).format('D MMM')
        ),
        title: {
          text: 'Date',
          style: {
            fontSize: '14px',
            fontWeight: 'bold'
          }
        }
      },
      yaxis: {
        title: {
          text: 'Amount ($)',
          style: {
            fontSize: '14px',
            fontWeight: 'bold'
          }
        }
      },
      colors: ['#333651'],
      markers: {
        size: 5
      },
      dataLabels: {
        enabled: false
      },
      grid: {
        borderColor: '#E5E7EB'
      }
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Top Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Account Health */}
        <div className="bg-white shadow-md rounded-2xl p-6 flex flex-col items-center justify-center">
          <Health/>
        </div>

        {/* Sales Chart */}
        <div className="w-full h-[350px] p-4 bg-white rounded-2xl shadow flex flex-col">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Top Sales</h2>
          <div className="flex-1">
            <Chart
              options={chartData.options}
              series={chartData.series}
              type="line"
              width="100%"
              height="100%"
            />
          </div>
        </div>
      </div>

      {/* Issues Table */}
      <div className="bg-white shadow-md rounded-2xl p-6 overflow-x-auto">
        <div className="flex justify-end items-center mb-4">
          
          <button className="text-sm text-white bg-[#333651]  rounded px-3 py-1 hover:bg-blue-50">
            Download PDF
          </button>
        </div>
        <table className="min-w-full table-auto text-sm text-left">
          <thead>
            <tr className="border-b bg-[#333651] text-white">
              <th className="p-2 font-semibold">Issue</th>
              <th className="p-2 font-semibold">How to solve</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {
             issueData.map((issue, idx) => (
              <tr key={idx}>
                <td className="p-2 align-top w-1/3 font-medium">{issue.issue}</td>
                <td className="p-2 whitespace-pre-line">{issue.solution}</td>
              </tr>
            ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

