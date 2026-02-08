import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const AdminTicketMessages = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [topicFilter, setTopicFilter] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (topicFilter) params.set('topic', topicFilter);
      const res = await axiosInstance.get(`/app/auth/admin/ticket-messages?${params}`);
      if (res.data?.statusCode === 200) setData(res.data.data);
      else setError(res.data?.message || 'Failed to load');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load ticket messages');
      if (err.response?.status === 401) window.location.href = '/admin-login';
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, topicFilter]);

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto w-full">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500">Retry</button>
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
            <input
              type="text"
              placeholder="Filter by topic…"
              value={topicFilter}
              onChange={(e) => { setTopicFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg w-48"
            />
          </div>

          <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Topic</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase max-w-[240px]">Message</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]">
                  {data.tickets?.map((t) => (
                    <tr
                      key={t._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTicket(t)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTicket(t); } }}
                      className="hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5 text-sm text-gray-300">{t.topic}</td>
                      <td className="px-2 py-2.5">
                        <p className="text-sm font-medium text-gray-100">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.email}</p>
                      </td>
                      <td className="px-2 py-2.5 text-sm text-gray-300 max-w-[180px] truncate" title={t.subject}>{t.subject}</td>
                      <td className="px-2 py-2.5 text-sm text-gray-400 max-w-[240px] truncate" title={t.message}>{t.message || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-gray-500">{formatDate(t.createdAt)}</td>
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
          {data.tickets?.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-500">No ticket messages found.</p>
          )}

          {/* Right-side slider: message details */}
          {selectedTicket && (
            <>
              <div
                className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-200"
                aria-hidden="true"
                onClick={() => setSelectedTicket(null)}
              />
              <aside
                className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-[#161b22] border-l border-[#252525] shadow-xl z-50 flex flex-col"
                aria-label="Message details"
                style={{ animation: 'slideInRight 0.2s ease-out' }}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#252525] bg-[#0d0d0d]">
                  <h3 className="text-sm font-semibold text-gray-100">Message details</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedTicket(null)}
                    className="p-2 rounded-lg text-gray-400 hover:bg-[#252525] hover:text-gray-200 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Topic</p>
                    <p className="text-sm text-gray-200">{selectedTicket.topic}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">From</p>
                    <p className="text-sm font-medium text-gray-100">{selectedTicket.name}</p>
                    <p className="text-sm text-gray-400">{selectedTicket.email}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Subject</p>
                    <p className="text-sm text-gray-200">{selectedTicket.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Message</p>
                    <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] p-3">
                      <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{selectedTicket.message || '—'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Received</p>
                    <p className="text-sm text-gray-400">{formatDate(selectedTicket.createdAt)}</p>
                  </div>
                  {selectedTicket.updatedAt && selectedTicket.updatedAt !== selectedTicket.createdAt && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Updated</p>
                      <p className="text-sm text-gray-400">{formatDate(selectedTicket.updatedAt)}</p>
                    </div>
                  )}
                </div>
              </aside>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default AdminTicketMessages;
