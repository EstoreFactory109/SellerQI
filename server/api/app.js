require('dotenv').config()
const express=require('express')
const app=express();
const path=require('path')
const fs=require('fs')
const _dirname=path.resolve()
 
const cors = require('cors')
const cookieParser=require('cookie-parser')
const helmet = require('helmet')


const userRoute=require('../routes/user.routes.js')
const tokenRoute=require('../routes/spi.tokens.routes.js')
const spapiroute=require('../routes/spi.routes.js');
const analysingRoute=require('../routes/analysing.routes.js')
const testRoute=require('../routes/testRoutes.js')
const accountHistoryRoute=require('../routes/AccountHistory.routes.js')
const cacheRoute=require('../routes/cache.routes.js')
const backgroundJobsRoute=require('../routes/backgroundJobs.routes.js')
const jobStatusRoute=require('../routes/jobStatus.routes.js')
const profileRoute=require('../routes/profile.routes.js')
const stripeRoute=require('../routes/stripe.routes.js')
const razorpayRoute=require('../routes/razorpay.routes.js')
const supportTicketRoute=require('../routes/supportTicket.routes.js')
const adminRoute=require('../routes/admin.routes.js')
const userDetailsRoute=require('../routes/userDetails.routes.js')
const reimbursementRoute=require('../routes/reimbursement.routes.js')
const mcpRoute=require('../routes/mcp.routes.js')
const pageWiseDataRoute=require('../routes/pageWiseData.routes.js')
const totalSalesFilterRoute=require('../routes/totalSalesFilter.routes.js')
const buyboxTestRoute=require('../routes/buyboxTest.routes.js')
const mcpEconomicsTestRoute=require('../routes/mcpEconomicsTest.routes.js')
const inventoryReportsTestRoute=require('../routes/inventoryReportsTest.routes.js')
const searchTermsTestRoute=require('../routes/searchTermsTest.routes.js')
const restockInventoryTestRoute=require('../routes/restockInventoryTest.routes.js')
const reimbursementTestRoute=require('../routes/reimbursementTest.routes.js')
const shipmentTestRoute=require('../routes/shipmentTest.routes.js')
const inactiveSKUIssuesTestRoute=require('../routes/inactiveSKUIssuesTest.routes.js')
const activeProductsTestRoute=require('../routes/activeProductsTest.routes.js')
const merchantListingsTestRoute=require('../routes/merchantListingsTest.routes.js')
const updateProductContentTestRoute=require('../routes/updateProductContentTest.routes.js')
const cogsRoute=require('../routes/cogs.routes.js')
const integrationRoute=require('../routes/integration.routes.js')
const alertsRoute=require('../routes/alerts.routes.js')
const qmateRoute=require('../routes/qmate.routes.js')
const dbConnect=require('../config/dbConn.js')
const logger=require('../utils/Logger.js')
const {connectRedis} = require('../config/redisConn.js')
const { jobScheduler } = require('../Services/BackgroundJobs/JobScheduler.js')
const { initializeEmailReminderJob } = require('../Services/BackgroundJobs/sendEmailAfter48Hrs.js')
const { setupDailyUpdateCron } = require('../Services/BackgroundJobs/cronProducer.js')
const config = require('../config/config.js')
// Global rate limiter disabled - only authentication rate limiters are active
// const { globalRateLimiter } = require('../middlewares/rateLimiting.js')


app.use(cors({origin:process.env.CORS_ORIGIN_DOMAIN,credentials:true}))
app.use(cookieParser());

