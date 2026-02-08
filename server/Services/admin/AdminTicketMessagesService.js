/**
 * Admin Ticket Messages Service
 * Independent service for superAdmin to fetch support/ticket messages.
 * Does not affect existing support ticket creation flow (POST /app/support).
 */
const Support = require('../../models/system/SupportModel.js');

/**
 * Get all support ticket messages with pagination
 * @param {Object} options - { page, limit, topic }
 * @returns {Promise<{ tickets, pagination }>}
 */
const getTicketMessages = async (options = {}) => {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 20));
  const skip = (page - 1) * limit;
  const topic = options.topic || null;

  const query = {};
  if (topic) query.topic = new RegExp(topic, 'i');

  const [tickets, totalCount] = await Promise.all([
    Support.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Support.countDocuments(query),
  ]);

  return {
    tickets,
    pagination: {
      currentPage: page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
};

module.exports = {
  getTicketMessages,
};
