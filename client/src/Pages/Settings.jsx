import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

import Profile from '../Components/settings/UserProfile/Profile.jsx';
import Security from '../Components/settings/Security/Security.jsx';
import Teams from '../Components/settings/Teams/Teams.jsx';
import AccountIntegration from '../Components/settings/AccountIntegrations/AccountIntegrations.jsx';
import PlansAndBilling from '../Components/settings/PlansAndBilling/PlansAndBilling.jsx';

const Settings = () => {
  const [settingOption, setSettingOption] = useState('User-Profile');
  const [prevOption, setPrevOption] = useState('User-Profile');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMobileOrTablet, setIsMobileOrTablet] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const checkDevice = () => {
      setIsMobileOrTablet(window.innerWidth < 1024);
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => {
      window.removeEventListener('resize', checkDevice);
    };
  }, []);

  // Check for URL parameter to directly navigate to specific tab
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'account-integration') {
      setPrevOption(settingOption);
      setSettingOption('Account-Integration');
      setHasInteracted(true);
    }
  }, [searchParams, settingOption]);

  const order = ['User-Profile', 'Security', 'Account-Integration', 'Plans-And-Billing', 'Team-Members'];

  const getDirection = () => {
    return order.indexOf(settingOption) > order.indexOf(prevOption) ? 1 : -1;
  };

  const direction = getDirection();

  const pageVariants = {
    enter: (direction) => ({
      x: direction > 0 ? '100%' : '80vw',
      opacity: 0,
      position: 'absolute',
      width: '100%',
    }),
    center: {
      x: 0,
      opacity: 1,
      position: 'relative',
      width: '100%',
      transition: { duration: 0.5, ease: 'easeInOut' },
    },
    exit: (direction) => ({
      x: direction > 0 ? '-80vw' : '100%',
      opacity: 0,
      position: 'absolute',
      width: '100%',
      transition: { duration: 0.5, ease: 'easeInOut' },
    }),
  };

  const renderComponent = (page) => {
    switch (page) {
      case 'User-Profile':
        return <Profile />;
      // case 'Security':
      //   return <Security />;
      case 'Account-Integration':
        return <AccountIntegration />;
      case 'Plans-And-Billing':
        return <PlansAndBilling />;
      // case 'Team-Members':
      //   return <Teams />;
      default:
        return <Profile />;
    }
  };

  const handleTabClick = (nextPage) => {
    if (nextPage === settingOption) return;
    setPrevOption(settingOption);
    setSettingOption(nextPage);
    setHasInteracted(true);
  };

  return (
    <div className="h-[90vh] bg-[#eeeeee] w-full max-h-[90vh] p-6 lg:mt-0 mt-[8vh] overflow-y-auto">
      <p className="text-sm">SETTINGS</p>

      {/* Tabs with sliding underline */}
      <div className="mt-5">
        <div className="relative flex gap-6 flex-wrap text-sm border-b-2 border-gray-200">
          {['User-Profile', 'Security', 'Account-Integration', 'Plans-And-Billing', 'Team-Members'].map((item) => {
            const isActive = settingOption === item;
            return (
              <div
                key={item}
                className="relative pb-3 cursor-pointer"
                onClick={() => handleTabClick(item)}
              >
                <p
                  style={{
                    color: isActive ? '#333651' : '#000000a0',
                    fontWeight: isActive ? 'bold' : 'normal',
                  }}
                >
                  {{
                    'User-Profile': 'User Profile',
                    // 'Security': 'Security',
                    'Account-Integration': 'Account Integration',
                    'Plans-And-Billing': 'Plans & Billing',
                    // 'Team-Members': 'Invite Team Members',
                  }[item]}
                </p>

                {isActive && (
                  <motion.div
                    layoutId="underline"
                    className="absolute bottom-0 left-0 right-0 h-[4px] bg-[#333651] rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content Area with Pushing Animation */}
      <div className="relative w-full min-h-[400px] overflow-hidden mt-7">
        <AnimatePresence custom={direction} mode="sync">
          <motion.div
            key={settingOption}
            custom={direction}
            variants={pageVariants}
            initial={hasInteracted ? 'enter' : false}
            animate="center"
            exit="exit"
          >
            {renderComponent(settingOption)}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Settings;
