/**
 * Tests for BuyBoxCalculation service
 */

const { calculateBuyBoxMetrics } = require('../../../Services/Calculations/BuyBoxCalculation.js');

describe('BuyBoxCalculation', () => {
  describe('calculateBuyBoxMetrics', () => {
    const startDate = '2024-01-01';
    const endDate = '2024-01-31';
    const marketplace = 'ATVPDKIKX0DER';

    it('should return empty metrics for empty document', () => {
      const result = calculateBuyBoxMetrics('', startDate, endDate, marketplace);

      expect(result.dateRange.startDate).toBe(startDate);
      expect(result.dateRange.endDate).toBe(endDate);
      expect(result.totalProducts).toBe(0);
      expect(result.productsWithBuyBox).toBe(0);
      expect(result.productsWithoutBuyBox).toBe(0);
      expect(result.productsWithLowBuyBox).toBe(0);
      expect(result.asinBuyBoxData).toEqual([]);
    });

    it('should parse JSONL format correctly', () => {
      const jsonlContent = [
        JSON.stringify({
          childAsin: 'B000ABC123',
          parentAsin: 'B000PARENT1',
          traffic: { buyBoxPercentage: 95, pageViews: 100, sessions: 50, unitSessionPercentage: 10 },
          sales: { orderedProductSales: { amount: 1000, currencyCode: 'USD' }, unitsOrdered: 20, totalOrderItems: 18 },
        }),
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.totalProducts).toBe(1);
      expect(result.asinBuyBoxData).toHaveLength(1);
      expect(result.asinBuyBoxData[0].childAsin).toBe('B000ABC123');
      expect(result.asinBuyBoxData[0].parentAsin).toBe('B000PARENT1');
    });

    it('should count products with buy box correctly', () => {
      const jsonlContent = [
        JSON.stringify({ childAsin: 'ASIN1', traffic: { buyBoxPercentage: 95 } }),
        JSON.stringify({ childAsin: 'ASIN2', traffic: { buyBoxPercentage: 0 } }),
        JSON.stringify({ childAsin: 'ASIN3', traffic: { buyBoxPercentage: 75 } }),
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.totalProducts).toBe(3);
      expect(result.productsWithBuyBox).toBe(2);
      expect(result.productsWithoutBuyBox).toBe(1);
    });

    it('should count products with low buy box correctly', () => {
      const jsonlContent = [
        JSON.stringify({ childAsin: 'ASIN1', traffic: { buyBoxPercentage: 95 } }),
        JSON.stringify({ childAsin: 'ASIN2', traffic: { buyBoxPercentage: 30 } }), // Low
        JSON.stringify({ childAsin: 'ASIN3', traffic: { buyBoxPercentage: 45 } }), // Low
        JSON.stringify({ childAsin: 'ASIN4', traffic: { buyBoxPercentage: 0 } }),  // Not counted as low (it's zero)
        JSON.stringify({ childAsin: 'ASIN5', traffic: { buyBoxPercentage: 50 } }), // Not low (exactly 50)
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.productsWithLowBuyBox).toBe(2); // ASIN2 and ASIN3
    });

    it('should extract ASIN-wise data correctly', () => {
      const jsonlContent = JSON.stringify({
        childAsin: 'B000ABC123',
        parentAsin: 'B000PARENT1',
        traffic: {
          buyBoxPercentage: 85,
          pageViews: 200,
          sessions: 100,
          unitSessionPercentage: 15,
        },
        sales: {
          orderedProductSales: { amount: 5000, currencyCode: 'USD' },
          unitsOrdered: 50,
          totalOrderItems: 45,
        },
      });

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      const asinData = result.asinBuyBoxData[0];
      expect(asinData.childAsin).toBe('B000ABC123');
      expect(asinData.parentAsin).toBe('B000PARENT1');
      expect(asinData.buyBoxPercentage).toBe(85);
      expect(asinData.pageViews).toBe(200);
      expect(asinData.sessions).toBe(100);
      expect(asinData.unitSessionPercentage).toBe(15);
      expect(asinData.sales.amount).toBe(5000);
      expect(asinData.sales.currencyCode).toBe('USD');
      expect(asinData.unitsOrdered).toBe(50);
      expect(asinData.totalOrderItems).toBe(45);
    });

    it('should aggregate duplicate ASIN entries', () => {
      const jsonlContent = [
        JSON.stringify({
          childAsin: 'B000ABC123',
          traffic: { buyBoxPercentage: 80, pageViews: 100, sessions: 50 },
          sales: { orderedProductSales: { amount: 1000 }, unitsOrdered: 10, totalOrderItems: 8 },
        }),
        JSON.stringify({
          childAsin: 'B000ABC123',
          traffic: { buyBoxPercentage: 90, pageViews: 150, sessions: 75 },
          sales: { orderedProductSales: { amount: 2000 }, unitsOrdered: 20, totalOrderItems: 18 },
        }),
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.asinBuyBoxData).toHaveLength(1);
      const asinData = result.asinBuyBoxData[0];
      expect(asinData.buyBoxPercentage).toBe(90); // Takes higher percentage
      expect(asinData.pageViews).toBe(250);       // Aggregated
      expect(asinData.sessions).toBe(125);        // Aggregated
      expect(asinData.sales.amount).toBe(3000);   // Aggregated
      expect(asinData.unitsOrdered).toBe(30);     // Aggregated
    });

    it('should handle missing traffic data', () => {
      const jsonlContent = JSON.stringify({
        childAsin: 'B000ABC123',
        sales: { orderedProductSales: { amount: 1000 }, unitsOrdered: 10 },
      });

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      const asinData = result.asinBuyBoxData[0];
      expect(asinData.buyBoxPercentage).toBe(0);
      expect(asinData.pageViews).toBe(0);
      expect(asinData.sessions).toBe(0);
    });

    it('should handle missing sales data', () => {
      const jsonlContent = JSON.stringify({
        childAsin: 'B000ABC123',
        traffic: { buyBoxPercentage: 85, pageViews: 100 },
      });

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      const asinData = result.asinBuyBoxData[0];
      expect(asinData.sales.amount).toBe(0);
      expect(asinData.unitsOrdered).toBe(0);
    });

    it('should use parentAsin as childAsin fallback', () => {
      const jsonlContent = JSON.stringify({
        parentAsin: 'B000PARENT1',
        traffic: { buyBoxPercentage: 80 },
      });

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.asinBuyBoxData[0].childAsin).toBe('B000PARENT1');
    });

    it('should skip items with unknown ASIN', () => {
      const jsonlContent = [
        JSON.stringify({ traffic: { buyBoxPercentage: 80 } }),
        JSON.stringify({ childAsin: 'B000ABC123', traffic: { buyBoxPercentage: 90 } }),
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      // Should only process the valid ASIN
      expect(result.asinBuyBoxData.some(a => a.childAsin === 'B000ABC123')).toBe(true);
    });

    it('should handle invalid JSON lines gracefully', () => {
      const jsonlContent = [
        'invalid json line',
        JSON.stringify({ childAsin: 'B000ABC123', traffic: { buyBoxPercentage: 80 } }),
        '{ broken json',
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      expect(result.asinBuyBoxData).toHaveLength(1);
      expect(result.asinBuyBoxData[0].childAsin).toBe('B000ABC123');
    });

    it('should recalculate unitSessionPercentage on aggregation', () => {
      const jsonlContent = [
        JSON.stringify({
          childAsin: 'B000ABC123',
          traffic: { sessions: 100, unitSessionPercentage: 10 },
          sales: { unitsOrdered: 10 },
        }),
        JSON.stringify({
          childAsin: 'B000ABC123',
          traffic: { sessions: 100, unitSessionPercentage: 20 },
          sales: { unitsOrdered: 20 },
        }),
      ].join('\n');

      const result = calculateBuyBoxMetrics(jsonlContent, startDate, endDate, marketplace);

      // Total units = 30, total sessions = 200
      // unitSessionPercentage = (30/200) * 100 = 15
      expect(result.asinBuyBoxData[0].unitSessionPercentage).toBe(15);
    });
  });
});
