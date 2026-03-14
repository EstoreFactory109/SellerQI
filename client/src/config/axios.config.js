import axios from 'axios';

// Create axios instance
const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_BASE_URI,
  withCredentials: true,
});

// Track if we're currently refreshing the token to avoid infinite loops
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

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
  async (error) => {
    const originalRequest = error.config;
    const statusCode = error.response?.status;
    const currentPath = window.location.pathname;
    const requestUrl = error.config?.url || '';
    
    // Skip redirects for logout calls - let them handle their own navigation
    const isLogoutRequest = requestUrl.includes('/app/logout') || requestUrl.includes('/logout');
    
    // Skip refresh for refresh-token endpoint to avoid infinite loop
    const isRefreshRequest = requestUrl.includes('/app/refresh-token');
    
    // Check if we're on pages that handle their own auth errors
    const isFromConnectAccounts = currentPath.includes('/connect-accounts') || 
                                  currentPath.includes('/connect-to-amazon') ||
                                  currentPath.includes('/auth/callback') ||
                                  currentPath.startsWith('/agency/') ||
                                  currentPath.startsWith('/manage-agency');
    
    // Handle 401 Unauthorized errors - try to refresh token first
    if (statusCode === 401 && !isLogoutRequest && !isFromConnectAccounts && !isRefreshRequest && !originalRequest._retry) {
      
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => {
          return axiosInstance(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }
      
      originalRequest._retry = true;
      isRefreshing = true;
      
      try {
        // Try to refresh the access token
        await axios.post(
          `${import.meta.env.VITE_BASE_URI}/app/refresh-token`,
          {},
          { withCredentials: true }
        );
        
        processQueue(null);
        isRefreshing = false;
        
        // Retry the original request
        return axiosInstance(originalRequest);
        
      } catch (refreshError) {
        processQueue(refreshError);
        isRefreshing = false;

        // Agency routes: redirect to agency-login instead of regular login
        const isAgencyRoute = currentPath.startsWith('/agency/') || currentPath.startsWith('/manage-agency');
        if (isAgencyRoute) {
          if (currentPath !== '/agency-login') {
            window.location.href = '/agency-login';
          }
          return Promise.reject(refreshError);
        }

        // If this was an admin route, clear admin auth and redirect to admin login to avoid redirect loop
        const isAdminRoute = currentPath.startsWith('/manage-accounts') || requestUrl.includes('/admin/');
        if (isAdminRoute) {
          localStorage.removeItem('isAdminAuth');
          localStorage.removeItem('adminAccessType');
          localStorage.removeItem('adminId');
          if (currentPath !== '/admin-login') {
            window.location.href = '/admin-login';
          }
          return Promise.reject(refreshError);
        }

        // Refresh failed - clear auth and redirect to login
        // But NOT for agency users — they should go to /agency-login
        const adminAccessType = localStorage.getItem('adminAccessType');
        if (adminAccessType === 'enterpriseAdmin') {
          window.location.href = '/agency-login';
          return Promise.reject(refreshError);
        }

        localStorage.removeItem("isAuth");

        // Redirect to login only if we're not already on the login page
        if (currentPath !== '/' && !currentPath.includes('/log-in')) {
          window.location.href = '/';
        }

        return Promise.reject(refreshError);
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