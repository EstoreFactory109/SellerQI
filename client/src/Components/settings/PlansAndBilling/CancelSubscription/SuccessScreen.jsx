import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function SuccessScreen({ onReturnToDashboard }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
        <CheckCircle2 className="w-9 h-9 text-green-500" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-100 mb-2">Your subscription has been cancelled.</h3>
        <p className="text-sm text-gray-400">
          Your cancellation has been completed successfully. Thank you for using SellerQI.
        </p>
      </div>
      <button
        type="button"
        onClick={onReturnToDashboard}
        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors mt-2"
      >
        Return to Dashboard
      </button>
    </div>
  );
}
