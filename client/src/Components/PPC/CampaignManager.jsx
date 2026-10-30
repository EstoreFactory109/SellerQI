import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import { useChangeRequest } from '../Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';
import KeywordListEditor, { parseKeywordLines } from './KeywordListEditor.jsx';
import NewCampaignWizard from './NewCampaignWizard.jsx';

const STATE_STYLE = {
  ENABLED: { background: 'rgba(34,197,94,.14)', color: COLORS.good, label: 'Enabled' },
  PAUSED: { background: 'rgba(165,174,192,.14)', color: COLORS.textSecondary, label: 'Paused' },
  ARCHIVED: { background: 'rgba(239,68,68,.12)', color: COLORS.fix, label: 'Archived' },
};
const StateBadge = ({ state }) => {
  const s = STATE_STYLE[state] || STATE_STYLE.PAUSED;
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[12px] font-semibold" style={{ background: s.background, color: s.color }}>{s.label}</span>;
};
const smallBtn = { borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' };

/** Archiving cannot be undone: the seller types the name to confirm. */
const ArchiveConfirm = ({ name, onCancel, onConfirm }) => {
  const [typed, setTyped] = useState('');
  return (
    <Dialog title={`Archive "${name}"?`} subtitle="An archived campaign or ad group can never be turned back on." onClose={onCancel} labelId="archive-confirm-title"
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton disabled={typed.trim() !== name.trim()} onClick={onConfirm}>Continue</PrimaryButton></>}>
      <Field label={`Type ${name} to confirm`} htmlFor="archive-confirm-input">
        <input id="archive-confirm-input" value={typed} onChange={(e) => setTyped(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />
      </Field>
    </Dialog>
  );
};

/** Keywords for an existing ad group. */
const AddKeywordsDialog = ({ adGroup, onCancel, onReview }) => {
  const [text, setText] = useState('');
  const [matchType, setMatchType] = useState('EXACT');
  const [bid, setBid] = useState(adGroup.defaultBid ? String(adGroup.defaultBid) : '');
  const [error, setError] = useState('');
  const review = () => {
    const keywords = parseKeywordLines(text, matchType, bid);
    if (keywords.length === 0) return setError('Enter at least one keyword.');
    return onReview({ campaignId: adGroup.campaignId, adGroupId: adGroup.adGroupId, defaultBid: adGroup.defaultBid || bid, keywords });
  };
  return (
    <Dialog title={`Add keywords to "${adGroup.name}"`} subtitle="Keywords already in this ad group are left as they are." onClose={onCancel} labelId="add-keywords-title"
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <KeywordListEditor idPrefix="ak" text={text} onText={setText} matchType={matchType} onMatchType={setMatchType} bid={bid} onBid={setBid} />
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

/** A new ad group (with its product, and keywords for a manual campaign). */
const AddAdGroupDialog = ({ campaign, onCancel, onReview }) => {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: '', sku: '', defaultBid: '0.75' });
  const [text, setText] = useState('');
  const [matchType, setMatchType] = useState('EXACT');
  const [bid, setBid] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    axiosInstance.get('/api/actions/ads/new-campaign-options').then((res) => setProducts(res.data?.data?.products || [])).catch(() => {});
  }, []);
  const manual = campaign.targetingType === 'MANUAL';
  const review = () => {
    if (!form.name.trim()) return setError('Give the ad group a name.');
    if (!form.sku) return setError('Choose the product to advertise.');
    return onReview({ campaignId: campaign.campaignId, name: form.name.trim(), sku: form.sku, defaultBid: Number(form.defaultBid), keywords: manual ? parseKeywordLines(text, matchType, bid) : [] });
  };
  return (
    <Dialog title={`New ad group in "${campaign.name}"`} onClose={onCancel} labelId="add-adgroup-title" wide
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Ad group name" htmlFor="ag-name"><input id="ag-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={128} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
        <Field label="Default bid" htmlFor="ag-bid"><input id="ag-bid" type="number" min="0.02" step="0.01" value={form.defaultBid} onChange={(e) => setForm({ ...form, defaultBid: e.target.value })} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} /></Field>
        <div className="sm:col-span-2">
          <Field label="Product" htmlFor="ag-sku" hint="An ad group needs a product to show.">
            <select id="ag-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="">Choose a product…</option>
              {products.map((p) => <option key={p.sku} value={p.sku}>{(p.name || p.asin).slice(0, 70)} ({p.sku})</option>)}
            </select>
          </Field>
        </div>
      </div>
      {manual && <div className="mt-4"><KeywordListEditor idPrefix="ag-kw" text={text} onText={setText} matchType={matchType} onMatchType={setMatchType} bid={bid} onBid={setBid} /></div>}
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

/**
 * "Your campaigns" on the PPC page: pause, enable or archive campaigns and ad
 * groups, add ad groups and keywords, and create campaigns. Every change opens
 * the approval window first. Hidden until these changes are switched on for the
 * account (AMAZON_ACTIONS_ADS on the server).
 */
const CampaignManager = ({ onChanged }) => {
  const { can, loaded } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState({}); // campaignId -> ad groups (or 'loading')
  const [dialog, setDialog] = useState(null); // { kind, ... }

  const enabled = can('ads.set_campaign_state') || can('ads.create_campaign');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    axiosInstance.get('/api/actions/ads/campaigns')
      .then((res) => setCampaigns(res.data?.data?.campaigns || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your campaigns from Amazon Ads.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const loadAdGroups = (campaignId) => {
    setOpen((o) => ({ ...o, [campaignId]: 'loading' }));
    axiosInstance.get(`/api/actions/ads/campaigns/${campaignId}/ad-groups`)
      .then((res) => setOpen((o) => ({ ...o, [campaignId]: res.data?.data?.adGroups || [] })))
      .catch(() => setOpen((o) => ({ ...o, [campaignId]: [] })));
  };
  const toggle = (campaignId) => {
    if (open[campaignId]) setOpen((o) => { const n = { ...o }; delete n[campaignId]; return n; });
    else loadAdGroups(campaignId);
  };

  /** Hands a prepared change to the approval window, then refreshes. */
  const run = async (actionType, input, after) => {
    setDialog(null);
    setMessage('');
    const outcome = await requestChange({ feature: 'ads', actionType, input });
    if (outcome?.status === 'succeeded') {
      setMessage('Done on Amazon.');
      after?.();
      onChanged?.();
    }
  };

  const setState = (kind, item, state) => {
    const isCampaign = kind === 'campaign';
    const go = () => run(isCampaign ? 'ads.set_campaign_state' : 'ads.set_ad_group_state',
      { ids: [isCampaign ? item.campaignId : item.adGroupId], state, ...(state === 'ARCHIVED' ? { confirmArchive: true } : {}) },
      () => (isCampaign ? load() : loadAdGroups(item.campaignId)));
    if (state === 'ARCHIVED') setDialog({ kind: 'archive', name: item.name, onConfirm: go });
    else go();
  };

  if (!loaded || !enabled) return null;

  const stateButtons = (kind, item) => (
    <div className="flex gap-1.5 justify-end">
      {item.state === 'ENABLED' && <button type="button" onClick={() => setState(kind, item, 'PAUSED')} className="px-2.5 py-1 rounded-lg text-xs border" style={smallBtn}>Pause</button>}
      {item.state === 'PAUSED' && <button type="button" onClick={() => setState(kind, item, 'ENABLED')} className="px-2.5 py-1 rounded-lg text-xs border" style={smallBtn}>Enable</button>}
      {item.state !== 'ARCHIVED' && <button type="button" onClick={() => setState(kind, item, 'ARCHIVED')} className="px-2.5 py-1 rounded-lg text-xs border" style={{ ...smallBtn, color: COLORS.fix }}>Archive</button>}
    </div>
  );

  return (
    <section className="rounded-xl border mb-6" style={{ background: COLORS.surface, borderColor: COLORS.border }} aria-labelledby="campaign-manager-title">
      {changeModal}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <div>
          <h2 id="campaign-manager-title" className="m-0 text-base font-semibold" style={{ color: COLORS.textPrimary }}>Your campaigns</h2>
          <p className="m-0 text-xs" style={{ color: COLORS.textSecondary }}>Live from Amazon Ads. Every change is shown to you for approval first.</p>
        </div>
        {can('ads.create_campaign') && (
          <button type="button" onClick={() => setDialog({ kind: 'newCampaign' })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>
            <Plus size={14} /> New campaign
          </button>
        )}
      </div>
      {message && <p role="status" className="m-0 px-4 pt-3 text-sm" style={{ color: COLORS.good }}>{message}</p>}
      {error && <p role="alert" className="m-0 px-4 pt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr style={{ background: COLORS.surfaceElevated }}>
              <th className="w-8" />
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Campaign</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Type</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Status</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Daily budget</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-4 text-sm" style={{ color: COLORS.textSecondary }}>Loading campaigns…</td></tr>}
            {!loading && campaigns.length === 0 && !error && <tr><td colSpan={6} className="px-4 py-4 text-sm" style={{ color: COLORS.textSecondary }}>No Sponsored Products campaigns yet.</td></tr>}
            {campaigns.map((c) => {
              const groups = open[c.campaignId];
              return (
                <React.Fragment key={c.campaignId}>
                  <tr style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td className="pl-3">
                      <button type="button" onClick={() => toggle(c.campaignId)} aria-label={groups ? 'Hide ad groups' : 'Show ad groups'} aria-expanded={!!groups} className="p-1" style={{ color: COLORS.textMuted, background: 'transparent' }}>
                        {groups ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: COLORS.textPrimary }}>{c.name}</td>
                    <td className="px-3 py-2.5" style={{ color: COLORS.textSecondary }}>{c.targetingType === 'AUTO' ? 'Automatic' : 'Manual'}</td>
                    <td className="px-3 py-2.5"><StateBadge state={c.state} /></td>
                    <td className="px-3 py-2.5 text-right" style={{ color: COLORS.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{c.dailyBudget != null ? c.dailyBudget.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2.5">{can('ads.set_campaign_state') && stateButtons('campaign', c)}</td>
                  </tr>
                  {groups === 'loading' && <tr><td /><td colSpan={5} className="px-3 py-2 text-xs" style={{ color: COLORS.textSecondary }}>Loading ad groups…</td></tr>}
                  {Array.isArray(groups) && (
                    <>
                      {groups.map((g) => (
                        <tr key={g.adGroupId} style={{ background: COLORS.surfaceElevated }}>
                          <td />
                          <td className="px-3 py-2 pl-6 text-sm" style={{ color: COLORS.textPrimary }}>{g.name}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: COLORS.textSecondary }}>Ad group{g.defaultBid ? ` · bid ${g.defaultBid.toFixed(2)}` : ''}</td>
                          <td className="px-3 py-2"><StateBadge state={g.state} /></td>
                          <td />
                          <td className="px-3 py-2">
                            <div className="flex gap-1.5 justify-end">
                              {c.targetingType === 'MANUAL' && can('ads.add_keywords') && (
                                <button type="button" onClick={() => setDialog({ kind: 'addKeywords', adGroup: g })} className="px-2.5 py-1 rounded-lg text-xs border" style={smallBtn}>Add keywords</button>
                              )}
                              {can('ads.set_ad_group_state') && stateButtons('adGroup', g)}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {can('ads.create_ad_group') && c.state !== 'ARCHIVED' && (
                        <tr style={{ background: COLORS.surfaceElevated }}>
                          <td />
                          <td colSpan={5} className="px-3 py-2 pl-6">
                            <button type="button" onClick={() => setDialog({ kind: 'addAdGroup', campaign: c })} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: COLORS.accent, background: 'transparent' }}>
                              <Plus size={12} /> New ad group
                            </button>
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'archive' && <ArchiveConfirm name={dialog.name} onCancel={() => setDialog(null)} onConfirm={dialog.onConfirm} />}
      {dialog?.kind === 'addKeywords' && <AddKeywordsDialog adGroup={dialog.adGroup} onCancel={() => setDialog(null)} onReview={(input) => run('ads.add_keywords', input)} />}
      {dialog?.kind === 'addAdGroup' && <AddAdGroupDialog campaign={dialog.campaign} onCancel={() => setDialog(null)} onReview={(input) => run('ads.create_ad_group', input, () => loadAdGroups(dialog.campaign.campaignId))} />}
      {dialog?.kind === 'newCampaign' && <NewCampaignWizard onClose={() => setDialog(null)} onReview={(input) => run('ads.create_campaign', input, load)} />}
    </section>
  );
};

export default CampaignManager;
