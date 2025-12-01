const mongoose=require('mongoose')

const AccountHistorySchema = mongoose.Schema({
    User: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    region: {
        type: String,
        required: true,
    },
    country: {
        type: String,
        required: true,
    },
    accountHistory: [
        {
            Date:{
                type:Date,
                required:true
            },
            HealthScore:{
                type:String,
                required:true
            },
            TotalProducts:{
                type:Number,
                required:true
            },
            ProductsWithIssues:{
                type:Number,
                required:true
            },
            TotalNumberOfIssues:{
                type:Number,
                required:true
            },
            expireDate:{
                type:Date,
                required:true
            }
        },{timestamps:true}
    ],
},
    { timestamps: true });

module.exports = mongoose.model("AccountHistory", AccountHistorySchema);