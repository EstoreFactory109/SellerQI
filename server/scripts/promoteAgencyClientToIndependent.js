/**
 * Promote an agency client user to an independent account (direct login).
 *
 * - Clears agencyId, isAgencyClient, adminId (matches how agency clients are stored)
 * - Sets a new bcrypt password
 * - Clears appRefreshToken so existing sessions must log in again
 *
 * Usage (from repo root):
 *   node server/scripts/promoteAgencyClientToIndependent.js <email>
 *   → prompts for new password (hidden when run in a TTY)
 *
 * Non-interactive (password visible in shell history / process list — avoid if possible):
 *   node server/scripts/promoteAgencyClientToIndependent.js <email> "<newPassword>"
 *
 * Requires DB_URI and DB_NAME in .env (same as the app).
 */

require('dotenv').config();

const mongoose = require('mongoose');
const readline = require('readline');
const dbConsts = require('../config/config.js');
const User = require('../models/user-auth/userModel.js');
const { hashPassword } = require('../utils/HashPassword.js');

const MIN_PASSWORD_LEN = 8;

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Password prompt needs a TTY. Pass the password as the second argument (see script header).'
        )
      );
      return;
    }
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let pw = '';
    const onData = (key) => {
      if (key === '\u0003') {
        stdin.setRawMode(false);
        process.exit(130);
      }
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(pw);
        return;
      }
      if (key === '\u007f' || key === '\b') {
        pw = pw.slice(0, -1);
        return;
      }
      pw += key;
    };
    stdin.on('data', onData);
  });
}

function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getNewPassword() {
  const fromArg = process.argv[3];
  if (fromArg != null && String(fromArg).length > 0) {
    return String(fromArg);
  }
  try {
    return await promptHidden(`New password (min ${MIN_PASSWORD_LEN} chars): `);
  } catch {
    return await promptLine(`New password (min ${MIN_PASSWORD_LEN} chars, visible): `);
  }
}

async function main() {
  const emailRaw = process.argv[2];
  if (!emailRaw) {
    console.error('Usage: node server/scripts/promoteAgencyClientToIndependent.js <email> [newPassword]');
    process.exit(1);
  }
  const email = String(emailRaw).trim().toLowerCase();

  if (!process.env.DB_URI || !process.env.DB_NAME) {
    console.error('Missing DB_URI or DB_NAME in environment (.env).');
    process.exit(1);
  }

  const newPassword = await getNewPassword();
  if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
    console.error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
    process.exit(1);
  }

  const uri = `${dbConsts.dbUri}/${dbConsts.dbName}`;
  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('Connected.');

  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    console.error(`No user found with email: ${email}`);
    await mongoose.connection.close();
    process.exit(1);
  }

  const wasAgencyClient = user.isAgencyClient === true || user.agencyId != null;
  if (!wasAgencyClient) {
    console.warn(
      'User is not marked as an agency client (isAgencyClient false and no agencyId). Updating password and clearing agency fields anyway.'
    );
  }

  const hashed = await hashPassword(newPassword);

  const updated = await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        isAgencyClient: false,
        agencyId: null,
        adminId: null,
        password: hashed,
        appRefreshToken: '',
      },
    },
    { new: true }
  );

  console.log('Done.');
  console.log(`  _id:   ${updated._id}`);
  console.log(`  email: ${updated.email}`);
  console.log('  Agency flags cleared; password updated. User can log in directly.');
  console.log(
    '  Note: Seller connections stored under AgencySeller may still point at this clientId — review in DB if needed.'
  );

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
