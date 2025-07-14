import React from 'react';
import { motion } from 'framer-motion';
import { History, BarChart3 } from 'lucide-react';
import { useSelector } from 'react-redux';
import Table from '../Components/Account/Table.jsx';
import Chart from '../Components/Account/Chart.jsx';

const AccountHistoryPanel = () => {
  const historyInfo = useSelector(state => state.History.HistoryInfo || []);

  console.log("🔍 ACCOUNT HISTORY PAGE DATA:");
  console.log("History Info:", historyInfo);
  console.log("Number of history records:", historyInfo.length);



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
                            <div className="flex flex-col gap-6">
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
              </div>
            </motion.div>



            {/* Enhanced Chart Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
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
              transition={{ duration: 0.6, delay: 0.2 }}
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
