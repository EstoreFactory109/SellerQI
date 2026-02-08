/**
 * Admin Email Logs Service
 * Independent service for superAdmin to fetch all email logs.
 * Does not affect existing user-scoped email log flows (e.g. /app/analyse/logging/emails).
 */
const EmailLogs = require('../../models/system/EmailLogsModel.js');

/**
 * Get all email logs with pagination and filters (superAdmin)
 * @param {Object} options - { page, limit, type, status, startDate, endDate }
 * @returns {Promise<{ emailLogs, stats, pagination }>}
 */
const getAllEmailLogs = async (options = {}) => {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 50));
  const skip = (page - 1) * limit;
  const emailType = options.type || null;
  const status = options.status || null;
  const startDate = options.startDate || null;
  const endDate = options.endDate || null;

  const query = {};
  if (emailType) query.emailType = emailType.toUpperCase();
  if (status) query.status = status.toUpperCase();
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const [emailLogs, totalCount, stats] = await Promise.all([
    EmailLogs.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('receiverId', 'firstName lastName email', 'User', { strictPopulate: false })
      .select('emailType receiverEmail receiverId status sentDate sentTime errorMessage subject emailProvider retryCount createdAt updatedAt')
      .lean(),
    EmailLogs.countDocuments(query),
    EmailLogs.aggregate([
      { $match: query },
      {
        $group: {
          _id: { emailType: '$emailType', status: '$status' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.emailType',
          statuses: { $push: { status: '$_id.status', count: '$count' } },
          totalCount: { $sum: '$count' },
        },
      },
      { $sort: { totalCount: -1 } },
    ]),
  ]);

  const formattedLogs = emailLogs.map((log) => ({
    id: log._id,
    emailType: log.emailType,
    receiverEmail: log.receiverEmail,
    receiverId: log.receiverId?._id || null,
    receiverName: log.receiverId ? `${log.receiverId.firstName || ''} ${log.receiverId.lastName || ''}`.trim() || 'Unknown' : '—',
    status: log.status,
    subject: log.subject,
    emailProvider: log.emailProvider,
    sentDate: log.sentDate,
    sentTime: log.sentTime,
    errorMessage: log.errorMessage,
    retryCount: log.retryCount,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  }));

  return {
    emailLogs: formattedLogs,
    stats,
    pagination: {
      currentPage: page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
};

module.exports = {
  getAllEmailLogs,
};
