import React from 'react';
import { useSearchParams } from 'react-router-dom';
import AgencyProfile from '../../Components/Agency/AgencyProfile.jsx';
import AgencyPassword from '../../Components/Agency/AgencyPassword.jsx';
import Support from '../../Components/settings/Support/Support.jsx';

const AgencySettings = () => {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'profile';

  const renderContent = () => {
    switch (currentTab) {
      case 'profile':
        return <AgencyProfile />;
      case 'password':
        return <AgencyPassword />;
      case 'support':
        return <Support consultationPath="/manage-agency-users/consultation" />;
      default:
        return <AgencyProfile />;
    }
  };

  return (
    <div className="h-[90vh] w-full max-h-[90vh] p-4 lg:mt-0 mt-[8vh] overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
      <div className="w-full mt-4">
        {renderContent()}
      </div>
    </div>
  );
};

export default AgencySettings;
