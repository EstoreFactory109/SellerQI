/**
 * Admin Email Logs Controller
 * Independent controller for manage-accounts email logs page.
 * Requires superAdmin auth. Does not affect existing user email log routes (/app/analyse/logging/emails).
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { getAllEmailLogs } = require('../../Services/admin/AdminEmailLogsService.js');

const getAdminEmailLogs = asyncHandler(async (req, res) => {
  const adminId = req.SuperAdminId;
  if (!adminId) {
    return res.status(401).json(new ApiResponse(401, '', 'Admin token required'));
  }

  const admin = await UserModel.findById(adminId).select('accessType');
  if (!admin || admin.accessType !== 'superAdmin') {
    return res.status(403).json(new ApiResponse(403, '', 'SuperAdmin access required'));
  }

  try {
    const { page, limit, type, status, startDate, endDate } = req.query;
    const data = await getAllEmailLogs({ page, limit, type, status, startDate, endDate });
    return res.status(200).json(new ApiResponse(200, data, 'Email logs retrieved successfully'));
  } catch (error) {
    logger.error('Admin getAdminEmailLogs error', { error: error.message });
    return res.status(500).json(new ApiResponse(500, '', 'Failed to fetch email logs'));
  }
});

module.exports = {
  getAdminEmailLogs,
};
