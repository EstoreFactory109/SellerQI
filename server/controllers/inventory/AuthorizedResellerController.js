const mongoose = require('mongoose');
const AuthorizedReseller = require('../../models/products/AuthorizedResellerModel.js');
const logger = require('../../utils/Logger.js');

/**
 * The brand owner's authorised resellers, for the marketplace in the location
 * cookie. A seller ID here never raises a new_seller_on_brand task.
 */

// Amazon merchant tokens are short uppercase alphanumerics (e.g. A2EUQ1WTGCTBG2).
const SELLER_ID = /^[A-Z0-9]{8,20}$/;
const MAX_IDS = 100;
const scope = (req) => ({ User: new mongoose.Types.ObjectId(String(req.userId)), country: req.country, region: req.region });

/** GET /api/authorized-resellers */
const list = async (req, res) => {
    try {
        const rows = await AuthorizedReseller.find(scope(req)).select('sellerId createdAt').sort({ createdAt: -1 }).lean();
        return res.status(200).json({ success: true, data: rows.map(r => ({ sellerId: r.sellerId, addedAt: r.createdAt })) });
    } catch (error) {
        logger.error('Error listing authorised resellers', { userId: req.userId, error: error.message });
        return res.status(500).json({ success: false, message: 'Failed to load authorised resellers' });
    }
};

/** POST /api/authorized-resellers  Body: { sellerIds: [...] } */
const add = async (req, res) => {
    try {
        const ids = [...new Set((Array.isArray(req.body?.sellerIds) ? req.body.sellerIds : [])
            .map(id => String(id || '').trim().toUpperCase()))];
        if (ids.length === 0 || ids.length > MAX_IDS || ids.some(id => !SELLER_ID.test(id))) {
            return res.status(400).json({ success: false, message: `sellerIds must be 1-${MAX_IDS} Amazon seller IDs` });
        }
        const base = scope(req);
        await AuthorizedReseller.bulkWrite(ids.map(sellerId => ({
            updateOne: { filter: { ...base, sellerId }, update: { $setOnInsert: { ...base, sellerId } }, upsert: true }
        })), { ordered: false });
        logger.info('Authorised resellers added', { userId: req.userId, country: req.country, region: req.region, count: ids.length });
        return res.status(200).json({ success: true, data: { added: ids } });
    } catch (error) {
        logger.error('Error adding authorised resellers', { userId: req.userId, error: error.message });
        return res.status(500).json({ success: false, message: 'Failed to save authorised resellers' });
    }
};

/** DELETE /api/authorized-resellers/:sellerId */
const remove = async (req, res) => {
    try {
        const sellerId = String(req.params.sellerId || '').trim().toUpperCase();
        if (!SELLER_ID.test(sellerId)) return res.status(400).json({ success: false, message: 'Invalid seller ID' });
        const result = await AuthorizedReseller.deleteOne({ ...scope(req), sellerId });
        return res.status(200).json({ success: true, data: { removed: result.deletedCount || 0 } });
    } catch (error) {
        logger.error('Error removing authorised reseller', { userId: req.userId, error: error.message });
        return res.status(500).json({ success: false, message: 'Failed to remove authorised reseller' });
    }
};

module.exports = { list, add, remove, SELLER_ID };
