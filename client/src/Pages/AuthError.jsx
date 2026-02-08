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
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#1a1a1a] px-4 py-12">
      <div className="relative w-full max-w-lg">
        <div className="bg-[#161b22] backdrop-blur-sm shadow-xl rounded-2xl border border-[#30363d] p-8 md:p-10 text-center">
          {/* Icon */}
          <div className="mb-6">
            <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-red-500/20 ring-4 ring-red-500/10">
              <AlertCircle className="h-10 w-10 text-red-400" />
            </div>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-gray-100 mb-2">
            Connection Error
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            We couldn’t complete the Amazon account connection
          </p>

          <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 mb-6 text-left">
            <p className="text-gray-300 text-sm leading-relaxed">
              {errorMessage}
            </p>
            {errorCode && (
              <p className="text-xs text-gray-500 mt-2">
                Error code: {errorCode}
              </p>
            )}
          </div>

          <div className="bg-[#21262d] border border-[#30363d] rounded-xl p-4 mb-8 text-left">
            <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-400" />
              What you can do
            </h3>
            <ul className="text-sm text-gray-400 space-y-1.5">
              <li>• Make sure you completed the authorization on Amazon</li>
              <li>• Try connecting again from the Connect to Amazon page</li>
              <li>• Use a supported marketplace and seller account</li>
              <li>• Contact support if the issue continues</li>
            </ul>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate('/connect-to-amazon')}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/30"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Connect to Amazon
            </button>

            {canRetry !== false && (
              <button
                onClick={() => navigate('/connect-accounts')}
                className="w-full bg-[#21262d] hover:bg-[#1c2128] text-gray-300 font-medium py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 border border-[#30363d]"
              >
                <RefreshCcw className="w-4 h-4" />
                Try connecting again
              </button>
            )}
          </div>

          <p className="mt-8 pt-6 border-t border-[#30363d] text-xs text-gray-500">
            Need help?{' '}
            <a href="mailto:support@sellerqi.com" className="text-blue-400 hover:text-blue-300 hover:underline font-medium">
              support@sellerqi.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
