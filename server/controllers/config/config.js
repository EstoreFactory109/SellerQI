const URIs = {
    "NA": process.env.AMAZON_BASE_URI_NA,  // North America
    "EU": process.env.AMAZON_BASE_URI_EU,  // Europe
    "FE": process.env.AMAZON_BASE_URI_FE   // Far East
  };

  const marketplaceConfig = {
    "US": "ATVPDKIKX0DER",  // United States
    "CA": "A2EUQ1WTGCTBG2", // Canada
    "MX": "A1AM78C64UM0Y8", // Mexico
    "BR": "A2Q3Y263D00KWC", // Brazil
    "UK": "A1F83G8C2ARO7P", // United Kingdom
    "DE": "A1PA6795UKMFR9", // Germany
    "FR": "A13V1IB3VIYZZH", // France
    "IT": "APJ6JRA9NG5V4",  // Italy
    "ES": "A1RKKUPIHCS9HS", // Spain
    "NL": "A1805IZSGTT6HS", // Netherlands
    "SE": "A2NODRKZP88ZB9", // Sweden
    "PL": "A1C3SOZRARQ6R3", // Poland
    "BE": "AMEN7PMS3EDWL",  // Belgium
    "TR": "A33AVAJ2PDY3EV", // Turkey
    "EG": "ARBP9OOSHTCHU", // Egypt
    "AE": "A2VIGQ35RCS4UG", // United Arab Emirates
    "SA": "A17E79C6D8DWNP", // Saudi Arabia
    "JP": "A1VC38T7YXB528", // Japan
    "AU": "A39IBJ37TRP1C6", // Australia
    "IN": "A21TJRUUN4KGV"   // India
  };

  const spapiRegions = {
    "NA": "us-east-1",  // North America (US, CA, MX, BR)
    "EU": "eu-west-1",  // Europe (UK, DE, FR, IT, ES, NL, SE, PL, SA, EG, TR, AE, IN)
    "FE": "us-west-2"   // Far East (JP, AU, SG)
  };
  
  module.exports = {URIs,marketplaceConfig,spapiRegions};
  