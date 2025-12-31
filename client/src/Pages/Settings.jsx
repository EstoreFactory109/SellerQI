import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

import Profile from '../Components/settings/UserProfile/Profile.jsx';
import Security from '../Components/settings/Security/Security.jsx';
import Teams from '../Components/settings/Teams/Teams.jsx';
import AccountIntegration from '../Components/settings/AccountIntegrations/AccountIntegrations.jsx';
import PlansAndBilling from '../Components/settings/PlansAndBilling/PlansAndBilling.jsx';
import Support from '../Components/settings/Support/Support.jsx';

// Admin Components
import AdminUserProfile from '../Components/settings/Admin/AdminUserProfile.jsx';

import AdminAccountIntegrations from '../Components/settings/Admin/AdminAccountIntegrations.jsx';
import AdminPlansAndBilling from '../Components/settings/Admin/AdminPlansAndBilling.jsx';
import AdminSupport from '../Components/settings/Admin/AdminSupport.jsx';

const Settings = () => {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'profile';

  const renderComponent = () => {
    switch (currentTab) {
      case 'profile':
        return <Profile />;
      case 'security':
        return <Security />;
      case 'account-integration':
        return <AccountIntegration />;
      case 'plans-billing':
        return <PlansAndBilling />;
      case 'teams':
        return <Teams />;
      case 'support':
        return <Support />;
      
      // Admin tabs
              case 'admin-user-profile':
            return <AdminUserProfile />;
        case 'admin-account-integration':
            return <AdminAccountIntegrations />;
        case 'admin-plans-billing':
            return <AdminPlansAndBilling />;
        case 'admin-support':
            return <AdminSupport />;
      
      default:
        return <Profile />;
    }
  };

  return (
    <div className="h-[90vh] bg-[#eeeeee] w-full max-h-[90vh] p-6 lg:mt-0 mt-[8vh] overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Content Area */}
      <div className="w-full mt-7">
        {renderComponent()}
      </div>
    </div>
  );
};

export default Settings;
