/**
 * READ-ONLY dry run: what would a Fix it purchase do in Zoho for each ESF client with no
 * linked project — link which existing project, or create a new one?
 *
 * Runs the same finder the purchase uses (FixItZohoService.findExistingProject: brand
 * shortlist, then the AI match, then an exact-name check) and prints the decision. Nothing
 * is linked, created or written to Mongo or Zoho. The only side effects are the OpenAI calls
 * and refreshing the 5-minute Zoho project-list cache in Redis (what any page load does).
 *
 * Usage (from the repo root, with the production .env):
 *   node server/scripts/dryRunFixItProjectMatch.js [maxClients]
 *
 * Connect Redis first so the cached Zoho token is reused (see probeZohoDeliverables.js).
 */
require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../config/dbConn.js');
const { connectRedis } = require('../config/redisConn.js');

(async () => {
    await dbConnect();
    await connectRedis();
    const UserModel = require('../models/user-auth/userModel.js');
    const SellerCentralModel = require('../models/user-auth/sellerCentralModel.js');
    const { findExistingProject } = require('../Services/Stripe/FixItZohoService.js');

    const max = Number(process.argv[2]) || 50;
    const clients = await UserModel.find({ isEsfClient: true, $or: [{ 'zohoProject.projectId': null }, { zohoProject: null }, { zohoProject: { $exists: false } }] })
        .select('firstName lastName email zohoProject').limit(max).lean();
    console.log(`${clients.length} ESF client(s) with no linked Zoho project\n`);

    const tally = { link: 0, create: 0 };
    for (const user of clients) {
        const seller = await SellerCentralModel.findOne({ User: user._id }).select('brand').lean();
        const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const brand = String(seller?.brand || '').trim() || name || user.email;
        const found = await findExistingProject(user, brand);
        const label = `${name || '(no name)'} — brand "${brand}"`;
        if (found.project) {
            tally.link += 1;
            console.log(`LINK    ${label}\n        → "${found.project.name}" (${found.project.id}) by ${found.matchedBy}${found.reason ? `: ${found.reason}` : ''}`);
        } else {
            tally.create += 1;
            const newName = found.nameTakenByAnotherClient && name ? `${brand} – ${name}` : brand;
            console.log(`CREATE  ${label}\n        → new project "${newName}"; considered: ${found.shortlist.map((p) => `"${p.name}"`).join(', ') || 'none'}`);
        }
    }
    console.log(`\nWould link ${tally.link}, create ${tally.create}. Nothing was changed.`);
    await mongoose.disconnect();
    process.exit(0);
})().catch(async (error) => {
    console.error('FAILED:', error.message);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
