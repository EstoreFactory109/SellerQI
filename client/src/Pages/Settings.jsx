import React, { useState } from 'react';

import Profile from '../Components/settings/UserProfile/Profile.jsx';
import Security from '../Components/settings/Security/Security.jsx';
import Teams from '../Components/settings/Teams/Teams.jsx';
import AccountIntegration from '../Components/settings/AccountIntegrations/AccountIntegrations.jsx';

const Settings = () => {
  const [settingOption, setSettingOption] = useState('User-Profile');

  return (
    <div className="bg-[#eeeeee] w-full min-h-[90vh] p-6 lg:mt-0 mt-[8vh]">
      <p className="text-sm">SETTINGS</p>

      <div className="mt-5">
        <div className="flex gap-4 flex-wrap text-sm">
          <p
            className="pb-3 cursor-pointer"
            onClick={() => setSettingOption('User-Profile')}
            style={settingOption === 'User-Profile' ?
              { color: "#333651", borderBottom: "4px solid #333651", fontWeight: "bold" } : {}}
          >
            User Profile
          </p>

          <p
            className="pb-3 cursor-pointer"
            onClick={() => setSettingOption('Security')}
            style={settingOption === 'Security' ?
              { color: "#333651", borderBottom: "4px solid #333651", fontWeight: "bold" } : {}}
          >
            Security
          </p>

          <p
            className="pb-3 cursor-pointer"
            onClick={() => setSettingOption('Account-Integration')}
            style={settingOption === 'Account-Integration' ?
              { color: "#333651", borderBottom: "4px solid #333651", fontWeight: "bold" } : {}}
          >
            Account Integration
          </p>

          <p
            className="pb-3 cursor-pointer"
            onClick={() => setSettingOption('Team-Members')}
            style={settingOption === 'Team-Members' ?
              { color: "#333651", borderBottom: "4px solid #333651", fontWeight: "bold" } : {}}
          >
            Invite Team Members
          </p>
        </div>
        <hr className="w-full h-[2px] bg-gray-200" />
      </div>
      <div className='mt-7'>
        {(() => {
          switch (settingOption) {
            case 'User-Profile':
              return <Profile />;
            case 'Security':
              return <Security />;
            case 'Account-Integration':
              return <AccountIntegration />;
            case 'Team-Members':
              return <Teams />;
            default:
              return <Profile />;
          }
        })()}
      </div>

    </div>
  );
};

export default Settings;
