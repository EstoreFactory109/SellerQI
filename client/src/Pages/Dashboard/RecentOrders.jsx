import { Fragment, useEffect, useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { COLORS } from '../../Components/Shared/index.js';

const REVIEW_STATUS_CONFIG = {
  not_requested: { label: 'Not requested', bg: 'rgba(165,174,192,.14)', color: COLORS.textSecondary },
  queued: { label: 'Queued', bg: 'rgba(245,166,35,.16)', color: COLORS.watch },
  sent: { label: 'Sent', bg: 'rgba(34,197,94,.14)', color: COLORS.good },
  failed: { label: 'Failed', bg: 'rgba(239,68,68,.14)', color: '#F87171' },
};

const ORDERS_PAGE_SIZE = 10;
const ITEMS_PAGE_SIZE = 10;

// ─── Sub-component: expandable item rows for a single order ────────────────
const OrderItemsPanel = ({ amazonOrderId }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);

  const fetchItems = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);

    const nextPage = pageRef.current + 1;

    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BASE_URI}/api/review/order-items/${encodeURIComponent(amazonOrderId)}`,
        { withCredentials: true, params: { page: nextPage, limit: ITEMS_PAGE_SIZE } }
      );

      if (res?.data?.success) {
        pageRef.current = nextPage;
        setHasMore(!!res.data.hasMore);
        setItems((prev) => [...prev, ...(res.data.items || [])]);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [amazonOrderId, hasMore]);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const priceDisplay = (priceObj) => {
    if (!priceObj) return '—';
    const amt = priceObj.Amount ?? priceObj.amount;
    const cur = priceObj.CurrencyCode ?? priceObj.currencyCode ?? '';
    return amt != null ? `${Number(amt).toFixed(2)} ${cur}` : '—';
  };

  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div style={{ background: COLORS.bgBase, borderTop: `1px solid ${COLORS.border}` }}>
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>ASIN</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>SKU</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>Title</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>Qty Ordered</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>Qty Shipped</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item._id || i}
                  className="transition-colors hover:bg-[#1A202B]"
                  style={{ borderTop: `1px solid ${COLORS.border}` }}
                >
                  <td className="px-4 py-3 font-mono text-sm" style={{ color: '#7EA8F8' }}>{item.asin || '—'}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: COLORS.textSecondary }}>{item.sellerSKU || '—'}</td>
                  <td className="px-4 py-3 text-sm max-w-[260px] truncate" style={{ color: COLORS.textPrimary }}>
                    {item.title || '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                    {item.quantityOrdered ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                    {item.quantityShipped ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium" style={{ color: COLORS.textPrimary }}>
                    {priceDisplay(item.itemPrice)}
                  </td>
                </tr>
              ))}

              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center" style={{ color: COLORS.textSecondary }}>
                    No items found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center" style={{ color: COLORS.textSecondary }}>
                    Loading items...
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {hasMore && !loading && (
            <div className="flex justify-center py-2" style={{ borderTop: `1px solid ${COLORS.border}` }}>
              <button
                onClick={fetchItems}
                className="text-xs font-medium px-4 py-1.5 rounded-md transition-colors"
                style={{ color: '#7EA8F8' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59,130,246,.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Load More Items
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

// ─── Helper: find the nearest scrollable ancestor ──────────────────────────
function getScrollParent(node) {
  let el = node?.parentElement;
  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return window;
}

// ─── Main component ────────────────────────────────────────────────────────
const RecentOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [autoSendLoading, setAutoSendLoading] = useState(true);

  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const initialLoadDone = useRef(false);
  const bottomRef = useRef(null);

  const fetchNextPage = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const nextPage = pageRef.current + 1;

    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BASE_URI}/api/review/recent-orders`,
        { withCredentials: true, params: { page: nextPage, limit: ORDERS_PAGE_SIZE } }
      );

      if (res?.data?.success) {
        const { orders: newOrders, hasMore } = res.data;
        pageRef.current = nextPage;
        hasMoreRef.current = !!hasMore;
        setOrders((prev) => (nextPage === 1 ? newOrders : [...prev, ...(newOrders || [])]));
      } else {
        hasMoreRef.current = false;
        setError(res?.data?.error || 'Failed to load recent orders');
      }
    } catch (err) {
      hasMoreRef.current = false;
      setError(err?.response?.data?.error || err.message || 'Failed to load recent orders');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      fetchNextPage();
    }
  }, [fetchNextPage]);

  // Fetch auto-send toggle status
  useEffect(() => {
    const fetchAuthStatus = async () => {
      try {
        const res = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/api/review/review-auth-status`,
          { withCredentials: true }
        );
        if (res?.data?.success) {
          setAutoSendEnabled(!!res.data.reviewRequestAuthStatus);
        }
      } catch {
        // leave default false
      } finally {
        setAutoSendLoading(false);
      }
    };
    fetchAuthStatus();
  }, []);

  const handleToggleAutoSend = async () => {
    const newValue = !autoSendEnabled;
    setAutoSendLoading(true);
    try {
      const res = await axios.patch(
        `${import.meta.env.VITE_BASE_URI}/api/review/review-auth-status`,
        { enabled: newValue },
        { withCredentials: true }
      );
      if (res?.data?.success) {
        setAutoSendEnabled(res.data.reviewRequestAuthStatus);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to update';
      setError(msg);
    } finally {
      setAutoSendLoading(false);
    }
  };

  // Scroll-based pagination: listen on the real scrollable ancestor
  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;

    const scrollParent = getScrollParent(sentinel);

    const handleScroll = () => {
      if (loadingRef.current || !hasMoreRef.current) return;

      let nearBottom = false;
      if (scrollParent === window) {
        nearBottom =
          window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
      } else {
        nearBottom =
          scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 200;
      }

      if (nearBottom) fetchNextPage();
    };

    const target = scrollParent === window ? window : scrollParent;
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, [fetchNextPage]);

  const toggleExpand = (orderId) => {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
  };

  const COL_COUNT = 7;

  return (
    <div className="min-h-screen w-full" style={{ background: COLORS.bgBase, color: COLORS.textPrimary }}>
      <div className="mx-auto px-4 py-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1280px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px' }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '24px', lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.02em', color: COLORS.textPrimary }}>Review Requests</h1>
            <p style={{ margin: 0, color: COLORS.textSecondary, fontSize: '14px', maxWidth: '76ch' }}>
              Amazon lets you ask for a review between 5 and 30 days after delivery — once per order. Outside that window the button disappears.
            </p>
          </div>
          <div style={{ flex: 'none', border: `1px solid ${COLORS.border}`, borderRadius: '12px', background: COLORS.surface, padding: '14px 16px', minWidth: '300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '7px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, flex: 1, color: COLORS.textPrimary }}>Auto review requests</span>
              <button
                onClick={handleToggleAutoSend}
                disabled={autoSendLoading}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${autoSendLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{ background: autoSendEnabled ? 'rgba(34,197,94,.5)' : COLORS.borderStrong }}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full shadow-lg transform transition-transform duration-200 ease-in-out ${autoSendEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  style={{ background: autoSendEnabled ? COLORS.good : COLORS.textMuted }}
                />
              </button>
              <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, width: '22px' }}>{autoSendEnabled ? 'On' : 'Off'}</span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: COLORS.textMuted }}>
              We send a request on day 6 after delivery for every eligible order, and skip anything with an open return or A-to-Z claim.
            </p>
          </div>
        </div>

        {/* KPI shell — real backend aggregation for these 4 numbers doesn't exist yet; placeholder until that work is done */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
          {[
            { label: 'Eligible right now' },
            { label: 'Requested this month' },
            { label: 'Reviews received' },
            { label: 'Window closed' },
          ].map((kpi) => (
            <div key={kpi.label} style={{ border: `1px solid ${COLORS.border}`, borderRadius: '12px', background: COLORS.surface, padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: COLORS.textSecondary, marginBottom: '8px' }}>
                {kpi.label}
              </div>
              <div style={{ fontSize: '21px', fontWeight: 700, color: COLORS.textMuted }}>—</div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '6px' }}>Not available yet</div>
            </div>
          ))}
        </div>

        <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: '13px', background: COLORS.surface, overflow: 'hidden' }}>
          <div style={{ padding: '13px 18px', borderBottom: `1px solid ${COLORS.border}`, fontSize: '13px', color: COLORS.textSecondary }}>
            Most recent orders first. Eligibility is calculated from the delivery date, not the order date.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead style={{ background: COLORS.surfaceElevated }}>
                <tr>
                  <th className="w-8" style={{ borderBottom: `1px solid ${COLORS.border}` }} />
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Order ID</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Purchase Date</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Items</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Total</th>
                  <th className="px-4 py-3 text-center font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Can Request Review</th>
                  <th className="px-4 py-3 text-center font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted, fontSize: '11px', borderBottom: `1px solid ${COLORS.border}` }}>Review Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => {
                  const id = order._id || order.amazonOrderId || idx;
                  const isExpanded = expandedOrderId === order.amazonOrderId;
                  const purchaseDate = order.purchaseDate
                    ? new Date(order.purchaseDate).toLocaleString()
                    : '—';
                  const total =
                    order.orderTotalAmount != null
                      ? `${order.orderTotalAmount.toFixed(2)} ${order.orderTotalCurrencyCode || ''}`
                      : '—';
                  const canRequestStyle = order.canRequestReview
                    ? { background: 'rgba(34,197,94,.14)', color: COLORS.good }
                    : { background: 'rgba(165,174,192,.14)', color: COLORS.textSecondary };
                  const statusConfig = REVIEW_STATUS_CONFIG[order.reviewRequestStatus] || REVIEW_STATUS_CONFIG.not_requested;

                  return (
                    <Fragment key={id}>
                      <tr
                        className="transition-colors cursor-pointer hover:bg-[#1A202B]"
                        style={{ borderBottom: `1px solid ${COLORS.border}`, background: isExpanded ? COLORS.surfaceElevated : 'transparent' }}
                        onClick={() => toggleExpand(order.amazonOrderId)}
                      >
                        <td className="pl-3 pr-1 py-3.5" style={{ color: COLORS.textMuted }}>
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-sm" style={{ color: COLORS.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{order.amazonOrderId}</td>
                        <td className="px-4 py-3.5 text-sm" style={{ color: COLORS.textSecondary }}>{purchaseDate}</td>
                        <td className="px-4 py-3.5 text-sm" style={{ color: COLORS.textPrimary }}>{order.itemCount ?? 0}</td>
                        <td className="px-4 py-3.5 text-right text-sm" style={{ color: COLORS.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{total}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold" style={canRequestStyle}>
                            {order.canRequestReview ? 'Can be sent' : "Can't send yet"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-center" style={{ color: COLORS.textSecondary }}>
                          {statusConfig.label}
                        </td>
                      </tr>
                      {isExpanded && (
                        <OrderItemsPanel key={`items-${order.amazonOrderId}`} amazonOrderId={order.amazonOrderId} />
                      )}
                    </Fragment>
                  );
                })}

                {orders.length === 0 && !loading && !error && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-10 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                      No recent orders found.
                    </td>
                  </tr>
                )}

                {error && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-sm" style={{ color: '#F87171' }}>
                      {error}
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-sm" style={{ color: COLORS.textSecondary }}>
                      Loading...
                    </td>
                  </tr>
                )}

                {!loading && !hasMoreRef.current && orders.length > 0 && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-xs" style={{ color: COLORS.textMuted }}>
                      You've reached the end of recent orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom sentinel for scroll detection */}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>
    </div>
  );
};

export default RecentOrders;
