import React from "react";
import Category from "../Components/Issues_pages/Category.jsx";
import Products from "../Components/Issues_pages/Products.jsx";
import Account from "../Components/Issues_pages/Account.jsx";
import { AlertTriangle } from 'lucide-react';
import { useSearchParams } from "react-router-dom";

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
    <div className="min-h-screen bg-[#1a1a1a]">
      {/* Modern Header Section */}
      <div className='bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40'>
        <div className='px-2 lg:px-3 py-1.5'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <div>
                <h1 className='text-lg font-bold text-gray-100'>
                  {currentTab === 'account' ? 'Account Issues' : 'Issues'}
                </h1>
                <p className='text-xs text-gray-400 mt-0.5'>
                  {currentTab === 'account' 
                    ? 'Monitor and resolve account health issues and policy violations' 
                    : 'Monitor and resolve product issues across your Amazon catalog'}
                </p>
              </div>
              <div className='hidden sm:flex items-center gap-1 px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs font-medium border border-orange-500/30'>
                <AlertTriangle className='w-3 h-3' />
                Issues detected
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
