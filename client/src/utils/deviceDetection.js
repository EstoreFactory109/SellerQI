/**
 * Device Detection Utility
 * 
 * Provides functions to detect mobile devices and screen sizes
 * Used to show mobile restriction page when needed
 */

/**
 * Check if the current device is mobile based on screen width and user agent
 * @returns {boolean} True if mobile device, false otherwise
 */
export const isMobileDevice = () => {
  // Check screen width (mobile typically < 768px)
  const isMobileWidth = window.innerWidth < 768;
  
  // Check user agent for mobile indicators
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = [
    'mobile', 'iphone', 'ipod', 'android', 'blackberry', 
    'windows phone', 'opera mini', 'iemobile'
  ];
  
  const isMobileUserAgent = mobileKeywords.some(keyword => 
    userAgent.includes(keyword)
  );
  
  // Return true if either condition is met
  return isMobileWidth || isMobileUserAgent;
};

/**
 * Check if the current device is tablet based on screen width
 * @returns {boolean} True if tablet device, false otherwise
 */
export const isTabletDevice = () => {
  const width = window.innerWidth;
  return width >= 768 && width <= 1024;
};

/**
 * Check if the current device is desktop
 * @returns {boolean} True if desktop device, false otherwise
 */
export const isDesktopDevice = () => {
  return window.innerWidth > 1024;
};

/**
 * Get the current device type
 * @returns {string} 'mobile', 'tablet', or 'desktop'
 */
export const getDeviceType = () => {
  if (isMobileDevice()) return 'mobile';
  if (isTabletDevice()) return 'tablet';
  return 'desktop';
};

/**
 * Check if the device supports the application (desktop or tablet)
 * @returns {boolean} True if device is supported, false if mobile
 */
export const isDeviceSupported = () => {
  return !isMobileDevice();
};

/**
 * Hook to listen for window resize and update device detection
 * @param {Function} callback Function to call when device type changes
 */
export const useDeviceDetection = (callback) => {
  const handleResize = () => {
    if (callback) {
      callback(getDeviceType());
    }
  };

  window.addEventListener('resize', handleResize);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('resize', handleResize);
  };
}; 