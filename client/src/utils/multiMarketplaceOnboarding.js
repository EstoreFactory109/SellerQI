/**
 * Client side of multi-marketplace onboarding (server: /app/onboarding).
 *
 * The server mints a single-use OAuth `state` for each trip to Amazon and remembers the user,
 * region and kind of connection it is for. The browser only remembers that the trip is ours (the
 * state value and its kind), so the shared /auth/callback page can tell an onboarding return
 * from the existing single-marketplace flow and hand it to the right endpoint. The region always
 * comes back from the server, never from here.
 */
import axiosInstance from '../config/axios.config.js';
import { sellerCentralConsentUrl, adsConsentUrl } from './amazonMarketplaces.js';

const PENDING_KEY = 'sqi_mm_onboarding_oauth';
export const CHECKLIST_PATH = '/connect-marketplaces';

const data = (response) => response?.data?.data;

/** { enabled: false } or { enabled: true, primary, regions, marketplaces }. */
export const fetchChecklist = async () => data(await axiosInstance.get('/app/onboarding/marketplaces'));

export const isMultiMarketplaceOnboardingOn = async () => {
  try {
    return Boolean((await fetchChecklist())?.enabled);
  } catch {
    return false;
  }
};

/**
 * Send the seller to Amazon to approve a region.
 * @param {{kind: 'spapi'|'ads', region: string, country?: string, primaryCountry?: string, plannedCountries?: string[]}} options
 *   country: which Seller Central site opens; primaryCountry: the main marketplace, first trip only;
 *   plannedCountries: every marketplace the seller ticked up front, first trip only
 */
export const goToAmazon = async ({ kind, region, country, primaryCountry, plannedCountries }) => {
  const response = await axiosInstance.post('/app/onboarding/oauth-state', {
    kind,
    region,
    ...(primaryCountry ? { primaryCountry } : {}),
    ...(primaryCountry && plannedCountries?.length ? { plannedCountries } : {}),
  });
  const state = data(response)?.state;
  if (!state) throw new Error('Could not start the Amazon connection');

  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, kind }));
  } catch { /* the server still validates the state; this only routes the callback */ }

  const redirectUri = `${window.location.origin}/auth/callback`;
  window.location.href = kind === 'spapi'
    ? sellerCentralConsentUrl({
      region,
      country: country || primaryCountry,
      state,
      applicationId: import.meta.env.VITE_APP_ID,
      redirectUri,
      beta: import.meta.env.VITE_APP_BETA === 'true',
    })
    : adsConsentUrl({
      region,
      state,
      clientId: import.meta.env.VITE_ADS_CLIENT_ID || 'amzn1.application-oa2-client.cd1d81266e80444e97c6ae8795345d93',
      redirectUri,
    });
};

/** The pending onboarding trip this callback belongs to, or null when it is not ours. */
export const pendingOnboardingTrip = (stateFromAmazon) => {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    return pending && stateFromAmazon && pending.state === stateFromAmazon ? pending : null;
  } catch {
    return null;
  }
};

/**
 * Finish an onboarding trip on /auth/callback.
 * @returns the server's answer ({ region, ...checklist })
 */
export const completeAmazonTrip = async ({ kind, state, authCode, sellingPartnerId }) => {
  try {
    const response = kind === 'spapi'
      ? await axiosInstance.post('/app/onboarding/spapi/callback', { state, authCode, sellingPartnerId })
      : await axiosInstance.post('/app/onboarding/ads/callback', { state, authCode });
    return data(response);
  } finally {
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
  }
};

export const confirmMarketplaces = async (region, countries) =>
  data(await axiosInstance.post('/app/onboarding/marketplaces', { region, countries }));

export const saveAdsProfiles = async (region, mapping) =>
  data(await axiosInstance.post('/app/onboarding/ads/profiles', { region, mapping }));

export const startFetches = async (scope) =>
  data(await axiosInstance.post('/app/onboarding/start', { scope }));

/** The server's message for a failed request, for showing to the seller. */
export const errorMessage = (error, fallback) => error?.response?.data?.message || fallback;
