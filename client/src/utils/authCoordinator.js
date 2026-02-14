// Global auth coordination to prevent multiple simultaneous auth checks
import axiosInstance from '../config/axios.config.js';

// Global state for auth coordination
let globalAuthState = {
  isChecking: false,
  lastCheckResult: null,
  lastCheckTime: 0,
  authPromise: null
};

// Cache duration - 30 seconds
const CACHE_DURATION = 30 * 1000;

/**
 * Coordinated auth check that prevents multiple simultaneous calls
 * @returns {Promise<{isAuthenticated: boolean, user: any, fromCache: boolean}>}
 */
export const coordinatedAuthCheck = async () => {
  const now = Date.now();
  
  // Return cached result if recent enough
  if (globalAuthState.lastCheckResult && 
      (now - globalAuthState.lastCheckTime) < CACHE_DURATION) {
    return {
      ...globalAuthState.lastCheckResult,
      fromCache: true
    };
  }
  
  // If there's already an auth check in progress, wait for it
  if (globalAuthState.authPromise) {
    try {
      const result = await globalAuthState.authPromise;
      return {
        ...result,
        fromCache: false
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Create new auth check promise
  globalAuthState.isChecking = true;
  globalAuthState.authPromise = performAuthCheck();
  
  try {
    const result = await globalAuthState.authPromise;
    
    // Cache the result
    globalAuthState.lastCheckResult = result;
    globalAuthState.lastCheckTime = now;
    
    return {
      ...result,
      fromCache: false
    };
  } catch (error) {
    // Cache failed result briefly to prevent immediate retries
    globalAuthState.lastCheckResult = { isAuthenticated: false, user: null };
    globalAuthState.lastCheckTime = now;
    throw error;
  } finally {
    globalAuthState.isChecking = false;
    globalAuthState.authPromise = null;
  }
};

/**
 * Performs the actual auth check API call
 * @returns {Promise<{isAuthenticated: boolean, user: any}>}
 */
const performAuthCheck = async () => {
  try {
    const response = await axiosInstance.get('/app/profile');
    
    if (response?.status === 200 && response.data?.data) {
      const userData = response.data.data;
      localStorage.setItem("isAuth", "true");
      return { isAuthenticated: true, user: userData };
    } else {
      localStorage.removeItem("isAuth");
      return { isAuthenticated: false, user: null };
    }
  } catch (error) {
    console.error("❌ Auth check failed:", error);
    localStorage.removeItem("isAuth");
    return { isAuthenticated: false, user: null };
  }
};

/**
 * Clear cached auth state (useful after logout)
 */
export const clearAuthCache = () => {
  globalAuthState.lastCheckResult = null;
  globalAuthState.lastCheckTime = 0;
  globalAuthState.authPromise = null;
  globalAuthState.isChecking = false;
  // Also clear user access type used for super admin redirect
  localStorage.removeItem('userAccessType');
};

/**
 * Check if auth check is currently in progress
 */
export const isAuthCheckInProgress = () => {
  return globalAuthState.isChecking;
};