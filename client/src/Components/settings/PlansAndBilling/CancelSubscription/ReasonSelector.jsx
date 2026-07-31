import React from 'react';
import ReasonCard from './ReasonCard';
import { CANCEL_REASONS } from './cancelReasons';

export default function ReasonSelector({ selectedReason, onSelectReason }) {
  return (
    <div className="flex flex-col gap-2">
      {CANCEL_REASONS.map((reason) => (
        <ReasonCard
          key={reason.value}
          label={reason.label}
          selected={selectedReason === reason.value}
          onSelect={() => onSelectReason(reason.value)}
        />
      ))}
    </div>
  );
}
