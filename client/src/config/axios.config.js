import axios from 'axios';

// Create axios instance
const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_BASE_URI,
  withCredentials: true,
});

export const SESSION_EXPIRED_KEY = 'sessionExpiredMessage';
const SESSION_EXPIRED_MESSAGE = 'Your session expired — please sign in again.';

// A failed refresh means the session is gone. The raw server error ("Refresh
// token is missing" / "Invalid or expired refresh token") is plumbing detail that
// dozens of components render straight into the UI, so replace it with copy that
// makes sense to a user. Rejecting a same-shaped error means every one of those
// call sites is covered without being edited.
const sessionExpiredError = (cause) => {
  const err = new Error(SESSION_EXPIRED_MESSAGE);
  err.isSessionExpired = true;
  err.config = cause?.config;
  err.response = {
    ...(cause?.response || {}),
    status: 401,
    data: { statusCode: 401, data: '', message: SESSION_EXPIRED_MESSAGE },
  };
  return err;
};

// The redirect below is a full page load, which destroys React state, so the
// message is handed to the login screen through sessionStorage instead.
const signOutLocally = () => {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, SESSION_EXPIRED_MESSAGE);
  } catch {
    /* private mode — the redirect still happens, just without the explanation */
  }
  localStorage.removeItem('isAuth');
  localStorage.removeItem('userAccessType');
};

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

    // Auth endpoints answer 401 as a real result (not-verified / bad-password / bad-OTP).
    // Refreshing would discard that answer, so let it reach the caller.
    const isAuthRequest = ['/app/login', '/app/auth/admin-login', '/app/register',
                           '/app/verify-user', '/app/resend-otp']
      .some(path => requestUrl.includes(path));

    // Check if we're on pages that handle their own auth errors
    const isFromConnectAccounts = currentPath.includes('/connect-accounts') || 
                                  currentPath.includes('/connect-to-amazon') ||
                                  currentPath.includes('/auth/callback') ||
                                  currentPath.startsWith('/agency/') ||
                                  currentPath.startsWith('/manage-agency');
    
    // Handle 401 Unauthorized errors - try to refresh token first
    if (statusCode === 401 && !isLogoutRequest && !isFromConnectAccounts && !isRefreshRequest && !isAuthRequest && !originalRequest._retry) {
      
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
        const expired = sessionExpiredError(refreshError);
        processQueue(expired);
        isRefreshing = false;

        // The session is gone regardless of which surface noticed, so always
        // clear local auth state before deciding where to send the user.
        signOutLocally();

        // Agency routes: redirect to agency-login instead of regular login
        const adminAccessType = localStorage.getItem('adminAccessType');
        const isAgencyRoute = currentPath.startsWith('/agency/') || currentPath.startsWith('/manage-agency');
        if (isAgencyRoute || adminAccessType === 'enterpriseAdmin') {
          if (currentPath !== '/agency-login') {
            window.location.href = '/agency-login';
          }
          return Promise.reject(expired);
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
          return Promise.reject(expired);
        }

        // Redirect to login only if we're not already on it
        if (currentPath !== '/') {
          window.location.href = '/';
        }

        return Promise.reject(expired);
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