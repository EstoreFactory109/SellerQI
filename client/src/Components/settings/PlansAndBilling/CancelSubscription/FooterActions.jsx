import React from 'react';

export default function FooterActions({ leftLabel, onLeft, rightLabel, onRight, rightDisabled, rightLoading, rightVariant = 'primary' }) {
  const rightClasses = rightVariant === 'destructive'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <div className="flex gap-3 mt-6">
      {leftLabel && (
        <button
          type="button"
          onClick={onLeft}
          className="flex-1 py-2.5 px-4 bg-[#21262d] hover:bg-[#30363d] text-gray-200 rounded-xl font-semibold border border-[#30363d] transition-colors"
        >
          {leftLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onRight}
        disabled={rightDisabled || rightLoading}
        className={`flex-1 py-2.5 px-4 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${rightClasses}`}
      >
        {rightLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {rightLabel}
      </button>
    </div>
  );
}
