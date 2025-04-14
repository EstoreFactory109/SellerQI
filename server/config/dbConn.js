const mongoose=require('mongoose');
const dbConsts=require('./config.js');
const logger=require('../utils/Logger.js');

const dbConnect=async()=>{
    try {
        const connect=await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`)
        if(connect){
            logger.info('Connected to DB');
        }
    } catch (error) {
        logger.error(`Error in connecting to DB: ${error}`);
    }
}

module.exports=dbConnect;