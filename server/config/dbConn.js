const mongoose=require('mongoose');
const dbConsts=require('./config.js');
const logger=require('../utils/Logger.js');

const dbConnect=async()=>{
    try {
        const connect=await mongoose.connect(`mongodb+srv://estorefactory2025:mlqIhjMOC7bABAIz@cluster0.jxql8.mongodb.net/IBEX`,{
            connectTimeoutMS: 60000,  // Connection timeout (in milliseconds)
            socketTimeoutMS: 120000,   // Socket timeout (in milliseconds)
        })
        if(connect){
            logger.info('Connected to DB');
        }
    } catch (error) {
        logger.error(`Error in connecting to DB: ${error}`);
    }
}

module.exports=dbConnect;