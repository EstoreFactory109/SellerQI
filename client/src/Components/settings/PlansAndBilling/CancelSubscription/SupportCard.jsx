import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import CalendlyWidget from '../../../../Pages/Tools/consultation.jsx';
import { isSpApiConnected, isAdsAccountConnected } from '../../../../utils/spApiConnectionCheck.js';

// The only retention flow: shown for "Hard to Use / Couldn't Set Up". Never cancels the
// subscription - reuses the existing Book Demo Call widget (CalendlyWidget) rather than
// building a new booking system, and only reports setup-status signals that actually exist
// in this app (no fabricated "Campaign Setup" line - there's no such signal anywhere).
export default function SupportCard({ user, onBookedCall, loading }) {
  const marketplace = user?.sellerCentral?.sellerAccount?.[0]?.country;

  const checklist = [
    { label: 'Seller Account Connected', done: Boolean(user?.sellerCentral) },
    { label: 'Marketplace Connected', done: Boolean(marketplace) },
    { label: 'Ads Connected', done: isAdsAccountConnected(user) },
    { label: 'SP-API Connected', done: isSpApiConnected(user) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-100 mb-1">Need help getting started?</h3>
        <p className="text-sm text-gray-400">
          It looks like you may still need help setting up your account. Schedule a quick 15-minute
          onboarding call and we&apos;ll help configure everything for you.
        </p>
      </div>

      <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 flex flex-col gap-2">
        {checklist.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            {item.done ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            )}
            <span className={item.done ? 'text-gray-300' : 'text-gray-500'}>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg overflow-hidden border border-[#30363d]">
        <CalendlyWidget />
      </div>

      <button
        type="button"
        onClick={onBookedCall}
        disabled={loading}
        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        I&apos;ve booked my call — Continue
      </button>
    </div>
  );
}
