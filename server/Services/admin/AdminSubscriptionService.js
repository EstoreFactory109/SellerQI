/**
 * Admin Subscription Service
 * Independent service for superAdmin subscription overview data.
 * Does not modify existing subscription or user flows.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const SubscriptionModel = require('../../models/user-auth/SubscriptionModel.js');

/**
 * Get subscription overview for admin dashboard with full subscription details
 * @param {Object} options - { page, limit, planType, status, paymentGateway }
 * @returns {Promise<{ summary, subscriptionRecords, pagination }>}
 */
const getSubscriptionOverview = async (options = {}) => {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 20));
  const skip = (page - 1) * limit;
  const planType = options.planType || null;
  const status = options.status || null;
  const paymentGateway = options.paymentGateway || null;

  const matchSubscription = {};
  if (planType) matchSubscription.planType = planType;
  if (status) matchSubscription.status = status;
  if (paymentGateway) matchSubscription.paymentGateway = paymentGateway;

  const [summary, totalRecords, subscriptionRecords] = await Promise.all([
    UserModel.aggregate([
      { $match: { accessType: { $nin: ['superAdmin'] } } },
      {
        $group: {
          _id: { plan: '$packageType', status: '$subscriptionStatus' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.plan',
          byStatus: { $push: { status: '$_id.status', count: '$count' } },
          total: { $sum: '$count' },
        },
      },
      { $sort: { total: -1 } },
    ]),
    SubscriptionModel.countDocuments(matchSubscription),
    SubscriptionModel.find(matchSubscription)
      .populate('userId', 'firstName lastName email packageType subscriptionStatus isInTrialPeriod trialEndsDate createdAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    summary,
    subscriptionRecords,
    pagination: {
      currentPage: page,
      limit,
      totalCount: totalRecords,
      totalPages: Math.ceil(totalRecords / limit) || 1,
    },
  };
};

module.exports = {
  getSubscriptionOverview,
};
