import { useState, useEffect } from 'react';
import { isDeviceSupported, getDeviceType, isMobileDevice, isTabletDevice, isDesktopDevice } from '../utils/deviceDetection';

/**
 * Custom React hook for device detection
 * 
 * Provides reactive device type detection that updates on window resize
 * and orientation changes
 * 
 * @returns {Object} Device detection state and utilities
 */
export const useDeviceDetection = () => {
  const [deviceType, setDeviceType] = useState(getDeviceType());
  const [isSupported, setIsSupported] = useState(isDeviceSupported());
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  const [isTablet, setIsTablet] = useState(isTabletDevice());
  const [isDesktop, setIsDesktop] = useState(isDesktopDevice());

  useEffect(() => {
    const updateDeviceInfo = () => {
      const newDeviceType = getDeviceType();
      const newIsSupported = isDeviceSupported();
      const newIsMobile = isMobileDevice();
      const newIsTablet = isTabletDevice();
      const newIsDesktop = isDesktopDevice();

      setDeviceType(newDeviceType);
      setIsSupported(newIsSupported);
      setIsMobile(newIsMobile);
      setIsTablet(newIsTablet);
      setIsDesktop(newIsDesktop);
    };

    // Initial update
    updateDeviceInfo();

    // Add event listeners for device changes
    window.addEventListener('resize', updateDeviceInfo);
    window.addEventListener('orientationchange', updateDeviceInfo);

    // Cleanup
    return () => {
      window.removeEventListener('resize', updateDeviceInfo);
      window.removeEventListener('orientationchange', updateDeviceInfo);
    };
  }, []);

  return {
    deviceType,
    isSupported,
    isMobile,
    isTablet,
    isDesktop,
    // Utility functions
    refresh: () => {
      setDeviceType(getDeviceType());
      setIsSupported(isDeviceSupported());
      setIsMobile(isMobileDevice());
      setIsTablet(isTabletDevice());
      setIsDesktop(isDesktopDevice());
    }
  };
};

export default useDeviceDetection; 