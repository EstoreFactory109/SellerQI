import React from 'react';
import { motion } from 'framer-motion';
import { History, BarChart3 } from 'lucide-react';
import { useSelector } from 'react-redux';
import Table from '../Components/Account/Table.jsx';
import Chart from '../Components/Account/Chart.jsx';
import { useAccountHistoryData } from '../hooks/usePageData.js';
import { SkeletonChart, SkeletonTableBody } from '../Components/Skeleton/PageSkeletons.jsx';

const AccountHistoryPanel = () => {
  // Fetch account history data using the hook (automatically fetches on mount)
  const { data: accountHistoryPageData, loading: accountHistoryLoading, refetch: refetchAccountHistory } = useAccountHistoryData();
  
  // Use page-wise data if available, fall back to legacy HistorySlice
  const legacyHistoryInfo = useSelector(state => state.History.HistoryInfo || []);
  const historyInfo = accountHistoryPageData?.accountHistory || legacyHistoryInfo;

  console.log("🔍 ACCOUNT HISTORY PAGE DATA:");
  console.log("History Info:", historyInfo);
  console.log("Number of history records:", historyInfo.length);
  console.log("Account history loading:", accountHistoryLoading);



  return (
    <div className="min-h-screen" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          style={{ marginBottom: '10px' }}
        >
          <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>
              Account History
            </h1>
          </div>
        </motion.div>

        {/* Chart Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{ marginBottom: '10px' }}
        >
          <div style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #30363d' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" style={{ color: '#60a5fa' }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Issues Trend Analysis</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#3b82f6' }}></div>
                  <span className="text-xs" style={{ color: '#9ca3af' }}>Issues Count</span>
                </div>
              </div>
            </div>
            <div style={{ padding: '8px 12px' }}>
              {accountHistoryLoading ? <SkeletonChart height={256} /> : <Chart />}
            </div>
          </div>
        </motion.div>

        {/* Table Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          style={{ marginBottom: '10px' }}
        >
          <div style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #30363d' }}>
              <div className="flex items-center gap-2">
                <History className="w-4 h-4" style={{ color: '#60a5fa' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Account Snapshot History</h3>
              </div>
            </div>
            <div style={{ padding: '8px 12px' }}>
              {accountHistoryLoading ? <SkeletonTableBody rows={6} /> : <Table />}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AccountHistoryPanel;
