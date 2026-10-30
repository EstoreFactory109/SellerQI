import React, { useState } from 'react';
import { COLORS } from '../Shared/index.js';
import { useChangeRequest } from '../Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';

/** FBM stock: the approval window shows the stock on Amazon now and Amazon's own check. */
const StockDialog = ({ sku, onCancel, onReview }) => {
  const [quantity, setQuantity] = useState('');
  const [handlingTime, setHandlingTime] = useState('');
  const [error, setError] = useState('');
  const review = () => {
    if (quantity === '' || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) return setError('Enter the stock as a whole number.');
    return onReview({ sku, quantity: Number(quantity), ...(handlingTime ? { handlingTime: Number(handlingTime) } : {}) });
  };
  return (
    <Dialog title="Update stock you ship yourself" subtitle={`SKU ${sku}. Amazon-fulfilled (FBA) stock cannot be changed here.`} onClose={onCancel} labelId="fbm-stock-title"
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="flex flex-wrap gap-4">
        <Field label="Units in stock" htmlFor="fbm-qty"><input id="fbm-qty" type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-40 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
        <Field label="Handling time in days (optional)" htmlFor="fbm-ht"><input id="fbm-ht" type="number" min="1" max="30" step="1" value={handlingTime} onChange={(e) => setHandlingTime(e.target.value)} className="w-40 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
      </div>
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

const emptyTier = { minQuantity: '', value: '' };

/** Business (B2B) price, up to 5 quantity tiers, and an optional business sale. */
const B2BDialog = ({ sku, onCancel, onReview }) => {
  const [price, setPrice] = useState('');
  const [discountType, setDiscountType] = useState('fixed');
  const [tiers, setTiers] = useState([{ ...emptyTier }]);
  const [sale, setSale] = useState({ price: '', start: '', end: '' });
  const [error, setError] = useState('');
  const setTier = (i, key) => (e) => setTiers((t) => t.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)));
  const review = () => {
    if (!(Number(price) > 0)) return setError('Enter the business price.');
    const filled = tiers.filter((t) => t.minQuantity !== '' && t.value !== '').map((t) => ({ minQuantity: Number(t.minQuantity), value: Number(t.value) }));
    return onReview({
      sku, price: Number(price), discountType, tiers: filled,
      ...(sale.price ? { salePrice: Number(sale.price), saleStart: sale.start, saleEnd: sale.end } : {})
    });
  };
  return (
    <Dialog title="Business pricing" subtitle={`SKU ${sku}. Prices for Amazon Business buyers; your regular price stays as it is.`} onClose={onCancel} labelId="b2b-title" wide
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <Field label="Business price" htmlFor="b2b-price"><input id="b2b-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-40 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Quantity discounts as" htmlFor="b2b-type">
            <select id="b2b-type" value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="fixed">A price per unit</option>
              <option value="percent">A percent off</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Quantity tiers (up to 5)</span>
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <Field label="From units" htmlFor={`b2b-tq-${i}`}><input id={`b2b-tq-${i}`} type="number" min="2" step="1" value={t.minQuantity} onChange={setTier(i, 'minQuantity')} className="w-32 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
              <Field label={discountType === 'percent' ? '% off' : 'Price per unit'} htmlFor={`b2b-tv-${i}`}><input id={`b2b-tv-${i}`} type="number" min="0" step="0.01" value={t.value} onChange={setTier(i, 'value')} className="w-32 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
              {tiers.length > 1 && <button type="button" onClick={() => setTiers((x) => x.filter((_, j) => j !== i))} className="text-xs pb-2" style={{ color: COLORS.textSecondary, background: 'transparent' }}>Remove</button>}
            </div>
          ))}
          {tiers.length < 5 && <button type="button" onClick={() => setTiers((x) => [...x, { ...emptyTier }])} className="self-start text-xs font-semibold" style={{ color: COLORS.accent, background: 'transparent' }}>Add a tier</button>}
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Business sale price (optional)" htmlFor="b2b-sale"><input id="b2b-sale" type="number" min="0" step="0.01" value={sale.price} onChange={(e) => setSale({ ...sale, price: e.target.value })} className="w-40 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Sale starts" htmlFor="b2b-start"><input id="b2b-start" type="date" value={sale.start} onChange={(e) => setSale({ ...sale, start: e.target.value })} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Sale ends" htmlFor="b2b-end"><input id="b2b-end" type="date" value={sale.end} onChange={(e) => setSale({ ...sale, end: e.target.value })} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
        </div>
      </div>
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

/**
 * Offer changes for one product: stock you ship yourself (FBM) and business
 * pricing. Each opens the approval window, which shows the listing's live values
 * and Amazon's own check before anything is sent. Hidden until switched on.
 */
const OfferActions = ({ sku }) => {
  const { can, loaded } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [dialog, setDialog] = useState(null);
  const [message, setMessage] = useState('');
  const canStock = can('listings.update_fbm_stock');
  const canB2B = can('listings.set_b2b_pricing');
  if (!loaded || !sku || (!canStock && !canB2B)) return null;

  const run = async (actionType, input) => {
    setDialog(null);
    setMessage('');
    const outcome = await requestChange({ feature: 'listings', actionType, input });
    if (outcome?.status === 'succeeded') setMessage('Done on Amazon. It can take Amazon a few minutes to show it.');
  };

  return (
    <section className="rounded-xl border px-4 py-3 mb-4 flex flex-wrap items-center gap-3" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-label="Offer changes">
      {changeModal}
      <span className="text-sm font-semibold mr-auto" style={{ color: COLORS.textPrimary }}>Offer</span>
      {message && <span role="status" className="text-xs" style={{ color: COLORS.good }}>{message}</span>}
      {canStock && <button type="button" onClick={() => setDialog('stock')} className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}>Update FBM stock</button>}
      {canB2B && <button type="button" onClick={() => setDialog('b2b')} className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}>Business pricing</button>}
      {dialog === 'stock' && <StockDialog sku={sku} onCancel={() => setDialog(null)} onReview={(input) => run('listings.update_fbm_stock', input)} />}
      {dialog === 'b2b' && <B2BDialog sku={sku} onCancel={() => setDialog(null)} onReview={(input) => run('listings.set_b2b_pricing', input)} />}
    </section>
  );
};

export default OfferActions;
