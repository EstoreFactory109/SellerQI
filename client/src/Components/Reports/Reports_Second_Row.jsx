import React from 'react';
import Chart from 'react-apexcharts';
import moment from 'moment';
import { useSelector } from 'react-redux';

const TopSalesChart = () => {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)

  // Get last 16 days of sales data (covers 10-16 days range)
  const totalSales = info.TotalSales ? info.TotalSales.slice(-16) : [];
  console.log('Last 16 days of sales data:', totalSales)

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
          moment(item.interval.split('--')[0]).format('DD MMM')
        ),
        title: {
          text: 'Date',
          style: {
            fontSize: '14px',
            fontWeight: 'bold'
          }
        },
        labels: {
          rotate: -45,
          style: {
            fontSize: '12px'
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
