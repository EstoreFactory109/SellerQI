const mongoose = require('mongoose');

/**
 * One day of currency exchange rates, written by FxService.fetchAndStoreDailyRates.
 *
 * Every rate is "units of that currency per 1 EUR" (the ECB's own base), so any pair is
 * rates[to] / rates[from]. `sources` records where each rate came from (ecb, a USD peg, or
 * the fallback provider) so a surprising figure can be traced. A currency no source supplied
 * is simply absent — FxService treats a missing rate as "cannot convert", never as 1.
 *
 * Small and global (one document per day, not per user), so it carries no TTL: keeping the
 * history costs a few KB a year and lets a past figure be reproduced.
 */
const fxRateSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD the rates are published for
    base: { type: String, default: 'EUR' },
    rates: { type: Map, of: Number, default: {} },
    sources: { type: Map, of: String, default: {} },
    fetchedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.models.FxRate || mongoose.model('FxRate', fxRateSchema);
