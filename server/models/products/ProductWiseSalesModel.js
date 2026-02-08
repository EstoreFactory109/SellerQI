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

// Compound index for efficient queries by User, country, region and sorted by createdAt
productWiseSalesSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports=mongoose.model('ProductWiseSales',productWiseSalesSchema)