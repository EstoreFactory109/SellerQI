const mongoose = require("mongoose");

// Define the email logs schema
const EmailLogsSchema = new mongoose.Schema(
  {
    emailType: {
      type: String,
      required: [true, "Email type is required"],
      enum: {
        values: [
          "OTP", 
          "WELCOME_LITE", 
          "PASSWORD_RESET", 
          "ANALYSIS_READY", 
          "WEEKLY_REPORT", 
          "UPGRADE_REMINDER", 
          "CONNECTION_REMINDER", 
          "SUPPORT_MESSAGE", 
          "USER_REGISTERED", 
          "OTHER"
        ],
        message: "Email type must be one of: OTP, WELCOME_LITE, PASSWORD_RESET, ANALYSIS_READY, WEEKLY_REPORT, UPGRADE_REMINDER, CONNECTION_REMINDER, SUPPORT_MESSAGE, USER_REGISTERED, OTHER"
      },
      trim: true,
      uppercase: true
    },
    receiverEmail: {
      type: String,
      required: [true, "Receiver email is required"],
      trim: true,
      lowercase: true,
      match: [
        /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/,
        "Please enter a valid email address",
      ],
      index: true // Add index for faster queries
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Made optional since some emails don't have user context
      index: true // Add index for faster queries
    },
    status: {
      type: String,
      required: [true, "Email status is required"],
      enum: {
        values: ["SENT", "FAILED", "PENDING", "DELIVERED", "BOUNCED", "REJECTED"],
        message: "Status must be one of: SENT, FAILED, PENDING, DELIVERED, BOUNCED, REJECTED"
      },
      default: "PENDING",
      uppercase: true
    },
    subject: {
      type: String,
      required: false,
      trim: true,
      maxlength: [200, "Subject must not exceed 200 characters"]
    },
    emailContent: {
      type: String,
      required: false,
      trim: true
    },
    emailProvider: {
      type: String,
      required: false,
      enum: ["AWS_SES", "SENDGRID", "MAILGUN", "NODEMAILER", "OTHER"],
      default: "AWS_SES",
      uppercase: true
    },
    errorMessage: {
      type: String,
      required: false,
      trim: true
    },
    retryCount: {
      type: Number,
      default: 0,
      min: [0, "Retry count cannot be negative"]
    },
    sentDate: {
      type: Date,
      required: function() {
        return this.status === "SENT" || this.status === "DELIVERED";
      },
      index: true // Add index for date-based queries
    },
    sentTime: {
      type: String,
      required: function() {
        return this.status === "SENT" || this.status === "DELIVERED";
      },
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Time must be in HH:MM:SS format"]
    },
    deliveredAt: {
      type: Date,
      required: false
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { 
    timestamps: true // Automatically adds createdAt and updatedAt
  }
);

// Compound indexes for better query performance
EmailLogsSchema.index({ receiverId: 1, emailType: 1 });
EmailLogsSchema.index({ status: 1, createdAt: -1 });
EmailLogsSchema.index({ emailType: 1, createdAt: -1 });
EmailLogsSchema.index({ sentDate: -1 });

// Pre-save middleware to set sentDate and sentTime when status changes to SENT
EmailLogsSchema.pre('save', function(next) {
  if (this.isModified('status') && (this.status === 'SENT' || this.status === 'DELIVERED')) {
    if (!this.sentDate) {
      const now = new Date();
      this.sentDate = now;
      this.sentTime = now.toTimeString().split(' ')[0]; // Format: HH:MM:SS
    }
  }
  next();
});

// Instance method to mark email as sent
EmailLogsSchema.methods.markAsSent = function() {
  const now = new Date();
  this.status = 'SENT';
  this.sentDate = now;
  this.sentTime = now.toTimeString().split(' ')[0];
  return this.save();
};

// Instance method to mark email as failed
EmailLogsSchema.methods.markAsFailed = function(errorMessage) {
  this.status = 'FAILED';
  this.errorMessage = errorMessage;
  this.retryCount += 1;
  return this.save();
};

// Static method to get email logs by user
EmailLogsSchema.statics.getLogsByUser = function(userId, limit = 50) {
  return this.find({ receiverId: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('receiverId', 'firstName lastName email');
};

// Static method to get email logs by type
EmailLogsSchema.statics.getLogsByType = function(emailType, limit = 100) {
  return this.find({ emailType: emailType.toUpperCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('receiverId', 'firstName lastName email');
};

// Static method to get failed emails for retry
EmailLogsSchema.statics.getFailedEmails = function(maxRetries = 3) {
  return this.find({ 
    status: 'FAILED', 
    retryCount: { $lt: maxRetries } 
  })
  .sort({ createdAt: -1 })
  .populate('receiverId', 'firstName lastName email');
};

// Static method to get email statistics
EmailLogsSchema.statics.getEmailStats = function(startDate, endDate) {
  const matchCondition = {};
  if (startDate && endDate) {
    matchCondition.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          emailType: '$emailType',
          status: '$status'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.emailType',
        statuses: {
          $push: {
            status: '$_id.status',
            count: '$count'
          }
        },
        totalCount: { $sum: '$count' }
      }
    },
    { $sort: { totalCount: -1 } }
  ]);
};

// Create the model
const EmailLogs = mongoose.model("EmailLogs", EmailLogsSchema);

module.exports = EmailLogs;
