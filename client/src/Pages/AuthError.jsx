import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, ArrowLeft, RefreshCcw, Link2 } from 'lucide-react';

export default function AuthError() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state || {};
  const { error, errorCode, canRetry } = state;

  const errorMessage = error || 'Something went wrong while connecting to Amazon. Please try again.';

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 via-white to-slate-100 px-4 py-12">
      {/* Background accent */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-red-100/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#3B4A6B]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="bg-white/95 backdrop-blur-sm shadow-xl rounded-2xl border border-gray-100 p-8 md:p-10 text-center">
          {/* Icon */}
          <div className="mb-6">
            <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-red-100 ring-4 ring-red-50">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            Connection Error
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            We couldn’t complete the Amazon account connection
          </p>

          <div className="bg-red-50/80 border border-red-100 rounded-xl p-4 mb-6 text-left">
            <p className="text-gray-700 text-sm leading-relaxed">
              {errorMessage}
            </p>
            {errorCode && (
              <p className="text-xs text-gray-500 mt-2">
                Error code: {errorCode}
              </p>
            )}
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-8 text-left">
            <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-[#3B4A6B]" />
              What you can do
            </h3>
            <ul className="text-sm text-gray-600 space-y-1.5">
              <li>• Make sure you completed the authorization on Amazon</li>
              <li>• Try connecting again from the Connect to Amazon page</li>
              <li>• Use a supported marketplace and seller account</li>
              <li>• Contact support if the issue continues</li>
            </ul>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate('/connect-to-amazon')}
              className="w-full bg-[#3B4A6B] hover:bg-[#2d3a52] text-white font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-[#3B4A6B]/20 hover:shadow-[#3B4A6B]/30"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Connect to Amazon
            </button>

            {canRetry !== false && (
              <button
                onClick={() => navigate('/connect-accounts')}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Try connecting again
              </button>
            )}
          </div>

          <p className="mt-8 pt-6 border-t border-gray-100 text-xs text-gray-400">
            Need help?{' '}
            <a href="mailto:support@sellerqi.com" className="text-[#3B4A6B] hover:underline font-medium">
              support@sellerqi.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
