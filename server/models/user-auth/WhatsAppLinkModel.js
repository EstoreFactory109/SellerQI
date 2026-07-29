const mongoose = require("mongoose");

/**
 * WHATSAPP LINK MODEL
 *
 * Binds a Meta-verified WhatsApp sender number to a SellerQI user, established
 * via the Option A deep-link flow: the user mints a short-lived link token from
 * an authenticated web session, sends it through a wa.me deep link, and the
 * webhook verifies the token and creates this record. After linking, the
 * verified WhatsApp number itself is the credential for the QMate WhatsApp
 * channel — no per-message OTP.
 *
 * This is a standalone, additive collection. It does not modify the User model
 * or any existing schema.
 */
const whatsAppLinkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Normalized E.164 sender number (e.g. "919876543210"), unique so one number
    // maps to exactly one account.
    whatsappNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    verifiedAt: {
      type: Date,
      required: false,
    },
    // Current in-chat marketplace selection. Seeded from getUserLocation() at
    // link time and changed via the "switch to <marketplace>" command.
    activeCountry: {
      type: String,
      required: false,
    },
    activeRegion: {
      type: String,
      enum: ["NA", "EU", "FE"],
      required: false,
    },
    status: {
      type: String,
      enum: ["active", "unlinked"],
      default: "active",
    },
    lastMessageAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

const WhatsAppLink = mongoose.model("WhatsAppLink", whatsAppLinkSchema);
module.exports = WhatsAppLink;
