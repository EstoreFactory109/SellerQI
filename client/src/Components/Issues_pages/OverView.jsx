import React from 'react'
import IssuesSummary from "../issues/IssuesSummery.jsx";
import TrafficStats from "../issues/TrafficStats.jsx";
import ProductTable from "../issues/ProductTable.jsx";

const OverView = () => {
  return (
    <div >
      <div className="flex  lg:flex-row gap-4 mb-4">
        <IssuesSummary />
      
      </div>
      <ProductTable />
    </div>
  )
}

export default OverView