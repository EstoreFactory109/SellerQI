const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken } = require('../utils/Tokens.js');
const logger = require('../utils/Logger.js');
const UserModel = require('../models/userModel.js');
const AgencySellerModel = require('../models/AgencySellerModel.js');
const SellerCentralModel = require('../models/sellerCentralModel.js');
const SubscriptionModel = require('../models/SubscriptionModel.js');
const { createUser } = require('../Services/User/userServices.js');

// Register a new client for agency owner
const registerAgencyClient = asyncHandler(async (req, res) => {
    const { firstName, lastName, phone, whatsapp, email, password } = req.body;
    const agencyOwnerId = req.agencyOwnerId;

    if (!firstName || !lastName || !phone || !whatsapp || !email || !password) {
        logger.error(new ApiError(400, "All client details are required"));
        return res.status(400).json(new ApiResponse(400, "", "All client details are required"));
    }

    if (!agencyOwnerId) {
        logger.error(new ApiError(401, "Agency owner authentication required"));
        return res.status(401).json(new ApiResponse(401, "", "Agency owner authentication required"));
    }

    // Check if agency owner exists and has AGENCY plan
    const agencyOwner = await UserModel.findById(agencyOwnerId);
    if (!agencyOwner || agencyOwner.subscriptionPlan !== 'AGENCY') {
        logger.error(new ApiError(403, "Invalid agency owner or subscription plan"));
        return res.status(403).json(new ApiResponse(403, "", "Invalid agency owner or subscription plan"));
    }

    // Check if client email already exists
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
        logger.error(new ApiError(409, "Client email already exists"));
        return res.status(409).json(new ApiResponse(409, "", "Client email already exists"));
    }

    try {
        // Create the client user (skip OTP and email verification for agency clients)
        const clientUser = await createUser(firstName, lastName, phone, whatsapp, email, password, null, true);
        if (!clientUser) {
            logger.error(new ApiError(500, "Internal server error in creating client user"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating client user"));
        }

        // Set client as verified, assign owner, and set PRO plan (no email verification needed for agency clients)
        clientUser.isVerified = true;
        clientUser.OTP = null;
        clientUser.owner = agencyOwnerId;
        clientUser.subscriptionPlan = 'PRO';
        clientUser.subscriptionStatus = 'active';
        await clientUser.save();

        // Create PRO subscription record for the client
        await SubscriptionModel.create({
            userId: clientUser._id,
            stripeSubscriptionId: 'AGENCY_CLIENT_' + clientUser._id, // Special ID for agency clients
            stripeCustomerId: 'AGENCY_CLIENT_' + clientUser._id, // Special ID for agency clients
            planType: 'PRO',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
            cancelAtPeriodEnd: false
        });

        // Note: SellerCentral will be created later when client connects to Amazon
        // This allows country/region to be selected on the Connect to Amazon page

        // Create agency relationship
        let agencySeller = await AgencySellerModel.findOne({ User: agencyOwnerId });
        if (!agencySeller) {
            agencySeller = await AgencySellerModel.create({ 
                User: agencyOwnerId, 
                agencyAccount: [] 
            });
        }

        // Add client to agency account (country/region will be added later)
        agencySeller.agencyAccount.push({
            clientId: clientUser._id,
            selling_partner_id: "",
            country: "", // Will be set when connecting to Amazon
            region: "", // Will be set when connecting to Amazon
            products: [],
            TotalProducts: []
        });
        await agencySeller.save();

        // Generate new tokens for the client
        const ClientAccessToken = await createAccessToken(clientUser._id);
        const ClientRefreshToken = await createRefreshToken(clientUser._id);

        if (!ClientAccessToken || !ClientRefreshToken) {
            logger.error(new ApiError(500, "Internal server error in creating client tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating client tokens"));
        }

        // Store refresh token
        clientUser.appRefreshToken = ClientRefreshToken;
        await clientUser.save();

        const options = {
            httpOnly: true,
            secure: true,
            sameSite: "None"
        };

        res.status(201)
            .cookie("IBEXAccessToken", ClientAccessToken, options)
            .cookie("IBEXRefreshToken", ClientRefreshToken, options)
            .json(new ApiResponse(201, {
                clientId: clientUser._id,
                firstName: clientUser.firstName,
                lastName: clientUser.lastName,
                email: clientUser.email
            }, "Agency client registered successfully and tokens updated"));

    } catch (error) {
        logger.error(`Error in registerAgencyClient: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in registering client"));
    }
});

// Get agency clients
const getAgencyClients = asyncHandler(async (req, res) => {
    const agencyOwnerId = req.agencyOwnerId;

    if (!agencyOwnerId) {
        logger.error(new ApiError(401, "Agency owner authentication required"));
        return res.status(401).json(new ApiResponse(401, "", "Agency owner authentication required"));
    }

    try {
        const agencySeller = await AgencySellerModel.findOne({ User: agencyOwnerId })
            .populate('agencyAccount.clientId', 'firstName lastName email phone whatsapp createdAt');

        if (!agencySeller) {
            return res.status(200).json(new ApiResponse(200, [], "No clients found"));
        }

        const clients = agencySeller.agencyAccount.map(account => ({
            clientId: account.clientId._id,
            firstName: account.clientId.firstName,
            lastName: account.clientId.lastName,
            email: account.clientId.email,
            phone: account.clientId.phone,
            whatsapp: account.clientId.whatsapp,
            country: account.country,
            region: account.region,
            selling_partner_id: account.selling_partner_id,
            createdAt: account.clientId.createdAt
        }));

        res.status(200).json(new ApiResponse(200, clients, "Agency clients retrieved successfully"));

    } catch (error) {
        logger.error(`Error in getAgencyClients: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting clients"));
    }
});

// Switch to a specific client (replace tokens)
const switchToClient = asyncHandler(async (req, res) => {
    const { clientId } = req.body;
    const agencyOwnerId = req.agencyOwnerId;

    if (!clientId || !agencyOwnerId) {
        logger.error(new ApiError(400, "Client ID and agency owner authentication required"));
        return res.status(400).json(new ApiResponse(400, "", "Client ID required"));
    }

    try {
        // Verify agency owner has access to this client
        const agencySeller = await AgencySellerModel.findOne({ 
            User: agencyOwnerId,
            'agencyAccount.clientId': clientId 
        });

        if (!agencySeller) {
            logger.error(new ApiError(403, "Access denied to this client"));
            return res.status(403).json(new ApiResponse(403, "", "Access denied to this client"));
        }

        // Generate new tokens for the client
        const ClientAccessToken = await createAccessToken(clientId);
        const ClientRefreshToken = await createRefreshToken(clientId);

        if (!ClientAccessToken || !ClientRefreshToken) {
            logger.error(new ApiError(500, "Internal server error in creating client tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating client tokens"));
        }

        // Update client's refresh token
        await UserModel.findByIdAndUpdate(clientId, { appRefreshToken: ClientRefreshToken });

        const options = {
            httpOnly: true,
            secure: true,
            sameSite: "None"
        };

        res.status(200)
            .cookie("IBEXAccessToken", ClientAccessToken, options)
            .cookie("IBEXRefreshToken", ClientRefreshToken, options)
            .json(new ApiResponse(200, { clientId }, "Switched to client successfully"));

    } catch (error) {
        logger.error(`Error in switchToClient: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in switching client"));
    }
});

module.exports = {
    registerAgencyClient,
    getAgencyClients,
    switchToClient
}; 