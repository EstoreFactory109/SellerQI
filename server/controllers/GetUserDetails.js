const User = require('../models/userModel');
const Seller = require('../models/sellerCentralModel');

/**
 * Controller 1: Get All Users
 * Fetches all user details from the database with their seller account details
 */
const getAllUsers = async (req, res) => {
  try {
    // Fetch all users from the database
    const users = await User.find({}).select('-password -OTP -resetPasswordCode');

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users found',
        data: []
      });
    }

    // Process each user to include seller account details
    const usersWithSellerAccounts = await Promise.all(
      users.map(async (user) => {
        const userData = {
          firstName: user.firstName,
          lastName: user.lastName,
          Phone: user.phone,
          Whatsapp: user.whatsapp,
          email: user.email,
          packageType: user.packageType,
          subscriptionStatus: user.subscriptionStatus,
          isInTrialPeriod: user.isInTrialPeriod,
          trialEndsDate: user.trialEndsDate,
          isVerified: user.isVerified,
          sellerAccount: []
        };

        // Find seller accounts for this user
        const sellerAccounts = await Seller.find({ User: user._id });
        
        if (sellerAccounts && sellerAccounts.length > 0) {
          // Process seller accounts
          sellerAccounts.forEach(seller => {
            if (seller.sellerAccount && seller.sellerAccount.length > 0) {
              seller.sellerAccount.forEach(account => {
                userData.sellerAccount.push({
                  country: account.country || '',
                  region: account.region || '',
                  spAPI: !!(account.spiRefreshToken && account.spiRefreshToken.trim() !== ''),
                  Ads: !!(account.adsRefreshToken && account.adsRefreshToken.trim() !== '')
                });
              });
            }
          });
        }

        return userData;
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: usersWithSellerAccounts
    });

  } catch (error) {
    console.error('Error fetching all users:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching users',
      error: error.message
    });
  }
};

/**
 * Controller 2: Get User by Email or Phone
 * Retrieves user details based on email or phone number
 */
const getUserByEmailOrPhone = async (req, res) => {
  try {
    const { email, phone } = req.query;

    // Validate that at least one parameter is provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone parameter is required'
      });
    }

    // Build query object
    const query = {};
    if (email) {
      query.email = email.toLowerCase().trim();
    }
    if (phone) {
      query.phone = phone.trim();
    }

    // Find user by email or phone
    const user = await User.findOne(query).select('-password -OTP -resetPasswordCode');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare user data
    const userData = {
      firstName: user.firstName,
      lastName: user.lastName,
      Phone: user.phone,
      Whatsapp: user.whatsapp,
      email: user.email,
      packageType: user.packageType,
      subscriptionStatus: user.subscriptionStatus,
      isInTrialPeriod: user.isInTrialPeriod,
      trialEndsDate: user.trialEndsDate,
      isVerified: user.isVerified,
      sellerAccount: []
    };

    // Find seller accounts for this user
    const sellerAccounts = await Seller.find({ User: user._id });
    
    if (sellerAccounts && sellerAccounts.length > 0) {
      // Process seller accounts
      sellerAccounts.forEach(seller => {
        if (seller.sellerAccount && seller.sellerAccount.length > 0) {
          seller.sellerAccount.forEach(account => {
            userData.sellerAccount.push({
              country: account.country || '',
              region: account.region || '',
              spAPI: !!(account.spiRefreshToken && account.spiRefreshToken.trim() !== ''),
              Ads: !!(account.adsRefreshToken && account.adsRefreshToken.trim() !== '')
            });
          });
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: userData
    });

  } catch (error) {
    console.error('Error fetching user by email or phone:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching user',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsers,
  getUserByEmailOrPhone
};
