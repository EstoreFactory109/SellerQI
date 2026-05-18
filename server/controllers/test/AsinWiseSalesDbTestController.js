const AsinWiseSalesReadService = require('../../Services/Finance/AsinWiseSalesReadService.js');
const logger = require('../../utils/Logger.js');

/**
 * Read persisted ASIN-wise sales from MongoDB (AsinWiseSalesRun / Item / DateItem).
 *
 * Body:
 * - userId, country, region (required)
 * - Either:
 *   - period: 7 | 14 | 30  → uses latest run’s period totals per ASIN
 *   - from, to: YYYY-MM-DD → aggregates AsinWiseSalesDateItem across recent runs in range
 *
 * If both period and from/to are sent, from/to wins.
 */
async function testAsinWiseSalesFromDb(req, res) {
  try {
    const { userId, country, region, period, from, to } = req.body || {};

    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        message: 'userId, country, and region are required',
      });
    }

    const countryUpper = String(country).trim().toUpperCase();
    const regionUpper = String(region).trim().toUpperCase();
    if (!['NA', 'EU', 'FE'].includes(regionUpper)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid region. Expected one of: NA, EU, FE',
      });
    }

    if ((from && !to) || (!from && to)) {
      return res.status(400).json({
        success: false,
        message: 'If using a date range, pass both from and to (YYYY-MM-DD).',
      });
    }

    if (from && to) {
      const err = AsinWiseSalesReadService.validateDateRange(from, to);
      if (err) {
        return res.status(400).json({ success: false, message: err });
      }

      logger.info('[testAsinWiseSalesFromDb] Date range read', { userId, country: countryUpper, region: regionUpper, from, to });
      const data = await AsinWiseSalesReadService.getAsinWiseSalesByDateRange({
        userId,
        country: countryUpper,
        region: regionUpper,
        from: String(from).trim(),
        to: String(to).trim(),
      });

      return res.status(200).json({
        success: true,
        message: 'ASIN-wise sales loaded from database (date range)',
        mode: 'date-range',
        data,
      });
    }

    const periodDays = period != null ? Number(period) : 30;
    if (![7, 14, 30].includes(periodDays)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Expected one of: 7, 14, 30 (or pass from + to as YYYY-MM-DD).',
      });
    }

    logger.info('[testAsinWiseSalesFromDb] Period read', { userId, country: countryUpper, region: regionUpper, period: periodDays });
    const data = await AsinWiseSalesReadService.getAsinWiseSalesByPeriod({
      userId,
      country: countryUpper,
      region: regionUpper,
      periodDays,
    });

    return res.status(200).json({
      success: true,
      message: 'ASIN-wise sales loaded from database (period totals from latest run)',
      mode: 'period',
      data,
    });
  } catch (error) {
    logger.error('[testAsinWiseSalesFromDb] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      data: null,
    });
  }
}

module.exports = { testAsinWiseSalesFromDb };
