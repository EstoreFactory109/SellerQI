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
    <div className="min-h-screen bg-gray-50/50">
      {/* Modern Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>
                  {currentTab === 'account' ? 'Account Issues' : 'Issues'}
                </h1>
                <p className='text-sm text-gray-600 mt-1'>
                  {currentTab === 'account' 
                    ? 'Monitor and resolve account health issues and policy violations' 
                    : 'Monitor and resolve product issues across your Amazon catalog'}
                </p>
              </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium'>
                <AlertTriangle className='w-2 h-2' />
                Issues detected
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          {renderComponent()}
        </div>
      </div>
    </div>
  );
}
