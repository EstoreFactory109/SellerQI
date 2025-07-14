import React from 'react';
import Chart from 'react-apexcharts';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

const IssuesLineChart = () => {
  const info = useSelector(state => state.History.HistoryInfo);

  console.log("🔍 ACCOUNT HISTORY DATA IN CHART COMPONENT:");
  console.log("History Info for Chart:", info);
  console.log("Chart data length:", info ? info.length : 0);

  // Handle empty or invalid data
  if (!info || !Array.isArray(info) || info.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="text-center py-8"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
            <Activity className="w-8 h-8 text-gray-400" />
          </div>
          <div className="space-y-2">
            <h4 className="text-lg font-semibold text-gray-900">No Historical Data</h4>
            <p className="text-sm text-gray-600 max-w-md">
              No historical data found. Data will appear here once your account analysis runs.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Get the most recent 10 records (same logic as table)
  const reversedInfo = [...info].reverse();
  const recentData = reversedInfo.slice(0, 10);
  // Reverse again to show chronological order in chart (oldest to newest)
  const chartData = [...recentData].reverse();

  const categories = chartData.map(item => 
    new Date(item.Date).toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short' 
    })
  );
  const seriesData = chartData.map(item => item.TotalNumberOfIssues);

  // Calculate trend and get latest exact total issues
  const latestValue = seriesData[seriesData.length - 1] || 0;
  const previousValue = seriesData[seriesData.length - 2] || 0;
  const trendDirection = latestValue > previousValue ? 'up' : latestValue < previousValue ? 'down' : 'stable';
  const trendValue = Math.abs(latestValue - previousValue);
  const trendPercentage = previousValue > 0 ? ((trendValue / previousValue) * 100).toFixed(1) : 0;

  // Get the latest history record for detailed logging
  const latestHistoryRecord = info[info.length - 1];
  
  console.log("🔍 TOTAL ISSUES DISPLAY ABOVE GRAPH:");
  console.log("Latest History Record:", latestHistoryRecord);
  console.log("Latest Total Issues (TotalNumberOfIssues):", latestValue);
  console.log("📊 This is the EXACT same value as Dashboard's Total Issues box!");
  console.log("🔢 Calculated from: Profitability + Sponsored Ads + Inventory + Ranking + Conversion + Account errors");
  console.log("Trend Direction:", trendDirection);
  console.log("Trend Percentage:", trendPercentage + "%");

  const options = {
    chart: {
      type: 'line',
      toolbar: { show: false },
      background: 'transparent',
      fontFamily: 'Inter, system-ui, sans-serif',
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 800,
        animateGradually: {
          enabled: true,
          delay: 150
        },
        dynamicAnimation: {
          enabled: true,
          speed: 350
        }
      }
    },
    colors: ['#6366f1'], // Modern indigo color
    stroke: {
      curve: 'smooth',
      width: 3,
      lineCap: 'round'
    },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'light',
        type: 'vertical',
        shadeIntensity: 0.5,
        gradientToColors: ['#8b5cf6'],
        inverseColors: false,
        opacityFrom: 0.1,
        opacityTo: 0.05,
        stops: [0, 100]
      }
    },
    markers: {
      size: 6,
      colors: ['#ffffff'],
      strokeColors: '#6366f1',
      strokeWidth: 3,
      hover: {
        size: 8,
        sizeOffset: 2
      },
      discrete: [{
        seriesIndex: 0,
        dataPointIndex: seriesData.length - 1,
        fillColor: '#10b981',
        strokeColor: '#ffffff',
        size: 8,
        shape: 'circle'
      }]
    },
    grid: {
      show: true,
      borderColor: '#f1f5f9',
      strokeDashArray: 3,
      position: 'back',
      xaxis: {
        lines: {
          show: false
        }
      },
      yaxis: {
        lines: {
          show: true
        }
      },
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      }
    },
    tooltip: {
      enabled: true,
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const issues = series[seriesIndex][dataPointIndex];
        const date = categories[dataPointIndex];
        const previous = dataPointIndex > 0 ? series[seriesIndex][dataPointIndex - 1] : issues;
        const diff = issues - previous;
        const sign = diff > 0 ? '+' : diff < 0 ? '' : '±';
        const trendColor = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : '#6b7280';
        
        return `
          <div style="
            padding: 12px 16px; 
            background: rgba(255, 255, 255, 0.95); 
            border: 1px solid #e5e7eb;
            border-radius: 12px; 
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            font-family: Inter, sans-serif;
          ">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">${date}</div>
            <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 4px;">
              ${issues} Issues
            </div>
            ${dataPointIndex > 0 ? `
              <div style="font-size: 12px; color: ${trendColor}; font-weight: 500;">
                ${sign}${Math.abs(diff)} from previous
              </div>
            ` : ''}
          </div>
        `;
      }
    },
    xaxis: {
      categories,
      labels: {
        rotate: -45,
        style: {
          colors: '#64748b',
          fontSize: '12px',
          fontWeight: '500'
        }
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: false
      }
    },
    yaxis: {
      title: {
        text: 'Number of Issues',
        style: {
          color: '#64748b',
          fontSize: '12px',
          fontWeight: '600'
        }
      },
      min: 0,
      labels: {
        style: {
          colors: '#64748b',
          fontSize: '12px',
          fontWeight: '500'
        },
        formatter: function(value) {
          return Math.floor(value);
        }
      }
    },
    dataLabels: {
      enabled: false
    }
  };

  const series = [
    {
      name: 'Issues Count',
      data: seriesData
    }
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Recent Issues Trend</h2>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative"
      >


        {/* Enhanced Chart */}
        <div className="relative">
          <Chart 
            options={options} 
            series={series} 
            type="area" 
            height={320}
          />
          
          {/* Gradient overlay for modern effect */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-white/10 to-transparent rounded-lg"></div>
        </div>
      </motion.div>
    </div>
  );
};

export default IssuesLineChart;
