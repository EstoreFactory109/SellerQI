const express=require('express')
const app=express();

require('dotenv').config()
const cors = require('cors')
const cookieParser=require('cookie-parser')


const userRoute=require('./routes/user.routes.js')
const tokenRoute=require('./routes/spi.tokens.routes.js')
const spapiroute=require('./routes/spi.routes.js');
const analysingRoute=require('./routes/analysing.routes.js')
const testRoute=require('./routes/testRoutes.js')
const accountHistoryRoute=require('./routes/AccountHistory.routes.js')


const dbConnect=require('./config/dbConn.js')
const logger=require('./utils/Logger.js')


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


module.exports=app