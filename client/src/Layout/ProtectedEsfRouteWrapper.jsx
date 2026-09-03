import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { EsfUserContext } from '../contexts/EsfUserContext.js';

/**
 * Route guard for the ESF staff portal.
 *
 * Unlike the agency and admin layouts (which only read localStorage), this
 * verifies the session against the server via GET /app/esf/me, so a stale
 * localStorage flag cannot render the portal.
 */
const ProtectedEsfRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const isMountedRef = useRef(true);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const verify = async () => {
      try {
        const res = await axiosInstance.get('/app/esf/me');
        if (!isMountedRef.current) return;

        if (res.data?.statusCode === 200 && res.data?.data) {
          setUser(res.data.data);
          localStorage.setItem('isEsfAuth', 'true');
          setChecking(false);
        } else {
          localStorage.removeItem('isEsfAuth');
          navigate('/esf-login', { replace: true });
        }
      } catch (_) {
        if (!isMountedRef.current) return;
        localStorage.removeItem('isEsfAuth');
        navigate('/esf-login', { replace: true });
      }
    };

    verify();
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-sm text-gray-400">Verifying access…</p>
        </div>
      </div>
    );
  }

  return <EsfUserContext.Provider value={user}>{children}</EsfUserContext.Provider>;
};

export default ProtectedEsfRouteWrapper;
