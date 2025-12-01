const mongoose=require('mongoose');

const totalSalesSchema=new mongoose.Schema({
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        require:true
    },
    region:{
        type:String,
        require:true
    },
    country:{
        type:String,
        require:true
    },
    totalSales:[{
        interval:{
            type:String,
            require:true
        },
        TotalAmount:{
            type:Number,
            require:true
        }
    }]
},{timestamps:true})

module.exports=mongoose.model('TotalSales',totalSalesSchema)