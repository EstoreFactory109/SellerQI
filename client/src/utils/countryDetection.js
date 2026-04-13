import axios from 'axios';

/**
 * Detect user's country using IP geolocation (HTTPS only — avoids mixed-content
 * blocking when the app is served over HTTPS).
 * @returns {Promise<string>} Country code (e.g., 'IN', 'US') or null if detection fails
 */
export const detectCountry = async () => {
  try {
    const response = await axios.get('https://ipapi.co/json/', {
      timeout: 5000
    });
    if (response.data && response.data.country_code) {
      return response.data.country_code.toUpperCase();
    }
  } catch (error) {
    console.error('ipapi.co country detection failed:', error);
  }

  try {
    const response = await axios.get('https://ip-api.com/json/?fields=countryCode', {
      timeout: 5000
    });
    if (response.data && response.data.countryCode) {
      return response.data.countryCode.toUpperCase();
    }
  } catch (fallbackError) {
    console.error('ip-api.com country detection failed:', fallbackError);
  }

  return null;
};
