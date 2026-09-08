/**
 * Set an ESF staff member's portal role.
 *
 * Mainly used once, to stamp `esfRole: 'owner'` on the portal owner. The API
 * deliberately refuses to assign 'owner', so this script is the only way in.
 *
 * Usage:
 *   node server/scripts/setEsfRole.js <email> <owner|admin|member>
 *
 * Example:
 *   node server/scripts/setEsfRole.js estorefactory@portal.com owner
 *
 * Note: the account matching ESF_OWNER_EMAIL is treated as the owner by the
 * permission guards whether or not this has been run — this just makes the
 * stored value agree with the effective one.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');
const UserModel = require('../models/user-auth/userModel.js');
const { ESF_ROLES } = require('../Services/User/esfRoles.js');

const [, , email, role] = process.argv;
const VALID = Object.values(ESF_ROLES);

if (!email || !role || !VALID.includes(role)) {
    console.error(`Usage: node server/scripts/setEsfRole.js <email> <${VALID.join('|')}>`);
    process.exit(1);
}

const run = async () => {
    if (!dbConsts.dbUri || !dbConsts.dbName) {
        console.error('DB_URI and DB_NAME must both be set in .env');
        process.exit(1);
    }

    await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`);
    console.log(`Connected to MongoDB (db: ${dbConsts.dbName})`);

    const normalizedEmail = email.trim().toLowerCase();
    const user = await UserModel.findOne({ email: normalizedEmail });

    if (!user) {
        console.error(`No user found with email ${normalizedEmail}`);
        await mongoose.disconnect();
        process.exit(1);
    }

    if (user.accessType !== 'esfUser') {
        console.error(`${normalizedEmail} is not an ESF portal user (accessType: ${user.accessType}).`);
        await mongoose.disconnect();
        process.exit(1);
    }

    // Exactly one owner: demote any other owner before promoting this one.
    if (role === ESF_ROLES.OWNER) {
        const demoted = await UserModel.updateMany(
            { accessType: 'esfUser', esfRole: ESF_ROLES.OWNER, _id: { $ne: user._id } },
            { $set: { esfRole: ESF_ROLES.ADMIN } }
        );
        if (demoted.modifiedCount > 0) {
            console.log(`Demoted ${demoted.modifiedCount} previous owner(s) to admin.`);
        }
    }

    const previous = user.esfRole;
    user.esfRole = role;
    await user.save();

    console.log(`${normalizedEmail}: ${previous || '(unset)'} -> ${role}`);
    await mongoose.disconnect();
    process.exit(0);
};

run().catch(async (err) => {
    console.error('Failed to set ESF role:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* already closed */ }
    process.exit(1);
});
