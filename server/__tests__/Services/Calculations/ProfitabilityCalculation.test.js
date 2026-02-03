/**
 * Tests for ProfitabilityCalculation service
 */

const Profitability = require('../../../Services/Calculations/ProfitabilityCalculation.js');

describe('Profitability Calculation', () => {
  describe('basic functionality', () => {
    it('should return empty array when all inputs are empty', () => {
      const result = Profitability([], [], [], [], {});
      expect(result).toEqual([]);
    });

    it('should process economicsAsinData as primary source', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          unitsSold: 50,
          totalFees: 200,
          fbaFees: 150,
          storageFees: 50,
          amazonFees: 200,
        },
      };

      const result = Profitability([], [], [], [], economicsAsinData);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
      expect(result[0].sales).toBe(1000);
      expect(result[0].quantity).toBe(50);
      expect(result[0].totalFees).toBe(200);
      expect(result[0].source).toBe('economicsMetrics');
    });

    it('should calculate gross profit correctly', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          unitsSold: 50,
          totalFees: 200,
        },
      };
      const productWiseSponsoredAds = [
        { asin: 'B000ABC123', spend: 100 },
      ];

      const result = Profitability([], productWiseSponsoredAds, [], [], economicsAsinData);

      // grossProfit = sales - adsSpend - totalFees = 1000 - 100 - 200 = 700
      expect(result[0].grossProfit).toBe(700);
    });

    it('should calculate profit margin correctly', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          unitsSold: 50,
          totalFees: 200,
        },
      };
      const productWiseSponsoredAds = [
        { asin: 'B000ABC123', spend: 100 },
      ];

      const result = Profitability([], productWiseSponsoredAds, [], [], economicsAsinData);

      // profitMargin = (grossProfit / sales) * 100 = (700 / 1000) * 100 = 70%
      expect(result[0].profitMargin).toBe(70);
    });
  });

  describe('ads spend aggregation', () => {
    it('should aggregate ads spend from Amazon Ads API', () => {
      const productWiseSponsoredAds = [
        { asin: 'B000ABC123', spend: 50 },
        { asin: 'B000ABC123', spend: 75 },
        { ASIN: 'B000ABC123', spend: 25 }, // Test ASIN capitalization
      ];
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          totalFees: 100,
        },
      };

      const result = Profitability([], productWiseSponsoredAds, [], [], economicsAsinData);

      expect(result[0].ads).toBe(150); // 50 + 75 + 25
      expect(result[0].adsSource).toBe('amazonAdsAPI');
    });

    it('should handle ads data with missing spend values', () => {
      const productWiseSponsoredAds = [
        { asin: 'B000ABC123', spend: null },
        { asin: 'B000ABC123', spend: 50 },
      ];
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          totalFees: 100,
        },
      };

      const result = Profitability([], productWiseSponsoredAds, [], [], economicsAsinData);

      expect(result[0].ads).toBe(50);
    });

    it('should add ASINs from Ads API that are not in other sources', () => {
      const productWiseSponsoredAds = [
        { asin: 'B000NEW999', spend: 200 },
      ];

      const result = Profitability([], productWiseSponsoredAds, [], [], {});

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000NEW999');
      expect(result[0].ads).toBe(200);
      expect(result[0].source).toBe('adsOnly');
    });
  });

  describe('legacy data processing', () => {
    it('should use totalSales as fallback when no economicsMetrics', () => {
      const totalSales = [
        { asin: 'B000ABC123', quantity: 10, amount: 500 },
      ];

      const result = Profitability(totalSales, [], [], [], {});

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
      expect(result[0].quantity).toBe(10);
      expect(result[0].sales).toBe(500);
      expect(result[0].source).toBe('legacy');
    });

    it('should not override economicsMetrics data with totalSales', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: 1000,
          unitsSold: 50,
          totalFees: 200,
        },
      };
      const totalSales = [
        { asin: 'B000ABC123', quantity: 10, amount: 500 },
      ];

      const result = Profitability(totalSales, [], [], [], economicsAsinData);

      expect(result[0].sales).toBe(1000);
      expect(result[0].quantity).toBe(50);
    });

    it('should process productWiseFBAData for legacy format', () => {
      const productWiseFBAData = [
        { asin: 'B000ABC123', totalFba: '50.00', totalAmzFee: '25.00' },
      ];

      const result = Profitability([], [], productWiseFBAData, [], {});

      expect(result).toHaveLength(1);
      expect(result[0].amzFee).toBe(75);
    });

    it('should process FBAFeesData for legacy format', () => {
      const FBAFeesData = [
        { asin: 'B000ABC123', fees: 30 },
      ];

      const result = Profitability([], [], [], FBAFeesData, {});

      expect(result).toHaveLength(1);
      expect(result[0].amzFee).toBe(30);
    });

    it('should handle FBAFeesData with object fees format', () => {
      const FBAFeesData = [
        { asin: 'B000ABC123', fees: { amount: 45 } },
      ];

      const result = Profitability([], [], [], FBAFeesData, {});

      expect(result[0].amzFee).toBe(45);
    });

    it('should handle FBAFeesData with string fees format', () => {
      const FBAFeesData = [
        { asin: 'B000ABC123', fees: '35.50' },
      ];

      const result = Profitability([], [], [], FBAFeesData, {});

      expect(result[0].amzFee).toBe(35.5);
    });
  });

  describe('multiple ASINs', () => {
    it('should process multiple ASINs correctly', () => {
      const economicsAsinData = {
        'B000ABC123': { sales: 1000, unitsSold: 50, totalFees: 200 },
        'B000DEF456': { sales: 2000, unitsSold: 100, totalFees: 400 },
        'B000GHI789': { sales: 500, unitsSold: 25, totalFees: 100 },
      };

      const result = Profitability([], [], [], [], economicsAsinData);

      expect(result).toHaveLength(3);
      
      const asinMap = new Map(result.map(item => [item.asin, item]));
      expect(asinMap.get('B000ABC123').sales).toBe(1000);
      expect(asinMap.get('B000DEF456').sales).toBe(2000);
      expect(asinMap.get('B000GHI789').sales).toBe(500);
    });

    it('should combine data from multiple sources for same ASIN', () => {
      const economicsAsinData = {
        'B000ABC123': { sales: 1000, unitsSold: 50, totalFees: 200 },
      };
      const productWiseSponsoredAds = [
        { asin: 'B000ABC123', spend: 100 },
      ];

      const result = Profitability([], productWiseSponsoredAds, [], [], economicsAsinData);

      expect(result).toHaveLength(1);
      expect(result[0].sales).toBe(1000);
      expect(result[0].ads).toBe(100);
      expect(result[0].totalFees).toBe(200);
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined values in data', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: null,
          unitsSold: undefined,
          totalFees: NaN,
        },
      };

      const result = Profitability([], [], [], [], economicsAsinData);

      expect(result[0].sales).toBe(0);
      expect(result[0].quantity).toBe(0);
      expect(result[0].totalFees).toBe(0);
    });

    it('should handle zero sales for profit margin calculation', () => {
      const economicsAsinData = {
        'B000ABC123': {
          sales: 0,
          unitsSold: 0,
          totalFees: 100,
        },
      };

      const result = Profitability([], [], [], [], economicsAsinData);

      expect(result[0].profitMargin).toBe(0);
    });

    it('should skip invalid FBAFeesData entries', () => {
      const FBAFeesData = [
        null,
        undefined,
        { asin: null, fees: 50 },
        { fees: 50 },
        { asin: 'B000ABC123', fees: 30 },
      ];

      const result = Profitability([], [], [], FBAFeesData, {});

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
    });

    it('should handle non-array inputs gracefully', () => {
      const economicsAsinData = {
        'B000ABC123': { sales: 1000, totalFees: 200 },
      };

      const result = Profitability(null, null, null, null, economicsAsinData);

      expect(result).toHaveLength(1);
      expect(result[0].sales).toBe(1000);
    });
  });
});
