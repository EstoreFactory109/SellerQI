/**
 * constants.js
 * 
 * Constants for Data Kiosk API integration
 */

const MARKETPLACES = {
    // North America
    US: 'ATVPDKIKX0DER',  // United States of America
    CA: 'A2EUQ1WTGCTBG2', // Canada
    MX: 'A1AM78C64UM0Y8', // Mexico
    BR: 'A2Q3Y263D00KWC', // Brazil
    
    // Europe
    IE: 'A28R8C7NBKEWEA', // Ireland
    ES: 'A1RKKUPIHCS9HS', // Spain
    UK: 'A1F83G8C2ARO7P', // United Kingdom
    FR: 'A13V1IB3VIYZZH', // France
    BE: 'AMEN7PMS3EDWL',  // Belgium
    NL: 'A1805IZSGTT6HS', // Netherlands
    DE: 'A1PA6795UKMFR9', // Germany
    IT: 'APJ6JRA9NG5V4',  // Italy
    SE: 'A2NODRKZP88ZB9', // Sweden
    ZA: 'AE08WJ6YKNBMC',  // South Africa
    PL: 'A1C3SOZRARQ6R3', // Poland
    EG: 'ARBP9OOSHTCHU',  // Egypt
    TR: 'A33AVAJ2PDY3EV', // Turkey
    SA: 'A17E79C6D8DWNP', // Saudi Arabia
    AE: 'A2VIGQ35RCS4UG', // United Arab Emirates
    IN: 'A21TJRUUN4KGV',  // India
    
    // Far East
    SG: 'A19VAU5U5O7RUS', // Singapore
    AU: 'A39IBJ37TRP1C6', // Australia
    JP: 'A1VC38T7YXB528'  // Japan
};

// Map regions to their default marketplaces
const REGION_DEFAULT_MARKETPLACES = {
    NA: 'US',    // North America defaults to US
    EU: 'UK',    // Europe defaults to UK
    FE: 'JP'     // Far East defaults to JP
};

// Valid marketplaces per region
const REGION_VALID_MARKETPLACES = {
    NA: ['US', 'CA', 'MX', 'BR'],
    EU: ['IE', 'ES', 'UK', 'FR', 'BE', 'NL', 'DE', 'IT', 'SE', 'ZA', 'PL', 'EG', 'TR', 'SA', 'AE', 'IN'],
    FE: ['SG', 'AU', 'JP']
};

const SCHEMA_NAMES = {
    SALES_AND_TRAFFIC: 'analytics_salesAndTraffic_2024_04_24',
    ECONOMICS: 'analytics_economics_2024_03_15',
    VENDOR_ANALYTICS: 'analytics_vendorAnalytics_2024_09_30'
};

const QUERY_STATUS = {
    IN_QUEUE: 'IN_QUEUE',
    IN_PROGRESS: 'IN_PROGRESS',
    DONE: 'DONE',
    FATAL: 'FATAL',
    CANCELLED: 'CANCELLED'
};

const FEE_TYPES = {
    FBA_FULFILLMENT_FEE: 'FBA_FULFILLMENT_FEE',
    FBA_STORAGE_FEE: 'FBA_STORAGE_FEE',
    REFERRAL_FEE: 'REFERRAL_FEE',
    PER_ITEM_SELLING_FEE: 'PER_ITEM_SELLING_FEE',
    AGED_INVENTORY_SURCHARGE: 'AGED_INVENTORY_SURCHARGE',
    BASE_FBA_FULFILLMENT_FEE: 'BASE_FBA_FULFILLMENT_FEE',
    BASE_MONTHLY_STORAGE_FEE: 'BASE_MONTHLY_STORAGE_FEE',
    CLOSING_FEES: 'CLOSING_FEES',
    FBA_FULFILLMENT_FEES: 'FBA_FULFILLMENT_FEES',
    HIGH_RETURN_RATE_FEE: 'HIGH_RETURN_RATE_FEE',
    LOW_INVENTORY_LEVEL_FEE: 'LOW_INVENTORY_LEVEL_FEE',
    MONTHLY_INVENTORY_STORAGE_FEES: 'MONTHLY_INVENTORY_STORAGE_FEES',
    PAN_EU_OVERSIZE_FEE: 'PAN_EU_OVERSIZE_FEE',
    RETURN_PROCESSING_FEE: 'RETURN_PROCESSING_FEE',
    SPONSORED_PRODUCTS_CHARGES: 'SPONSORED_PRODUCTS_CHARGES',
    STORAGE_UTILIZATION_SURCHARGE: 'STORAGE_UTILIZATION_SURCHARGE'
};

module.exports = {
    MARKETPLACES,
    REGION_DEFAULT_MARKETPLACES,
    REGION_VALID_MARKETPLACES,
    SCHEMA_NAMES,
    QUERY_STATUS,
    FEE_TYPES
};

