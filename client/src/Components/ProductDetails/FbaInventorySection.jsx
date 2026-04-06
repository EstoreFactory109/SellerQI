import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Warehouse, Loader2 } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

function fmtDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

function fmtNum(v) {
  return (Number(v) || 0).toLocaleString();
}

/**
 * FBA inventory summary from GET /api/fba-inventory/asin/:asin (aggregated across MSKUs for this ASIN).
 */
export default function FbaInventorySection({ asin }) {
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);
  const [payload, setPayload] = useState(null);

  const fetchData = useCallback(async () => {
    if (!asin || !String(asin).trim()) {
      setLoading(false);
      setErrorKind('invalid');
      setPayload(null);
      return;
    }
    setLoading(true);
    setErrorKind(null);
    setPayload(null);
    try {
      const encoded = encodeURIComponent(String(asin).trim());
      const res = await axiosInstance.get(`/api/fba-inventory/asin/${encoded}`);
      const data = res?.data?.data;
      if (!data) {
        setErrorKind('empty');
        return;
      }
      setPayload(data);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 404) {
        setErrorKind('not_found');
      } else {
        setErrorKind('error');
      }
    } finally {
      setLoading(false);
    }
  }, [asin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasSummary =
    payload?.summary && Array.isArray(payload.items) && payload.items.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="bg-[#161b22] border border-[#30363d] rounded overflow-hidden"
    >
      <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-gray-100">FBA inventory</h2>
            <p className="text-[10px] text-gray-500">From last Amazon Inventory API sync for this marketplace</p>
          </div>
        </div>
        {payload?.marketplaceId ? (
          <span className="text-[10px] text-gray-500 font-mono">Marketplace {payload.marketplaceId}</span>
        ) : null}
      </div>

      <div className="p-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading inventory…
          </div>
        )}

        {!loading && errorKind === 'not_found' && (
          <p className="text-xs text-gray-500 py-4 text-center">
            No FBA inventory snapshot for this ASIN yet. Run an inventory sync (or migration) for this marketplace, then refresh.
          </p>
        )}

        {!loading && errorKind === 'error' && (
          <p className="text-xs text-red-400 py-4 text-center">Could not load FBA inventory. Try again later.</p>
        )}

        {!loading && errorKind === 'invalid' && (
          <p className="text-xs text-gray-500 py-4 text-center">Invalid ASIN.</p>
        )}

        {!loading && errorKind === 'empty' && (
          <p className="text-xs text-gray-500 py-4 text-center">Unexpected empty response.</p>
        )}

        {!loading && hasSummary && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { label: 'MSKUs', value: fmtNum(payload.summary.skuCount) },
                { label: 'Fulfillable', value: fmtNum(payload.summary.totalFulfillable), highlight: 'text-green-400' },
                { label: 'Total qty', value: fmtNum(payload.summary.totalQuantity) },
                { label: 'Reserved', value: fmtNum(payload.summary.totalReserved) },
                { label: 'Inbound', value: fmtNum(payload.summary.totalInbound) },
                { label: 'Unfulfillable', value: fmtNum(payload.summary.totalUnfulfillable), warn: true },
              ].map((cell) => (
                <div
                  key={cell.label}
                  className="bg-[#21262d] border border-[#30363d] rounded px-2 py-2 text-center"
                >
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{cell.label}</p>
                  <p
                    className={`text-sm font-bold tabular-nums ${cell.highlight || ''} ${
                      cell.warn ? 'text-orange-400' : 'text-gray-100'
                    }`}
                  >
                    {cell.value}
                  </p>
                </div>
              ))}
            </div>

            {payload.summary?.latestFetchedAt && (
              <p className="text-[10px] text-gray-500 mt-3">
                Last synced: {fmtDateTime(payload.summary.latestFetchedAt)}
              </p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
