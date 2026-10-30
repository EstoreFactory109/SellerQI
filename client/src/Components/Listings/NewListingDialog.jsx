import React, { useEffect, useMemo, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';
import SchemaForm from './SchemaForm.jsx';

const CONDITIONS = [['new_new', 'New'], ['used_like_new', 'Used - like new'], ['used_very_good', 'Used - very good'], ['used_good', 'Used - good'], ['used_acceptable', 'Used - acceptable'], ['refurbished_refurbished', 'Refurbished']];

/**
 * A new listing: sell a product already on Amazon (by ASIN), or create a new
 * product from its product type's fields. Nothing is created from here: "Review"
 * opens the approval window, which shows Amazon's own check first.
 */
const NewListingDialog = ({ onClose, onReview }) => {
  const [mode, setMode] = useState('existing');
  const [offer, setOffer] = useState({ asin: '', sku: '', price: '', fulfillment: 'FBM', quantity: '', condition: 'new_new' });
  const [q, setQ] = useState('');
  const [types, setTypes] = useState([]);
  const [productType, setProductType] = useState('');
  const [def, setDef] = useState(null);
  const [extra, setExtra] = useState([]);
  const [values, setValues] = useState({});
  const [sku, setSku] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'new' || q.trim().length < 2) { setTypes([]); return undefined; }
    const t = setTimeout(() => {
      axiosInstance.get('/api/actions/listings/product-types', { params: { q } }).then((res) => setTypes(res.data?.data?.productTypes || [])).catch(() => setTypes([]));
    }, 400);
    return () => clearTimeout(t);
  }, [q, mode]);
  useEffect(() => {
    if (!productType) { setDef(null); return; }
    setDef(null);
    setError('');
    axiosInstance.get('/api/actions/listings/fields', { params: { productType } })
      .then((res) => setDef(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not read this product type from Amazon.'));
  }, [productType]);

  const shownFields = useMemo(() => (def?.fields || []).filter((f) => f.required || extra.includes(f.name)), [def, extra]);
  const optional = useMemo(() => (def?.fields || []).filter((f) => !f.required && !extra.includes(f.name)), [def, extra]);
  const setO = (k) => (e) => setOffer((o) => ({ ...o, [k]: e.target.value }));

  const review = () => {
    setError('');
    if (mode === 'existing') {
      if (!offer.asin.trim() || !offer.sku.trim() || !(Number(offer.price) > 0)) return setError('Enter the ASIN, your SKU and your price.');
      return onReview('listings.offer_existing_asin', { ...offer, price: Number(offer.price), quantity: offer.fulfillment === 'FBM' ? Number(offer.quantity) : undefined });
    }
    if (!productType || !def) return setError('Choose the product type.');
    if (def.unsupportedRequired?.length) return setError('This product type needs details SellerQI cannot collect yet. Create it in Seller Central.');
    if (!sku.trim()) return setError('Enter the SKU.');
    return onReview('listings.create_product', { sku: sku.trim(), productType, values });
  };

  return (
    <Dialog title="New listing" subtitle="Nothing is created until you approve it." onClose={onClose} wide labelId="new-listing-title"
      footer={<><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="flex gap-2 mb-4" role="tablist">
        {[['existing', 'Sell a product already on Amazon'], ['new', 'Create a new product']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: mode === k ? COLORS.accent : COLORS.border, color: mode === k ? COLORS.textPrimary : COLORS.textSecondary, background: 'transparent' }}>{l}</button>
        ))}
      </div>

      {mode === 'existing' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="ASIN" htmlFor="nl-asin"><input id="nl-asin" value={offer.asin} onChange={setO('asin')} className="rounded-lg border px-2.5 py-2 text-sm font-mono" style={fieldStyle} /></Field>
          <Field label="Your SKU" htmlFor="nl-sku"><input id="nl-sku" value={offer.sku} onChange={setO('sku')} maxLength={40} className="rounded-lg border px-2.5 py-2 text-sm font-mono" style={fieldStyle} /></Field>
          <Field label="Your price" htmlFor="nl-price"><input id="nl-price" type="number" min="0" step="0.01" value={offer.price} onChange={setO('price')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Condition" htmlFor="nl-cond">
            <select id="nl-cond" value={offer.condition} onChange={setO('condition')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Who ships it" htmlFor="nl-ful">
            <select id="nl-ful" value={offer.fulfillment} onChange={setO('fulfillment')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="FBM">I ship it (FBM)</option>
              <option value="FBA">Amazon ships it (FBA)</option>
            </select>
          </Field>
          {offer.fulfillment === 'FBM' && <Field label="Units in stock" htmlFor="nl-qty"><input id="nl-qty" type="number" min="0" step="1" value={offer.quantity} onChange={setO('quantity')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>}
        </div>
      )}

      {mode === 'new' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="What is the product?" htmlFor="nl-q" hint="A few words, e.g. speaker wire"><input id="nl-q" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
            <Field label="Product type" htmlFor="nl-type">
              <select id="nl-type" value={productType} onChange={(e) => { setProductType(e.target.value); setValues({}); setExtra([]); }} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                <option value="">{types.length ? 'Choose…' : 'Describe the product first'}</option>
                {types.map((t) => <option key={t.productType} value={t.productType}>{t.displayName}</option>)}
              </select>
            </Field>
            <Field label="Your SKU" htmlFor="nl-new-sku"><input id="nl-new-sku" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={40} className="rounded-lg border px-2.5 py-2 text-sm font-mono" style={fieldStyle} /></Field>
          </div>
          {productType && !def && !error && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Reading what Amazon needs for this product type…</p>}
          {def && (
            <>
              <SchemaForm fields={shownFields} values={values} onChange={setValues} idPrefix="nl-f" />
              {optional.length > 0 && (
                <Field label="Add a field" htmlFor="nl-more" hint="Amazon's check lists any other field this product needs.">
                  <select id="nl-more" value="" onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                    <option value="">Choose a field…</option>
                    {optional.map((f) => <option key={f.name} value={f.name}>{f.title}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

export default NewListingDialog;
