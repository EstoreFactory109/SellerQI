const app=require('./app.js')
const logger=require('./utils/Logger.js')

const port=process.env.PORT || 3000

app.listen(port,()=>{
    logger.info(`Server started on port ${port}`);  
})