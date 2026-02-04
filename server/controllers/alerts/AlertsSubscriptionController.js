/**
 * AlertsSubscriptionController.js
 *
 * Public endpoint helper for managing alert email subscription by email.
 * Intended for "unsubscribe" links from emails (no auth required).
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const User = require('../../models/user-auth/userModel.js');

const EMAIL_REGEX = /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;

/**
 * POST /api/alerts/unsubscribe
 * Body: { email: string }
 *
 * Idempotent: calling multiple times is safe.
 */
const unsubscribeAlertsByEmail = asyncHandler(async (req, res) => {
  const emailRaw = req.body?.email;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';

  if (!email) {
    return res.status(400).json(new ApiResponse(400, null, 'Email is required'));
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json(new ApiResponse(400, null, 'Please enter a valid email address'));
  }

  await User.findOneAndUpdate(
    { email },
    { $set: { subscribedToAlerts: false } },
    { new: false }
  );

  // Return a generic success message to avoid leaking whether an email exists.
  return res
    .status(200)
    .json(new ApiResponse(200, { subscribedToAlerts: false }, 'Unsubscribed from alerts (if the account exists)'));
});

module.exports = {
  unsubscribeAlertsByEmail,
};

