/**
 * Admin Ticket Messages Controller
 * Independent controller for manage-accounts user messages (support tickets) page.
 * Requires superAdmin auth. Does not affect existing support ticket creation (POST /app/support).
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { getTicketMessages } = require('../../Services/Admin/AdminTicketMessagesService.js');

const getAdminTicketMessages = asyncHandler(async (req, res) => {
  const adminId = req.SuperAdminId;
  if (!adminId) {
    return res.status(401).json(new ApiResponse(401, '', 'Admin token required'));
  }

  const admin = await UserModel.findById(adminId).select('accessType');
  if (!admin || admin.accessType !== 'superAdmin') {
    return res.status(403).json(new ApiResponse(403, '', 'SuperAdmin access required'));
  }

  try {
    const { page, limit, topic } = req.query;
    const data = await getTicketMessages({ page, limit, topic });
    return res.status(200).json(new ApiResponse(200, data, 'Ticket messages retrieved successfully'));
  } catch (error) {
    logger.error('Admin getAdminTicketMessages error', { error: error.message });
    return res.status(500).json(new ApiResponse(500, '', 'Failed to fetch ticket messages'));
  }
});

module.exports = {
  getAdminTicketMessages,
};
