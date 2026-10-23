import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'framer-motion';
import { Globe, ChevronDown, ArrowRight, Loader2, Search, AlertTriangle, Check } from 'lucide-react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { hasPremiumAccess } from '../../utils/subscriptionCheck.js';
import { devLog } from '../../utils/devLogger.js';
import OnboardingShell from '../../Components/Onboarding/OnboardingShell.jsx';
import { COLORS } from '../../Components/Shared/index.js';
import { COUNTRY_DATA, REGION_NAMES } from '../../utils/amazonMarketplaces.js';
import {
  fetchChecklist,
  goToAmazon,
  errorMessage,
  CHECKLIST_PATH,
} from '../../utils/multiMarketplaceOnboarding.js';

// Matches the onboarding shell's inset panel shade.
const PANEL_BG = '#10141C';

/** Regions of the picked marketplaces, the main marketplace's region first (it is approved first). */
const regionsOf = (codes, main) => {
  const regionOfCode = (c) => COUNTRY_DATA.find((x) => x.code === c)?.region;
  return [...new Set([regionOfCode(main), ...codes.map(regionOfCode)].filter(Boolean))];
};

/**
 * Multi-marketplace picker: tick every marketplace the seller sells in, choose one as main.
 * A list rather than a dropdown so several can be ticked and seen at once.
 */
