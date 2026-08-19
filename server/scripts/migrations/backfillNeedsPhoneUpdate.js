/**
 * Flag existing users whose stored phone number cannot be trusted, so the
 * phone-collection modal asks them for it on their next visit.
 *
 * Two groups are flagged, told apart by phoneUpdateReason:
 *
 *   'missing'      - Google OAuth signups. googleRegisterUser never asks for a
 *                    phone; it writes `Date.now().toString().slice(-10)` as the
 *                    phone and that value + 1 as the whatsapp, purely to satisfy
 *                    the required field and the unique index. These are not real
 *                    numbers. Matched only when ALL of these hold, so that Google
 *                    users who later supplied a real number are left alone:
 *                      - phone is exactly 10 bare digits
 *                      - whatsapp === phone + 1
 *                      - phone reconstructs to within 60s of the doc's createdAt
 *
 *   'country_code' - agency clients. The client form and validator used to force
 *                    exactly 10 bare digits, so their real numbers are stored
 *                    without a country code. These surface when an agency owner
 *                    opens the client session via "login as client".
 *
 * Users whose phone already starts with "+" are never touched.
 *
 * Usage:
 *   node server/scripts/migrations/backfillNeedsPhoneUpdate.js            # dry run, prints what would change
 *   node server/scripts/migrations/backfillNeedsPhoneUpdate.js --apply    # actually writes
 *   node server/scripts/migrations/backfillNeedsPhoneUpdate.js --apply --skip-purged
 *
 * Env: DB_URI, DB_NAME
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const dbConsts = require('../../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName ? `${dbConsts.dbUri}/${dbConsts.dbName}` : process.env.MONGODB_URI;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_PURGED = args.includes('--skip-purged');

/**
 * A Google placeholder phone is the last 10 digits of Date.now() at signup, with
 * whatsapp one higher. Rebuilding the full epoch from createdAt's leading digits
 * and comparing back is what separates these from real 10-digit numbers.
 */
const isGooglePlaceholder = (user) => {
  const phone = String(user.phone || '');
  const whatsapp = String(user.whatsapp || '');
  if (!/^\d{10}$/.test(phone)) return false;
  if (Number(whatsapp) !== Number(phone) + 1) return false;
  if (!user.createdAt) return false;

  const created = new Date(user.createdAt).getTime();
  const createdStr = String(created);
  const rebuilt = Number(createdStr.slice(0, createdStr.length - 10) + phone);
  return Math.abs(created - rebuilt) < 60000;
};

(async () => {
  if (!MONGODB_URI) {
    console.error('Missing DB_URI / DB_NAME in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, { connectTimeoutMS: 60000 });
  const users = mongoose.connection.db.collection('users');

  console.log(APPLY ? '=== APPLY MODE - writes enabled ===' : '=== DRY RUN - no writes, pass --apply to write ===');

  // Only users whose phone has no country code are candidates.
  const candidates = await users
    .find(
      { phone: { $not: /^\+/ } },
      { projection: { email: 1, phone: 1, whatsapp: 1, createdAt: 1, profilePic: 1, purgedAt: 1, isAgencyClient: 1, needsPhoneUpdate: 1 } }
    )
    .toArray();

  const googlePlaceholder = [];
  const agencyClients = [];
  const skipped = [];

  for (const user of candidates) {
    if (SKIP_PURGED && user.purgedAt) {
      skipped.push({ user, why: 'purged' });
      continue;
    }
    if (isGooglePlaceholder(user)) {
      googlePlaceholder.push(user);
    } else if (user.isAgencyClient) {
      agencyClients.push(user);
    } else {
      // Real number from a pre-fix email signup. Out of scope for now - these
      // users have a usable number, it just lacks the country code.
      skipped.push({ user, why: 'real number, pre-fix signup' });
    }
  }

  const mask = (email) => (email ? String(email).replace(/^(.{3}).*(@.*)$/, '$1***$2') : email);

  console.log(`\ncandidates (phone without "+"): ${candidates.length}`);
  console.log(`  -> 'missing'      (Google placeholder): ${googlePlaceholder.length}`);
  console.log(`  -> 'country_code' (agency clients):     ${agencyClients.length}`);
  console.log(`  -> left alone:                          ${skipped.length}`);

  console.log('\n--- would flag as missing ---');
  googlePlaceholder.forEach((u) =>
    console.log(`  ${mask(u.email)} | ${u.phone} | ${new Date(u.createdAt).toISOString().slice(0, 10)}${u.purgedAt ? ' | purged' : ''}`)
  );

  console.log('\n--- would flag as country_code ---');
  agencyClients.forEach((u) =>
    console.log(`  ${mask(u.email)} | ${u.phone} | ${new Date(u.createdAt).toISOString().slice(0, 10)}`)
  );

  if (!APPLY) {
    console.log('\nDry run complete. Nothing was written.');
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const [group, reason] of [[googlePlaceholder, 'missing'], [agencyClients, 'country_code']]) {
    if (!group.length) continue;
    const result = await users.updateMany(
      { _id: { $in: group.map((u) => u._id) } },
      { $set: { needsPhoneUpdate: true, phoneUpdateReason: reason } }
    );
    console.log(`\nflagged ${result.modifiedCount} user(s) as '${reason}'`);
    updated += result.modifiedCount;
  }

  console.log(`\nDone. ${updated} user(s) updated.`);
  await mongoose.disconnect();
})().catch((error) => {
  console.error('Backfill failed:', error.message);
  process.exit(1);
});
