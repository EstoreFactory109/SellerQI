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

module.exports=mongoose.model('Shipment',shipmentSchema)