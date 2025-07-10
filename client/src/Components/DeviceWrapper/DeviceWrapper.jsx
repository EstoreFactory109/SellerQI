import React, { useEffect } from 'react';
import { useDeviceDetection } from '../../hooks/useDeviceDetection';
import MobileRestriction from '../MobileRestriction/MobileRestriction';

const DeviceWrapper = ({ children }) => {
  const { deviceType, isSupported, isMobile, isTablet, isDesktop } = useDeviceDetection();

  // Log device info for debugging (can be removed in production)
  useEffect(() => {
    console.log(`Device Type: ${deviceType} | Supported: ${isSupported} | Mobile: ${isMobile} | Tablet: ${isTablet} | Desktop: ${isDesktop}`);
  }, [deviceType, isSupported, isMobile, isTablet, isDesktop]);

  // If device is not supported (mobile), show restriction page
  if (!isSupported) {
    return <MobileRestriction />;
  }

  // If device is supported (desktop/tablet), show the main application
  return children;
};

export default DeviceWrapper; 