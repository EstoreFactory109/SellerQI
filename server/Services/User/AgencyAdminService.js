const UserModel = require('../../models/user-auth/userModel.js');
const mongoose = require('mongoose');
const { uploadToCloudinary } = require('../Cloudinary/Cloudinary.js');
const logger = require('../../utils/Logger.js');

/**
 * Get agency admin profile with client statistics.
 * @param {string} adminId - Agency admin user ID
 * @returns {Promise<{adminInfo: object, clientStats: object}|null>} Profile data or null if not found
 */
const getAdminProfile = async (adminId) => {
    if (!adminId) return null;

    const adminUser = await UserModel.findById(adminId).select('-password');
    if (!adminUser) return null;

    const clientStats = await UserModel.aggregate([
        {
            $match: {
                $or: [
                    { agencyId: new mongoose.Types.ObjectId(adminId) },
                    { adminId: new mongoose.Types.ObjectId(adminId) }
                ]
            }
        },
        {
            $group: {
                _id: null,
                totalClients: { $sum: 1 },
                activeClients: {
                    $sum: {
                        $cond: [{ $eq: ['$subscriptionStatus', 'active'] }, 1, 0]
                    }
                }
            }
        }
    ]);

    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const newClientsThisMonth = await UserModel.countDocuments({
        $or: [
            { agencyId: adminId },
            { adminId: adminId }
        ],
        createdAt: { $gte: thisMonth }
    });

    const stats = clientStats[0] || { totalClients: 0, activeClients: 0 };
    stats.thisMonth = newClientsThisMonth;

    return {
        adminInfo: adminUser,
        clientStats: stats
    };
};

/**
 * Update agency admin profile details (all fields except email).
 * @param {string} adminId - Agency admin user ID
 * @param {object} payload - { firstName?, lastName?, phone?, whatsapp?, agencyName? }
 * @returns {Promise<object|null>} Updated admin user (without password) or null
 */
const updateAdminProfile = async (adminId, payload) => {
    if (!adminId) return null;

    const adminUser = await UserModel.findById(adminId);
    if (!adminUser) return null;

    const { firstName, lastName, phone, whatsapp, agencyName } = payload;

    if (firstName !== undefined && firstName !== null) adminUser.firstName = firstName;
    if (lastName !== undefined && lastName !== null) adminUser.lastName = lastName;
    if (phone !== undefined && phone !== null) adminUser.phone = phone;
    if (whatsapp !== undefined && whatsapp !== null) adminUser.whatsapp = whatsapp;
    if (agencyName !== undefined && agencyName !== null) adminUser.agencyName = agencyName;

    await adminUser.save();

    return UserModel.findById(adminId).select('-password').lean();
};

/**
 * Upload agency logo to Cloudinary and save URL to admin profile (profilePic).
 * Same flow as user profile pic: local file path -> Cloudinary upload -> save URL.
 * @param {string} adminId - Agency admin user ID
 * @param {string} localFilePath - Path to uploaded file (e.g. req.file.path from multer)
 * @returns {Promise<{profilePicUrl: string}|null>} { profilePicUrl } or null on failure
 */
const uploadAgencyLogo = async (adminId, localFilePath) => {
    if (!adminId || !localFilePath) return null;

    const profilePicUrl = await uploadToCloudinary(localFilePath);
    if (!profilePicUrl) {
        logger.warn('AgencyAdminService: Cloudinary upload failed for admin', { adminId });
        return null;
    }

    const adminUser = await UserModel.findById(adminId);
    if (!adminUser) return null;

    adminUser.profilePic = profilePicUrl;
    await adminUser.save();

    return { profilePicUrl };
};

module.exports = {
    getAdminProfile,
    updateAdminProfile,
    uploadAgencyLogo
};
