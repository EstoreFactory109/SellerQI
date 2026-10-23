/**
 * The Amazon marketplaces SellerQI supports: one list for every onboarding screen.
 *
 * Before this, the same country list was copied into ConnectToAmazon and AmazonConnectPopup, and
 * the Seller Central hosts lived only inside ConnectAccounts. Country codes are SellerQI's ("UK",
 * not Amazon's "GB"), matching what the server stores.
 *
 * Amazon authorises per REGION (NA / EU / FE): one Seller Central approval covers every
 * marketplace that seller account sells in within the region, and one Ads login covers the
 * region's ad profiles. Multi-marketplace onboarding connects each region once.
 */

export const REGION_NAMES = {
  NA: 'North America',
  EU: 'Europe',
  FE: 'Far East',
};

export const REGIONS = ['NA', 'EU', 'FE'];

export const COUNTRY_DATA = [
  // North America (NA)
  { code: 'CA', name: 'Canada', marketplaceId: 'A2EUQ1WTGCTBG2', region: 'NA', flag: '🇨🇦', sellerCentralUrl: 'https://sellercentral.amazon.ca' },
  { code: 'US', name: 'United States of America', marketplaceId: 'ATVPDKIKX0DER', region: 'NA', flag: '🇺🇸', sellerCentralUrl: 'https://sellercentral.amazon.com' },
  { code: 'MX', name: 'Mexico', marketplaceId: 'A1AM78C64UM0Y8', region: 'NA', flag: '🇲🇽', sellerCentralUrl: 'https://sellercentral.amazon.com.mx' },
  { code: 'BR', name: 'Brazil', marketplaceId: 'A2Q3Y263D00KWC', region: 'NA', flag: '🇧🇷', sellerCentralUrl: 'https://sellercentral.amazon.com.br' },

  // Europe (EU)
  { code: 'IE', name: 'Ireland', marketplaceId: 'A28R8C7NBKEWEA', region: 'EU', flag: '🇮🇪', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'ES', name: 'Spain', marketplaceId: 'A1RKKUPIHCS9HS', region: 'EU', flag: '🇪🇸', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'UK', name: 'United Kingdom', marketplaceId: 'A1F83G8C2ARO7P', region: 'EU', flag: '🇬🇧', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'FR', name: 'France', marketplaceId: 'A13V1IB3VIYZZH', region: 'EU', flag: '🇫🇷', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'BE', name: 'Belgium', marketplaceId: 'AMEN7PMS3EDWL', region: 'EU', flag: '🇧🇪', sellerCentralUrl: 'https://sellercentral.amazon.com.be' },
  { code: 'NL', name: 'Netherlands', marketplaceId: 'A1805IZSGTT6HS', region: 'EU', flag: '🇳🇱', sellerCentralUrl: 'https://sellercentral.amazon.nl' },
  { code: 'DE', name: 'Germany', marketplaceId: 'A1PA6795UKMFR9', region: 'EU', flag: '🇩🇪', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'IT', name: 'Italy', marketplaceId: 'APJ6JRA9NG5V4', region: 'EU', flag: '🇮🇹', sellerCentralUrl: 'https://sellercentral-europe.amazon.com' },
  { code: 'SE', name: 'Sweden', marketplaceId: 'A2NODRKZP88ZB9', region: 'EU', flag: '🇸🇪', sellerCentralUrl: 'https://sellercentral.amazon.se' },
  { code: 'ZA', name: 'South Africa', marketplaceId: 'AE08WJ6YKNBMC', region: 'EU', flag: '🇿🇦', sellerCentralUrl: 'https://sellercentral.amazon.co.za' },
  { code: 'PL', name: 'Poland', marketplaceId: 'A1C3SOZRARQ6R3', region: 'EU', flag: '🇵🇱', sellerCentralUrl: 'https://sellercentral.amazon.pl' },
  { code: 'EG', name: 'Egypt', marketplaceId: 'ARBP9OOSHTCHU', region: 'EU', flag: '🇪🇬', sellerCentralUrl: 'https://sellercentral.amazon.eg' },
  { code: 'TR', name: 'Turkey', marketplaceId: 'A33AVAJ2PDY3EV', region: 'EU', flag: '🇹🇷', sellerCentralUrl: 'https://sellercentral.amazon.com.tr' },
  { code: 'SA', name: 'Saudi Arabia', marketplaceId: 'A17E79C6D8DWNP', region: 'EU', flag: '🇸🇦', sellerCentralUrl: 'https://sellercentral.amazon.sa' },
  { code: 'AE', name: 'United Arab Emirates', marketplaceId: 'A2VIGQ35RCS4UG', region: 'EU', flag: '🇦🇪', sellerCentralUrl: 'https://sellercentral.amazon.ae' },
  { code: 'IN', name: 'India', marketplaceId: 'A21TJRUUN4KGV', region: 'EU', flag: '🇮🇳', sellerCentralUrl: 'https://sellercentral.amazon.in' },

  // Far East (FE)
  { code: 'SG', name: 'Singapore', marketplaceId: 'A19VAU5U5O7RUS', region: 'FE', flag: '🇸🇬', sellerCentralUrl: 'https://sellercentral.amazon.sg' },
  { code: 'AU', name: 'Australia', marketplaceId: 'A39IBJ37TRP1C6', region: 'FE', flag: '🇦🇺', sellerCentralUrl: 'https://sellercentral.amazon.com.au' },
  { code: 'JP', name: 'Japan', marketplaceId: 'A1VC38T7YXB528', region: 'FE', flag: '🇯🇵', sellerCentralUrl: 'https://sellercentral.amazon.co.jp' },
];

/** Amazon Ads (Login with Amazon) authorisation host per region. */
export const ADS_OAUTH_BASE_BY_REGION = {
  NA: 'https://www.amazon.com',
  EU: 'https://eu.account.amazon.com',
  FE: 'https://apac.account.amazon.com',
};

/** Where the region's Seller Central approval opens when no marketplace is named. */
const REGION_DEFAULT_COUNTRY = { NA: 'US', EU: 'UK', FE: 'JP' };

export const getCountry = (code) => COUNTRY_DATA.find((c) => c.code === String(code || '').toUpperCase()) || null;

export const countryName = (code) => getCountry(code)?.name || code;

export const countryFlag = (code) => getCountry(code)?.flag || '🌐';

export const countriesInRegion = (region) => COUNTRY_DATA.filter((c) => c.region === region);

/**
 * Amazon Seller Central consent URL for a region. `country` picks which Seller Central site
 * opens (a seller recognises their own); the approval covers the region either way.
 */
export const sellerCentralConsentUrl = ({ region, country, state, applicationId, redirectUri, beta }) => {
  const site = getCountry(country)?.region === region ? getCountry(country) : getCountry(REGION_DEFAULT_COUNTRY[region]);
  const url = new URL(`${site.sellerCentralUrl}/apps/authorize/consent`);
  url.searchParams.append('application_id', applicationId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('state', state);
  if (beta) url.searchParams.append('version', 'beta');
  return url.toString();
};

/** Amazon Ads (Login with Amazon) consent URL for a region. */
export const adsConsentUrl = ({ region, state, clientId, redirectUri }) => {
  const url = new URL(`${ADS_OAUTH_BASE_BY_REGION[region] || ADS_OAUTH_BASE_BY_REGION.NA}/ap/oa`);
  url.searchParams.append('client_id', clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', 'advertising::campaign_management');
  url.searchParams.append('state', state);
  return url.toString();
};
