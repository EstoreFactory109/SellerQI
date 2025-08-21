import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Clock, ArrowRight, X } from 'lucide-react';

const RecurringTrialPopup = ({ isVisible, onClose }) => {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    // Close popup first
    onClose();
    // Then navigate to plans & billing page
    navigate('/seller-central-checker/settings?tab=plans-billing');
  };

  const handleClose = () => {
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 text-center relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors duration-200"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Upgrade to Pro
          </h2>
          <p className="text-gray-600 leading-relaxed">
            Your trial has expired. Upgrade to Pro to unlock all premium features and continue your analysis.
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

export default RecurringTrialPopup;
