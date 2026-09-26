import React from 'react';
import { useSearchParams } from 'react-router-dom';
import EsfProfile from '../../Components/ESF/EsfProfile.jsx';
import EsfPassword from '../../Components/ESF/EsfPassword.jsx';
import Support from '../../Components/settings/Support/Support.jsx';
import { useEsfUser } from '../../contexts/EsfUserContext.js';

const EsfSettings = () => {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'profile';
  // Only the owner has a password; admins and members sign in by emailed link.
  const canChangePassword = useEsfUser()?.isOwner === true;

  const renderContent = () => {
    switch (currentTab) {
      case 'profile':
        return <EsfProfile />;
      case 'password':
        return canChangePassword ? <EsfPassword /> : <EsfProfile />;
      case 'support':
        return <Support />;
      default:
        return <EsfProfile />;
    }
  };

  return (
    <div className="h-[90vh] w-full max-h-[90vh] p-4 lg:mt-0 mt-[8vh] overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
      <div className="w-full mt-4">{renderContent()}</div>
    </div>
  );
};

export default EsfSettings;
