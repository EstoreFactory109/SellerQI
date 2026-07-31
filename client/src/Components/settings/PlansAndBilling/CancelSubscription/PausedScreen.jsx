import React from 'react';
import { Clock } from 'lucide-react';

// Shown after the retention flow (Hard to Use / Couldn't Set Up) - this is NOT a cancellation
// success screen. The subscription remains fully active and unchanged.
export default function PausedScreen({ onClose }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
        <Clock className="w-9 h-9 text-blue-400" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-100 mb-2">We&apos;ll contact you soon.</h3>
        <p className="text-sm text-gray-400">
          Your account has been temporarily paused while we help you complete your setup. Our team
          will contact you shortly or meet with you during your scheduled onboarding session. Thank
          you for giving us the opportunity to help.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full py-2.5 px-4 bg-[#21262d] hover:bg-[#30363d] text-gray-200 rounded-xl font-semibold border border-[#30363d] transition-colors mt-2"
      >
        Close
      </button>
    </div>
  );
}
