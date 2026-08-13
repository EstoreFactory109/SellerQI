import React from "react";
import Category from "../../Components/Issues_pages/Category.jsx";
import Products from "../../Components/Issues_pages/Products.jsx";
import Account from "../../Components/Issues_pages/Account.jsx";
import { AlertTriangle } from 'lucide-react';
import { useSearchParams } from "react-router-dom";
import { COLORS } from "../../Components/Shared/index.js";

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'category';

  const renderComponent = () => {
    switch (currentTab) {
      case "category":
        return <Category />;
      case "account":
        return <Account />;
      default:
        return <Category />;
    }
  };

  return (
    <div className="min-h-screen" style={{ background: COLORS.bgBase }}>
      {/* Header Section */}
      <div className='sticky top-0 z-40' style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        <div className='px-2 lg:px-3 py-1.5'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <div>
                <h1 className='m-0 text-2xl leading-8 font-semibold tracking-[-0.02em]' style={{ color: COLORS.textPrimary }}>
                  {currentTab === 'account' ? 'Account Issues' : 'Issues'}
                </h1>
                <p className='m-0 mt-1 text-sm' style={{ color: COLORS.textSecondary }}>
                  {currentTab === 'account'
                    ? 'Monitor and resolve account health issues and policy violations'
                    : 'Monitor and resolve product issues across your Amazon catalog'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 72px)', scrollBehavior: 'smooth' }}>
        <div className='px-2 lg:px-3 py-1.5 pb-1'>
          {renderComponent()}
        </div>
      </div>
    </div>
  );
}
