import React from 'react';
import Table from '../Components/Account/Table.jsx';
import Chart from '../Components/Account/Chart.jsx';

const AccountHistoryPanel = () => {
  return (
    <div className="p-6 bg-gray-100 h-[90vh] overflow-y-auto">
      {/* Fixed Chart Section */}
      <div className="bg-white p-6 rounded-2xl shadow mb-4">
        <Chart />
      </div>

      {/* Table Section */}
      <div className="bg-white p-6 rounded-2xl shadow mb-4">
        <Table />
      </div>

      {/* Bottom spacer to ensure pagination never gets clipped */}
      <div className="h-1" />
    </div>
  );
};

export default AccountHistoryPanel;
