/**
 * Admin Subscription Controller
 * Independent controller for manage-accounts subscription page.
 * Requires superAdmin auth. Does not affect existing subscription flows.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { getSubscriptionOverview } = require('../../Services/Admin/AdminSubscriptionService.js');

const getSubscriptionData = asyncHandler(async (req, res) => {
  const adminId = req.SuperAdminId;
  if (!adminId) {
    return res.status(401).json(new ApiResponse(401, '', 'Admin token required'));
  }

  const admin = await UserModel.findById(adminId).select('accessType');
  if (!admin || admin.accessType !== 'superAdmin') {
    return res.status(403).json(new ApiResponse(403, '', 'SuperAdmin access required'));
  }

  try {
    const { page, limit, planType, status, paymentGateway } = req.query;
    const data = await getSubscriptionOverview({ page, limit, planType, status, paymentGateway });
    return res.status(200).json(new ApiResponse(200, data, 'Subscription data retrieved successfully'));
  } catch (error) {
    logger.error('Admin getSubscriptionData error', { error: error.message });
    return res.status(500).json(new ApiResponse(500, '', 'Failed to fetch subscription data'));
  }
});

module.exports = {
  getSubscriptionData,
};
