import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import Loader from '../Components/Loader/Loader.jsx';

const ProtectedAuthRouteWrapper = ({ children }) => {
  const [isAuth, setIsAuth] = useState(null); // null = loading, true or false = known
  const [hasRedirected, setHasRedirected] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    // Prevent multiple auth checks
    if (hasCheckedRef.current || hasRedirected) {
      return;
    }
    
    hasCheckedRef.current = true;

    // read from localStorage first
    const localAuth = localStorage.getItem("isAuth");

    if (localAuth === "true") {
      setIsAuth(true);
      // Add small delay and check if we're not already on dashboard route
      if (!location.pathname.includes("/seller-central-checker/dashboard")) {
        setHasRedirected(true);
        setTimeout(() => {
          navigate("/seller-central-checker/dashboard", { replace: true });
        }, 100);
      }
      return;
    } else if (localAuth === "false") {
      setIsAuth(false);
      return;
    }

    // If no info in localStorage, validate backend
    async function validate() {
      try {
        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/profile`,
          { withCredentials: true }
        );
        if (response && response.status === 200) {
          localStorage.setItem("isAuth", "true");
          setIsAuth(true);
          // Check if we're not already on dashboard route to prevent loops
          if (!location.pathname.includes("/seller-central-checker/dashboard")) {
            setHasRedirected(true);
            setTimeout(() => {
              navigate("/seller-central-checker/dashboard", { replace: true });
            }, 100);
          }
        } else {
          localStorage.setItem("isAuth", "false");
          setIsAuth(false);
        }
      } catch (error) {
        console.error("Auth validation error:", error);
        localStorage.setItem("isAuth", "false");
        setIsAuth(false);
      }
    }
    validate();
  }, []); // Remove navigate dependency to prevent re-runs

  // Show loader while auth status is unknown or during redirect
  if (isAuth === null || hasRedirected) {
    return <Loader />;
  }

  // If user is authenticated and already on dashboard route, don't redirect again
  if (isAuth === true && location.pathname.includes("/seller-central-checker/dashboard")) {
    return null;
  }

  // If user is authenticated but not yet redirected, show loader
  if (isAuth === true) {
    return <Loader />;
  }

  // Otherwise show the protected children (login/signup pages)
  return children;
};

export default ProtectedAuthRouteWrapper;
