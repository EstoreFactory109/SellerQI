const URIs = {
    "NA": process.env.AMAZON_BASE_URI_NA,  // North America
    "EU": process.env.AMAZON_BASE_URI_EU,  // Europe
    "FE": process.env.AMAZON_BASE_URI_FE   // Far East
  };

  const marketplaceConfig = {
    // North America
    "US": "ATVPDKIKX0DER",  // United States of America
    "CA": "A2EUQ1WTGCTBG2", // Canada
    "MX": "A1AM78C64UM0Y8", // Mexico
    "BR": "A2Q3Y263D00KWC", // Brazil
    
    // Europe
    "IE": "A28R8C7NBKEWEA", // Ireland
    "ES": "A1RKKUPIHCS9HS", // Spain
    "UK": "A1F83G8C2ARO7P", // United Kingdom
    "FR": "A13V1IB3VIYZZH", // France
    "BE": "AMEN7PMS3EDWL",  // Belgium
    "NL": "A1805IZSGTT6HS", // Netherlands
    "DE": "A1PA6795UKMFR9", // Germany
    "IT": "APJ6JRA9NG5V4",  // Italy
    "SE": "A2NODRKZP88ZB9", // Sweden
    "ZA": "AE08WJ6YKNBMC",  // South Africa
    "PL": "A1C3SOZRARQ6R3", // Poland
    "EG": "ARBP9OOSHTCHU",  // Egypt
    "TR": "A33AVAJ2PDY3EV", // Turkey
    "SA": "A17E79C6D8DWNP", // Saudi Arabia
    "AE": "A2VIGQ35RCS4UG", // United Arab Emirates
    "IN": "A21TJRUUN4KGV",  // India
    
    // Far East
    "SG": "A19VAU5U5O7RUS", // Singapore
    "AU": "A39IBJ37TRP1C6", // Australia
    "JP": "A1VC38T7YXB528"  // Japan
  };

  const spapiRegions = {
    "NA": "us-east-1",  // North America (US, CA, MX, BR)
    "EU": "eu-west-1",  // Europe (UK, DE, FR, IT, ES, NL, SE, PL, SA, EG, TR, AE, IN)
    "FE": "us-west-2"   // Far East (JP, AU, SG)
  };
  
  module.exports = {URIs,marketplaceConfig,spapiRegions};
  