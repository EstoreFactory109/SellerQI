require('dotenv').config()
const express=require('express')
const app=express();


const cors = require('cors')
const cookieParser=require('cookie-parser')


const userRoute=require('./routes/user.routes.js')
const tokenRoute=require('./routes/spi.tokens.routes.js')
const spapiroute=require('./routes/spi.routes.js');
const analysingRoute=require('./routes/analysing.routes.js')
const testRoute=require('./routes/testRoutes.js')
const accountHistoryRoute=require('./routes/AccountHistory.routes.js')
const cacheRoute=require('./routes/cache.routes.js')
const backgroundJobsRoute=require('./routes/backgroundJobs.routes.js')
const stripeRoute=require('./routes/stripe.routes.js')
const agencyRoute=require('./routes/agency.routes.js')


const dbConnect=require('./config/dbConn.js')
const logger=require('./utils/Logger.js')
const {connectRedis} = require('./config/redisConn.js')
const { jobScheduler } = require('./Services/BackgroundJobs/JobScheduler.js')


app.use(cors({origin:process.env.CORS_ORIGIN,credentials:true}))
app.use(cookieParser());
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
app.use('/app/stripe',stripeRoute)
app.use('/app/agency',agencyRoute)



app.get('/',(req,res)=>{
    res.send("Hello world");
})


dbConnect()
.then(()=>{
    logger.info('Connection to database established');
})
.catch((err)=>{
    logger.error(`Error in connecting to database: ${err}`);
})


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

const initializeBackgroundJobs = async () => {
    try {
        // Initialize background job scheduler
        await jobScheduler.initialize();
        logger.info('Background job scheduler initialized successfully');
        
    } catch (error) {
        logger.error('Failed to initialize background job scheduler:', error);
        // Don't exit process for job scheduler failure, just log it
    }
};

redisConnection();
initializeBackgroundJobs();


module.exports=app