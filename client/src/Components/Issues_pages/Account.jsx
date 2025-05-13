import React from "react";
import Chart from "react-apexcharts";
import moment from "moment";
import Health from '../Reports/Reports_Third_Row/Health.jsx'
import { useSelector } from 'react-redux';

export default function AccountHealthDashboard() {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)

    const AccountErrors=info.AccountErrors
 
    console.log(AccountErrors)
    console.log(AccountErrors.validTrackingRateStatus.HowTOSolve.length)



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
              <th className="p-2 font-semibold">Category</th>
              <th className="p-2 font-semibold">Issue</th>
              <th className="p-2 font-semibold">How to solve</th>
            </tr>
          </thead>
          <tbody className="divide-y">
             
              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                  Account Status
                </td>
                <td className="p-2 whitespace-pre-line text-justify" style={AccountErrors.accountStatus.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.accountStatus.Message}</td>
                <td className="p-2 whitespace-pre-line text-justify" style={AccountErrors.accountStatus.status !== "Error" && { textAlign: "center" }}>
                  {AccountErrors.accountStatus.HowTOSolve.length>0?AccountErrors.accountStatus.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Negative Seller Feedback
                </td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.negativeFeedbacks.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.negativeFeedbacks.Message}</td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.negativeFeedbacks.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.negativeFeedbacks.HowTOSolve.length>0?AccountErrors.negativeFeedbacks.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                NCX - Negative Customer Experience
                </td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.NCX.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.NCX.Message}</td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.NCX.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.NCX.HowTOSolve.length>0?AccountErrors.NCX.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Policy Violations
                </td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.PolicyViolations.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.PolicyViolations.Message}</td>
                <td className="p-2 whitespace-pre-line  " style={AccountErrors.PolicyViolations.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.PolicyViolations.HowTOSolve.length>0?AccountErrors.PolicyViolations.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Valid Tracking Rate
                </td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.validTrackingRateStatus.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.validTrackingRateStatus.Message}</td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.validTrackingRateStatus.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.validTrackingRateStatus.HowTOSolve.length>0?AccountErrors.validTrackingRateStatus.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Order Defect Rate
                </td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.orderWithDefectsStatus.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.orderWithDefectsStatus.Message}</td>
                <td className="p-2 whitespace-pre-line " style={AccountErrors.orderWithDefectsStatus.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.orderWithDefectsStatus.HowTOSolve.length>0?AccountErrors.orderWithDefectsStatus.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Late Shipment Rate
                </td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.lateShipmentRateStatus.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.lateShipmentRateStatus.Message}</td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.lateShipmentRateStatus.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.lateShipmentRateStatus.HowTOSolve.length>0?AccountErrors.lateShipmentRateStatus.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                A-Z Guarantee Claim
                </td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.a_z_claims.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.a_z_claims.Message}</td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.a_z_claims.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.a_z_claims.HowTOSolve.length>0?AccountErrors.a_z_claims.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Cancellation Rate (CR)
                </td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.CancellationRate.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.accountStatus.Message}</td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.CancellationRate.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.CancellationRate.HowTOSolve.length>0?AccountErrors.CancellationRate.HowTOSolve:"N/A"}
                </td>
              </tr>

              <tr>
                <td className="p-2 align-top w-1/3 font-medium">
                Customer Response Time (More than 24 Hours)
                </td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.responseUnder24HoursCount.status==="Error"?{color:"red",fontWeight:"bold"}:{color:"green"}}>{AccountErrors.responseUnder24HoursCount.Message}</td>
                <td className="p-2 whitespace-pre-line" style={AccountErrors.responseUnder24HoursCount.status!=="Error" &&{textAlign:"center"}}>
                  {AccountErrors.responseUnder24HoursCount.HowTOSolve.length>0?AccountErrors.responseUnder24HoursCount.HowTOSolve:"N/A"}
                </td>
              </tr>
            
          </tbody>
        </table>
      </div>
    </div>
  );
}

