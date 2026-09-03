/**
 * Seed the first eStore Factory portal staff account.
 *
 * Every account after this one is created from inside the portal via the
 * "Add user" button, so this only needs to be run once per environment.
 *
 * Usage:
 *   node server/scripts/createEsfUser.js <email> <password> <firstName> <lastName> [phone]
 *
 * Example:
 *   node server/scripts/createEsfUser.js ops@estorefactory.net "S3cretPass!" Priya Shah +14155550177
 *
 * Re-running with an existing email promotes that user to esfUser and resets
 * their password, so it doubles as a recovery path if everyone is locked out.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const UserModel = require('../models/user-auth/userModel.js');
const { hashPassword } = require('../utils/HashPassword.js');

const [, , email, password, firstName, lastName, phone] = process.argv;

const usage = () => {
    console.error('Usage: node server/scripts/createEsfUser.js <email> <password> <firstName> <lastName> [phone]');
    process.exit(1);
};

if (!email || !password || !firstName || !lastName) usage();
if (password.length < 8) {
    console.error('Password must be at least 8 characters long.');
    process.exit(1);
}

const run = async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
    if (!uri) {
        console.error('No Mongo connection string found (MONGODB_URI / MONGO_URI / DB_URI).');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await UserModel.findOne({ email: normalizedEmail });

    if (existing) {
        existing.accessType = 'esfUser';
        existing.password = await hashPassword(password);
        existing.isVerified = true;
        await existing.save();
        console.log(`Updated existing user ${normalizedEmail} -> accessType 'esfUser' and reset password.`);
    } else {
        const user = new UserModel({
            firstName,
            lastName,
            email: normalizedEmail,
            phone: phone || '+10000000000',
            whatsapp: phone || '+10000000000',
            password: await hashPassword(password),
            accessType: 'esfUser',
            isVerified: true,
            allTermsAndConditionsAgreed: true,
            packageType: 'LITE',
            subscriptionStatus: 'active',
        });
        await user.save();
        console.log(`Created ESF portal user ${normalizedEmail} (${user._id}).`);
    }

    console.log('Sign in at /esf-login');
    await mongoose.disconnect();
    process.exit(0);
};

run().catch(async (err) => {
    console.error('Failed to create ESF user:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* already closed */ }
    process.exit(1);
});
