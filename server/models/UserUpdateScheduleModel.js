const mongoose = require('mongoose');

// Schema for tracking user update schedules for background jobs
const UserUpdateScheduleSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    // Time slot (0-23) for daily updates to distribute load
    dailyUpdateHour: {
        type: Number,
        required: true,
        min: 0,
        max: 23
    },
    // Day of week (0-6) for weekly updates 
    weeklyUpdateDay: {
        type: Number,
        required: true,
        min: 0,
        max: 6
    },
    // Last update timestamps
    lastDailyUpdate: {
        type: Date,
        default: null
    },
    lastWeeklyUpdate: {
        type: Date,
        default: null
    },
    // Countries and regions for this user
    sellerAccounts: [{
        country: {
            type: String,
            required: false  // Changed: Allow empty initially
        },
        region: {
            type: String,
            required: false,  // Changed: Allow empty initially
            enum: ["NA", "EU", "FE"]
        },
        lastDailyUpdate: {
            type: Date,
            default: null
        },
        lastWeeklyUpdate: {
            type: Date,
            default: null
        }
    }]
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Create indexes for better query performance
// Note: userId index is automatically created by unique: true in schema
UserUpdateScheduleSchema.index({ dailyUpdateHour: 1 });
UserUpdateScheduleSchema.index({ weeklyUpdateDay: 1 });
UserUpdateScheduleSchema.index({ lastDailyUpdate: 1 });
UserUpdateScheduleSchema.index({ lastWeeklyUpdate: 1 });

// Create the model
const UserUpdateSchedule = mongoose.model('UserUpdateSchedule', UserUpdateScheduleSchema);

module.exports = UserUpdateSchedule; 