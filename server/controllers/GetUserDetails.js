const User = require("../models/userModel");
const Seller = require("../models/sellerCentralModel");

// Store user details in JSON format
const storeUserDetails = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      Phone,
      Whatsapp,
      email,
      packageType,
      sellerAccount
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !Phone || !Whatsapp || !email || !packageType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: firstName, lastName, Phone, Whatsapp, email, packageType"
      });
    }

    // Validate packageType
    const validPackageTypes = ["LITE", "PRO", "AGENCY"];
    if (!validPackageTypes.includes(packageType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid packageType. Must be one of: LITE, PRO, AGENCY"
      });
    }

    // Validate sellerAccount array if provided
    if (sellerAccount && Array.isArray(sellerAccount)) {
      for (const account of sellerAccount) {
        if (!account.country || !account.region) {
          return res.status(400).json({
            success: false,
            message: "Each sellerAccount must have country and region"
          });
        }
        
        const validRegions = ["NA", "EU", "FE"];
        if (!validRegions.includes(account.region)) {
          return res.status(400).json({
            success: false,
            message: "Invalid region in sellerAccount. Must be one of: NA, EU, FE"
          });
        }
      }
    }

    // Create user data object in the exact JSON format requested
    const userData = {
      firstName,
      lastName,
      Phone,
      Whatsapp,
      email,
      packageType,
      sellerAccount: sellerAccount || []
    };

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email already exists"
      });
    }

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      phone: Phone,
      whatsapp: Whatsapp,
      email,
      packageType,
      allTermsAndConditionsAgreed: true, // Default to true for stored user details
      accessType: "user",
      subscriptionStatus: "active"
    });

    const savedUser = await newUser.save();

    // If sellerAccount data is provided, create seller records
    if (sellerAccount && sellerAccount.length > 0) {
      const sellerAccounts = sellerAccount.map(account => ({
        selling_partner_id: account.selling_partner_id || "",
        spiRefreshToken: account.spAPI ? "connected" : "",
        adsRefreshToken: account.Ads ? "connected" : "",
        ProfileId: account.ProfileId || "",
        countryCode: account.countryCode || "",
        country: account.country,
        region: account.region,
        products: [],
        TotatProducts: []
      }));

      const sellerRecord = new Seller({
        User: savedUser._id,
        selling_partner_id: savedUser._id.toString(),
        sellerAccount: sellerAccounts
      });

      await sellerRecord.save();
    }

    // Return success response with stored data
    res.status(201).json({
      success: true,
      message: "User details stored successfully",
      data: userData,
      userId: savedUser._id
    });

  } catch (error) {
    console.error("Error storing user details:", error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists"
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error while storing user details",
      error: error.message
    });
  }
};

module.exports = {
  storeUserDetails
};