// Helmet security headers - configured to work with existing setup
// Applied early in middleware chain, before routes
app.use(helmet({
    // Content Security Policy - configured to allow your frontend and APIs
    contentSecurityPolicy: {
        useDefaults: false, // Disable defaults to have full control
        directives: {
            defaultSrc: ["'self'"], // Base policy - allow same origin
            styleSrc: ["'self'", "'unsafe-inline'", "https:"], // Allow inline styles and external stylesheets
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://www.googletagmanager.com", "https://static.hotjar.com", "https://connect.facebook.net", "https://analytics.ahrefs.com", "https://mediaassets-in.blr1.cdn.digitaloceanspaces.com", "https:"], // Allow inline scripts, eval, and external analytics
            scriptSrcElem: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://static.hotjar.com", "https://connect.facebook.net", "https://analytics.ahrefs.com", "https://mediaassets-in.blr1.cdn.digitaloceanspaces.com", "https:"], // Allow script elements (like dynamically loaded scripts)
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc.)
            imgSrc: ["'self'", "data:", "https:"], // Allow images from any HTTPS source
            connectSrc: ["'self'", process.env.CORS_ORIGIN_DOMAIN, "https://www.google-analytics.com", "https://www.googletagmanager.com", "https://static.hotjar.com", "https://api.hotjar.com", "wss://ws.hotjar.com", "https://www.facebook.com", "https://mpc-prod-16-s6uit34pua-uk.a.run.app", "https://demo-1.conversionsapigateway.com", "https://www.google.com", "https://www.googleadservices.com", "https:", "wss:"].filter(Boolean), // Allow API connections and WebSockets from any HTTPS/WSS source
            fontSrc: ["'self'", "data:", "https://members.sellerqi.com", "https://*.sellerqi.com", "https:"], // Allow fonts from members.sellerqi.com, all sellerqi.com subdomains, and any HTTPS source
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "https:"],
            frameSrc: ["'self'", "https://www.facebook.com", "https://www.googletagmanager.com", "https:"], // Allow iframes from same origin, Facebook, Google Tag Manager, and any HTTPS source
            workerSrc: ["'self'", "blob:"], // Allow web workers
            childSrc: ["'self'", "blob:"], // Allow child contexts
            baseUri: ["'self'"], // Allow base URI from same origin
            formAction: ["'self'"], // Allow form submissions to same origin
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Only in production
        },
    },
    // Cross-Origin policies - configured to work with CORS and cookies
    crossOriginEmbedderPolicy: false, // Disabled to avoid breaking frontend
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Allows popups for OAuth/payments
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allows cross-origin resources (needed for CORS)
    // HSTS - only in production with HTTPS
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    },
    // X-Frame-Options - allow same origin framing (for iframes if needed)
    frameguard: { action: 'sameorigin' },
    // X-Content-Type-Options - prevent MIME type sniffing
    noSniff: true,
    // X-XSS-Protection - legacy browser protection
    xssFilter: true,
    // Referrer Policy
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Permissions Policy (formerly Feature Policy)
    permissionsPolicy: {
        features: {
            geolocation: ["'self'"],
            microphone: ["'none'"],
            camera: ["'none'"],
        },
    },
}));
 
// Stripe webhook route MUST come before express.json() middleware
// because Stripe requires raw body for signature verification
app.use('/app/stripe/webhook', express.raw({type: 'application/json'}));
 
// Apply JSON parsing for all other routes
app.use(express.json({limit:"16kb"}));
app.use(express.urlencoded({extended:true,limit:"16kb",}))

// Global rate limiting disabled - only authentication rate limiters are active
// Webhooks are automatically skipped (handled in rateLimiting.js)
// Static files are excluded (handled by express.static before this)
// app.use(globalRateLimiter);


app.use('/app',userRoute)
app.use('/app/token',tokenRoute)
app.use('/app/info',spapiroute)
app.use('/app/analyse',analysingRoute)
app.use('/app/test',testRoute);
app.use('/app/accountHistory',accountHistoryRoute)
app.use('/app/cache',cacheRoute)
app.use('/app/jobs',backgroundJobsRoute)
app.use('/app/job-status',jobStatusRoute)
app.use('/app/profile',profileRoute)
app.use('/app/stripe',stripeRoute)
app.use('/app/razorpay',razorpayRoute)
app.use('/app/support',supportTicketRoute)
app.use('/app/auth',adminRoute)
app.use('/app/getUserDetails',userDetailsRoute)
app.use('/app/reimbursements',reimbursementRoute)
app.use('/app/mcp',mcpRoute)
app.use('/api/pagewise',pageWiseDataRoute)
app.use('/api/total-sales',totalSalesFilterRoute)
app.use('/api/test',testRoute)
app.use('/api/test/buybox',buyboxTestRoute)
app.use('/api/test/mcp-economics',mcpEconomicsTestRoute)
app.use('/api/test/inventory',inventoryReportsTestRoute)
app.use('/api/test/search-terms',searchTermsTestRoute)
app.use('/api/test/restock-inventory',restockInventoryTestRoute)
app.use('/api/test/reimbursement',reimbursementTestRoute)
app.use('/api/test/shipment',shipmentTestRoute)
app.use('/api/test/inactive-sku-issues',inactiveSKUIssuesTestRoute)
app.use('/api/test/active-products',activeProductsTestRoute)
app.use('/api/test/merchant-listings',merchantListingsTestRoute)
app.use('/api/test/update-product-content',updateProductContentTestRoute)
app.use('/api/cogs',cogsRoute)
app.use('/api/integration',integrationRoute)
app.use('/api/alerts',alertsRoute)
app.use('/api/qmate',qmateRoute)

