/**
 * Determine if we're running in a secure (HTTPS) environment
 * Checks environment variables and defaults appropriately
 */
const isSecureEnvironment = () => {
  // Explicit HTTPS setting takes priority
  if (process.env.USE_HTTPS === 'true') return true;
  if (process.env.USE_HTTPS === 'false') return false;
  
  // Production defaults to secure, development to non-secure
  return process.env.NODE_ENV === 'production';
};

/**
 * Get cookie configuration based on environment and request protocol
 * @param {Object} req - Express request object (optional)
 * @returns {Object} Cookie options
 */
const getCookieOptions = (req = null) => {
  let isSecure = isSecureEnvironment();
  
  // If request is available, we can also check the protocol
  if (req) {
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    isSecure = protocol === 'https';
  }
  
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "None" : "Lax" // "None" requires secure=true, use "Lax" for HTTP
  };
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
 * Now also checks environment - falls back to HTTP options in development
 */
const getHttpsCookieOptions = () => {
  const isSecure = isSecureEnvironment();
  
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "None" : "Lax"
  };
};

module.exports = {
  getCookieOptions,
  getHttpCookieOptions,
  getHttpsCookieOptions,
  isSecureEnvironment
};