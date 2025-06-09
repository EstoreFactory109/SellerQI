import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import axiosInstance from '../config/axios.config.js';
import { clearCogsData } from '../redux/slices/cogsSlice.js';

// Global auth state to prevent multiple simultaneous checks
let authCheckPromise = null;

export const useAuth = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const checkAuth = useCallback(async () => {
    // If there's already an auth check in progress, wait for it
    if (authCheckPromise) {
      try {
        const result = await authCheckPromise;
        setIsAuthenticated(result.isAuthenticated);
        setUser(result.user);
        setIsLoading(false);
        return result;
      } catch (error) {
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
        throw error;
      }
    }

    // Create a new auth check promise
    authCheckPromise = (async () => {
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
      } finally {
        // Clear the promise after completion
        authCheckPromise = null;
      }
    })();

    try {
      const result = await authCheckPromise;
      setIsAuthenticated(result.isAuthenticated);
      setUser(result.user);
      setIsLoading(false);
      return result;
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      setIsLoading(false);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await axiosInstance.post('/app/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem("isAuth");
      dispatch(clearCogsData());
      setIsAuthenticated(false);
      setUser(null);
      navigate('/');
    }
  }, [navigate, dispatch]);

  useEffect(() => {
    // Quick check for existing auth status in localStorage
    const storedAuth = localStorage.getItem("isAuth");
    if (!storedAuth) {
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    // Perform actual auth check
    checkAuth();
  }, [checkAuth]);

  return {
    isLoading,
    isAuthenticated,
    user,
    checkAuth,
    logout
  };
}; 