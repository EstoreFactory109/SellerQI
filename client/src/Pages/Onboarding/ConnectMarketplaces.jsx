import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, CheckCircle2, Globe, Loader2, Lock, Megaphone, Plus, Store, AlertTriangle } from 'lucide-react';
import OnboardingShell from '../../Components/Onboarding/OnboardingShell.jsx';
import { COLORS } from '../../Components/Shared/index.js';
import { REGIONS, REGION_NAMES, countryFlag, countryName } from '../../utils/amazonMarketplaces.js';
import {
  fetchChecklist,
  goToAmazon,
  confirmMarketplaces,
  saveAdsProfiles,
  startFetches,
  errorMessage,
} from '../../utils/multiMarketplaceOnboarding.js';

/**
 * Multi-marketplace onboarding checklist (/connect-marketplaces).
 *
 * One card per Amazon region the seller has connected. Each region is approved once in Seller
 * Central; Amazon reports which marketplaces that approval covers, the seller confirms them, then
 * optionally connects Amazon Ads once for the region and matches each marketplace to its profile.
 * The main marketplace's data starts preparing as soon as its region is done; the rest start on
 * "Continue". Everything is read back from the server, so a reload or a later visit resumes.
 */

const PANEL_BG = '#10141C';
const SKIPPED_ADS_KEY = 'sqi_mm_ads_skipped';

const readSkipped = () => {
  try { return JSON.parse(sessionStorage.getItem(SKIPPED_ADS_KEY) || '[]'); } catch { return []; }
};

const FETCH_LABELS = {
  not_started: 'Not started',
  queued: 'Queued',
  preparing: 'Preparing…',
  ready: 'Ready',
  failed: 'Needs a retry',
  unknown: '—',
};

