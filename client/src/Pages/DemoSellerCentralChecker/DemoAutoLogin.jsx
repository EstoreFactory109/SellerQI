import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../../redux/slices/authSlice.js';
import axiosInstance from '../../config/axios.config.js';
import Loader from '../../Components/Loader/Loader.jsx';

const DemoAutoLogin = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const login = async () => {
      try {
        const res = await axiosInstance.post('/app/demo/login', {}, { withCredentials: true });

        if (cancelled) return;

        if (res.status === 200 && res.data?.data) {
          const userData = res.data.data;
          localStorage.setItem('sellerqi_demo_mode', 'true');
          dispatch(loginSuccess(userData));
          navigate('/seller-central-checker-demo/dashboard', { replace: true });
        } else {
          setError('Unexpected response from demo login.');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err.response?.data?.message || err.message || 'Demo login failed';
        setError(msg);
      }
    };

    login();
    return () => { cancelled = true; };
  }, [dispatch, navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
        <div className="text-center p-8 bg-[#161b22] border border-[#30363d] rounded-lg max-w-md">
          <h2 className="text-lg font-bold text-red-400 mb-2">Demo Login Failed</h2>
          <p className="text-sm text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => { setError(null); window.location.reload(); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      <Loader />
    </div>
  );
};

export default DemoAutoLogin;
