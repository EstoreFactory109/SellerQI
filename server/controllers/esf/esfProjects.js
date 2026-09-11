/**
 * esfProjects.js
 *
 * Connecting an ESF client to an existing Zoho project, from the clients page.
 *
 * Projects are never created here — see Services/Zoho/ZohoProjectLinks.js for
 * why, and for the suggestion/search logic these endpoints expose.
 *
 *   GET    /app/esf/clients/:clientId/project-options   picker data (suggest + search)
 *   POST   /app/esf/clients/:clientId/project           link an existing project
 *   DELETE /app/esf/clients/:clientId/project           remove the link
 *
 * All three sit behind esfAuth. Linking is deliberately open to every staff
 * member rather than owner/admin only: canManageClients() is the portal's
 * "managing clients is the job" rule, and attaching a project is client
 * management, not a portal-wide setting like the Zoho connection itself.
 */

const mongoose = require('mongoose');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ZohoProjectLinks = require('../../Services/Zoho/ZohoProjectLinks.js');

/** Shared guard: a valid ObjectId, or a 400 that has already been sent. */
const validClientId = (req, res) => {
    const { clientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
        res.status(400).json(new ApiResponse(400, '', 'Invalid client id'));
        return null;
    }
    return clientId;
};

/**
 * Turn a thrown ApiError into the response shape the rest of this controller
 * family uses. Anything unexpected is logged and reported as a 500 rather than
 * leaking a Zoho/Mongo message to the portal.
 */
const respondToError = (res, error, context) => {
    if (error instanceof ApiError) {
        logger.error(error);
        return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
    }
    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return res.status(500).json(new ApiResponse(500, '', context));
};

/**
 * @route GET /app/esf/clients/:clientId/project-options?search=&refresh=
 *
 * With no `search` this returns suggestions matched against the client's brand;
 * with one it returns name matches. `refresh=true` bypasses the 5-minute project
 * cache, for when someone has just created the project in Zoho.
 */
const getClientProjectOptions = asyncHandler(async (req, res) => {
    const clientId = validClientId(req, res);
    if (!clientId) return;

    try {
        const options = await ZohoProjectLinks.getProjectOptions({
            clientId,
            search: req.query.search || '',
            refresh: req.query.refresh === 'true',
        });
        return res.status(200).json(new ApiResponse(200, options, 'Project options fetched'));
    } catch (error) {
        return respondToError(res, error, 'Could not load projects from Zoho');
    }
});

/**
 * @route POST /app/esf/clients/:clientId/project
 * body: { projectId }
 */
const linkClientProject = asyncHandler(async (req, res) => {
    const clientId = validClientId(req, res);
    if (!clientId) return;

    try {
        const zohoProject = await ZohoProjectLinks.linkProject({
            clientId,
            projectId: req.body.projectId,
            staffUserId: req.esfUserId,
        });
        return res.status(200).json(new ApiResponse(200, { zohoProject }, 'Project connected to client'));
    } catch (error) {
        return respondToError(res, error, 'Could not connect the project');
    }
});

/**
 * @route DELETE /app/esf/clients/:clientId/project
 */
const unlinkClientProject = asyncHandler(async (req, res) => {
    const clientId = validClientId(req, res);
    if (!clientId) return;

    try {
        await ZohoProjectLinks.unlinkProject(clientId);
        return res.status(200).json(new ApiResponse(200, { zohoProject: null }, 'Project disconnected from client'));
    } catch (error) {
        return respondToError(res, error, 'Could not disconnect the project');
    }
});

module.exports = {
    getClientProjectOptions,
    linkClientProject,
    unlinkClientProject,
};
