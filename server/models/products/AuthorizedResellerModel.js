const mongoose = require("mongoose");

/**
 * Sellers a brand owner has said are allowed on their listings (tasks-logics.xlsx:
 * "Exclude seller IDs the client has whitelisted"). A seller here never raises a
 * new_seller_on_brand task for that marketplace. Added from the task itself
 * ("This is my authorised reseller").
 */
const authorizedResellerSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        sellerId: { type: String, required: true }
    },
    { timestamps: true }
);

authorizedResellerSchema.index({ User: 1, country: 1, region: 1, sellerId: 1 }, { unique: true });

module.exports = mongoose.model("AuthorizedReseller", authorizedResellerSchema);
