import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

import Profile from '../Components/settings/UserProfile/Profile.jsx';
import Security from '../Components/settings/Security/Security.jsx';
import Teams from '../Components/settings/Teams/Teams.jsx';
import AccountIntegration from '../Components/settings/AccountIntegrations/AccountIntegrations.jsx';
import PlansAndBilling from '../Components/settings/PlansAndBilling/PlansAndBilling.jsx';
import Support from '../Components/settings/Support/Support.jsx';

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
      default:
        return <Profile />;
    }
  };

  return (
    <div className="h-[90vh] bg-[#eeeeee] w-full max-h-[90vh] p-6 lg:mt-0 mt-[8vh] overflow-y-auto">
      <p className="text-sm font-medium">SETTINGS</p>

      {/* Content Area */}
      <div className="w-full mt-7">
        {renderComponent()}
      </div>
    </div>
  );
};

export default Settings;
