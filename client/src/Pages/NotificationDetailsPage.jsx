import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ArrowLeft, Bell, FileText } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { markAsRead } from '../redux/slices/notificationsSlice.js';

function getAlertTitle(alertType) {
  if (alertType === 'ProductContentChange') return 'Product content change';
  if (alertType === 'BuyBoxMissing') return 'Buy box missing';
  if (alertType === 'NegativeReviews') return 'Negative reviews';
  if (alertType === 'APlusMissing') return 'A+ content missing';
  if (alertType === 'ConversionRates') return 'Conversion rates';
  return 'Alert';
}

function getTypeBadgeClass(alertType) {
  if (alertType === 'ProductContentChange') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (alertType === 'BuyBoxMissing') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (alertType === 'NegativeReviews') return 'bg-red-100 text-red-700 border-red-200';
  if (alertType === 'APlusMissing') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (alertType === 'ConversionRates') return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function formatDate(createdAt) {
  if (!createdAt) return '—';
  return new Date(createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function NotificationDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setError('Invalid notification ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    axiosInstance
      .get(`/api/alerts/${id}`)
      .then((res) => {
        const data = res.data?.data;
        if (data) {
          setAlert(data);
          if (!data.viewed) {
            dispatch(markAsRead(id));
            axiosInstance.patch(`/api/alerts/${id}/viewed`).catch(() => {});
          }
        } else {
          setError('Alert not found');
        }
      })
      .catch((err) => {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to load notification';
        setError(msg);
        if (err?.response?.status === 404) setError('Notification not found');
      })
      .finally(() => setLoading(false));
  }, [id, dispatch]);

  const handleBack = () => {
    navigate('/seller-central-checker/notifications');
  };

  if (loading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent mb-4" />
          <p className="text-gray-500">Loading notification details...</p>
        </div>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to notifications
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-medium">{error || 'Notification not found'}</p>
        </div>
      </div>
    );
  }

  const alertType = alert.alertType;
  const products = Array.isArray(alert.products) ? alert.products : [];
  const conversionRates = Array.isArray(alert.conversionRates) ? alert.conversionRates : [];
  const title = getAlertTitle(alertType);

  // Table columns and rows by alert type
  const renderTable = () => {
    // Conversion rates: date-wise table
    if (alertType === 'ConversionRates') {
      const rows = conversionRates.length > 0
        ? [...conversionRates].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        : [];
      if (rows.length === 0) {
        return (
          <p className="text-gray-500 py-6 text-center">No conversion rate data for this alert.</p>
        );
      }
      return (
        <div className="rounded-xl border border-gray-200 w-full overflow-hidden">
          <table className="w-full table-fixed divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">#</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Date</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold text-gray-700">Sessions</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold text-gray-700">Conversion rate (%)</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold text-gray-700">Page views</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold text-gray-700">Units ordered</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="px-3 py-3 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-3 text-gray-900">{row.date ?? '—'}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-700">{row.sessions != null ? Number(row.sessions).toLocaleString() : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-700">{row.conversionRate != null ? Number(row.conversionRate).toFixed(2) : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-700">{row.pageViews != null ? Number(row.pageViews).toLocaleString() : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-700">{row.unitsOrdered != null ? Number(row.unitsOrdered).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (products.length === 0) {
      return (
        <p className="text-gray-500 py-6 text-center">No product details for this alert.</p>
      );
    }

    if (alertType === 'ProductContentChange') {
      return (
        <div className="rounded-xl border border-gray-200 w-full overflow-hidden">
          <table className="w-full table-fixed divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">#</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Product name</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">ASIN</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">SKU</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Change types</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Message</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="px-3 py-3 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-3 text-gray-900 break-words">{row.title ?? '—'}</td>
                  <td className="px-3 py-3 font-mono text-gray-900 break-all">{row.asin ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-700 font-mono break-all">{row.sku ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-700 break-words">
                    {Array.isArray(row.changeTypes) && row.changeTypes.length
                      ? row.changeTypes.join(', ')
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-600 break-words">{row.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (alertType === 'NegativeReviews') {
      return (
        <div className="rounded-xl border border-gray-200 w-full overflow-hidden">
          <table className="w-full table-fixed divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">#</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Product name</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">ASIN</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">SKU</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Rating</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Review count</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Message</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="px-3 py-3 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-3 text-gray-900 break-words">{row.title ?? '—'}</td>
                  <td className="px-3 py-3 font-mono text-gray-900 break-all">{row.asin ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-700 font-mono break-all">{row.sku ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-700">{row.rating != null ? row.rating : '—'}</td>
                  <td className="px-3 py-3 text-gray-700">{row.reviewCount != null ? row.reviewCount : '—'}</td>
                  <td className="px-3 py-3 text-gray-600 break-words">{row.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // BuyBoxMissing, APlusMissing, or other product-based
    return (
      <div className="rounded-xl border border-gray-200 w-full overflow-hidden">
        <table className="w-full table-fixed divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '32%' }} />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">#</th>
              <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Product name</th>
              <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">ASIN</th>
              <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">SKU</th>
              <th scope="col" className="px-3 py-3 text-left font-semibold text-gray-700">Message</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {products.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50/50">
                <td className="px-3 py-3 text-gray-500">{idx + 1}</td>
                <td className="px-3 py-3 text-gray-900 break-words">{row.title ?? '—'}</td>
                <td className="px-3 py-3 font-mono text-gray-900 break-all">{row.asin ?? '—'}</td>
                <td className="px-3 py-3 text-gray-700 font-mono break-all">{row.sku ?? '—'}</td>
                <td className="px-3 py-3 text-gray-600 break-words">{row.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <button
        type="button"
        onClick={handleBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to notifications
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notification details</h1>
          <p className="text-sm text-gray-500">Complete details for this alert</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/80">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium ${getTypeBadgeClass(alertType)}`}>
              <Bell className="w-4 h-4" />
              {title}
            </span>
            <span className="text-sm text-gray-500">
              {formatDate(alert.createdAt)}
            </span>
          </div>
          {alert.message && (
            <p className="mt-3 text-sm text-gray-700">{alert.message}</p>
          )}
        </div>
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {alertType === 'ConversionRates'
              ? `Conversion rates by date (${conversionRates.length} day${conversionRates.length === 1 ? '' : 's'})`
              : `Products (${products.length})`}
          </h2>
          {renderTable()}
        </div>
      </div>
    </div>
  );
}
