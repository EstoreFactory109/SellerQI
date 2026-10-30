import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../../Components/Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { useChangeRequest } from '../../Components/Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../../Components/Actions/Dialog.jsx';
import MarketplaceSwitcher from '../../Components/Marketplace/MarketplaceSwitcher.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

/** One order: confirm its shipment, or message the buyer. Both go to the approval window. */
const OrderDialog = ({ orderId, onClose, onChange, canShip, canMessage }) => {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(canShip ? 'ship' : 'message');
  const [form, setForm] = useState({ carrierCode: '', carrierName: '', trackingNumber: '', shipDate: today(), shippingMethod: '' });
  const [qty, setQty] = useState({});
  const [message, setMessage] = useState({ action: '', text: '' });

  useEffect(() => {
    axiosInstance.get(`/api/actions/orders/${orderId}`)
      .then((res) => {
        const d = res.data?.data;
        setDetail(d);
        setQty(Object.fromEntries((d?.items || []).map((i) => [i.orderItemId, Math.max(i.quantityOrdered - i.quantityShipped, 0)])));
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not read this order from Amazon.'));
  }, [orderId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const option = (detail?.messages || []).find((m) => m.name === message.action);

  const reviewShipment = () => {
    if (!form.carrierCode) return setError('Choose the carrier.');
    if (!form.trackingNumber.trim()) return setError('Enter the tracking number.');
    setError('');
    const items = Object.entries(qty).filter(([, n]) => Number(n) > 0).map(([orderItemId, n]) => ({ orderItemId, quantity: Number(n) }));
    return onChange('orders', 'orders.confirm_shipment', { orderId, ...form, shipDate: `${form.shipDate}T12:00:00.000Z`, items });
  };
  const reviewMessage = () => {
    if (!option) return setError('Choose the kind of message.');
    if (!message.text.trim()) return setError('Write the message.');
    setError('');
    return onChange('messaging', 'messaging.send_message', { orderId, action: message.action, text: message.text.trim() });
  };

  const footer = (
    <>
      <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      {detail && tab === 'ship' && canShip && <PrimaryButton onClick={reviewShipment}>Review</PrimaryButton>}
      {detail && tab === 'message' && canMessage && <PrimaryButton onClick={reviewMessage} disabled={!option?.supported}>Review</PrimaryButton>}
    </>
  );

  return (
    <Dialog title={`Order ${orderId}`} subtitle={detail?.order ? `${detail.order.status} · ship by ${fmt(detail.order.latestShipDate)} · ${detail.order.shipServiceLevel}` : 'Reading the order from Amazon…'} onClose={onClose} footer={footer} wide labelId="fbm-order-title">
      {canShip && canMessage && (
        <div className="flex gap-2 mb-4" role="tablist">
          {[['ship', 'Confirm shipment'], ['message', 'Message the buyer']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: tab === k ? COLORS.accent : COLORS.border, color: tab === k ? COLORS.textPrimary : COLORS.textSecondary, background: 'transparent' }}>{l}</button>
          ))}
        </div>
      )}

      {detail && tab === 'ship' && canShip && (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: COLORS.surfaceElevated }}>
                <th className="text-left px-3 py-2 text-xs" style={{ color: COLORS.textSecondary }}>Item</th>
                <th className="text-right px-3 py-2 text-xs" style={{ color: COLORS.textSecondary }}>Left to ship</th>
                <th className="text-right px-3 py-2 text-xs" style={{ color: COLORS.textSecondary }}>In this package</th>
              </tr></thead>
              <tbody>
                {detail.items.map((i) => {
                  const left = i.quantityOrdered - i.quantityShipped;
                  return (
                    <tr key={i.orderItemId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-3 py-2" style={{ color: COLORS.textPrimary }}>{i.sku}<span className="block text-xs" style={{ color: COLORS.textMuted }}>{i.title.slice(0, 70)}</span></td>
                      <td className="px-3 py-2 text-right" style={{ color: COLORS.textSecondary }}>{left}</td>
                      <td className="px-3 py-2 text-right">
                        <label className="sr-only" htmlFor={`qty-${i.orderItemId}`}>Quantity of {i.sku} in this package</label>
                        <input id={`qty-${i.orderItemId}`} type="number" min="0" max={left} value={qty[i.orderItemId] ?? 0} disabled={left <= 0} onChange={(e) => setQty((q) => ({ ...q, [i.orderItemId]: e.target.value }))} className="w-20 rounded-lg border px-2 py-1 text-sm text-right" style={fieldStyle} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Carrier" htmlFor="ship-carrier">
              <select id="ship-carrier" value={form.carrierCode} onChange={set('carrierCode')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                <option value="">Choose…</option>
                {detail.carriers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            {form.carrierCode === 'Other' && <Field label="Carrier name" htmlFor="ship-carrier-name"><input id="ship-carrier-name" value={form.carrierName} onChange={set('carrierName')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>}
            <Field label="Tracking number" htmlFor="ship-tracking"><input id="ship-tracking" value={form.trackingNumber} onChange={set('trackingNumber')} className="rounded-lg border px-2.5 py-2 text-sm font-mono" style={fieldStyle} /></Field>
            <Field label="Ship date" htmlFor="ship-date"><input id="ship-date" type="date" max={today()} value={form.shipDate} onChange={set('shipDate')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
            <Field label="Shipping service (optional)" htmlFor="ship-method"><input id="ship-method" value={form.shippingMethod} onChange={set('shippingMethod')} placeholder="e.g. Ground Advantage" className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          </div>
        </div>
      )}

      {detail && tab === 'message' && canMessage && (
        <div className="flex flex-col gap-4">
          {(detail.messages || []).length === 0 && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Amazon allows no messages for this order right now.</p>}
          {(detail.messages || []).length > 0 && (
            <Field label="Kind of message" htmlFor="msg-action" hint={option && !option.supported ? 'This message needs a file attached; send it from Seller Central.' : option?.description}>
              <select id="msg-action" value={message.action} onChange={(e) => setMessage((m) => ({ ...m, action: e.target.value }))} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                <option value="">Choose…</option>
                {detail.messages.map((m) => <option key={m.name} value={m.name}>{m.title}{m.supported ? '' : ' (needs a file)'}</option>)}
              </select>
            </Field>
          )}
          {option?.supported && (
            <Field label={`Message${option.maxLength ? ` (up to ${option.maxLength} characters)` : ''}`} htmlFor="msg-text" hint="No links, contact details, offers or review requests: Amazon does not allow them.">
              <textarea id="msg-text" rows={6} maxLength={option.maxLength || undefined} value={message.text} onChange={(e) => setMessage((m) => ({ ...m, text: e.target.value }))} className="w-full rounded-lg border p-2.5 text-sm" style={fieldStyle} />
            </Field>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

/**
 * Orders to ship: seller-fulfilled (FBM) orders waiting to ship, read live from
 * Amazon. Confirm a shipment with its tracking number, or message the buyer; each
 * is approved in the approval window before it is sent.
 */
const FbmOrders = () => {
  const { can, loaded } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const canShip = can('orders.confirm_shipment');
  const canMessage = can('messaging.send_message');

  const load = useCallback(() => {
    setError('');
    axiosInstance.get('/api/actions/orders/unshipped')
      .then((res) => setOrders(res.data?.data?.orders || []))
      .catch((err) => { setOrders([]); setError(err.response?.data?.message || 'Could not read your orders from Amazon.'); });
  }, []);
  useEffect(() => { if (canShip || canMessage) load(); }, [canShip, canMessage, load]);

  const onChange = async (feature, actionType, input) => {
    setOpen(null);
    setNotice('');
    const outcome = await requestChange({ feature, actionType, input });
    if (outcome?.status === 'succeeded') {
      setNotice(actionType === 'orders.confirm_shipment' ? 'Shipment confirmed on Amazon.' : 'Message sent through Amazon.');
      load();
    }
  };

  return (
    <div className="min-h-screen w-full" style={{ background: COLORS.bgBase, color: COLORS.textPrimary }}>
      {changeModal}
      <div className="mx-auto px-4 py-6 flex flex-col gap-5" style={{ maxWidth: '1280px' }}>
        <div>
          <h1 className="m-0 mb-1 text-2xl font-semibold" style={{ color: COLORS.textPrimary }}>Orders to ship</h1>
          <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Orders you ship yourself that Amazon is waiting for, oldest ship-by date first.</p>
          <MarketplaceSwitcher className="mt-3 inline-block" />
        </div>
        {loaded && !canShip && !canMessage && (
          <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>This page is not switched on for your account yet.</p>
        )}
        {notice && <p role="status" className="m-0 text-sm" style={{ color: COLORS.good }}>{notice}</p>}
        {error && <p role="alert" className="m-0 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
        {(canShip || canMessage) && (
          <div className="rounded-xl border overflow-x-auto" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ background: COLORS.surfaceElevated }}>
                  {['Order', 'Ordered', 'Ship by', 'Items to ship', 'Service', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders === null && <tr><td colSpan={6} className="px-4 py-6 text-sm" style={{ color: COLORS.textSecondary }}>Reading your orders from Amazon…</td></tr>}
                {orders && orders.length === 0 && !error && <tr><td colSpan={6} className="px-4 py-6 text-sm" style={{ color: COLORS.textSecondary }}>No orders waiting to ship.</td></tr>}
                {(orders || []).map((o) => {
                  const late = o.latestShipDate && new Date(o.latestShipDate) < new Date();
                  return (
                    <tr key={o.orderId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-4 py-3 font-mono text-sm" style={{ color: COLORS.textSecondary }}>{o.orderId}{o.isPrime ? <span className="ml-2 text-[11px] font-semibold" style={{ color: COLORS.accent }}>Prime</span> : null}</td>
                      <td className="px-4 py-3" style={{ color: COLORS.textSecondary }}>{fmt(o.purchaseDate)}</td>
                      <td className="px-4 py-3" style={{ color: late ? COLORS.fix : COLORS.textPrimary }}>{fmt(o.latestShipDate)}{late ? ' (late)' : ''}</td>
                      <td className="px-4 py-3" style={{ color: COLORS.textPrimary }}>{o.itemsUnshipped}</td>
                      <td className="px-4 py-3" style={{ color: COLORS.textSecondary }}>{o.shipServiceLevel}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setOpen(o.orderId)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <OrderDialog orderId={open} onClose={() => setOpen(null)} onChange={onChange} canShip={canShip} canMessage={canMessage} />}
    </div>
  );
};

export default FbmOrders;