const Pill = ({ tone = 'muted', children }) => {
  const tones = {
    good: { background: 'rgba(34,197,94,.12)', color: '#4ADE80', border: '1px solid rgba(34,197,94,.3)' },
    accent: { background: 'rgba(59,130,246,.12)', color: '#7EA8F8', border: '1px solid rgba(59,130,246,.3)' },
    watch: { background: 'rgba(245,166,35,.10)', color: COLORS.watch, border: '1px solid rgba(245,166,35,.3)' },
    muted: { background: COLORS.surfaceElevated, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
  };
  return (
    <span className="inline-flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, ...tones[tone] }}>
      {children}
    </span>
  );
};

const Button = ({ onClick, disabled, busy, variant = 'primary', children }) => {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center justify-center gap-2 transition-colors"
      style={{
        padding: '9px 15px',
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 600,
        border: primary ? 0 : `1px solid ${COLORS.border}`,
        background: disabled ? COLORS.surfaceElevated : primary ? COLORS.accent : 'transparent',
        color: disabled ? COLORS.textMuted : primary ? '#061021' : COLORS.textSecondary,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
      }}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const fetchTone = (status) => (status === 'ready' ? 'good' : status === 'failed' ? 'watch' : status === 'not_started' ? 'muted' : 'accent');

/** Tick the marketplaces Amazon reported for this region. */
const MarketplacePicker = ({ region, primary, onSaved, onError }) => {
  const confirmed = useMemo(() => new Set(region.confirmed), [region.confirmed]);
  const [selected, setSelected] = useState(() => new Set(region.available.map((m) => m.country)));
  const [busy, setBusy] = useState(false);
  const locked = (country) => confirmed.has(country) || (primary?.region === region.region && primary?.country === country);
  const pending = region.available.filter((m) => !confirmed.has(m.country));
  if (!pending.length) return null;

  const toggle = (country) => {
    if (locked(country)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country); else next.add(country);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await confirmMarketplaces(region.region, [...new Set([...selected, ...confirmed])]));
    } catch (error) {
      onError(errorMessage(error, 'Could not save your marketplaces.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>
        {region.discoveryFailed
          ? "Amazon didn't tell us which marketplaces you sell in. Tick the ones you do."
          : 'Amazon says this account sells in these marketplaces. Untick any you don’t want in SellerQI.'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8, marginBottom: 12 }}>
        {region.available.map((m) => {
          const isLocked = locked(m.country);
          const on = isLocked || selected.has(m.country);
          return (
            <button
              key={m.country}
              type="button"
              onClick={() => toggle(m.country)}
              aria-pressed={on}
              className="flex items-center gap-2.5 text-left"
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${on ? 'rgba(59,130,246,.45)' : COLORS.border}`,
                background: on ? 'rgba(59,130,246,.08)' : PANEL_BG,
                color: COLORS.textPrimary,
                fontSize: 13,
                cursor: isLocked ? 'default' : 'pointer',
              }}
            >
              <span
                className="flex items-center justify-center flex-none"
                style={{ width: 18, height: 18, borderRadius: 5, background: on ? COLORS.accent : 'transparent', border: `1px solid ${on ? COLORS.accent : COLORS.borderStrong}` }}
              >
                {on && <Check className="w-3 h-3" style={{ color: '#061021' }} />}
              </span>
              <span style={{ fontSize: 16 }}>{countryFlag(m.country)}</span>
              <span className="flex-1 min-w-0 truncate">{countryName(m.country)}</span>
              {isLocked && <Lock className="w-3.5 h-3.5" style={{ color: COLORS.textMuted }} aria-label="Always included" />}
            </button>
          );
        })}
      </div>
      <Button onClick={save} busy={busy} disabled={![...selected].some((c) => !confirmed.has(c))}>
        Add selected marketplaces
      </Button>
    </div>
  );
};

/** Match each marketplace in the region to its Amazon Ads profile. */
const AdsMapping = ({ region, onSaved, onSkip, onError }) => {
  const [choice, setChoice] = useState(() => Object.fromEntries(region.adsMapping.map((m) => [m.country, m.profileId || ''])));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const mapping = region.adsMapping.map((m) => ({ country: m.country, profileId: choice[m.country] || null }));
      const result = await saveAdsProfiles(region.region, mapping);
      // Saving with no profile at all means "no Ads here": treat the region as skipped.
      if (!mapping.some((m) => m.profileId)) onSkip(region.region);
      onSaved(result);
    } catch (error) {
      onError(errorMessage(error, 'Could not save your Ads profiles.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>
        Which Ads profile belongs to each marketplace? We matched them where we could.
      </div>
      <div className="flex flex-col" style={{ gap: 8, marginBottom: 12 }}>
        {region.adsMapping.map((m) => (
          <label key={m.country} className="flex items-center gap-3" style={{ fontSize: 13, color: COLORS.textPrimary }}>
            <span className="flex items-center gap-2" style={{ width: 170 }}>
              <span style={{ fontSize: 16 }}>{countryFlag(m.country)}</span>
              {countryName(m.country)}
            </span>
            <select
              value={choice[m.country] || ''}
              onChange={(e) => setChoice((prev) => ({ ...prev, [m.country]: e.target.value }))}
              className="flex-1 outline-none"
              style={{ padding: '8px 10px', borderRadius: 8, background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, fontSize: 13 }}
            >
              <option value="">{m.candidates.length ? 'No Ads for this marketplace' : 'No Ads profile found'}</option>
              {m.candidates.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {(p.name || 'Profile') + ` · ${p.profileId}`}{p.type && p.type !== 'seller' ? ` (${p.type})` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button onClick={save} busy={busy}>Save Ads profiles</Button>
    </div>
  );
};

const RegionCard = ({ region, checklist, adsSkipped, onSkipAds, onChecklist, onError }) => {
  const [opening, setOpening] = useState(null);
  // The picker shows until the region's first confirmation; after that a marketplace the seller
  // left unticked stays out of the way unless they ask to add more.
  const [addingMore, setAddingMore] = useState(false);
  const hasMoreToAdd = region.available.some((m) => !region.confirmed.includes(m.country));
  const showPicker = region.confirmed.length === 0 || addingMore;
  const marketplaces = checklist.marketplaces.filter((m) => m.region === region.region);
  const adsLinked = marketplaces.some((m) => m.ads);
  const showMapping = region.ads && region.confirmed.length > 0 && !adsLinked && !adsSkipped;
  const needsAds = !region.ads && region.confirmed.length > 0 && !adsSkipped;

  const open = async (kind) => {
    setOpening(kind);
    try {
      await goToAmazon({ kind, region: region.region, country: region.confirmed[0] });
    } catch (error) {
      setOpening(null);
      onError(errorMessage(error, 'Could not open Amazon. Please try again.'));
    }
  };

  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.surface, padding: 18, marginBottom: 12 }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Globe className="w-4 h-4" style={{ color: COLORS.textMuted }} />
        <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>{REGION_NAMES[region.region]}</span>
        <span className="flex-1" />
        <Pill tone="good"><Store className="w-3 h-3" /> Seller Central</Pill>
        {adsLinked ? <Pill tone="good"><Megaphone className="w-3 h-3" /> Ads</Pill>
          : adsSkipped ? <Pill>Ads skipped</Pill> : null}
      </div>

      {marketplaces.length > 0 && (
        <div className="flex flex-col" style={{ gap: 6, marginTop: 14 }}>
          {marketplaces.map((m) => (
            <div key={m.country} className="flex items-center gap-2.5" style={{ padding: '9px 12px', borderRadius: 10, background: PANEL_BG, fontSize: 13 }}>
              <span style={{ fontSize: 16 }}>{countryFlag(m.country)}</span>
              <span style={{ color: COLORS.textPrimary }}>{countryName(m.country)}</span>
              {m.primary && <Pill tone="accent">Main</Pill>}
              <span className="flex-1" />
              {!m.ads && region.ads && <span style={{ fontSize: 11, color: COLORS.textMuted }}>no Ads</span>}
              {m.fetch.status !== 'not_started' && <Pill tone={fetchTone(m.fetch.status)}>{FETCH_LABELS[m.fetch.status] || m.fetch.status}</Pill>}
            </div>
          ))}
        </div>
      )}

      {showPicker ? (
        <MarketplacePicker
          key={region.available.map((m) => m.country).join()}
          region={region}
          primary={checklist.primary}
          onSaved={(next) => { setAddingMore(false); onChecklist(next); }}
          onError={onError}
        />
      ) : hasMoreToAdd && (
        <button
          type="button"
          onClick={() => setAddingMore(true)}
          className="inline-flex items-center gap-1.5"
          style={{ marginTop: 10, fontSize: 12, color: '#7EA8F8' }}
        >
          <Plus className="w-3.5 h-3.5" /> Add more marketplaces from {REGION_NAMES[region.region]}
        </button>
      )}

      {needsAds && (
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
          <span className="flex-1" style={{ fontSize: 13, color: COLORS.textSecondary, minWidth: 200 }}>
            Connect Amazon Ads once for {REGION_NAMES[region.region]} to see ad spend and wasted keywords.
          </span>
          <Button variant="secondary" onClick={() => onSkipAds(region.region)}>Skip — I don’t run ads</Button>
          <Button onClick={() => open('ads')} busy={opening === 'ads'}>
            Connect Amazon Ads <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
      {showMapping && (
        <AdsMapping key={region.adsMapping.map((m) => m.country).join()} region={region} onSaved={onChecklist} onSkip={onSkipAds} onError={onError} />
      )}
    </div>
  );
};

const ConnectMarketplaces = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState(location.state?.error || '');
  const [adsSkipped, setAdsSkipped] = useState(readSkipped);
  const [continuing, setContinuing] = useState(false);
  const [openingRegion, setOpeningRegion] = useState(null);
  const primaryStarted = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchChecklist();
      if (!result?.enabled) {
        navigate('/connect-to-amazon', { replace: true });
        return;
      }
      setChecklist(result);
    } catch (err) {
      setError(errorMessage(err, 'Could not load your marketplaces.'));
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  const skipAds = (region) => {
    const next = [...new Set([...adsSkipped, region])];
    setAdsSkipped(next);
    try { sessionStorage.setItem(SKIPPED_ADS_KEY, JSON.stringify(next)); } catch { /* per-tab only */ }
  };

  const connectedRegions = useMemo(
    () => (checklist?.regions || []).filter((r) => r.sellerCentral),
    [checklist]
  );
  const otherRegions = REGIONS.filter((r) => !connectedRegions.some((c) => c.region === r));
  const primary = checklist?.marketplaces.find((m) => m.primary);
  const primaryRegion = connectedRegions.find((r) => r.region === primary?.region);
  const primaryRegionDone = Boolean(primary && primaryRegion
    && (adsSkipped.includes(primary.region) || checklist.marketplaces.some((m) => m.region === primary.region && m.ads)));

  // Start the main marketplace as soon as its region is done, so its dashboard is ready as fast
  // as with one marketplace. The rest start on "Continue".
  useEffect(() => {
    if (!primaryRegionDone || primaryStarted.current || primary?.fetch.status !== 'not_started') return;
    primaryStarted.current = true;
    startFetches('primary')
      .then((result) => result?.checklist && setChecklist((prev) => ({ ...prev, ...result.checklist })))
      .catch(() => { primaryStarted.current = false; });
  }, [primaryRegionDone, primary?.fetch.status]);

  const connectRegion = async (region) => {
    setOpeningRegion(region);
    try {
      await goToAmazon({ kind: 'spapi', region });
    } catch (err) {
      setOpeningRegion(null);
      setError(errorMessage(err, 'Could not open Amazon. Please try again.'));
    }
  };

  const finish = async () => {
    setContinuing(true);
    try {
      await startFetches('all');
      navigate('/analyse-account');
    } catch (err) {
      setContinuing(false);
      setError(errorMessage(err, 'Could not start preparing your data.'));
    }
  };

  if (!checklist) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bgBase }}>
        {error
          ? <p style={{ color: COLORS.textSecondary }}>{error}</p>
          : <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.accent }} />}
      </div>
    );
  }

  const unconfirmedRegion = connectedRegions.some((r) => r.available.some((m) => !r.confirmed.includes(m.country)) && r.confirmed.length === 0);
  const canContinue = Boolean(primary?.spApi) && !unconfirmedRegion;

  return (
    <OnboardingShell currentStep={primaryRegionDone ? 3 : 2} doneSteps={primaryRegionDone ? [1, 2] : [1]} maxWidth="680px">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 27, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em', color: COLORS.textPrimary }}>
          Your marketplaces
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: '22px', color: COLORS.textSecondary, maxWidth: '62ch' }}>
          Amazon approves one region at a time. Every marketplace you sell in within a region comes with a single approval.
        </p>

        {error && (
          <div className="flex items-start gap-2.5" role="alert" style={{ padding: '12px 14px', border: '1px solid rgba(239,68,68,.35)', borderRadius: 11, background: 'rgba(239,68,68,.08)', marginBottom: 14, fontSize: 13, color: '#FCA5A5' }}>
            <AlertTriangle className="w-4 h-4 flex-none" style={{ marginTop: 2 }} />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} style={{ color: COLORS.textMuted, fontSize: 12 }}>Dismiss</button>
          </div>
        )}

        {connectedRegions.map((region) => (
          <RegionCard
            key={region.region}
            region={region}
            checklist={checklist}
            adsSkipped={adsSkipped.includes(region.region)}
            onSkipAds={skipAds}
            onChecklist={(next) => { setError(''); setChecklist((prev) => ({ ...prev, ...next })); }}
            onError={setError}
          />
        ))}

        {otherRegions.length > 0 && (
          <div style={{ border: `1px dashed ${COLORS.borderStrong}`, borderRadius: 13, padding: 18, marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>Selling in another region?</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
              Add it now or later from Settings. Each region needs its own Amazon approval.
            </div>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              {otherRegions.map((region) => (
                <Button key={region} variant="secondary" onClick={() => connectRegion(region)} busy={openingRegion === region}>
                  <Plus className="w-4 h-4" /> {REGION_NAMES[region]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={finish} busy={continuing} disabled={!canContinue}>
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
          {primary?.fetch.status && primary.fetch.status !== 'not_started' && (
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: COLORS.textMuted }}>
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: COLORS.good }} />
              {countryName(primary.country)} is already being prepared
            </span>
          )}
        </div>
      </motion.div>
    </OnboardingShell>
  );
};

export default ConnectMarketplaces;
