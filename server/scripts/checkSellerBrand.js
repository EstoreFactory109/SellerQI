#!/usr/bin/env node
/**
 * checkSellerBrand.js
 *
 * Read-only. Reports whether Seller.brand is actually populated, which is what
 * the sidebar/TopNav render as the account name (they fall back to the literal
 * 'Your Brand' / 'Brand Name' placeholders when it is empty).
 *
 * Brand is written only by Services/Sp_API/GetBrand.js during an integration
 * run. That write used doc.save(), which validates the whole Seller document -
 * so a single product missing a required field made it fail silently. If this
 * script reports most accounts with no brand, that is why; the brand will fill
 * in on the next integration run now that the write is a targeted $set.
 *
 * Usage:
 *   node server/scripts/checkSellerBrand.js
 *   node server/scripts/checkSellerBrand.js --missing        # only accounts with no brand
 *   node server/scripts/checkSellerBrand.js --user-id=<mongoId>
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');
const User = require('../models/user-auth/userModel.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const FILTER_USER_ID = getArg('user-id');
const MISSING_ONLY = hasFlag('missing');

function pad(value, width) {
  const s = String(value == null ? '' : value);
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[checkSellerBrand] Connected to ${dbConsts.dbName || MONGODB_URI}\n`);

  const query = FILTER_USER_ID ? { User: FILTER_USER_ID } : {};

  // Project only what we report - the full doc carries every product.
  const sellers = await Seller.find(query).select('User brand').lean();

  const emails = new Map();
  const userIds = sellers.map((s) => s.User).filter(Boolean);
  if (userIds.length) {
    const users = await User.find({ _id: { $in: userIds } }).select('email').lean();
    users.forEach((u) => emails.set(u._id.toString(), u.email));
  }

  const rows = sellers.map((s) => ({
    userId: s.User ? s.User.toString() : '(none)',
    email: (s.User && emails.get(s.User.toString())) || '—',
    brand: (s.brand || '').trim(),
  }));

  const shown = MISSING_ONLY ? rows.filter((r) => !r.brand) : rows;

  console.log(pad('USER ID', 26) + pad('EMAIL', 34) + 'BRAND');
  console.log('-'.repeat(90));
  shown.forEach((r) => {
    console.log(pad(r.userId, 26) + pad(r.email, 34) + (r.brand || '(EMPTY -> shows placeholder)'));
  });

  const withBrand = rows.filter((r) => r.brand).length;
  console.log('\n' + '='.repeat(60));
  console.log(`Seller docs:      ${rows.length}`);
  console.log(`  With brand:     ${withBrand}`);
  console.log(`  Missing brand:  ${rows.length - withBrand}`);
  console.log(`  Shown:          ${shown.length}`);
}

main()
  .catch((err) => {
    console.error('[checkSellerBrand] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });
