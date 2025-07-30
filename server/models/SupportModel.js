const mongoose=require('mongoose');

const supportSchema=new mongoose.Schema({
    topic: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    subject: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
   
},{timestamps:true})

const Support=mongoose.model('Support',supportSchema);
module.exports=Support;