const MarketplaceMultiPicker = ({ selected, main, onToggle, onMain }) => {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? COUNTRY_DATA.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : COUNTRY_DATA;
  }, [query]);
  const regions = regionsOf(selected, main);

  return (
    <div>
      <div className="relative" style={{ marginBottom: 10 }}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: COLORS.textMuted }} />
        <input
          type="text"
          placeholder="Search country..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 outline-none"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 10, fontSize: 13 }}
        />
      </div>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surface, overflow: 'hidden' }}>
        {['NA', 'EU', 'FE'].map((regionCode) => {
          const rows = visible.filter((c) => c.region === regionCode);
          if (!rows.length) return null;
          return (
            <div key={regionCode}>
              <div
                className="px-4 py-2"
                style={{ background: COLORS.surfaceElevated, fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `1px solid ${COLORS.border}` }}
              >
                {REGION_NAMES[regionCode]}
              </div>
              {rows.map((country) => {
                const on = selected.includes(country.code);
                const isMain = on && main === country.code;
                return (
                  <div
                    key={country.code}
                    className="flex items-center gap-3 px-4"
                    style={{ minHeight: 42, background: on ? 'rgba(59,130,246,.08)' : 'transparent', borderBottom: `1px solid ${COLORS.border}` }}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(country.code)}
                      aria-pressed={on}
                      className="flex flex-1 items-center gap-3 text-left py-2.5"
                      style={{ fontSize: 13, color: on ? COLORS.textPrimary : COLORS.textSecondary }}
                    >
                      <span
                        className="flex items-center justify-center flex-none"
                        style={{ width: 18, height: 18, borderRadius: 5, background: on ? COLORS.accent : 'transparent', border: `1px solid ${on ? COLORS.accent : COLORS.borderStrong}` }}
                      >
                        {on && <Check className="w-3 h-3" style={{ color: '#061021' }} />}
                      </span>
                      <span style={{ fontSize: 16 }}>{country.flag}</span>
                      <span className="flex-1">{country.name}</span>
                    </button>
                    {isMain ? (
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'rgba(59,130,246,.16)', color: '#7EA8F8' }}>Main</span>
                    ) : on ? (
                      <button type="button" onClick={() => onMain(country.code)} style={{ fontSize: 11, color: COLORS.textMuted }}>
                        Make main
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!visible.length && (
          <div className="px-4 py-8 text-center" style={{ color: COLORS.textMuted, fontSize: 13 }}>
            No countries found matching &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: COLORS.textSecondary }}>
          {selected.length} marketplace{selected.length === 1 ? '' : 's'} in {regions.length} region{regions.length === 1 ? '' : 's'}
          {' — '}you&rsquo;ll approve {regions.map((r) => REGION_NAMES[r]).join(', then ')}
          {regions.length > 1 ? ' (main marketplace’s region first).' : '.'}
        </div>
      )}
    </div>
  );
};

// `basePath`, when given, overrides the agency-derived client route prefix so
// other portals (e.g. the ESF staff portal) can reuse this flow unchanged.
const AmazonConnect = ({ isAgencyContext = false, clientId = null, agencyName = '', basePath = '' }) => {
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  // Multi-marketplace onboarding (server-flagged, self-serve sellers only): this page then picks
  // the MAIN marketplace and goes straight to Amazon; the other marketplaces come next.
  const isSelfServe = !isAgencyContext && !basePath;
  const [multiMarketplace, setMultiMarketplace] = useState(false);
  // Multi mode: every marketplace the seller sells in; `marketPlace` is the main one among them.
  const [picked, setPicked] = useState([]);

  const chooseMain = (code) => {
    const country = COUNTRY_DATA.find((c) => c.code === code);
    if (!country) return;
    setMarketPlace(code);
    setRegion(country.region);
  };

  const togglePicked = (code) => {
    const next = picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code];
    setPicked(next);
    // The first pick is the main one until the seller says otherwise; un-picking the main one
    // hands it to the next pick.
    if (!next.includes(marketPlace)) {
      if (next.length) chooseMain(next[0]); else { setMarketPlace(''); setRegion(''); }
    }
  };
  const marketplaceDropdownRef = useRef(null);
  const navigate = useNavigate();

  // Close the marketplace dropdown on an outside click. Uses a document listener rather
  // than a full-screen overlay div — a `position: fixed` overlay sits outside the content
  // column's scroll chain, which would swallow the wheel and block page scrolling.
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (event) => {
      if (marketplaceDropdownRef.current && !marketplaceDropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);
  
  // Get user data from Redux
  const userData = useSelector(state => state.Auth?.user);
  const isAuthenticated = useSelector(state => state.Auth?.isAuthenticated) || localStorage.getItem('isAuth') === 'true';

  // Check authentication on mount - allow all authenticated users to proceed
  useEffect(() => {
    const checkAuth = async () => {
      // If not authenticated, redirect to login
      if (!isAuthenticated) {
        devLog('ConnectToAmazon: Not authenticated - redirecting to login');
        navigate('/', { replace: true });
        return;
      }

      // Allow all authenticated users to proceed (skip pricing check)
      // New signups with LITE package can connect Amazon first, then pay later
      devLog('ConnectToAmazon: User authenticated - allowing access');
      if (isSelfServe) {
        try {
          const checklist = await fetchChecklist();
          if (checklist?.enabled) {
            // Already part-way through: carry on from the checklist.
            if (checklist.primary) {
              navigate(CHECKLIST_PATH, { replace: true });
              return;
            }
            setMultiMarketplace(true);
          }
        } catch {
          // Unknown: keep the current single-marketplace flow.
        }
      }
      setCheckingSubscription(false);
    };

    checkAuth();
  }, [isAuthenticated, navigate, isSelfServe]);
  
  // Get selected country data
  const selectedCountry = useMemo(() => {
    return COUNTRY_DATA.find(country => country.code === marketPlace);
  }, [marketPlace]);

  // Filter countries based on search query
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return COUNTRY_DATA;
    const query = searchQuery.toLowerCase();
    return COUNTRY_DATA.filter(country => 
      country.name.toLowerCase().includes(query) || 
      country.code.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const handleCountrySelect = (countryCode) => {
    const country = COUNTRY_DATA.find(c => c.code === countryCode);
    if (country) {
      setMarketPlace(countryCode);
      setRegion(country.region);
      setIsDropdownOpen(false);
      setSearchQuery("");

      devLog("ConnectToAmazon country select:", {
        countryName: country.name,
        countryCode,
        region: country.region,
        regionName: REGION_NAMES[country.region],
        marketplaceId: country.marketplaceId,
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate selections
    if (!region || !marketPlace) {
      alert("Please select a country");
      return;
    }
    
    setLoading(true);

    if (multiMarketplace) {
      try {
        // Nothing is saved yet: the marketplace is created once Amazon approves the region.
        await goToAmazon({ kind: 'spapi', region, primaryCountry: marketPlace, plannedCountries: picked });
      } catch (error) {
        setLoading(false);
        alert(errorMessage(error, 'Could not open Amazon. Please try again.'));
      }
      return;
    }

    try {
      devLog("ConnectToAmazon submit:", { region, country: marketPlace });
      
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/token/SaveAllDetails`, {
        region: region,
        country: marketPlace
      }, { withCredentials: true });

      // Redirect to connect accounts page with region and country parameters
      if (response.status === 201) {
        setLoading(false);
        if (basePath) {
          navigate(`${basePath}/connect-accounts?country=${marketPlace}&region=${region}`);
        } else if (isAgencyContext && clientId && agencyName) {
          navigate(`/agency/${encodeURIComponent(agencyName)}/client/${clientId}/connect-accounts?country=${marketPlace}&region=${region}`);
        } else {
          navigate(`/connect-accounts?country=${marketPlace}&region=${region}`);
        }
      }

    } catch (error) {
      setLoading(false);
      console.error("Error saving details:", error);
      alert("Failed to save marketplace details. Please try again.");
    }
  };

  // Show loading state while checking subscription
  if (checkingSubscription) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bgBase }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.accent }} />
          <p style={{ color: COLORS.textSecondary }}>Verifying subscription...</p>
        </div>
      </div>
    );
  }

  return (
    <OnboardingShell currentStep={2} doneSteps={[1]}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div
          className="inline-flex items-center gap-2"
          style={{ padding: '5px 11px', borderRadius: 999, background: 'rgba(59,130,246,.12)', color: '#7EA8F8', fontSize: 12, fontWeight: 600, marginBottom: 16 }}
        >
          Step 2 of 4 · About 60 seconds
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: 27, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em', color: COLORS.textPrimary }}>
          Connect Amazon Seller Central
        </h1>
        <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: '22px', color: COLORS.textSecondary, maxWidth: '62ch' }}>
          This is the one step that makes SellerQI work. Until it&rsquo;s connected we have nothing to audit — every screen in the product stays empty.
        </p>

        {/* What happens next — describes the real sequence: pick marketplace here, then Amazon's consent page */}
        <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.surface, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: COLORS.textPrimary }}>Exactly what happens next</div>
          <div className="flex flex-col" style={{ gap: 13 }}>
            {[
              multiMarketplace
                ? 'You tick the marketplaces you sell in and choose a main one — the one you want to see first.'
                : 'You pick the marketplace your account sells in — that tells us which Amazon region to talk to.',
              "Amazon's own consent page opens, so you sign in on amazon.com and not on our site.",
              'Amazon sends you back here and the scan starts. No keys to copy, nothing to paste.',
            ].map((line, i) => (
              <div key={i} className="flex" style={{ gap: 13 }}>
                <span
                  className="flex-none flex items-center justify-center"
                  style={{ width: 22, height: 22, borderRadius: 999, background: COLORS.surfaceElevated, color: COLORS.textSecondary, fontSize: 11, fontWeight: 700 }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, lineHeight: '20px', color: '#C7CFDD' }}>{line}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Access disclosure. Worded to match what the app actually does: it reads broadly, and it
            can write to ads/listings but only on an explicit click, never on its own. */}
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12, marginBottom: 22 }}>
          <div style={{ border: '1px solid rgba(34,197,94,.22)', borderRadius: 12, background: PANEL_BG, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.good, marginBottom: 10 }}>
              What we read
            </div>
            <div className="flex flex-col" style={{ gap: 7, fontSize: 13, lineHeight: '19px', color: '#C7CFDD' }}>
              <div>Listings, inventory and pricing</div>
              <div>Orders, returns and FBA fees</div>
              <div>Account health metrics</div>
            </div>
          </div>
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, background: PANEL_BG, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.textMuted, marginBottom: 10 }}>
              What we never do on our own
            </div>
            <div className="flex flex-col" style={{ gap: 7, fontSize: 13, lineHeight: '19px', color: COLORS.textSecondary }}>
              <div>Change a price, listing or bid unless you click to apply it</div>
              <div>Contact your customers</div>
              <div>Move money or open cases for you</div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* One marketplace only, and it governs both connections — flagged up front
              because picking the wrong one here makes the Ads profiles in step 3 mismatch.
              With multi-marketplace onboarding this is only the MAIN one, so say that instead. */}
          {multiMarketplace ? (
            <div
              className="flex items-start gap-2.5"
              style={{ padding: '13px 15px', border: '1px solid rgba(59,130,246,.3)', borderRadius: 11, background: 'rgba(59,130,246,.07)', marginBottom: 16 }}
            >
              <Globe className="w-4 h-4 flex-shrink-0" style={{ color: '#7EA8F8', marginTop: 1 }} />
              <div style={{ fontSize: 13, lineHeight: '20px', color: '#C7CFDD' }}>
                <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>Tick every marketplace you sell in.</span>{' '}
                Amazon approves one region at a time, so you&rsquo;ll approve once per region — every marketplace in that
                region comes with it. Choose a main marketplace: it&rsquo;s prepared first and opens your dashboard.
              </div>
            </div>
          ) : (
          <div
            className="flex items-start gap-2.5"
            style={{ padding: '13px 15px', border: '1px solid rgba(245,166,35,.3)', borderRadius: 11, background: 'rgba(245,166,35,.07)', marginBottom: 16 }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.watch, marginTop: 1 }} />
            <div style={{ fontSize: 13, lineHeight: '20px', color: '#C7CFDD' }}>
              <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>Pick one marketplace.</span>{' '}
              This same marketplace is used for both your Seller Central and Amazon Ads connections, and only
              one can be connected during setup. Choosing a different one later means reconnecting both accounts.
            </div>
          </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 8 }}>
              <Globe className="w-3.5 h-3.5" style={{ color: COLORS.textMuted }} />
              {multiMarketplace ? 'Which marketplaces do you sell in?' : 'Which marketplace is your account in?'}
            </label>

                  {multiMarketplace ? (
                    <MarketplaceMultiPicker selected={picked} main={marketPlace} onToggle={togglePicked} onMain={chooseMain} />
                  ) : (
                  <div className="relative" ref={marketplaceDropdownRef}>
                    {/* Selected Country Display / Dropdown Trigger */}
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full outline-none transition-colors text-left flex items-center justify-between"
                      style={{ padding: '11px 14px', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 13, color: COLORS.textPrimary }}
                    >
                      {selectedCountry ? (
                        <span className="flex items-center gap-2">
                          <span style={{ fontSize: 16 }}>{selectedCountry.flag}</span>
                          <span>{selectedCountry.name}</span>
                          <span
                            style={{ fontSize: 11, color: COLORS.textSecondary, background: COLORS.surfaceElevated, padding: '2px 8px', borderRadius: 999, marginLeft: 4 }}
                          >
                            {REGION_NAMES[selectedCountry.region]}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: COLORS.textMuted }}>Select your marketplace</span>
                      )}
                      <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} style={{ color: COLORS.textMuted }} />
                    </button>

                    {/* Dropdown */}
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 w-full mt-2 overflow-hidden"
                        style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.5)' }}
                      >
                        {/* Search Input */}
                        <div className="p-2.5" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: COLORS.textMuted }} />
                            <input
                              type="text"
                              placeholder="Search country..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 outline-none"
                              style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, fontSize: 13 }}
                              onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                              onBlur={(e) => e.target.style.borderColor = COLORS.border}
                              autoFocus
                            />
                          </div>
                        </div>

                        {/* Country List — intentionally not its own scroll container, so the
                            wheel scrolls the whole page (dropdown included) instead of just this list. */}
                        <div>
                          {filteredCountries.length === 0 ? (
                            <div className="px-4 py-8 text-center" style={{ color: COLORS.textMuted, fontSize: 13 }}>
                              No countries found matching &ldquo;{searchQuery}&rdquo;
                            </div>
                          ) : (
                            <>
                              {/* Group by region */}
                              {['NA', 'EU', 'FE'].map(regionCode => {
                                const regionCountries = filteredCountries.filter(c => c.region === regionCode);
                                if (regionCountries.length === 0) return null;

                                return (
                                  <div key={regionCode}>
                                    <div
                                      className="px-4 py-2"
                                      style={{ background: COLORS.surfaceElevated, fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `1px solid ${COLORS.border}` }}
                                    >
                                      {REGION_NAMES[regionCode]}
                                    </div>
                                    {regionCountries.map(country => (
                                      <button
                                        key={country.code}
                                        type="button"
                                        onClick={() => handleCountrySelect(country.code)}
                                        className="w-full px-4 py-2.5 text-left transition-colors flex items-center gap-3"
                                        style={{
                                          fontSize: 13,
                                          color: marketPlace === country.code ? COLORS.textPrimary : COLORS.textSecondary,
                                          background: marketPlace === country.code ? 'rgba(59,130,246,.12)' : 'transparent',
                                        }}
                                        onMouseEnter={(e) => { if (marketPlace !== country.code) e.currentTarget.style.background = COLORS.surfaceElevated; }}
                                        onMouseLeave={(e) => { if (marketPlace !== country.code) e.currentTarget.style.background = 'transparent'; }}
                                      >
                                        <span style={{ fontSize: 16 }}>{country.flag}</span>
                                        <span className="flex-1">{country.name}</span>
                                        <span style={{ fontSize: 11, color: COLORS.textMuted }}>{country.code}</span>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                  )}
          </div>

          <button
            type="submit"
            disabled={loading || !region || !marketPlace}
            className="inline-flex items-center justify-center gap-2 transition-colors"
            style={{
              padding: '13px 22px',
              border: 0,
              borderRadius: 10,
              background: loading || !region || !marketPlace ? COLORS.surfaceElevated : COLORS.accent,
              color: loading || !region || !marketPlace ? COLORS.textMuted : '#061021',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || !region || !marketPlace ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {multiMarketplace ? 'Opening Amazon…' : 'Saving…'}
              </>
            ) : (
              <>
                Connect with Amazon
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div style={{ marginTop: 14, fontSize: 12, color: COLORS.textMuted }}>
            Read-only to start. You can revoke access from Seller Central at any time.
          </div>
        </form>
      </motion.div>
    </OnboardingShell>
  );
};

export default AmazonConnect;