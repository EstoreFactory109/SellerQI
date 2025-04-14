import React from 'react';
import Table from '../Components/Account/Table.jsx';
import Chart from '../Components/Account/Chart.jsx';

const AccountHistoryPanel = () => {
  return (
    <div className="p-6 bg-gray-100 h-[90vh] overflow-auto">
      {/* ACCOUNT HISTORY Section */}
      <div className="bg-white p-6 rounded-2xl shadow mb-8">
        <Chart />
      </div>

      {/* ACCOUNT SNAPSHOT HISTORY Section */}
      <Table/>
    </div>
  );
};

export default AccountHistoryPanel;