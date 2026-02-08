import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const formatDateTime = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const formatStatusLabel = (status) => (status === 'trialing' ? 'Trial' : status);
const formatCurrency = (amount, currency) => {
  if (amount == null) return '—';
  // Amount is stored in smallest unit (paise for INR, cents for USD)
  const inMainUnit = Number(amount) / 100;
  const c = (currency || 'usd').toUpperCase();
  return c === 'INR' ? `₹${inMainUnit.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : `$${inMainUnit.toFixed(2)}`;
};

const DetailRow = ({ sub }) => (
  <tr className="bg-[#1a1a1a]">
    <td colSpan={7} className="px-4 py-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Billing period</p>
          <p className="text-gray-300">{formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Payment status</p>
          <p className="text-gray-300">{sub.paymentStatus || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Last payment</p>
          <p className="text-gray-300">{formatDate(sub.lastPaymentDate)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Next billing</p>
          <p className="text-gray-300">{formatDate(sub.nextBillingDate)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Trial</p>
          <p className="text-gray-300">{sub.hasTrial ? (sub.trialEndsAt ? `Until ${formatDate(sub.trialEndsAt)}` : 'Yes') : '—'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Cancel at period end</p>
          <p className="text-gray-300">{sub.cancelAtPeriodEnd ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Subscription ID</p>
          <p className="text-gray-400 font-mono text-xs truncate max-w-[180px]" title={sub.stripeSubscriptionId || sub.razorpaySubscriptionId || ''}>
            {sub.stripeSubscriptionId || sub.razorpaySubscriptionId || '—'}
          </p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Payment history</p>
          <p className="text-gray-300">{Array.isArray(sub.paymentHistory) ? sub.paymentHistory.length : 0} payments</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Updated</p>
          <p className="text-gray-300">{formatDateTime(sub.updatedAt)}</p>
        </div>
      </div>
    </td>
  </tr>
);

const AdminSubscription = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [gatewayFilter, setGatewayFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (planFilter) params.set('planType', planFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (gatewayFilter) params.set('paymentGateway', gatewayFilter);
      const res = await axiosInstance.get(`/app/auth/admin/subscription?${params}`);
      if (res.data?.statusCode === 200) setData(res.data.data);
      else setError(res.data?.message || 'Failed to load');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load subscription data');
      if (err.response?.status === 401) window.location.href = '/admin-login';
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, planFilter, statusFilter, gatewayFilter]);

  const records = data?.subscriptionRecords || [];

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto w-full space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500">
            Retry
          </button>
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
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.summary?.map((s) => (
              <div key={s._id} className="rounded-lg border border-[#252525] bg-[#161b22] px-4 py-3">
                <p className="text-xl font-semibold tabular-nums text-gray-100">{s.total}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s._id}</p>
                {s.byStatus?.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1 truncate" title={s.byStatus.map((b) => `${formatStatusLabel(b.status)}: ${b.count}`).join(', ')}>
                    {s.byStatus.map((b) => `${formatStatusLabel(b.status)}: ${b.count}`).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1">Filters:</span>
            <select
              value={planFilter}
              onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="">All plans</option>
              <option value="LITE">Lite</option>
              <option value="PRO">Pro</option>
              <option value="AGENCY">Agency</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="cancelled">Cancelled</option>
              <option value="past_due">Past due</option>
              <option value="trialing">Trial</option>
              <option value="incomplete">Incomplete</option>
            </select>
            <select
              value={gatewayFilter}
              onChange={(e) => { setGatewayFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="">All gateways</option>
              <option value="stripe">Stripe</option>
              <option value="razorpay">Razorpay</option>
            </select>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                    <th className="w-10 px-2 py-3" aria-label="Expand" />
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gateway</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Billing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]">
                  {records.map((sub) => {
                    const user = sub.userId;
                    const isExpanded = expandedId === sub._id;
                    return (
                      <React.Fragment key={sub._id}>
                        <tr
                          className="hover:bg-[#1a1a1a] transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : sub._id)}
                        >
                          <td className="px-2 py-3 text-gray-500">
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-[#252525]"
                              aria-expanded={isExpanded}
                              onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : sub._id); }}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            {user ? (
                              <div>
                                <p className="text-sm font-medium text-gray-100">{user.firstName} {user.lastName}</p>
                                <p className="text-xs text-gray-500">{user.email}</p>
                              </div>
                            ) : (
                              <span className="text-sm text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">{sub.planType}</td>
                          <td className="px-3 py-3">
                            <span className={`text-sm font-medium ${
                              sub.status === 'active' ? 'text-emerald-400' :
                              sub.status === 'trialing' ? 'text-blue-400' :
                              sub.status === 'cancelled' || sub.status === 'past_due' ? 'text-red-400' :
                              'text-gray-400'
                            }`}>
                              {formatStatusLabel(sub.status)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-400 capitalize">{sub.paymentGateway || '—'}</td>
                          <td className="px-3 py-3 text-sm text-gray-300 text-right tabular-nums">{formatCurrency(sub.amount, sub.currency)}</td>
                          <td className="px-3 py-3 text-xs text-gray-500">
                            {formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}
                          </td>
                        </tr>
                        {isExpanded && <DetailRow sub={sub} />}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.pagination && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-[#252525] bg-[#0d0d0d]">
                <p className="text-xs text-gray-500">
                  {(data.pagination.currentPage - 1) * data.pagination.limit + 1}–{Math.min(data.pagination.currentPage * data.pagination.limit, data.pagination.totalCount)} of {data.pagination.totalCount}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 text-sm text-gray-400 min-w-[4rem] text-center">{page} / {data.pagination.totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                    disabled={page >= data.pagination.totalPages}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {records.length === 0 && (
            <p className="text-center py-12 text-sm text-gray-500">No subscription records found.</p>
          )}
        </>
      )}
    </div>
  );
};

export default AdminSubscription;
