import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import axiosInstance from '../config/axios.config.js';
import { clearCogsData } from '../redux/slices/cogsSlice.js';
import { coordinatedAuthCheck, clearAuthCache } from '../utils/authCoordinator.js';

export const useAuth = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const checkAuth = useCallback(async () => {
    try {
      const result = await coordinatedAuthCheck();
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
      clearAuthCache(); // Clear the coordinated auth cache
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
  }, []); // Fixed: Remove checkAuth from dependency array to prevent infinite loops

  return {
    isLoading,
    isAuthenticated,
    user,
    checkAuth,
    logout
  };
}; 