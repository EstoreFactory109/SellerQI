const mongoose=require('mongoose');

const productWiseSalesSchema=new mongoose.Schema({
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
    productWiseSales:[{
        asin:{
            type:String,
            require:true
        },
        quantity:{
            type:Number,
            require:true
        },
        amount:{
            type:Number,
            require:true
        }
    }]
},{timestamps:true})    

module.exports=mongoose.model('ProductWiseSales',productWiseSalesSchema)