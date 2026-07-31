import React from 'react';

export default function ReasonCard({ label, selected, onSelect }) {
  return (
    <label
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
        selected ? 'bg-blue-500/10 border-blue-500/50' : 'bg-[#0d1117] border-[#30363d] hover:border-[#484f58]'
      }`}
    >
      <input
        type="radio"
        name="cancel-reason"
        checked={selected}
        onChange={onSelect}
        className="accent-blue-500 w-4 h-4"
      />
      <span className="text-sm text-gray-200">{label}</span>
    </label>
  );
}
