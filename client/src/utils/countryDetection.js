import axios from 'axios';

/**
 * Detect user's country using IP geolocation
 * @returns {Promise<string>} Country code (e.g., 'IN', 'US') or null if detection fails
 */
export const detectCountry = async () => {
  try {
    // Using ip-api.com free service (no API key required)
    const response = await axios.get('http://ip-api.com/json/?fields=countryCode', {
      timeout: 5000
    });
    
    if (response.data && response.data.countryCode) {
      return response.data.countryCode.toUpperCase();
    }
    return null;
  } catch (error) {
    console.error('Error detecting country:', error);
    // Fallback: try alternative service
    try {
      const response = await axios.get('https://ipapi.co/json/', {
        timeout: 5000
      });
      if (response.data && response.data.country_code) {
        return response.data.country_code.toUpperCase();
      }
    } catch (fallbackError) {
      console.error('Fallback country detection failed:', fallbackError);
    }
    return null;
  }
};

