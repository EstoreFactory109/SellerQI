/**
 * Marketplace → currency lookup (server side).
 *
 * Amazon returns every monetary figure in the marketplace's own currency
 * (EconomicsMetrics, Ads API, storage fees, etc.), so any dollar amount we
 * compute is implicitly marketplace-local. Anything that renders or stores a
 * money figure needs the matching currency, otherwise a UK seller sees "$" on
 * GBP amounts.
 *
 * Symbols mirror client/src/utils/amazonAllowedCountries.js exactly so the
 * frontend and backend can't drift. ISO codes are added here because
 * user-visible prose reads better with an unambiguous code ("AUD 572.57")
 * than with a symbol several marketplaces share ("$" covers US/AU/MX/SG).
 */

// country code → ISO 4217 currency code
const MARKETPLACE_CURRENCY_CODES = Object.freeze({
    // North America
    US: 'USD',
    CA: 'CAD',
    MX: 'MXN',
    BR: 'BRL',

    // Europe
    GB: 'GBP',
    UK: 'GBP', // alternative code used in parts of this codebase
    DE: 'EUR',
    FR: 'EUR',
    IT: 'EUR',
    ES: 'EUR',
    NL: 'EUR',
    SE: 'SEK',
    PL: 'PLN',
    BE: 'EUR',
    TR: 'TRY',

    // Asia Pacific
    JP: 'JPY',
    AU: 'AUD',
    SG: 'SGD',
    IN: 'INR',

    // Middle East
    AE: 'AED',
    SA: 'SAR',
    EG: 'EGP',
});

// country code → display symbol (kept in sync with the client map)
const MARKETPLACE_CURRENCY_SYMBOLS = Object.freeze({
    US: '$',
    CA: 'C$',
    MX: '$',
    BR: 'R$',

    GB: '£',
    UK: '£',
    DE: '€',
    FR: '€',
    IT: '€',
    ES: '€',
    NL: '€',
    SE: 'kr',
    PL: 'zł',
    BE: '€',
    TR: '₺',

    JP: '¥',
    AU: '$',
    SG: '$',
    IN: '₹',

    AE: 'د.إ',
    SA: '﷼',
    EG: '£',
});

const DEFAULT_CURRENCY_CODE = 'USD';
const DEFAULT_CURRENCY_SYMBOL = '$';

/**
 * @param {string} country - marketplace country code (e.g. 'AU')
 * @returns {string} ISO 4217 code, defaulting to 'USD' for unknown markets
 */
function getCurrencyCode(country) {
    if (!country || typeof country !== 'string') return DEFAULT_CURRENCY_CODE;
    return MARKETPLACE_CURRENCY_CODES[country.toUpperCase()] || DEFAULT_CURRENCY_CODE;
}

/**
 * @param {string} country - marketplace country code (e.g. 'UK')
 * @returns {string} display symbol, defaulting to '$' for unknown markets
 */
function getCurrencySymbol(country) {
    if (!country || typeof country !== 'string') return DEFAULT_CURRENCY_SYMBOL;
    return MARKETPLACE_CURRENCY_SYMBOLS[country.toUpperCase()] || DEFAULT_CURRENCY_SYMBOL;
}

/**
 * Format a money figure for user-visible prose generated on the server.
 * Uses the ISO code rather than the symbol because several marketplaces share
 * "$" — "AUD 572.57" is unambiguous where "$572.57" is not.
 *
 * @param {number} amount
 * @param {string} country
 * @returns {string} e.g. "AUD 572.57"
 */
function formatMoneyForProse(amount, country) {
    const value = Number(amount) || 0;
    return `${getCurrencyCode(country)} ${value.toFixed(2)}`;
}

module.exports = {
    getCurrencyCode,
    getCurrencySymbol,
    formatMoneyForProse,
    MARKETPLACE_CURRENCY_CODES,
    MARKETPLACE_CURRENCY_SYMBOLS,
    DEFAULT_CURRENCY_CODE,
    DEFAULT_CURRENCY_SYMBOL,
};
