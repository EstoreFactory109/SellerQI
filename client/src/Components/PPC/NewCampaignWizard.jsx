import React, { useEffect, useMemo, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';
import KeywordListEditor, { parseKeywordLines } from './KeywordListEditor.jsx';

const STEPS = ['Product', 'Campaign', 'Keywords'];

/**
 * Prepares a new Sponsored Products campaign: product, settings, keywords. Nothing
 * is sent from here; "Review" hands the inputs to the approval window
 * (ads.create_campaign), which shows exactly what will be created.
 */
const NewCampaignWizard = ({ onClose, onReview }) => {
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sku, setSku] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [form, setForm] = useState({ name: '', targetingType: 'MANUAL', dailyBudget: '10', defaultBid: '0.75', biddingStrategy: 'LEGACY_FOR_SALES', startDate: '', startEnabled: false });
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [matchType, setMatchType] = useState('EXACT');
  const [bid, setBid] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    axiosInstance.get('/api/actions/ads/new-campaign-options')
      .then((res) => setProducts(res.data?.data?.products || []))
      .catch(() => setError('Could not load your products.'))
      .finally(() => setProductsLoading(false));
  }, []);

  const product = products.find((p) => p.sku === sku);
  useEffect(() => {
    if (!product?.asin) { setSuggestions([]); return; }
    axiosInstance.get('/api/actions/ads/new-campaign-options', { params: { asin: product.asin } })
      .then((res) => setSuggestions(res.data?.data?.suggestions || []))
      .catch(() => setSuggestions([]));
    setForm((f) => (f.name ? f : { ...f, name: `${(product.name || product.asin).slice(0, 60)} - SP` }));
  }, [product?.asin]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((p) => `${p.name} ${p.sku} ${p.asin}`.toLowerCase().includes(q)) : products).slice(0, 50);
  }, [products, search]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const keywords = () => {
    const fromSuggestions = suggestions.filter((s) => picked.includes(s.keywordText)).map((s) => ({ keywordText: s.keywordText, matchType: 'EXACT', bid: s.suggestedBid || undefined }));
    return [...fromSuggestions, ...parseKeywordLines(text, matchType, bid)];
  };

  const next = () => {
    setError('');
    if (step === 0 && !sku) return setError('Choose the product to advertise.');
    if (step === 1) {
      if (!form.name.trim()) return setError('Give the campaign a name.');
      if (!(Number(form.dailyBudget) > 0)) return setError('Enter a daily budget.');
      if (!(Number(form.defaultBid) > 0)) return setError('Enter a default bid.');
      if (form.targetingType === 'AUTO') return review();
    }
    return setStep((s) => s + 1);
  };

  const review = () => {
    const kws = form.targetingType === 'MANUAL' ? keywords() : [];
    if (form.targetingType === 'MANUAL' && kws.length === 0) return setError('Choose or enter at least one keyword.');
    return onReview({
      name: form.name.trim(),
      targetingType: form.targetingType,
      sku,
      dailyBudget: Number(form.dailyBudget),
      defaultBid: Number(form.defaultBid),
      biddingStrategy: form.biddingStrategy,
      startDate: form.startDate || undefined,
      startEnabled: form.startEnabled,
      keywords: kws
    });
  };

  const footer = (
    <>
      {step > 0 ? <SecondaryButton onClick={() => setStep((s) => s - 1)}>Back</SecondaryButton> : <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}
      {step < 2 && !(step === 1 && form.targetingType === 'AUTO')
        ? <PrimaryButton onClick={next}>Next</PrimaryButton>
        : <PrimaryButton onClick={step === 1 ? next : review}>Review</PrimaryButton>}
    </>
  );

  return (
    <Dialog title="New Sponsored Products campaign" subtitle={`Step ${step + 1} of ${form.targetingType === 'AUTO' ? 2 : 3}: ${STEPS[step]}. Nothing is created until you approve it.`} onClose={onClose} footer={footer} wide labelId="new-campaign-title">
      {step === 0 && (
        <div className="flex flex-col gap-3">
          <Field label="Find a product" htmlFor="nc-search">
            <input id="nc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or ASIN" className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />
          </Field>
          {productsLoading && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Loading your products…</p>}
          <div className="max-h-72 overflow-y-auto rounded-lg border" style={{ borderColor: COLORS.border }} role="radiogroup" aria-label="Product">
            {shown.map((p) => (
              <label key={p.sku} className="flex items-center gap-3 px-3 py-2 cursor-pointer text-sm" style={{ borderTop: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, background: p.sku === sku ? COLORS.surfaceElevated : 'transparent' }}>
                <input type="radio" name="nc-product" checked={p.sku === sku} onChange={() => setSku(p.sku)} />
                <span className="flex-1 min-w-0 truncate">{p.name || p.asin}</span>
                <span className="text-xs" style={{ color: COLORS.textMuted }}>{p.sku} · {p.asin}</span>
              </label>
            ))}
            {!productsLoading && shown.length === 0 && <p className="m-0 p-3 text-sm" style={{ color: COLORS.textSecondary }}>No active products match.</p>}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Campaign name" htmlFor="nc-name"><input id="nc-name" value={form.name} onChange={set('name')} maxLength={128} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          </div>
          <Field label="Targeting" htmlFor="nc-targeting" hint={form.targetingType === 'AUTO' ? 'Amazon chooses the searches and products to target.' : 'You choose the keywords.'}>
            <select id="nc-targeting" value={form.targetingType} onChange={set('targetingType')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="MANUAL">Manual (keywords)</option>
              <option value="AUTO">Automatic</option>
            </select>
          </Field>
          <Field label="Bidding" htmlFor="nc-bidding">
            <select id="nc-bidding" value={form.biddingStrategy} onChange={set('biddingStrategy')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="LEGACY_FOR_SALES">Dynamic bids - down only</option>
              <option value="AUTO_FOR_SALES">Dynamic bids - up and down</option>
              <option value="MANUAL">Fixed bids</option>
            </select>
          </Field>
          <Field label="Daily budget" htmlFor="nc-budget"><input id="nc-budget" type="number" min="1" step="0.01" value={form.dailyBudget} onChange={set('dailyBudget')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Default bid" htmlFor="nc-bid"><input id="nc-bid" type="number" min="0.02" step="0.01" value={form.defaultBid} onChange={set('defaultBid')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <Field label="Start date (blank = today)" htmlFor="nc-start"><input id="nc-start" type="date" value={form.startDate} onChange={set('startDate')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
          <label htmlFor="nc-enabled" className="flex items-center gap-2 text-sm self-end pb-2" style={{ color: COLORS.textPrimary }}>
            <input id="nc-enabled" type="checkbox" checked={form.startEnabled} onChange={set('startEnabled')} />
            Start spending as soon as it is created
          </label>
          {!form.startEnabled && <p className="sm:col-span-2 m-0 text-xs" style={{ color: COLORS.textMuted }}>The campaign is created paused, so nothing is spent until you enable it.</p>}
        </div>
      )}

      {step === 2 && (
        <KeywordListEditor
          idPrefix="nc-kw"
          text={text} onText={setText}
          matchType={matchType} onMatchType={setMatchType}
          bid={bid} onBid={setBid}
          suggestions={suggestions}
          picked={picked}
          onPick={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
        />
      )}

      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

export default NewCampaignWizard;
