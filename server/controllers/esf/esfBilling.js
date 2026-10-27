/**
 * ESF portal: link a client to their Zoho Billing customer by hand.
 *   GET    /app/esf/clients/:clientId/billing-options?search=&refresh=1
 *   POST   /app/esf/clients/:clientId/billing   { customerId }
 *   DELETE /app/esf/clients/:clientId/billing
 *
 * Billing is financial: owner, admins and platform super admins only (canManageBilling);
 * members get 403. Scoped like every client route (canAccessClient) and to ESF clients only.
 * The rules live in Services/Zoho/ZohoBillingLinks.js, shared with the super admin's routes.
 */
const mongoose = require('mongoose');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ZohoBillingLinks = require('../../Services/Zoho/ZohoBillingLinks.js');
const { canAccessClient } = require('../../Services/User/esfClientScope.js');
const { canManageBilling } = require('../../Services/User/esfRoles.js');

/** Shared by the ESF and super admin controllers. */
const respondToError = (res, error, context) => {
    if (error instanceof ApiError) {
        if (error.statusCode >= 500) logger.error(error);
        return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
    }
    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return res.status(500).json(new ApiResponse(500, '', context));
};

const allowed = (req, res) => {
    if (!canManageBilling(req.esfUser)) {
        res.status(403).json(new ApiResponse(403, '', 'Only the portal owner and admins can manage billing links'));
        return null;
    }
    const { clientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(clientId) || !canAccessClient(req.esfUser, clientId)) {
        res.status(404).json(new ApiResponse(404, '', 'Client not found'));
        return null;
    }
    return clientId;
};

const getClientBillingOptions = asyncHandler(async (req, res) => {
    const clientId = allowed(req, res);
    if (!clientId) return undefined;
    try {
        const data = await ZohoBillingLinks.getBillingOptions(clientId, {
            search: req.query.search,
            refresh: req.query.refresh === '1',
        });
        return res.status(200).json(new ApiResponse(200, data, 'OK'));
    } catch (error) {
        return respondToError(res, error, 'Could not load Zoho Billing customers');
    }
});

const linkClientBilling = asyncHandler(async (req, res) => {
    const clientId = allowed(req, res);
    if (!clientId) return undefined;
    try {
        const data = await ZohoBillingLinks.linkBillingCustomer(clientId, req.body?.customerId, req.esfUser);
        return res.status(200).json(new ApiResponse(200, data, 'Billing linked'));
    } catch (error) {
        return respondToError(res, error, 'Could not link the Zoho Billing customer');
    }
});

const unlinkClientBilling = asyncHandler(async (req, res) => {
    const clientId = allowed(req, res);
    if (!clientId) return undefined;
    try {
        const data = await ZohoBillingLinks.unlinkBillingCustomer(clientId, req.esfUser);
        return res.status(200).json(new ApiResponse(200, data, 'Billing unlinked'));
    } catch (error) {
        return respondToError(res, error, 'Could not unlink the Zoho Billing customer');
    }
});

module.exports = { getClientBillingOptions, linkClientBilling, unlinkClientBilling, respondToError };
