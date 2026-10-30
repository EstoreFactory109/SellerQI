import React, { useEffect, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';

/**
 * A search term that sells in an automatic campaign, added as a keyword to a
 * manual campaign's ad group. Nothing is sent from here: "Review" hands it to the
 * approval window (ads.add_keywords).
 */
const HarvestKeywordDialog = ({ searchTerm, defaultBid, onCancel, onReview }) => {
  const [campaigns, setCampaigns] = useState([]);
  const [adGroups, setAdGroups] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [adGroupId, setAdGroupId] = useState('');
  const [matchType, setMatchType] = useState('EXACT');
  const [bid, setBid] = useState(defaultBid ? Number(defaultBid).toFixed(2) : '');
  const [error, setError] = useState('');

  useEffect(() => {
    axiosInstance.get('/api/actions/ads/campaigns')
      .then((res) => setCampaigns((res.data?.data?.campaigns || []).filter((c) => c.targetingType === 'MANUAL' && c.state !== 'ARCHIVED')))
      .catch(() => setError('Could not load your campaigns from Amazon Ads.'));
  }, []);
  useEffect(() => {
    setAdGroupId('');
    setAdGroups([]);
    if (!campaignId) return;
    axiosInstance.get(`/api/actions/ads/campaigns/${campaignId}/ad-groups`)
      .then((res) => setAdGroups(res.data?.data?.adGroups || []))
      .catch(() => setAdGroups([]));
  }, [campaignId]);

  const review = () => {
    if (!campaignId || !adGroupId) return setError('Choose the manual campaign and ad group.');
    if (!(Number(bid) > 0)) return setError('Enter a bid.');
    return onReview({ campaignId, adGroupId, keywords: [{ keywordText: searchTerm, matchType, bid: Number(bid) }] });
  };

  return (
    <Dialog title={`Add "${searchTerm}" as a keyword`} subtitle="Bid on this search term directly in a manual campaign." onClose={onCancel} labelId="harvest-title"
      footer={<><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
      <div className="flex flex-col gap-4">
        <Field label="Manual campaign" htmlFor="hv-campaign">
          <select id="hv-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
            <option value="">Choose a campaign…</option>
            {campaigns.map((c) => <option key={c.campaignId} value={c.campaignId}>{c.name}{c.state === 'PAUSED' ? ' (paused)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Ad group" htmlFor="hv-adgroup">
          <select id="hv-adgroup" value={adGroupId} onChange={(e) => setAdGroupId(e.target.value)} disabled={!campaignId} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
            <option value="">Choose an ad group…</option>
            {adGroups.map((g) => <option key={g.adGroupId} value={g.adGroupId}>{g.name}{g.state === 'PAUSED' ? ' (paused)' : ''}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label="Match type" htmlFor="hv-match">
            <select id="hv-match" value={matchType} onChange={(e) => setMatchType(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="EXACT">Exact</option>
              <option value="PHRASE">Phrase</option>
              <option value="BROAD">Broad</option>
            </select>
          </Field>
          <Field label="Bid" htmlFor="hv-bid" hint={defaultBid ? 'Starts at what a click costs now.' : undefined}>
            <input id="hv-bid" type="number" min="0.02" step="0.01" value={bid} onChange={(e) => setBid(e.target.value)} className="w-36 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />
          </Field>
        </div>
      </div>
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

export default HarvestKeywordDialog;
