import React, { useState, useEffect } from 'react';
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const AdminPaymentLogs = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (eventFilter) params.set('eventType', eventFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await axiosInstance.get(`/app/auth/admin/payment-logs?${params}`);
      if (res.data?.statusCode === 200) setData(res.data.data);
      else setError(res.data?.message || 'Failed to load');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load payment logs');
      if (err.response?.status === 401) window.location.href = '/admin-login';
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, eventFilter, statusFilter]);

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto w-full">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500">Retry</button>
        </div>
      )}

      {data?.failedPaymentsSummary?.length > 0 && (
        <div className="rounded-lg border border-[#252525] bg-[#161b22] p-4 mb-6">
          <p className="text-sm font-medium text-gray-200 mb-2">Failed payments (last 30 days)</p>
          <div className="flex flex-wrap gap-2">
            {data.failedPaymentsSummary.map((f, i) => (
              <div key={i} className="rounded border border-[#252525] bg-[#0d0d0d] px-3 py-2 text-xs text-gray-400">
                {f._id?.paymentGateway} / {f._id?.errorCode}: {f.count}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#333] border-t-blue-500" />
          <span className="ml-3 text-sm text-gray-500">Loading…</span>
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={eventFilter}
              onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg"
            >
              <option value="">All events</option>
              <option value="subscription_created">Subscription created</option>
              <option value="payment_succeeded">Payment succeeded</option>
              <option value="payment_failed">Payment failed</option>
              <option value="invoice_paid">Invoice paid</option>
              <option value="customer_subscription_deleted">Subscription deleted</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg"
            >
              <option value="">All statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Gateway</th>
                    <th className="px-2 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]">
                  {data.logs?.map((log) => (
                    <tr key={log._id} className="hover:bg-[#1a1a1a]">
                      <td className="px-3 py-2.5">
                        {log.userId ? (
                          <>
                            <p className="text-sm font-medium text-gray-100">{log.userId.firstName} {log.userId.lastName}</p>
                            <p className="text-xs text-gray-500">{log.userId.email}</p>
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-sm text-gray-300">{log.eventType || '—'}</td>
                      <td className="px-2 py-2.5">
                        <span className={`text-sm ${log.status === 'SUCCESS' ? 'text-emerald-400' : log.status === 'FAILED' ? 'text-red-400' : 'text-gray-400'}`}>
                          {log.status || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-sm text-gray-400">{log.paymentGateway || '—'}</td>
                      <td className="px-2 py-2.5 text-sm text-gray-300 text-right">{log.amount != null ? `${log.currency || ''} ${log.amount}` : '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-gray-500">{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.pagination && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#252525] bg-[#0d0d0d]">
                <p className="text-xs text-gray-500">
                  {((data.pagination.currentPage - 1) * data.pagination.limit) + 1}–{Math.min(data.pagination.currentPage * data.pagination.limit, data.pagination.totalCount)} of {data.pagination.totalCount}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 text-sm text-gray-400">{page} / {data.pagination.totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                    disabled={page >= data.pagination.totalPages}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
          {data.logs?.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-500">No payment logs found.</p>
          )}
        </>
      )}
    </div>
  );
};

export default AdminPaymentLogs;
