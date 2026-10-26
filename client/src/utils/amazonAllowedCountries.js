const amazonMarketplaceCurrencies = {
    // North America
    "US": "$",      // United States - USD
    "CA": "C$",     // Canada - CAD
    "MX": "$",      // Mexico - MXN
    "BR": "R$",     // Brazil - BRL
    
    // Europe
    "GB": "£",      // United Kingdom - GBP
    "UK": "£",      // United Kingdom - GBP (alternative code)
    "DE": "€",      // Germany - EUR
    "FR": "€",      // France - EUR
    "IT": "€",      // Italy - EUR
    "ES": "€",      // Spain - EUR
    "NL": "€",      // Netherlands - EUR
    "SE": "kr",     // Sweden - SEK
    "PL": "zł",     // Poland - PLN
    "BE": "€",      // Belgium - EUR
    "IE": "€",      // Ireland - EUR
    "TR": "₺",      // Turkey - TRY
    
    // Asia Pacific
    "JP": "¥",      // Japan - JPY
    "AU": "$",      // Australia - AUD
    "SG": "$",      // Singapore - SGD
    "IN": "₹",      // India - INR
    
    // Middle East
    "AE": "د.إ",    // United Arab Emirates - AED
    "SA": "﷼",      // Saudi Arabia - SAR
    "EG": "£",      // Egypt - EGP

    // Africa
    "ZA": "R",      // South Africa - ZAR
  };

// country → ISO 4217 code (mirrors server/utils/marketplaceCurrency.js)
const amazonMarketplaceCurrencyCodes = {
    US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL',
    GB: 'GBP', UK: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', IE: 'EUR',
    SE: 'SEK', PL: 'PLN', TR: 'TRY',
    JP: 'JPY', AU: 'AUD', SG: 'SGD', IN: 'INR',
    AE: 'AED', SA: 'SAR', EG: 'EGP',
    ZA: 'ZAR',
};

// ISO code → display symbol, for amounts converted into a chosen currency (combined Dashboard).
// Shared symbols ($, £) are disambiguated so a converted total is never mistaken for another currency.
const currencyCodeSymbols = {
    USD: '$', CAD: 'C$', MXN: 'MX$', BRL: 'R$', GBP: '£', EUR: '€', SEK: 'kr', PLN: 'zł', TRY: '₺',
    JPY: '¥', AUD: 'A$', SGD: 'S$', INR: '₹', AED: 'د.إ', SAR: '﷼', EGP: 'E£', ZAR: 'R',
};

const getMarketplaceCurrencyCode = (country) => amazonMarketplaceCurrencyCodes[String(country || '').toUpperCase()] || 'USD';
const getCurrencySymbolForCode = (code) => currencyCodeSymbols[String(code || '').toUpperCase()] || String(code || '');

export { amazonMarketplaceCurrencies, amazonMarketplaceCurrencyCodes, currencyCodeSymbols, getMarketplaceCurrencyCode, getCurrencySymbolForCode };