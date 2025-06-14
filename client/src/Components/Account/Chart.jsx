import React from 'react';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';

const IssuesLineChart = () => {

      const info = useSelector(state => state.History.HistoryInfo);

  // Handle empty or invalid data
  if (!info || !Array.isArray(info) || info.length === 0) {
    return (
      <div>
        <h2>Issues Week by Week</h2>
        <div className="text-center text-gray-500 py-8">
          No data found in the history section
        </div>
      </div>
    );
  }

  const chartData = info.slice(0, 10);

  const categories = chartData.map(item => new Date(item.Date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
  const seriesData = chartData.map(item => item.TotalNumberOfIssues  );


  const options = {
    chart: {
      type: 'line',
      toolbar: { show: false }
    },
    colors: ['#333751'],
    stroke: {
      curve: 'smooth'
    },
    markers: {
      size: 5,
      colors: ['#ffffff'],
      strokeColors: '#333751',
      strokeWidth: 2,
      hover: {
        size: 7
      }
    },
    tooltip: {
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const issues = series[seriesIndex][dataPointIndex];
        const previous = dataPointIndex > 0 ? series[seriesIndex][dataPointIndex - 1] : 0;
        const diff = issues - previous;
        const sign = diff >= 0 ? '+' : '';
        return `<div style="padding: 8px; background: #2b3553; color: white; border-radius: 6px;">
                  <div>${issues} Issues</div>
                  <div style="color: ${diff >= 0 ? '#ff4d4f' : '#52c41a'};">${sign}${diff}</div>
                </div>`;
      }
    },
    xaxis: {
      categories,
      labels: {
        rotate: -45
      }
    },
    yaxis: {
      title: {
        text: 'Total Sales'
      },
      min: 0
    }
  };

  const series = [
    {
      name: 'Total Sales',
      data: seriesData
    }
  ];

  return (
    <div>
      <h2>Issues Week by Week</h2>
      <Chart options={options} series={series} type="line" height={350} />
    </div>
  );
};

export default IssuesLineChart;
