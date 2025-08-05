import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Loader from '../Components/Loader/Loader.jsx';
import { coordinatedAuthCheck } from '../utils/authCoordinator.js';

const ProtectedAuthRouteWrapper = ({ children }) => {
  const [isAuth, setIsAuth] = useState(null); // null = loading, true or false = known
  const navigate = useNavigate();

  useEffect(() => {
    // read from localStorage first
    const localAuth = localStorage.getItem("isAuth");

    if (localAuth === "true") {
      setIsAuth(true);
      navigate("/seller-central-checker/dashboard");
      return;
    } else if (localAuth === "false") {
      setIsAuth(false);
      return;
    }

    // If no info in localStorage, validate backend using coordinated auth check
    async function validate() {
      try {
        const result = await coordinatedAuthCheck();
        if (result.isAuthenticated) {
          localStorage.setItem("isAuth", "true");
          setIsAuth(true);
          navigate("/seller-central-checker/dashboard");
        } else {
          localStorage.setItem("isAuth", "false");
          setIsAuth(false);
        }
      } catch (error) {
        localStorage.setItem("isAuth", "false");
        setIsAuth(false);
      }
    }
    validate();
  }, [navigate]);

  // Show loader while auth status is unknown
  if (isAuth === null) {
    return <Loader />;
  }

  // If user is authenticated, don't show this page (redirect done)
  if (isAuth === true) {
    return null;
  }

  // Otherwise show the protected children (login/signup pages)
  return children;
};

export default ProtectedAuthRouteWrapper;
