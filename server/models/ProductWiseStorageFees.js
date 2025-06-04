const mongoose = require('mongoose');

const ProductWiseStorageFeesSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    country: {
        type: String,
        required: true
    },
    region: {
        type: String,
        required: true
    },
    storageFees: [
        {
            asin: {
                type: String,
                required: true
            },
            storageFee: {
                type: String,
                required: true
            }
        }
    ]
});

const ProductWiseStorageFees = mongoose.model('ProductWiseStorageFees', ProductWiseStorageFeesSchema);

module.exports = ProductWiseStorageFees;
