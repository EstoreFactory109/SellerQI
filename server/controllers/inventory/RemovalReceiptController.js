const { getPendingReceipts, saveReceipts } = require('../../Services/inventory/RemovalReceiptService.js');
const logger = require('../../utils/Logger.js');

const MAX_ENTRIES = 500;

/**
 * GET /api/removal-receipts/pending
 * Removal order lines Amazon shipped back that the seller has not confirmed yet,
 * for the marketplace in the location cookie.
 */
const getPending = async (req, res) => {
    try {
        const lines = await getPendingReceipts(req.userId, req.country, req.region);
        return res.status(200).json({ success: true, data: lines });
    } catch (error) {
        logger.error('Error in RemovalReceipt getPending', { userId: req.userId, error: error.message });
        return res.status(500).json({ success: false, message: 'Failed to load removal orders' });
    }
};

/**
 * POST /api/removal-receipts/confirm
 * Body: { entries: [{ orderId, sku, receivedQuantity }] }
 */
const confirm = async (req, res) => {
    try {
        const entries = req.body?.entries;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ success: false, message: 'entries must be a non-empty array' });
        }
        if (entries.length > MAX_ENTRIES) {
            return res.status(400).json({ success: false, message: `At most ${MAX_ENTRIES} entries at once` });
        }
        const result = await saveReceipts(req.userId, req.country, req.region, entries);
        logger.info('Removal receipts confirmed', {
            userId: req.userId, country: req.country, region: req.region, saved: result.saved, rejected: result.rejected.length
        });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        logger.error('Error in RemovalReceipt confirm', { userId: req.userId, error: error.message });
        return res.status(500).json({ success: false, message: 'Failed to save what arrived' });
    }
};

module.exports = { getPending, confirm };
