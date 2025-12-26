require('dotenv').config()
const express=require('express')
const app=express();
const path=require('path')
const _dirname=path.resolve()
 
const cors = require('cors')
const cookieParser=require('cookie-parser')


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
const cogsRoute=require('../routes/cogs.routes.js')
const dbConnect=require('../config/dbConn.js')
const logger=require('../utils/Logger.js')
const {connectRedis} = require('../config/redisConn.js')
const { jobScheduler } = require('../Services/BackgroundJobs/JobScheduler.js')
const { initializeEmailReminderJob } = require('../Services/BackgroundJobs/sendEmailAfter48Hrs.js')
const { setupDailyUpdateCron } = require('../Services/BackgroundJobs/cronProducer.js')
const config = require('../config/config.js')


app.use(cors({origin:process.env.CORS_ORIGIN_DOMAIN,credentials:true}))
app.use(cookieParser());
 
// Stripe webhook route MUST come before express.json() middleware
// because Stripe requires raw body for signature verification
app.use('/app/stripe/webhook', express.raw({type: 'application/json'}));
 
// Apply JSON parsing for all other routes
app.use(express.json({limit:"16kb"}));
app.use(express.urlencoded({extended:true,limit:"16kb",}))


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
app.use('/api/cogs',cogsRoute)
 
app.use(express.static(path.join(_dirname,'/client/dist')))
 
app.get('*',(req,res)=>{
    res.sendFile(path.resolve(_dirname,'client/dist/index.html'))
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

