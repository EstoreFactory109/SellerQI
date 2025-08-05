/**
 * Get cookie configuration based on environment and request protocol
 * @param {Object} req - Express request object (optional)
 * @returns {Object} Cookie options
 */
const getCookieOptions = (req = null) => {
  // Determine if we're in a secure context
  const isSecure = process.env.NODE_ENV === 'production' && 
                   process.env.USE_HTTPS === 'true';
  
  // For development or HTTP production, use less restrictive settings
  const baseOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "None" : "Lax" // "None" requires secure=true, use "Lax" for HTTP
  };

  // If request is available, we can also check the protocol
  if (req) {
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    const isHttps = protocol === 'https';
    
    return {
      ...baseOptions,
      secure: isHttps,
      sameSite: isHttps ? "None" : "Lax"
    };
  }

  return baseOptions;
};

/**
 * Get cookie options specifically for HTTP environments
 * Use this for development or HTTP production environments
 */
const getHttpCookieOptions = () => ({
  httpOnly: true,
  secure: false,
  sameSite: "Lax"
});

/**
 * Get cookie options specifically for HTTPS environments
 * Use this for HTTPS production environments
 */
const getHttpsCookieOptions = () => ({
  httpOnly: true,
  secure: true,
  sameSite: "None"
});

module.exports = {
  getCookieOptions,
  getHttpCookieOptions,
  getHttpsCookieOptions
};