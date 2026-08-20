import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'framer-motion';
import { Globe, ChevronDown, ArrowRight, Loader2, Search } from 'lucide-react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { hasPremiumAccess } from '../../utils/subscriptionCheck.js';
import { devLog } from '../../utils/devLogger.js';
import OnboardingShell from '../../Components/Onboarding/OnboardingShell.jsx';
import { COLORS } from '../../Components/Shared/index.js';

// Matches the onboarding shell's inset panel shade.
const PANEL_BG = '#10141C';

// Complete list of Amazon marketplaces with region mapping
const COUNTRY_DATA = [
  // North America (NA)
  { code: 'CA', name: 'Canada', marketplaceId: 'A2EUQ1WTGCTBG2', region: 'NA', flag: '🇨🇦' },
  { code: 'US', name: 'United States of America', marketplaceId: 'ATVPDKIKX0DER', region: 'NA', flag: '🇺🇸' },
  { code: 'MX', name: 'Mexico', marketplaceId: 'A1AM78C64UM0Y8', region: 'NA', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', marketplaceId: 'A2Q3Y263D00KWC', region: 'NA', flag: '🇧🇷' },
  
  // Europe (EU)
  { code: 'IE', name: 'Ireland', marketplaceId: 'A28R8C7NBKEWEA', region: 'EU', flag: '🇮🇪' },
  { code: 'ES', name: 'Spain', marketplaceId: 'A1RKKUPIHCS9HS', region: 'EU', flag: '🇪🇸' },
  { code: 'UK', name: 'United Kingdom', marketplaceId: 'A1F83G8C2ARO7P', region: 'EU', flag: '🇬🇧' },
  { code: 'FR', name: 'France', marketplaceId: 'A13V1IB3VIYZZH', region: 'EU', flag: '🇫🇷' },
  { code: 'BE', name: 'Belgium', marketplaceId: 'AMEN7PMS3EDWL', region: 'EU', flag: '🇧🇪' },
  { code: 'NL', name: 'Netherlands', marketplaceId: 'A1805IZSGTT6HS', region: 'EU', flag: '🇳🇱' },
  { code: 'DE', name: 'Germany', marketplaceId: 'A1PA6795UKMFR9', region: 'EU', flag: '🇩🇪' },
  { code: 'IT', name: 'Italy', marketplaceId: 'APJ6JRA9NG5V4', region: 'EU', flag: '🇮🇹' },
  { code: 'SE', name: 'Sweden', marketplaceId: 'A2NODRKZP88ZB9', region: 'EU', flag: '🇸🇪' },
  { code: 'ZA', name: 'South Africa', marketplaceId: 'AE08WJ6YKNBMC', region: 'EU', flag: '🇿🇦' },
  { code: 'PL', name: 'Poland', marketplaceId: 'A1C3SOZRARQ6R3', region: 'EU', flag: '🇵🇱' },
  { code: 'EG', name: 'Egypt', marketplaceId: 'ARBP9OOSHTCHU', region: 'EU', flag: '🇪🇬' },
  { code: 'TR', name: 'Turkey', marketplaceId: 'A33AVAJ2PDY3EV', region: 'EU', flag: '🇹🇷' },
  { code: 'SA', name: 'Saudi Arabia', marketplaceId: 'A17E79C6D8DWNP', region: 'EU', flag: '🇸🇦' },
  { code: 'AE', name: 'United Arab Emirates', marketplaceId: 'A2VIGQ35RCS4UG', region: 'EU', flag: '🇦🇪' },
  { code: 'IN', name: 'India', marketplaceId: 'A21TJRUUN4KGV', region: 'EU', flag: '🇮🇳' },
  
  // Far East (FE)
  { code: 'SG', name: 'Singapore', marketplaceId: 'A19VAU5U5O7RUS', region: 'FE', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', marketplaceId: 'A39IBJ37TRP1C6', region: 'FE', flag: '🇦🇺' },
  { code: 'JP', name: 'Japan', marketplaceId: 'A1VC38T7YXB528', region: 'FE', flag: '🇯🇵' },
];

// Region display names
const REGION_NAMES = {
  'NA': 'North America',
  'EU': 'Europe',
  'FE': 'Far East'
};

const AmazonConnect = ({ isAgencyContext = false, clientId = null, agencyName = '' }) => {
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
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
      setCheckingSubscription(false);
    };

    checkAuth();
  }, [isAuthenticated, navigate]);
  
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
    try {
      devLog("ConnectToAmazon submit:", { region, country: marketPlace });
      
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/token/SaveAllDetails`, {
        region: region,
        country: marketPlace
      }, { withCredentials: true });

      // Redirect to connect accounts page with region and country parameters
      if (response.status === 201) {
        setLoading(false);
        if (isAgencyContext && clientId && agencyName) {
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
          Step 2 of 5 · About 60 seconds
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
              'You pick the marketplace your account sells in — that tells us which Amazon region to talk to.',
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
          <div style={{ marginBottom: 14 }}>
            <label className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 8 }}>
              <Globe className="w-3.5 h-3.5" style={{ color: COLORS.textMuted }} />
              Which marketplace is your account in?
            </label>

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
                Saving…
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