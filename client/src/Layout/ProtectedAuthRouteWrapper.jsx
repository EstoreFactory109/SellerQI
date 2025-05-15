import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

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

  // Show nothing or a loader while auth status is unknown
  if (isAuth === null) {
    return <div>Loading...</div>;
  }

  // If user is authenticated, don't show this page (redirect done)
  if (isAuth === true) {
    return null;
  }

  // Otherwise show the protected children (login/signup pages)
  return children;
};

export default ProtectedAuthRouteWrapper;
