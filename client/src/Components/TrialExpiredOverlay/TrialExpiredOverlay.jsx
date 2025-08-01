import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Clock, ArrowRight } from 'lucide-react';

const TrialExpiredOverlay = () => {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    navigate('/pricing');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Trial Period Ended
          </h2>
          <p className="text-gray-600 leading-relaxed">
            Your 7-day free trial has expired. Upgrade to Pro to continue accessing all premium features.
          </p>
        </div>

        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Pro Features Include:</span>
          </div>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Unlimited product analyses</li>
            <li>• Download detailed reports</li>
            <li>• AI-powered fix recommendations</li>
            <li>• Priority support</li>
          </ul>
        </div>

        <button
          onClick={handleUpgrade}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
        >
          Upgrade to Pro
          <ArrowRight className="w-4 h-4" />
        </button>

        <p className="text-xs text-gray-500 mt-4">
          You can still access ASIN Analyzer and Settings with the free plan.
        </p>
      </div>
    </div>
  );
};

export default TrialExpiredOverlay;