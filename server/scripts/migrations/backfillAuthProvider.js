/**
 * Set authProvider: 'google' on accounts that were created through Google sign-up,
 * so login can tell them "this account uses Google Sign-In" instead of leaving
 * them stuck on "Incorrect email or password" forever.
 *
 * Accounts created before this field existed have no provider recorded, so they
 * are identified by the two artefacts googleRegisterUser used to leave behind:
 *
 *   - a Google profile picture (profilePic on googleusercontent.com), and/or
 *   - the placeholder phone it generated: `Date.now().toString().slice(-10)` as
 *     the phone with that value + 1 as the whatsapp. Rebuilding the full epoch
 *     from createdAt and comparing back is what separates these from real
 *     10-digit numbers. Same test as backfillNeedsPhoneUpdate.js.
 *
 * Either signal alone is accepted: a Google user who later set a real phone keeps
 * the picture, and one who changed their picture keeps the placeholder phone.
 *
 * Passwords are deliberately NOT removed. A stored hash cannot be told apart from
 * one the user genuinely chose via a reset, so deleting it could lock out someone
 * with a working password. The generated hash was never disclosed, so leaving it
 * is harmless — login keys off authProvider, not the hash.
 *
 * Agency clients are skipped: they are passwordless by design, not Google users.
 *
 * Usage:
 *   node server/scripts/migrations/backfillAuthProvider.js            # dry run
 *   node server/scripts/migrations/backfillAuthProvider.js --apply    # writes
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

const hasGooglePicture = (user) => /googleusercontent\.com/i.test(String(user.profilePic || ''));

const hasGooglePlaceholderPhone = (user) => {
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
  console.log(`db: ${dbConsts.dbName}\n`);

  const candidates = await users
    .find(
      { authProvider: { $ne: 'google' } },
      { projection: { email: 1, phone: 1, whatsapp: 1, createdAt: 1, profilePic: 1, isAgencyClient: 1, authProvider: 1, password: 1 } }
    )
    .toArray();

  const google = [];
  for (const user of candidates) {
    if (user.isAgencyClient) continue; // passwordless by design, not Google
    const byPicture = hasGooglePicture(user);
    const byPhone = hasGooglePlaceholderPhone(user);
    if (byPicture || byPhone) {
      google.push({ user, why: [byPicture && 'picture', byPhone && 'placeholder-phone'].filter(Boolean).join('+') });
    }
  }

  const mask = (email) => (email ? String(email).replace(/^(.{3}).*(@.*)$/, '$1***$2') : email);

  console.log(`scanned: ${candidates.length}`);
  console.log(`  -> would set authProvider='google': ${google.length}`);
  console.log(`  -> left as 'password':              ${candidates.length - google.length}\n`);

  console.log('--- would flag as google ---');
  google.forEach(({ user, why }) =>
    console.log(
      `  ${mask(user.email)} | ${new Date(user.createdAt).toISOString().slice(0, 10)} | ${why} | hash ${user.password ? 'kept' : 'none'}`
    )
  );

  if (!APPLY) {
    console.log('\nDry run complete. Nothing was written.');
    await mongoose.disconnect();
    return;
  }

  if (google.length) {
    const result = await users.updateMany(
      { _id: { $in: google.map((g) => g.user._id) } },
      { $set: { authProvider: 'google' } }
    );
    console.log(`\nupdated ${result.modifiedCount} user(s)`);
  } else {
    console.log('\nnothing to update');
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
