import React from 'react';
import Chart from 'react-apexcharts';
import moment from 'moment';
import { useSelector } from 'react-redux';

const TopSalesChart = () => {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)

  const totalSales = info.TotalSales;

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
        height: '100%',
        width: '100%'
      },
      stroke: {
        curve: 'smooth',
        width: 3
      },
      xaxis: {
        categories: totalSales.map(item =>
          moment(item.interval.split('--')[0]).format('D/MM')
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
      colors: ['#FFB400'],
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
    <div className="w-full h-full p-4 bg-white rounded-2xl shadow flex flex-col">
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
  );
};

export default TopSalesChart;
