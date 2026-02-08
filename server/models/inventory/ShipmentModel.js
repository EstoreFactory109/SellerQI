const mongoose=require('mongoose');

const shipmentSchema=new mongoose.Schema({
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
    shipmentData:[{
        shipmentId:{
            type:String,
            require:true
        },
        shipmentName:{
            type:String,
            require:true
        },
        shipmentDate:{
            type:Date,
            require:false
        },
        itemDetails:[{
            SellerSKU:{
                type:String,
                require:true
            },
            FulfillmentNetworkSKU:{
                type:String,
                require:true
            },
            QuantityShipped:{
                type:String,
                require:true
            },
            QuantityReceived:{
                type:String,
                require:true
            }
        }]
        
    }]
},{timestamps:true})

// Compound index for efficient queries by User, country, region and sorted by createdAt
shipmentSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports=mongoose.model('Shipment',shipmentSchema)