/**
 * The Amazon marketplaces SellerQI supports, by region.
 *
 * Amazon authorises per region (NA / EU / FE): one Seller Central approval yields a token for
 * every marketplace that seller account sells in within the region. Multi-marketplace onboarding
 * groups marketplaces by region and connects each region once.
 *
 * Marketplace ids come from controllers/config/config.js (the map the data pipeline uses), so a
 * country onboarding offers is always one the pipeline can fetch. Countries use SellerQI's codes
 * ("UK", not Amazon's "GB"); Amazon's responses are matched by marketplace id, never by country.
 */
const { marketplaceConfig } = require('../../controllers/config/config.js');

const REGIONS = ['NA', 'EU', 'FE'];

/** Region of each supported country (SpApiMarketplace's map, plus Ireland which it lacks). */
const REGION_OF = {
    US: 'NA', CA: 'NA', MX: 'NA', BR: 'NA',
    UK: 'EU', IE: 'EU', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', NL: 'EU', SE: 'EU', PL: 'EU',
    BE: 'EU', TR: 'EU', AE: 'EU', SA: 'EU', EG: 'EU', IN: 'EU', ZA: 'EU',
    JP: 'FE', AU: 'FE', SG: 'FE',
};

/** SP-API host per region. */
const SP_API_HOSTS = {
    NA: 'sellingpartnerapi-na.amazon.com',
    EU: 'sellingpartnerapi-eu.amazon.com',
    FE: 'sellingpartnerapi-fe.amazon.com',
};

const MARKETPLACES = Object.entries(marketplaceConfig)
    .filter(([country]) => REGION_OF[country])
    .map(([country, marketplaceId]) => ({ country, marketplaceId, region: REGION_OF[country] }));

const BY_ID = new Map(MARKETPLACES.map((m) => [m.marketplaceId, m]));

const isRegion = (region) => REGIONS.includes(region);
const regionOf = (country) => REGION_OF[String(country || '').toUpperCase()] || null;
const marketplaceById = (marketplaceId) => BY_ID.get(marketplaceId) || null;
const countriesInRegion = (region) => MARKETPLACES.filter((m) => m.region === region).map((m) => m.country);

/**
 * Amazon Ads profiles report Amazon's country code ("GB" for the UK).
 * Returns SellerQI's code for it.
 */
const fromAmazonCountryCode = (code) => {
    const upper = String(code || '').toUpperCase();
    return upper === 'GB' ? 'UK' : upper;
};

module.exports = {
    REGIONS,
    SP_API_HOSTS,
    MARKETPLACES,
    isRegion,
    regionOf,
    marketplaceById,
    countriesInRegion,
    fromAmazonCountryCode,
};
