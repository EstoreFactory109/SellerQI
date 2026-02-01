const mongoose = require("mongoose");

// Define the payment logs schema
const PaymentLogsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    eventType: {
      type: String,
      required: [true, "Event type is required"],
      enum: {
        values: [
          // Razorpay events
          "RAZORPAY_SUBSCRIPTION_CREATED",
          "RAZORPAY_PAYMENT_SUCCESS",
          "RAZORPAY_PAYMENT_FAILED",
          "RAZORPAY_SUBSCRIPTION_AUTHENTICATED",
          "RAZORPAY_SUBSCRIPTION_ACTIVATED",
          "RAZORPAY_SUBSCRIPTION_CHARGED",
          "RAZORPAY_SUBSCRIPTION_CANCELLED",
          "RAZORPAY_SUBSCRIPTION_HALTED",
          "RAZORPAY_SUBSCRIPTION_PENDING",
          "RAZORPAY_WEBHOOK_RECEIVED",
          "RAZORPAY_FETCH_ERROR",
          // Stripe events
          "STRIPE_CHECKOUT_CREATED",
          "STRIPE_PAYMENT_SUCCESS",
          "STRIPE_PAYMENT_FAILED",
          "STRIPE_SUBSCRIPTION_CREATED",
          "STRIPE_SUBSCRIPTION_UPDATED",
          "STRIPE_SUBSCRIPTION_CANCELLED",
          "STRIPE_WEBHOOK_RECEIVED",
          // Trial events
          "TRIAL_STARTED",
          "TRIAL_ENDED",
          "TRIAL_UPGRADED",
          // Generic events
          "SUBSCRIPTION_STATUS_CHANGED",
          "PLAN_UPGRADED",
          "PLAN_DOWNGRADED",
          "REFUND_PROCESSED",
          "OTHER"
        ],
        message: "Invalid event type"
      },
      trim: true,
      uppercase: true
    },
    paymentGateway: {
      type: String,
      required: [true, "Payment gateway is required"],
      enum: {
        values: ["RAZORPAY", "STRIPE", "MANUAL", "SYSTEM"],
        message: "Payment gateway must be one of: RAZORPAY, STRIPE, MANUAL, SYSTEM"
      },
      uppercase: true,
      index: true
    },
    status: {
      type: String,
      required: [true, "Status is required"],
      enum: {
        values: ["SUCCESS", "FAILED", "PENDING", "PROCESSING", "CANCELLED"],
        message: "Status must be one of: SUCCESS, FAILED, PENDING, PROCESSING, CANCELLED"
      },
      default: "PENDING",
      uppercase: true,
      index: true
    },
    // Amount details
    amount: {
      type: Number,
      required: false,
      min: [0, "Amount cannot be negative"]
    },
    currency: {
      type: String,
      required: false,
      default: "INR",
      uppercase: true
    },
    // Subscription/Payment IDs
    subscriptionId: {
      type: String,
      required: false,
      index: true
    },
    paymentId: {
      type: String,
      required: false,
      index: true
    },
    orderId: {
      type: String,
      required: false
    },
    // Plan details
    planType: {
      type: String,
      enum: ["LITE", "PRO", "AGENCY", null],
      required: false
    },
    previousPlanType: {
      type: String,
      enum: ["LITE", "PRO", "AGENCY", null],
      required: false
    },
    // Trial info
    isTrialPayment: {
      type: Boolean,
      default: false
    },
    trialEndsAt: {
      type: Date,
      required: false
    },
    // Status changes
    previousStatus: {
      type: String,
      required: false
    },
    newStatus: {
      type: String,
      required: false
    },
    // Error details (for failed payments)
    errorCode: {
      type: String,
      required: false,
      trim: true
    },
    errorMessage: {
      type: String,
      required: false,
      trim: true
    },
    errorDescription: {
      type: String,
      required: false,
      trim: true
    },
    // Request/Response details (for debugging)
    requestData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    responseData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    // Webhook specific
    webhookEventId: {
      type: String,
      required: false
    },
    webhookPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    // IP and source tracking
    ipAddress: {
      type: String,
      required: false
    },
    userAgent: {
      type: String,
      required: false
    },
    source: {
      type: String,
      enum: ["FRONTEND", "WEBHOOK", "ADMIN", "SYSTEM", "API"],
      default: "FRONTEND"
    },
    // Additional context
    message: {
      type: String,
      required: false,
      trim: true
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
PaymentLogsSchema.index({ userId: 1, eventType: 1 });
PaymentLogsSchema.index({ userId: 1, createdAt: -1 });
PaymentLogsSchema.index({ status: 1, createdAt: -1 });
PaymentLogsSchema.index({ eventType: 1, createdAt: -1 });
PaymentLogsSchema.index({ paymentGateway: 1, createdAt: -1 });
PaymentLogsSchema.index({ subscriptionId: 1, createdAt: -1 });
PaymentLogsSchema.index({ paymentId: 1 });

// Static method to log a payment event
PaymentLogsSchema.statics.logEvent = async function(eventData) {
  try {
    const log = await this.create({
      ...eventData,
      eventType: eventData.eventType?.toUpperCase(),
      paymentGateway: eventData.paymentGateway?.toUpperCase(),
      status: eventData.status?.toUpperCase() || 'SUCCESS'
    });
    return log;
  } catch (error) {
    console.error('Error logging payment event:', error);
    // Don't throw - logging failures shouldn't break the payment flow
    return null;
  }
};

// Static method to get payment logs by user
PaymentLogsSchema.statics.getLogsByUser = function(userId, options = {}) {
  const { limit = 50, skip = 0, eventType = null, status = null, startDate = null, endDate = null } = options;
  
  const query = { userId };
  
  if (eventType) {
    query.eventType = eventType.toUpperCase();
  }
  if (status) {
    query.status = status.toUpperCase();
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('userId', 'firstName lastName email');
};

// Static method to get all logs for superadmin with pagination
PaymentLogsSchema.statics.getAllLogs = function(options = {}) {
  const { limit = 100, skip = 0, userId = null, eventType = null, status = null, paymentGateway = null, startDate = null, endDate = null } = options;
  
  const query = {};
  
  if (userId) {
    query.userId = userId;
  }
  if (eventType) {
    query.eventType = eventType.toUpperCase();
  }
  if (status) {
    query.status = status.toUpperCase();
  }
  if (paymentGateway) {
    query.paymentGateway = paymentGateway.toUpperCase();
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('userId', 'firstName lastName email packageType');
};

// Static method to get payment statistics for a user
PaymentLogsSchema.statics.getUserPaymentStats = function(userId) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: {
          eventType: '$eventType',
          status: '$status'
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $group: {
        _id: '$_id.eventType',
        statuses: {
          $push: {
            status: '$_id.status',
            count: '$count',
            totalAmount: '$totalAmount'
          }
        },
        totalCount: { $sum: '$count' },
        totalAmount: { $sum: '$totalAmount' }
      }
    },
    { $sort: { totalCount: -1 } }
  ]);
};

// Static method to get failed payments summary
PaymentLogsSchema.statics.getFailedPaymentsSummary = function(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        status: 'FAILED',
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          paymentGateway: '$paymentGateway',
          errorCode: '$errorCode'
        },
        count: { $sum: 1 },
        users: { $addToSet: '$userId' }
      }
    },
    {
      $project: {
        paymentGateway: '$_id.paymentGateway',
        errorCode: '$_id.errorCode',
        count: 1,
        uniqueUsers: { $size: '$users' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Static method to count logs by user
PaymentLogsSchema.statics.countByUser = function(userId, options = {}) {
  const { eventType = null, status = null, startDate = null, endDate = null } = options;
  
  const query = { userId };
  
  if (eventType) {
    query.eventType = eventType.toUpperCase();
  }
  if (status) {
    query.status = status.toUpperCase();
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  return this.countDocuments(query);
};

// Create the model
const PaymentLogs = mongoose.model("PaymentLogs", PaymentLogsSchema);

module.exports = PaymentLogs;
