import { Fragment, useEffect, useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import axios from 'axios';

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
        <div className="bg-[#0d1117] border-t border-[#1f2937]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="px-4 py-3 text-left font-medium">ASIN</th>
                <th className="px-4 py-3 text-left font-medium">SKU</th>
                <th className="px-4 py-3 text-left font-medium">Title</th>
                <th className="px-4 py-3 text-center font-medium">Qty Ordered</th>
                <th className="px-4 py-3 text-center font-medium">Qty Shipped</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item._id || i}
                  className="border-t border-[#1f2937]/60 hover:bg-[#161b22] transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-blue-400">{item.asin || '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{item.sellerSKU || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-[260px] truncate">
                    {item.title || '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-300">
                    {item.quantityOrdered ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-300">
                    {item.quantityShipped ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-100">
                    {priceDisplay(item.itemPrice)}
                  </td>
                </tr>
              ))}

              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                    No items found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                    Loading items...
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {hasMore && !loading && (
            <div className="flex justify-center py-2 border-t border-[#1f2937]/60">
              <button
                onClick={fetchItems}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 px-4 py-1.5 rounded-md hover:bg-blue-500/10 transition-colors"
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
    <div className="min-h-screen w-full bg-[#0b0b0f] text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-[#111827] border border-[#1f2937] rounded-xl overflow-hidden shadow-lg shadow-black/40">
          <div className="px-4 py-3 border-b border-[#1f2937] bg-[#020617] flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-100">Recent Orders</h1>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">Auto Review Requests</span>
              <button
                onClick={handleToggleAutoSend}
                disabled={autoSendLoading}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoSendEnabled ? 'bg-emerald-500' : 'bg-zinc-600'
                } ${autoSendLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform duration-200 ease-in-out ${
                    autoSendEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#020617]/80">
                <tr>
                  <th className="w-8 border-b border-[#1f2937]" />
                  <th className="px-4 py-3 text-left font-medium text-gray-400 border-b border-[#1f2937]">Order ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-400 border-b border-[#1f2937]">Purchase Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-400 border-b border-[#1f2937]">Items</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-400 border-b border-[#1f2937]">Total</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-400 border-b border-[#1f2937]">Can Request Review</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-400 border-b border-[#1f2937]">Review Status</th>
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

                  return (
                    <Fragment key={id}>
                      <tr
                        className={`border-b border-[#111827] hover:bg-[#020617]/60 transition-colors cursor-pointer ${isExpanded ? 'bg-[#020617]/40' : ''}`}
                        onClick={() => toggleExpand(order.amazonOrderId)}
                      >
                        <td className="pl-3 pr-1 py-3 text-gray-400">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs sm:text-sm text-blue-300">{order.amazonOrderId}</td>
                        <td className="px-4 py-3 text-xs sm:text-sm text-gray-300">{purchaseDate}</td>
                        <td className="px-4 py-3 text-xs sm:text-sm text-gray-300">{order.itemCount ?? 0}</td>
                        <td className="px-4 py-3 text-right text-xs sm:text-sm text-gray-100">{total}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            order.canRequestReview
                              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                              : 'bg-zinc-700/40 text-zinc-300 border border-zinc-600/60'
                          }`}>
                            {order.canRequestReview ? 'Can be sent' : "can't send Yet"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            order.reviewRequestStatus === 'sent'
                              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                              : 'bg-slate-700/40 text-slate-200 border border-slate-600/60'
                          }`}>
                            {order.reviewRequestStatus || 'not_requested'}
                          </span>
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
                    <td colSpan={COL_COUNT} className="px-4 py-10 text-center text-sm text-gray-400">
                      No recent orders found.
                    </td>
                  </tr>
                )}

                {error && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-sm text-red-400">
                      {error}
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-sm text-gray-400">
                      Loading...
                    </td>
                  </tr>
                )}

                {!loading && !hasMoreRef.current && orders.length > 0 && (
                  <tr>
                    <td colSpan={COL_COUNT} className="px-4 py-4 text-center text-xs text-gray-500">
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
