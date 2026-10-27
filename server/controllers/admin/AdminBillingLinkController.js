/**
 * Super admin: link an ESF client to their Zoho Billing customer by hand.
 *   GET    /app/auth/admin/accounts/:userId/billing-options?search=&refresh=1
 *   POST   /app/auth/admin/accounts/:userId/billing   { customerId }
 *   DELETE /app/auth/admin/accounts/:userId/billing
 * Same service and rules as the ESF portal (Services/Zoho/ZohoBillingLinks.js); ESF clients only.
 */
const mongoose = require('mongoose');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { requireSuperAdmin } = require('./admin.js');
const ZohoBillingLinks = require('../../Services/Zoho/ZohoBillingLinks.js');
const { respondToError } = require('../esf/esfBilling.js');

const target = async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return null;
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        res.status(404).json(new ApiResponse(404, '', 'Account not found'));
        return null;
    }
    return userId;
};

/** The super admin, recorded as the one who linked. */
const actor = (req) => ({ _id: req.SuperAdminId });

const getAccountBillingOptions = asyncHandler(async (req, res) => {
    const userId = await target(req, res);
    if (!userId) return undefined;
    try {
        const data = await ZohoBillingLinks.getBillingOptions(userId, { search: req.query.search, refresh: req.query.refresh === '1' });
        return res.status(200).json(new ApiResponse(200, data, 'OK'));
    } catch (error) {
        return respondToError(res, error, 'Could not load Zoho Billing customers');
    }
});

const linkAccountBilling = asyncHandler(async (req, res) => {
    const userId = await target(req, res);
    if (!userId) return undefined;
    try {
        const data = await ZohoBillingLinks.linkBillingCustomer(userId, req.body?.customerId, actor(req));
        return res.status(200).json(new ApiResponse(200, data, 'Billing linked'));
    } catch (error) {
        return respondToError(res, error, 'Could not link the Zoho Billing customer');
    }
});

const unlinkAccountBilling = asyncHandler(async (req, res) => {
    const userId = await target(req, res);
    if (!userId) return undefined;
    try {
        const data = await ZohoBillingLinks.unlinkBillingCustomer(userId, actor(req));
        return res.status(200).json(new ApiResponse(200, data, 'Billing unlinked'));
    } catch (error) {
        return respondToError(res, error, 'Could not unlink the Zoho Billing customer');
    }
});

module.exports = { getAccountBillingOptions, linkAccountBilling, unlinkAccountBilling };
