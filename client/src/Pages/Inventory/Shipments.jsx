import React, { useCallback, useEffect, useState } from 'react';
import { COLORS } from '../../Components/Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { useChangeRequest } from '../../Components/Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../../Components/Actions/Dialog.jsx';
import MarketplaceSwitcher from '../../Components/Marketplace/MarketplaceSwitcher.jsx';

const API = '/api/actions/inbound';
const fees = (list = []) => {
  const total = list.filter((f) => f.type !== 'DISCOUNT').reduce((s, f) => s + (Number(f.value?.amount) || 0), 0) - list.filter((f) => f.type === 'DISCOUNT').reduce((s, f) => s + (Number(f.value?.amount) || 0), 0);
  return `${list[0]?.value?.code || ''} ${total.toFixed(2)}`.trim();
};
const cost = (c) => (c ? `${c.code || ''} ${Number(c.amount).toFixed(2)}`.trim() : 'No Amazon charge');
const card = { background: COLORS.surface, borderColor: COLORS.border };
const btn = { borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' };

/** Asks Amazon to prepare options, then waits for it (nothing is committed). */
async function prepare(planId, body) {
  const res = await axiosInstance.post(`${API}/plans/${planId}/prepare`, body);
  const operationId = res.data?.data?.operationId;
  for (let i = 0; operationId && i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const op = await axiosInstance.get(`${API}/operations/${operationId}`);
    const status = op.data?.data?.status;
    if (status === 'SUCCESS') return;
    if (status === 'FAILED') throw new Error((op.data?.data?.problems || [])[0] || 'Amazon could not prepare the options.');
  }
}

const Step = ({ n, title, done, children }) => (
  <section className="rounded-xl border p-4" style={card}>
    <h3 className="m-0 mb-3 text-sm font-semibold flex items-center gap-2" style={{ color: COLORS.textPrimary }}>
      <span className="inline-flex w-6 h-6 rounded-full items-center justify-center text-xs" style={{ background: done ? 'rgba(34,197,94,.15)' : COLORS.surfaceElevated, color: done ? COLORS.good : COLORS.textSecondary }}>{done ? '✓' : n}</span>
      {title}
    </h3>
    {children}
  </section>
);

/** A new plan: SKUs and quantities, ship-from address, labels and prep. */
const CreatePlanDialog = ({ onClose, onReview }) => {
  const [lines, setLines] = useState('');
  const [address, setAddress] = useState(() => { try { return JSON.parse(localStorage.getItem('sqi.inbound.address') || '{}'); } catch (_) { return {}; } });
  const [labelOwner, setLabelOwner] = useState('SELLER');
  const [prepOwner, setPrepOwner] = useState('NONE');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const setA = (k) => (e) => setAddress((a) => ({ ...a, [k]: e.target.value }));
  const review = () => {
    const items = lines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [sku, q] = l.split(/[,\t;]/).map((x) => (x || '').trim()); return { sku, quantity: Number(q) }; });
    if (!items.length || items.some((i) => !i.sku || !Number.isInteger(i.quantity) || i.quantity < 1)) return setError('One line per SKU: SKU, quantity.');
    try { localStorage.setItem('sqi.inbound.address', JSON.stringify(address)); } catch (_) { /* fine */ }
    return onReview({ name, items, sourceAddress: address, labelOwner, prepOwner });
  };
  const f = (k, label, extra = {}) => <Field label={label} htmlFor={`cp-${k}`}><input id={`cp-${k}`} value={address[k] || ''} onChange={setA(k)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} {...extra} /></Field>;
  return (
    <Dialog title="New shipment to Amazon" subtitle="Creating the plan is free; you approve packing, placement and shipping next." onClose={onClose} wide labelId="create-plan-title"
      footer={<><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="flex flex-col gap-4">
        <Field label="Plan name (optional)" htmlFor="cp-name"><input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
        <Field label="SKUs to send: SKU, quantity (one per line)" htmlFor="cp-lines"><textarea id="cp-lines" rows={6} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'SKU-1 FBA, 48\nSKU-2 FBA, 24'} className="w-full rounded-lg border p-2.5 text-sm font-mono" style={fieldStyle} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {f('name', 'Ship from: name')}{f('addressLine1', 'Street')}{f('addressLine2', 'Street, line 2 (optional)')}{f('city', 'City')}
          {f('stateOrProvinceCode', 'State or province')}{f('postalCode', 'Postcode')}{f('countryCode', 'Country (2 letters)', { maxLength: 2 })}{f('phoneNumber', 'Phone')}
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Who labels the units" htmlFor="cp-label"><select id="cp-label" value={labelOwner} onChange={(e) => setLabelOwner(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}><option value="SELLER">I do</option><option value="AMAZON">Amazon (fee)</option><option value="NONE">No labels needed</option></select></Field>
          <Field label="Who preps the units" htmlFor="cp-prep"><select id="cp-prep" value={prepOwner} onChange={(e) => setPrepOwner(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}><option value="NONE">No prep needed</option><option value="SELLER">I do</option><option value="AMAZON">Amazon (fee)</option></select></Field>
        </div>
      </div>
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

/** One plan, step by step. Every confirm goes to the approval window. */
const PlanView = ({ planId, run, can }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [packingChoice, setPackingChoice] = useState('');
  const [boxes, setBoxes] = useState({});
  const [placementChoice, setPlacementChoice] = useState('');
  const [readyDate, setReadyDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [shipOptions, setShipOptions] = useState({});
  const [transport, setTransport] = useState({});
  const [tracking, setTracking] = useState({});

  const load = useCallback(() => {
    setError('');
    axiosInstance.get(`${API}/plans/${planId}`).then((res) => setD(res.data?.data || null)).catch((err) => setError(err.response?.data?.message || 'Could not read the plan from Amazon.'));
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  const loadShipmentOptions = useCallback(async (shipments) => {
    const out = {};
    for (const s of shipments) {
      const res = await axiosInstance.get(`${API}/plans/${planId}/shipments/${s.shipmentId}/options`).catch(() => null);
      out[s.shipmentId] = res?.data?.data || {};
    }
    setShipOptions(out);
  }, [planId]);
  useEffect(() => { if (d?.shipments?.length) loadShipmentOptions(d.shipments); }, [d, loadShipmentOptions]);

  const doPrepare = async (label, body) => {
    setBusy(label); setError('');
    try { await prepare(planId, body); load(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const approve = async (actionType, input) => { const ok = await run(actionType, input); if (ok) load(); };

  if (error && !d) return <p role="alert" className="m-0 text-sm" style={{ color: COLORS.fix }}>{error}</p>;
  if (!d) return <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Reading the plan from Amazon…</p>;
  if (d.awd) return <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>This is an Amazon Warehousing and Distribution plan; manage it in Seller Central.</p>;

  const packedOption = d.packingOptions.find((o) => o.status === 'ACCEPTED');
  const offeredPacking = d.packingOptions.filter((o) => o.status === 'OFFERED');
  const placed = d.placementOptions.find((o) => o.status === 'ACCEPTED');
  const offeredPlacement = d.placementOptions.filter((o) => o.status === 'OFFERED');
  const chosenPacking = offeredPacking.find((o) => o.packingOptionId === packingChoice);
  const active = d.plan.status === 'ACTIVE';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-lg font-semibold" style={{ color: COLORS.textPrimary }}>{d.plan.name || planId}</h2>
        <span className="text-xs" style={{ color: COLORS.textSecondary }}>{d.plan.status} · {d.items.length} SKUs · {d.items.reduce((s, i) => s + i.quantity, 0)} units</span>
        <span className="flex-1" />
        {active && can('inbound.cancel_plan') && <button type="button" onClick={() => approve('inbound.cancel_plan', { inboundPlanId: planId })} className="px-3 py-1.5 rounded-lg text-xs border" style={{ ...btn, color: COLORS.fix }}>Cancel plan</button>}
      </div>
      {error && <p role="alert" className="m-0 text-sm" style={{ color: COLORS.fix }}>{error}</p>}

      <Step n={1} title="Packing and box contents" done={!!packedOption}>
        {packedOption && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Confirmed. Fees {fees(packedOption.fees)}.</p>}
        {!packedOption && offeredPacking.length === 0 && active && (
          <button type="button" disabled={!!busy} onClick={() => doPrepare('packing', { what: 'packing' })} className="px-3 py-1.5 rounded-lg text-xs border" style={btn}>{busy === 'packing' ? 'Asking Amazon…' : 'Get packing options'}</button>
        )}
        {!packedOption && offeredPacking.length > 0 && (
          <div className="flex flex-col gap-3">
            {offeredPacking.map((o) => (
              <label key={o.packingOptionId} className="flex items-center gap-2 text-sm" style={{ color: COLORS.textPrimary }}>
                <input type="radio" name={`po-${planId}`} checked={packingChoice === o.packingOptionId} onChange={() => setPackingChoice(o.packingOptionId)} />
                {o.packingGroups.length} packing group{o.packingGroups.length === 1 ? '' : 's'} · fees {fees(o.fees)}
              </label>
            ))}
            {chosenPacking && chosenPacking.packingGroups.map((g, i) => {
              const b = boxes[g] || {};
              const set = (k) => (e) => setBoxes((x) => ({ ...x, [g]: { ...(x[g] || {}), [k]: e.target.value } }));
              return (
                <div key={g} className="flex flex-wrap items-end gap-3">
                  <span className="text-xs font-semibold w-full" style={{ color: COLORS.textSecondary }}>Group {i + 1}: identical boxes</span>
                  {[['boxCount', 'Boxes'], ['length', 'Length'], ['width', 'Width'], ['height', 'Height'], ['weight', 'Weight per box']].map(([k, l]) => (
                    <Field key={k} label={l} htmlFor={`bx-${g}-${k}`}><input id={`bx-${g}-${k}`} type="number" min="0" step="0.1" value={b[k] || ''} onChange={set(k)} className="w-24 rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle} /></Field>
                  ))}
                  <Field label="Units" htmlFor={`bx-${g}-units`}><select id={`bx-${g}-units`} value={b.units || 'IN_LB'} onChange={set('units')} className="rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle}><option value="IN_LB">in / lb</option><option value="CM_KG">cm / kg</option></select></Field>
                </div>
              );
            })}
            {chosenPacking && can('inbound.confirm_packing') && (
              <div><PrimaryButton onClick={() => approve('inbound.confirm_packing', {
                inboundPlanId: planId, packingOptionId: packingChoice,
                groups: chosenPacking.packingGroups.map((g) => { const b = boxes[g] || {}; const cm = b.units === 'CM_KG'; return { packingGroupId: g, boxCount: Number(b.boxCount), length: Number(b.length), width: Number(b.width), height: Number(b.height), weight: Number(b.weight), dimUnit: cm ? 'CM' : 'IN', weightUnit: cm ? 'KG' : 'LB' }; })
              })}>Review packing</PrimaryButton></div>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="Placement (where Amazon receives it)" done={!!placed}>
        {placed && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Confirmed: {placed.shipmentIds.length} shipments, fee {fees(placed.fees)}.</p>}
        {!placed && packedOption && offeredPlacement.length === 0 && active && (
          <button type="button" disabled={!!busy} onClick={() => doPrepare('placement', { what: 'placement' })} className="px-3 py-1.5 rounded-lg text-xs border" style={btn}>{busy === 'placement' ? 'Asking Amazon…' : 'Get placement options'}</button>
        )}
        {!placed && offeredPlacement.length > 0 && (
          <div className="flex flex-col gap-2">
            {offeredPlacement.map((o) => (
              <label key={o.placementOptionId} className="flex items-center gap-2 text-sm" style={{ color: COLORS.textPrimary }}>
                <input type="radio" name={`pl-${planId}`} checked={placementChoice === o.placementOptionId} onChange={() => setPlacementChoice(o.placementOptionId)} />
                {o.shipmentIds.length} shipment{o.shipmentIds.length === 1 ? '' : 's'} · fee {fees(o.fees)}
              </label>
            ))}
            {placementChoice && can('inbound.confirm_placement') && <div><PrimaryButton onClick={() => approve('inbound.confirm_placement', { inboundPlanId: planId, placementOptionId: placementChoice })}>Review placement</PrimaryButton></div>}
          </div>
        )}
        {!placed && !packedOption && <p className="m-0 text-sm" style={{ color: COLORS.textMuted }}>After packing.</p>}
      </Step>

      <Step n={3} title="Shipping, delivery windows, labels and tracking" done={d.shipments.length > 0 && d.shipments.every((s) => s.selectedTransportationOptionId)}>
        {!placed && <p className="m-0 text-sm" style={{ color: COLORS.textMuted }}>After placement.</p>}
        {placed && (
          <div className="flex flex-col gap-4">
            {d.shipments.some((s) => !s.selectedTransportationOptionId) && active && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Ready to ship on" htmlFor={`rd-${planId}`}><input id={`rd-${planId}`} type="date" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-sm" style={fieldStyle} /></Field>
                <button type="button" disabled={!!busy} onClick={() => doPrepare('transport', { what: 'transport', placementOptionId: placed.placementOptionId, readyToShipDate: readyDate })} className="px-3 py-1.5 rounded-lg text-xs border" style={btn}>{busy === 'transport' ? 'Asking Amazon…' : 'Get shipping options'}</button>
              </div>
            )}
            {d.shipments.map((s) => {
              const o = shipOptions[s.shipmentId] || {};
              const needsWindow = (o.transportationOptions || []).some((t) => t.transportationOptionId === transport[s.shipmentId] && t.preconditions.includes('CONFIRMED_DELIVERY_WINDOW'));
              return (
                <div key={s.shipmentId} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: COLORS.border }}>
                  <div className="text-sm font-semibold" style={{ color: COLORS.textPrimary }}>{s.name || s.shipmentId} <span className="text-xs font-normal" style={{ color: COLORS.textSecondary }}>{s.warehouseId ? `to ${s.warehouseId}` : ''} · {s.status}</span></div>
                  {s.selectedTransportationOptionId
                    ? <span className="text-xs" style={{ color: COLORS.good }}>Shipping confirmed{s.selectedDeliveryWindow ? `, arriving ${String(s.selectedDeliveryWindow.startDate).slice(0, 10)} to ${String(s.selectedDeliveryWindow.endDate).slice(0, 10)}` : ''}.</span>
                    : (o.transportationOptions || []).length > 0 && (
                      <select aria-label={`Shipping for ${s.name || s.shipmentId}`} value={transport[s.shipmentId] || ''} onChange={(e) => setTransport((t) => ({ ...t, [s.shipmentId]: e.target.value }))} className="rounded-lg border px-2.5 py-1.5 text-sm" style={fieldStyle}>
                        <option value="">Choose shipping…</option>
                        {o.transportationOptions.map((t) => <option key={t.transportationOptionId} value={t.transportationOptionId}>{t.carrier} · {String(t.shippingMode).replace(/_/g, ' ').toLowerCase()} · {cost(t.cost)}</option>)}
                      </select>
                    )}
                  {needsWindow && !s.selectedDeliveryWindow && (
                    (o.deliveryWindowOptions || []).length === 0
                      ? <button type="button" onClick={() => doPrepare('delivery', { what: 'delivery', shipmentId: s.shipmentId }).then(() => loadShipmentOptions(d.shipments))} className="self-start px-3 py-1.5 rounded-lg text-xs border" style={btn}>Get delivery windows</button>
                      : (
                        <div className="flex flex-wrap gap-2">
                          {o.deliveryWindowOptions.slice(0, 6).map((w) => (
                            <button key={w.deliveryWindowOptionId} type="button" onClick={() => approve('inbound.confirm_delivery_window', { inboundPlanId: planId, shipmentId: s.shipmentId, deliveryWindowOptionId: w.deliveryWindowOptionId })} className="px-2.5 py-1 rounded-lg text-xs border" style={btn}>
                              {String(w.startDate).slice(0, 10)} – {String(w.endDate).slice(0, 10)}
                            </button>
                          ))}
                        </div>
                      )
                  )}
                  {s.shipmentConfirmationId && (
                    <div className="flex flex-wrap items-end gap-3">
                      <button type="button" onClick={async () => { const r = await axiosInstance.get(`${API}/plans/${planId}/shipments/${s.shipmentId}/labels`).catch((e) => ({ error: e })); const url = r?.data?.data?.url; if (url) window.open(url, '_blank', 'noopener'); else setError(r?.error?.response?.data?.message || 'Labels are not ready yet.'); }} className="px-3 py-1.5 rounded-lg text-xs border" style={btn}>Box labels</button>
                      {can('inbound.update_tracking') && (
                        <>
                          <label className="sr-only" htmlFor={`trk-${s.shipmentId}`}>Tracking numbers</label>
                          <input id={`trk-${s.shipmentId}`} placeholder="Tracking numbers, one per box" value={tracking[s.shipmentId] || ''} onChange={(e) => setTracking((t) => ({ ...t, [s.shipmentId]: e.target.value }))} className="flex-1 min-w-[200px] rounded-lg border px-2.5 py-1.5 text-sm" style={fieldStyle} />
                          <button type="button" onClick={() => approve('inbound.update_tracking', { inboundPlanId: planId, shipmentId: s.shipmentId, mode: 'SPD', trackingIds: tracking[s.shipmentId] || '' })} className="px-3 py-1.5 rounded-lg text-xs border" style={btn}>Review tracking</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {Object.keys(transport).length > 0 && can('inbound.confirm_transport') && (
              <div><PrimaryButton onClick={() => approve('inbound.confirm_transport', { inboundPlanId: planId, selections: Object.entries(transport).filter(([, v]) => v).map(([shipmentId, transportationOptionId]) => ({ shipmentId, transportationOptionId })) })}>Review shipping</PrimaryButton></div>
            )}
          </div>
        )}
      </Step>
    </div>
  );
};

/**
 * Shipments to Amazon (FBA inbound): your shipment plans from Amazon, and a new
 * shipment, step by step. Every step that commits anything (the plan, packing,
 * placement, shipping, tracking, cancelling) is approved first, with its fees.
 */
const Shipments = () => {
  const { can, loaded } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [plans, setPlans] = useState(null);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const enabled = can('inbound.create_plan');

  const load = useCallback(() => {
    axiosInstance.get(`${API}/plans`).then((res) => setPlans(res.data?.data?.plans || [])).catch((err) => { setPlans([]); setError(err.response?.data?.message || 'Could not read your shipment plans from Amazon.'); });
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const run = async (actionType, input) => {
    const outcome = await requestChange({ feature: 'inbound', actionType, input });
    return outcome?.status === 'succeeded' || outcome?.status === 'awaiting_amazon';
  };

  return (
    <div className="min-h-screen w-full" style={{ background: COLORS.bgBase, color: COLORS.textPrimary }}>
      {changeModal}
      <div className="mx-auto px-4 py-6 flex flex-col gap-5" style={{ maxWidth: '1280px' }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 mb-1 text-2xl font-semibold" style={{ color: COLORS.textPrimary }}>Shipments to Amazon</h1>
            <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Send stock to Amazon's warehouses. You approve each step and see its fees first.</p>
            <MarketplaceSwitcher className="mt-3 inline-block" />
          </div>
          {enabled && <PrimaryButton onClick={() => setCreating(true)}>New shipment</PrimaryButton>}
        </div>
        {loaded && !enabled && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>This page is not switched on for your account yet.</p>}
        {error && <p role="alert" className="m-0 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
        {enabled && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <ul className="m-0 p-0 list-none rounded-xl border self-start" style={card} aria-label="Shipment plans">
              {plans === null && <li className="px-4 py-3 text-sm" style={{ color: COLORS.textSecondary }}>Reading your plans…</li>}
              {plans && plans.length === 0 && <li className="px-4 py-3 text-sm" style={{ color: COLORS.textSecondary }}>No shipment plans yet.</li>}
              {(plans || []).map((p) => (
                <li key={p.inboundPlanId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <button type="button" onClick={() => setOpen(p.inboundPlanId)} className="w-full text-left px-4 py-3" style={{ background: open === p.inboundPlanId ? COLORS.surfaceElevated : 'transparent' }}>
                    <span className="block text-sm truncate" style={{ color: COLORS.textPrimary }}>{p.name || p.inboundPlanId}</span>
                    <span className="block text-xs" style={{ color: COLORS.textMuted }}>{p.status} · {new Date(p.createdAt).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">{open ? <PlanView key={open} planId={open} run={run} can={can} /> : <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Choose a plan, or start a new shipment.</p>}</div>
          </div>
        )}
      </div>
      {creating && <CreatePlanDialog onClose={() => setCreating(false)} onReview={async (input) => { setCreating(false); if (await run('inbound.create_plan', input)) load(); }} />}
    </div>
  );
};

export default Shipments;
