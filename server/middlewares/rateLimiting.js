/**
 * Rate Limiting Middleware
 * 
 * Provides rate limiting functionality using express-rate-limit with Redis store
 * for distributed rate limiting across multiple server instances.
 * 
 * This middleware does NOT affect background workers, webhooks, or internal service calls.
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { getRedisClient } = require('../config/redisConn.js');
const logger = require('../utils/Logger.js');

// Track if we've logged the Redis warning (only log once)
let redisWarningLogged = false;

/**
 * Create a Redis store adapter for express-rate-limit
 * This allows distributed rate limiting across multiple server instances
 * Uses a custom store implementation compatible with express-rate-limit
 * 
 * Lazy initialization: Redis client is retrieved when needed, not at store creation time
 * This allows Redis to be connected after the middleware is initialized
 */
function createRedisStore(windowMs) {
    // Cache for Redis client (lazy initialization)
    let redisClientCache = null;
    let redisUnavailable = false;
    
    /**
     * Get Redis client lazily (only when needed)
     * This allows Redis to be connected after middleware initialization
     */
    function getRedisClientLazy() {
        // If we already know Redis is unavailable, return null
        if (redisUnavailable) {
            return null;
        }
        
        // If we have a cached client, use it
        if (redisClientCache) {
            return redisClientCache;
        }
        
        // Try to get Redis client
        try {
            redisClientCache = getRedisClient();
            return redisClientCache;
        } catch (error) {
            // Redis not available yet - this is OK during startup
            // Will fall back to memory store, and can retry later
            redisUnavailable = true;
            
            // Only log once to avoid spam (log as info, not warning, since it's expected during startup)
            if (!redisWarningLogged) {
                redisWarningLogged = true;
                logger.info('Redis not available for rate limiting yet (will use memory store until Redis connects)');
            }
            return null;
        }
    }
    
    return {
        async increment(key) {
            const redisClient = getRedisClientLazy();
            
            // If Redis is not available, return undefined to let express-rate-limit use memory store
            if (!redisClient) {
                // Return undefined to signal that this store can't handle the request
                // express-rate-limit will fall back to its default memory store
                return undefined;
            }
            
            try {
                const count = await redisClient.incr(key);
                if (count === 1) {
                    // Set expiration on first increment (convert windowMs to seconds)
                    const expirySeconds = Math.ceil(windowMs / 1000);
                    await redisClient.expire(key, expirySeconds);
                }
                // Get TTL to calculate reset time
                const ttl = await redisClient.ttl(key);
                const resetTime = new Date(Date.now() + (ttl > 0 ? ttl * 1000 : windowMs));
                
                return {
                    totalHits: count,
                    resetTime: resetTime
                };
            } catch (error) {
                logger.error('Redis rate limit store error:', error);
                // If Redis fails during operation, return undefined to fall back to memory store
                return undefined;
            }
        },
        async decrement(key) {
            const redisClient = getRedisClientLazy();
            if (!redisClient) return;
            
            try {
                await redisClient.decr(key);
            } catch (error) {
                logger.error('Redis rate limit decrement error:', error);
            }
        },
        async resetKey(key) {
            const redisClient = getRedisClientLazy();
            if (!redisClient) return;
            
            try {
                await redisClient.del(key);
            } catch (error) {
                logger.error('Redis rate limit reset error:', error);
            }
        },
        async shutdown() {
            // Optional cleanup
            redisClientCache = null;
            redisUnavailable = false;
        }
    };
}

/**
 * Get identifier for rate limiting (IP or user ID)
 * Uses ipKeyGenerator helper for proper IPv6 handling
 * @param {Object} req - Express request object
 * @returns {string} Identifier for rate limiting
 */
function getRateLimitKey(req) {
    // For authenticated routes, use user ID for better user-based limiting
    if (req.userId) {
        return `rate_limit:user:${req.userId}`;
    }
    // For public routes, use IP address with proper IPv6 handling
    const ip = ipKeyGenerator(req);
    return `rate_limit:ip:${ip}`;
}

/**
 * Skip rate limiting for webhook endpoints
 * Webhooks are verified by signature, so they're safe to allow
 */
function skipWebhookRateLimit(req) {
    // Skip rate limiting for webhook endpoints
    const isStripeWebhook = req.path.includes('/stripe/webhook') && req.headers['stripe-signature'];
    const isRazorpayWebhook = req.path.includes('/razorpay/webhook') && req.headers['x-razorpay-signature'];
    
    return isStripeWebhook || isRazorpayWebhook;
}

/**
 * Global rate limiter - applies to all routes as baseline protection
 * 100 requests per minute per IP/user
 */
const globalRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: {
        statusCode: 429,
        message: 'Too many requests, please try again later.',
        retryAfter: 60
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    skip: (req) => {
        // Skip webhooks
        if (skipWebhookRateLimit(req)) {
            return true;
        }
        return false;
    },
    keyGenerator: getRateLimitKey,
    store: createRedisStore(60 * 1000), // Pass windowMs to store
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for ${getRateLimitKey(req)}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many requests, please try again later.',
            retryAfter: 60
        });
    }
});

