import React, { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

function fmt(v) {
  return (Number(v) || 0).toLocaleString();
}

function Row({ label, value, sub }) {
  return (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-100 font-semibold tabular-nums text-right">
        {fmt(value)}
        {sub ? <span className="block text-[10px] text-gray-500 font-normal">{sub}</span> : null}
      </span>
    </div>
  );
}

/**
 * Seller Central–style FBA inventory for one MSKU (from API field fbaInventory).
 */
export default function AmazonFbaInventoryCell({ fbaInventory, fallbackQuantity }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!fbaInventory) {
    const q = fallbackQuantity;
    if (q === undefined || q === null) return <span className="text-xs text-gray-500">—</span>;
    return (
      <span className="text-xs text-gray-400 whitespace-nowrap" title="No FBA snapshot for this SKU">
        {fmt(q)}
      </span>
    );
  }

  const inv = fbaInventory;

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="group inline-flex flex-col items-center gap-0.5 text-left rounded px-1 py-0.5 hover:bg-[#30363d]/60 transition-colors"
        title="FBA inventory (Seller Central layout)"
      >
        <span className="text-xs font-semibold text-green-400 tabular-nums whitespace-nowrap">
          {fmt(inv.available)}
        </span>
        <span className="text-[10px] text-gray-500 whitespace-nowrap">Available</span>
        <Info className="w-3 h-3 text-gray-500 opacity-0 group-hover:opacity-100 absolute -top-0.5 -right-0.5" />
      </button>

      {open && (
        <div
          className="absolute z-50 right-0 mt-1 w-56 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl p-3 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2 font-semibold">
            Inventory (FBA)
          </p>

          <div className="border-b border-[#30363d] pb-2 mb-2">
            <Row label="On-hand" value={inv.onHand?.total ?? 0} />
            <div className="pl-2 mt-1 space-y-0.5 border-l border-[#30363d]">
              <Row label="Available" value={inv.onHand?.available ?? inv.available} />
              <Row label="FC transfer" value={inv.onHand?.fcTransfer ?? inv.fcTransfer} />
            </div>
          </div>

          <Row label="Inbound" value={inv.inbound?.total ?? 0} />
          {(inv.inbound?.receiving ?? 0) > 0 && (
            <div className="pl-2 mt-0.5">
              <Row label="Receiving" value={inv.inbound.receiving} sub="at FC (API)" />
            </div>
          )}

          <div className="border-t border-[#30363d] mt-2 pt-2">
            <Row label="Reserved" value={inv.reserved?.total ?? 0} />
            <div className="pl-2 mt-1 space-y-0.5 border-l border-[#30363d]">
              <Row label="Customer orders" value={inv.reserved?.customerOrders ?? 0} />
              <Row label="FC processing" value={inv.reserved?.fcProcessing ?? 0} />
            </div>
          </div>

          <div className="border-t border-[#30363d] mt-2 pt-2 space-y-0.5">
            <Row label="Unfulfillable" value={inv.unfulfillable} />
            <Row label="Researching" value={inv.researching} />
            <Row label="Total" value={inv.total} />
          </div>

          {inv.fetchedAt && (
            <p className="text-[10px] text-gray-500 mt-2 pt-2 border-t border-[#30363d]">
              Synced {new Date(inv.fetchedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