app.use(express.static(path.join(_dirname,'/client/dist')))
 
app.get('*',(req,res,next)=>{
    // Skip API routes - they should be handled by their respective routers
    if (req.path.startsWith('/app/') || req.path.startsWith('/api/')) {
        return next();
    }
    
    const indexPath = path.resolve(_dirname,'client/dist/index.html');
    
    // Check if file exists before trying to send it
    if (!fs.existsSync(indexPath)) {
        logger.error('index.html file not found:', {
            path: indexPath,
            url: req.url,
            dirname: _dirname
        });
        return res.status(500).json({ 
            error: 'Frontend build not found. Please build the client application.',
            path: indexPath
        });
    }
    
    res.sendFile(indexPath, (err) => {
        if (err) {
            logger.error('Error serving index.html:', {
                error: err.message,
                stack: err.stack,
                path: indexPath,
                url: req.url,
                code: err.code
            });
            // If file doesn't exist or there's an error, send a 404 or 500
            if (err.code === 'ENOENT') {
                res.status(404).json({ error: 'Page not found' });
            } else {
                res.status(500).json({ error: 'Internal server error', details: err.message });
            }
        }
    });
})


// Initialize all services in proper order
const initializeServices = async () => {
    try {
        // Step 1: Connect to MongoDB first
        await dbConnect();
        logger.info('Connection to database established');
        
        // Step 2: Wait a moment to ensure MongoDB connection is fully ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 3: Connect to Redis
        try {
            await connectRedis();
            logger.info('Redis initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize redis:', error);
            process.exit(1);
        }
        
        // Step 4: Initialize background jobs (after DB is connected)
        await initializeBackgroundJobs();
        
    } catch (err) {
        logger.error(`Error in connecting to database: ${err}`);
        // Don't exit - let the app continue, but background jobs won't work
    }
};

const redisConnection = async () => {
    try {
        // Connect to Redis once when app starts
        await connectRedis();
        logger.info('Redis initialized successfully');
       
    } catch (error) {
        logger.error('Failed to initalize redis:', error);
        process.exit(1);
    }
};
 
// Background jobs initialization
const initializeBackgroundJobs = async () => {
    // Check if background jobs are disabled via config file
    const backgroundJobsEnabled = config.backgroundJobs?.enabled !== false;
    
    if (!backgroundJobsEnabled) {
        logger.warn('⚠️  Background jobs are DISABLED (config.backgroundJobs.enabled = false)');
        logger.warn('⚠️  Automatic data fetching is inactive - manual testing mode');
        return;
    }

    try {
        // NEW: Initialize queue-based cron producer (replaces old batch processing)
        // This ONLY enqueues user IDs - actual processing is done by separate worker processes
        if (config.backgroundJobs?.jobs?.dailyUpdates !== false) {
            setupDailyUpdateCron({ enabled: true });
            logger.info('✅ Queue-based daily update cron producer initialized (enqueues users only)');
        } else {
            logger.warn('⚠️  Daily updates cron is disabled in config');
        }

        // Keep other background jobs (cache cleanup, health check, etc.)
        // Initialize background job scheduler for non-daily-update jobs
        // Check if MongoDB is connected before initializing
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            logger.warn('MongoDB not ready, waiting before initializing job scheduler...');
            await new Promise((resolve) => {
                if (mongoose.connection.readyState === 1) {
                    resolve();
                } else {
                    mongoose.connection.once('connected', resolve);
                    // Timeout after 10 seconds
                    setTimeout(() => {
                        logger.warn('MongoDB connection timeout, proceeding anyway...');
                        resolve();
                    }, 10000);
                }
            });
        }
        
        await jobScheduler.initialize();
        logger.info('Background job scheduler initialized successfully');
       
        // Initialize email reminder cron job
        const emailJobInitialized = initializeEmailReminderJob();
        if (emailJobInitialized) {
            logger.info('Email reminder job initialized successfully');
        } else {
            logger.error('Failed to initialize email reminder job');
        }
       
    } catch (error) {
        logger.error('Failed to initialize background job scheduler:', error);
        // Don't exit process for job scheduler failure, just log it
    }
};
 
// Initialize all services in proper order
initializeServices();

// Log status based on config
if (config.backgroundJobs?.enabled !== false) {
    logger.info('✅ Background jobs enabled - automatic data fetching active');
} else {
    logger.info('⏸️  Background jobs disabled - manual testing mode');
}


module.exports=app

