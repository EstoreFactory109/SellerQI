import axios from 'axios';

// Create axios instance
const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_BASE_URI,
  withCredentials: true,

});

// Request interceptor
axiosInstance.interceptors.request.use(
  (config) => {
    // Add any request modifications here if needed
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const errorMessage = error.response?.data?.message || error.response?.data?.error || '';
    const statusCode = error.response?.status;
    const currentPath = window.location.pathname;
    const requestUrl = error.config?.url || '';
    
    // Skip redirects for logout calls - let them handle their own navigation
    const isLogoutRequest = requestUrl.includes('/app/logout') || requestUrl.includes('/logout');
    
    // Check if we're already on connect-accounts page
    const isFromConnectAccounts = currentPath.includes('/connect-accounts') || 
                                  currentPath.includes('/connect-to-amazon');
    
    // Handle 401 Unauthorized errors - only for actual auth failures
    // NOT for seller account errors (those are handled by ProtectedRouteWrapper)
    if (statusCode === 401 && !isLogoutRequest && !isFromConnectAccounts) {
      // Clear auth data and redirect to login
      localStorage.removeItem("isAuth");
      
      // Redirect to login only if we're not already on the login page
      if (currentPath !== '/' && !currentPath.includes('/log-in')) {
        window.location.href = '/';
      }
    }
    
    // Handle network errors
    if (!error.response && error.code === 'ECONNABORTED') {
      console.error('Request timeout');
    }
    
    return Promise.reject(error);
  }
);

export default axiosInstance; 