/**
 * Authentication rate limiter
 * Stricter limits for login, register, password reset endpoints
 */
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per 15 minutes
    message: {
        statusCode: 429,
        message: 'Too many authentication attempts, please try again after 15 minutes.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use IP for auth endpoints (before user is authenticated)
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:auth:${ip}`;
    },
    store: createRedisStore(15 * 60 * 1000),
    handler: (req, res) => {
        logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many authentication attempts, please try again after 15 minutes.',
            retryAfter: 900
        });
    }
});

/**
 * Registration rate limiter
 * Prevents spam registrations
 */
const registerRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 registrations per hour per IP
    message: {
        statusCode: 429,
        message: 'Too many registration attempts, please try again after 1 hour.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:register:${ip}`;
    },
    store: createRedisStore(60 * 60 * 1000),
    handler: (req, res) => {
        logger.warn(`Registration rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many registration attempts, please try again after 1 hour.',
            retryAfter: 3600
        });
    }
});

/**
 * Password reset rate limiter
 * Prevents email enumeration and spam
 */
const passwordResetRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per hour per email/IP
    message: {
        statusCode: 429,
        message: 'Too many password reset attempts, please try again after 1 hour.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use email if available, otherwise IP
        const email = req.body?.email;
        if (email) {
            return `rate_limit:password_reset:${email}`;
        }
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:password_reset:${ip}`;
    },
    store: createRedisStore(60 * 60 * 1000),
    handler: (req, res) => {
        logger.warn(`Password reset rate limit exceeded`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many password reset attempts, please try again after 1 hour.',
            retryAfter: 3600
        });
    }
});

/**
 * OTP resend rate limiter
 * Prevents OTP spam
 */
const otpRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 OTP requests per 15 minutes
    message: {
        statusCode: 429,
        message: 'Too many OTP requests, please try again after 15 minutes.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const email = req.body?.email;
        if (email) {
            return `rate_limit:otp:${email}`;
        }
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:otp:${ip}`;
    },
    store: createRedisStore(15 * 60 * 1000),
    handler: (req, res) => {
        logger.warn(`OTP rate limit exceeded`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many OTP requests, please try again after 15 minutes.',
            retryAfter: 900
        });
    }
});

/**
 * Integration job rate limiter
 * Prevents abuse of expensive integration operations
 */
const integrationRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 2, // 2 triggers per hour per user
    message: {
        statusCode: 429,
        message: 'Too many integration job requests. Please wait before triggering another integration.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use user ID for authenticated users
        if (req.userId) {
            return `rate_limit:integration:user:${req.userId}`;
        }
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:integration:${ip}`;
    },
    store: createRedisStore(60 * 60 * 1000),
    handler: (req, res) => {
        logger.warn(`Integration rate limit exceeded for user: ${req.userId || req.ip}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many integration job requests. Please wait before triggering another integration.',
            retryAfter: 3600
        });
    }
});

/**
 * Analytics/Data rate limiter
 * For dashboard and analytics endpoints
 */
const analyticsRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per user
    message: {
        statusCode: 429,
        message: 'Too many data requests, please try again in a moment.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
    store: createRedisStore(60 * 1000), // 1 minute window
    handler: (req, res) => {
        logger.warn(`Analytics rate limit exceeded for ${getRateLimitKey(req)}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many data requests, please try again in a moment.',
            retryAfter: 60
        });
    }
});

/**
 * Payment rate limiter
 * For payment-related endpoints
 */
const paymentRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute per user
    message: {
        statusCode: 429,
        message: 'Too many payment requests, please try again in a moment.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
    store: createRedisStore(60 * 1000), // 1 minute window
    handler: (req, res) => {
        logger.warn(`Payment rate limit exceeded for ${getRateLimitKey(req)}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many payment requests, please try again in a moment.',
            retryAfter: 60
        });
    }
});

/**
 * Webhook rate limiter (very permissive)
 * Webhooks are already verified by signature, but add light protection
 */
const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 webhooks per minute per IP (Stripe/Razorpay may send bursts)
    message: {
        statusCode: 429,
        message: 'Too many webhook requests.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use ipKeyGenerator helper for proper IPv6 handling
        const ip = ipKeyGenerator(req);
        return `rate_limit:webhook:${ip}`;
    },
    store: createRedisStore(60 * 1000),
    handler: (req, res) => {
        logger.warn(`Webhook rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            statusCode: 429,
            message: 'Too many webhook requests.',
            retryAfter: 60
        });
    }
});

module.exports = {
    globalRateLimiter,
    authRateLimiter,
    registerRateLimiter,
    passwordResetRateLimiter,
    otpRateLimiter,
    integrationRateLimiter,
    analyticsRateLimiter,
    paymentRateLimiter,
    webhookRateLimiter,
    skipWebhookRateLimit
};
