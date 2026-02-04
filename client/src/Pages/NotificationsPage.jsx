import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Bell } from 'lucide-react';
import { motion } from 'framer-motion';
import axiosInstance from '../config/axios.config.js';
import { markAsRead } from '../redux/slices/notificationsSlice.js';

const PAGE_SIZE = 20;

// Map API alert to notification shape; include full alert data for detail view
function mapAlertToNotification(alert) {
  const defaultTitle = alert.alertType === 'ProductContentChange' ? 'Product content change' : alert.alertType === 'BuyBoxMissing' ? 'Buy box missing' : alert.alertType === 'APlusMissing' ? 'A+ content missing' : alert.alertType === 'NegativeReviews' ? 'Negative reviews' : 'Alert';
  return {
    id: alert._id,
    alertId: alert._id,
    type: 'alert',
    alertType: alert.alertType,
    title: alert.message || defaultTitle,
    message: alert.message || '',
    timestamp: alert.createdAt || new Date().toISOString(),
    isRead: alert.viewed === true,
    products: Array.isArray(alert.products) ? alert.products : [],
    metadata: alert.metadata,
  };
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function typeLabel(notification) {
  if (notification.type !== 'alert') return 'Alert';
  if (notification.alertType === 'ProductContentChange') return 'Content';
  if (notification.alertType === 'BuyBoxMissing') return 'Buy box';
  if (notification.alertType === 'NegativeReviews') return 'Reviews';
  if (notification.alertType === 'APlusMissing') return 'A+ missing';
  return 'Alert';
}

function typeBadgeClass(notification) {
  if (notification.type !== 'alert') return 'bg-gray-100 text-gray-700 border-gray-200';
  if (notification.alertType === 'ProductContentChange') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (notification.alertType === 'BuyBoxMissing') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (notification.alertType === 'NegativeReviews') return 'bg-red-100 text-red-700 border-red-200';
  if (notification.alertType === 'APlusMissing') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function typeIconClass(notification) {
  if (notification.type !== 'alert') return 'bg-gray-500';
  if (notification.alertType === 'ProductContentChange') return 'bg-amber-500';
  if (notification.alertType === 'BuyBoxMissing') return 'bg-blue-500';
  if (notification.alertType === 'NegativeReviews') return 'bg-red-500';
  if (notification.alertType === 'APlusMissing') return 'bg-emerald-500';
  return 'bg-gray-500';
}

// Short title for compact display
function getDisplayTitle(notification) {
  if (notification.alertType === 'ProductContentChange') return 'Content change detected';
  if (notification.alertType === 'BuyBoxMissing') return 'Buy box missing';
  if (notification.alertType === 'NegativeReviews') return 'Negative reviews detected';
  if (notification.alertType === 'APlusMissing') return 'A+ content missing';
  return notification.title;
}

// One-line summary: only product count (no ASINs or product-level detail)
function getSummaryLine(notification) {
  const products = notification.products || [];
  const count = products.length;
  if (count === 0) return null;
  return count === 1 ? '1 product' : `${count} products`;
}

const NotificationsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async (skip) => {
    const res = await axiosInstance.get('/api/alerts', { params: { limit: PAGE_SIZE, skip } });
    const data = res.data?.data;
    const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
    const totalCount = typeof data?.total === 'number' ? data.total : 0;
    return { alerts: alerts.map(mapAlertToNotification), total: totalCount };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const markedViewedId = location.state?.markedViewedId;
    fetchPage(0)
      .then(({ alerts, total: t }) => {
        if (!cancelled) {
          // If we navigated from dropdown after clicking an alert, show that item as viewed
          const list = markedViewedId
            ? alerts.map((n) => (String(n.id) === String(markedViewedId) ? { ...n, isRead: true } : n))
            : alerts;
          setNotifications(list);
          setTotal(t);
          // Clear navigation state so refresh doesn't re-apply
          if (markedViewedId) {
            navigate(location.pathname, { replace: true, state: {} });
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load notifications');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount; location.state read inside
  }, [fetchPage]);

  const loadMore = () => {
    if (loadingMore || notifications.length >= total) return;
    setLoadingMore(true);
    fetchPage(notifications.length)
      .then(({ alerts, total: t }) => {
        setNotifications((prev) => [...prev, ...alerts]);
        setTotal(t);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const handleItemClick = (notification) => {
    if (notification.type !== 'alert' || !notification.alertId) return;

    // Update viewed status if not already read
    if (!notification.isRead) {
      const idToMatch = String(notification.id);
      setNotifications((prev) =>
        prev.map((n) => (String(n.id) === idToMatch ? { ...n, isRead: true } : n))
      );
      dispatch(markAsRead(notification.id));
      axiosInstance.patch(`/api/alerts/${notification.alertId}/viewed`).catch(() => {});
    }

    // Navigate to notification details page
    navigate(`/seller-central-checker/notification-details/${notification.alertId}`);
  };

  const hasMore = notifications.length < total;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <Bell className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500">All your alerts in one place</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent mb-4" />
          <p className="text-gray-500">Loading notifications...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-gray-400" />
          </div>
          <h4 className="font-semibold text-gray-700 mb-2">No notifications yet</h4>
          <p className="text-sm text-gray-500">You're all caught up. New notifications will appear here.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {notifications.map((notification, index) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
                onClick={() => handleItemClick(notification)}
                className={`w-full rounded-xl border p-4 sm:p-5 cursor-pointer transition-all hover:shadow-md ${
                  !notification.isRead
                    ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100 hover:border-blue-200'
                    : 'bg-gray-50/70 border-gray-200 hover:bg-gray-100/80 hover:border-gray-300'
                }`}
              >
                <div className="flex gap-3 sm:gap-4 w-full">
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${typeIconClass(notification)}`}>
                    <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 mb-1">
                      <h4 className={`text-sm sm:text-base font-semibold ${!notification.isRead ? 'text-gray-900' : 'text-gray-700'}`}>
                        {getDisplayTitle(notification)}
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-medium">
                          {formatTimestamp(notification.timestamp)}
                        </span>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${typeBadgeClass(notification)}`}>
                          {typeLabel(notification)}
                        </span>
                        {!notification.isRead && (
                          <div className="w-2.5 h-2.5 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                    </div>
                    {getSummaryLine(notification) && (
                      <p className="text-sm text-gray-600">{getSummaryLine(notification)}</p>
                    )}
                    {notification.message && notification.message !== getDisplayTitle(notification) && !getSummaryLine(notification) && (
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{notification.message}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-3 rounded-xl font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NotificationsPage;
