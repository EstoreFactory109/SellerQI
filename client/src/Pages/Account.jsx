import React from 'react';
import { motion } from 'framer-motion';
import { History, TrendingUp, BarChart3, Activity, Clock, Target, AlertTriangle } from 'lucide-react';
import { useSelector } from 'react-redux';
import Table from '../Components/Account/Table.jsx';
import Chart from '../Components/Account/Chart.jsx';

const AccountHistoryPanel = () => {
  const historyInfo = useSelector(state => state.History.HistoryInfo || []);

  console.log("🔍 ACCOUNT HISTORY PAGE DATA:");
  console.log("History Info:", historyInfo);
  console.log("Number of history records:", historyInfo.length);

  // Calculate dynamic values from history data
  const latestRecord = historyInfo.length > 0 ? historyInfo[historyInfo.length - 1] : null;
  const previousRecord = historyInfo.length > 1 ? historyInfo[historyInfo.length - 2] : null;
  
  // Current Health Score
  const currentHealthScore = latestRecord ? latestRecord.HealthScore || 0 : 0;
  
  // Current Total Issues (exact count from latest record)
  const currentTotalIssues = latestRecord ? latestRecord.TotalNumberOfIssues || 0 : 0;
  
  // 7-Day Trend (Health Score change)
  let healthTrend = 0;
  let healthTrendDirection = 'stable';
  if (latestRecord && previousRecord) {
    const currentHealth = latestRecord.HealthScore || 0;
    const previousHealth = previousRecord.HealthScore || 0;
    healthTrend = currentHealth - previousHealth;
    healthTrendDirection = healthTrend > 0 ? 'up' : healthTrend < 0 ? 'down' : 'stable';
  }
  
  // Issues resolved (calculate from trend)
  let issuesResolved = 0;
  if (latestRecord && previousRecord) {
    const currentIssues = latestRecord.TotalNumberOfIssues || 0;
    const previousIssues = previousRecord.TotalNumberOfIssues || 0;
    issuesResolved = Math.max(0, previousIssues - currentIssues); // Only count if issues decreased
  }
  
  // Records tracked
  const recordsTracked = historyInfo.length;

  console.log("🔍 CALCULATED PERFORMANCE SUMMARY VALUES:");
  console.log("Current Health Score:", currentHealthScore + "%");
  console.log("Current Total Issues:", currentTotalIssues);
  console.log("Health Trend:", healthTrend.toFixed(1) + "% (" + healthTrendDirection + ")");
  console.log("Issues Resolved:", issuesResolved);
  console.log("Records Tracked:", recordsTracked);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-100">
      <div className="h-[90vh] overflow-y-auto">
        <div className="p-6 lg:p-8">
          <div className="max-w-[1600px] mx-auto">
            
            {/* Modern Header Section */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Header Title and Description */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                      <History className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
                        Account History
                      </h1>
                      <p className="text-sm text-gray-600 mt-1">
                        Track your account performance and health score trends over time
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-xl">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    <span className="text-sm font-medium text-gray-700">Last Updated: Today</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700">Health Trending Up</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Quick Insights Summary */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-8"
            >
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <Activity className="w-4 h-4 text-white" />
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">Performance Summary</h2>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex items-center gap-3 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-xs text-blue-700 font-medium">Current Health Score</p>
                      <p className="text-lg font-bold text-blue-800">{currentHealthScore}%</p>
                    </div>
                  </div>
                  
                  <div className={`flex items-center gap-3 p-4 bg-gradient-to-br rounded-xl border ${
                    healthTrendDirection === 'up' ? 'from-green-50 to-emerald-50 border-green-200' :
                    healthTrendDirection === 'down' ? 'from-red-50 to-red-50 border-red-200' :
                    'from-gray-50 to-gray-50 border-gray-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      healthTrendDirection === 'up' ? 'bg-green-500' :
                      healthTrendDirection === 'down' ? 'bg-red-500' :
                      'bg-gray-500'
                    }`}>
                      <TrendingUp className={`w-5 h-5 text-white ${healthTrendDirection === 'down' ? 'rotate-180' : ''}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${
                        healthTrendDirection === 'up' ? 'text-green-700' :
                        healthTrendDirection === 'down' ? 'text-red-700' :
                        'text-gray-700'
                      }`}>Health Trend</p>
                      <p className={`text-lg font-bold ${healthTrendDirection === 'up' ? 'text-green-800' : healthTrendDirection === 'down' ? 'text-red-800' : 'text-gray-800'}`}>
                        {healthTrend > 0 ? '+' : ''}{healthTrend.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  
                  <div className={`flex items-center gap-3 p-4 bg-gradient-to-br rounded-xl border ${
                    currentTotalIssues > 0 ? 'from-red-50 to-red-50 border-red-200' : 'from-green-50 to-emerald-50 border-green-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      currentTotalIssues > 0 ? 'bg-red-500' : 'bg-green-500'
                    }`}>
                      {currentTotalIssues > 0 ? (
                        <AlertTriangle className="w-5 h-5 text-white" />
                      ) : (
                        <Target className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${
                        currentTotalIssues > 0 ? 'text-red-700' : 'text-green-700'
                      }`}>Current Total Issues</p>
                      <p className={`text-lg font-bold ${
                        currentTotalIssues > 0 ? 'text-red-800' : 'text-green-800'
                      }`}>{currentTotalIssues}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-4 bg-gradient-to-br from-orange-50 to-orange-50 rounded-xl border border-orange-200">
                    <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                      <History className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-xs text-orange-700 font-medium">Records Tracked</p>
                      <p className="text-lg font-bold text-orange-800">{recordsTracked}</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Enhanced Chart Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-8"
            >
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 pb-0">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <BarChart3 className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Issues Trend Analysis</h3>
                        <p className="text-sm text-gray-600">Track your account health and issues over time</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full"></div>
                        <span className="text-gray-600">Issues Count</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="px-6 pb-6">
                  <Chart />
                </div>
              </div>
            </motion.div>

            {/* Enhanced Table Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mb-8"
            >
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center">
                      <History className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Account Snapshot History</h3>
                      <p className="text-sm text-gray-600">Detailed historical records of your account performance</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <Table />
                </div>
              </div>
            </motion.div>

            {/* Bottom Spacer */}
            <div className='w-full h-8'></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountHistoryPanel;
