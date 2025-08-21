import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Clock, Crown, X } from 'lucide-react';

const TrialBanner = () => {
  const user = useSelector((state) => state.Auth.user);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (user?.isInTrialPeriod && user?.trialEndsDate) {
      const calculateTimeLeft = () => {
        const now = new Date();
        const trialEnd = new Date(user.trialEndsDate);
        const difference = trialEnd - now;

        if (difference > 0) {
          const days = Math.floor(difference / (1000 * 60 * 60 * 24));
          const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));

          if (days > 0) {
            setTimeLeft(`${days} day${days > 1 ? 's' : ''}, ${hours} hour${hours > 1 ? 's' : ''}`);
          } else if (hours > 0) {
            setTimeLeft(`${hours} hour${hours > 1 ? 's' : ''}, ${minutes} minute${minutes > 1 ? 's' : ''}`);
          } else {
            setTimeLeft(`${minutes} minute${minutes > 1 ? 's' : ''}`);
          }
        } else {
          setTimeLeft('Expired');
        }
      };

      calculateTimeLeft();
      const interval = setInterval(calculateTimeLeft, 60000); // Update every minute

      return () => clearInterval(interval);
    }
  }, [user?.trialEndsDate, user?.isInTrialPeriod]);

  const handleUpgrade = () => {
    navigate('/seller-central-checker/settings?tab=plans-billing');
  };

  // Don't show banner if user is not in trial period, trial has expired, or banner is dismissed
  if (!user?.isInTrialPeriod || dismissed || !user?.trialEndsDate) {
    return null;
  }

  const trialEnd = new Date(user.trialEndsDate);
  const now = new Date();
  const isExpired = now >= trialEnd;

  if (isExpired) {
    return null; // Don't show banner if trial has expired (user should be downgraded)
  }

  // Format the trial end date for display
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-3 shadow-md relative">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-300" />
            <span className="font-semibold">
              You have your account access till {formatDate(trialEnd)}.
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-green-100">
            <Clock className="w-4 h-4" />
            <span className="text-sm">
              {timeLeft ? `${timeLeft} remaining` : 'Calculating...'}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="sm:hidden text-xs text-green-100">
            {timeLeft ? `${timeLeft} left` : '...'}
          </div>
          <button
            onClick={handleUpgrade}
            className="bg-white text-green-600 px-4 py-1.5 rounded-md text-sm font-semibold hover:bg-green-50 transition-colors duration-200"
          >
            Upgrade Now
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-green-200 hover:text-white transition-colors duration-200 p-1"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrialBanner;