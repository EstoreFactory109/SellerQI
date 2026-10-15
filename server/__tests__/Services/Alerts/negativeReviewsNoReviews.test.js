/**
 * The negative-review alert fired for products with no reviews: ingest stored their
 * missing rating as "0", which parsed as a rating below the threshold.
 */
jest.mock('../../../models/alerts/Alert.js', () => ({
  ProductContentChangeAlert: { findOne: jest.fn() },
  NegetiveReviewsAlert: { findOne: jest.fn(), create: jest.fn() },
  APlusMissingAlert: { findOne: jest.fn() },
}));

const { NegetiveReviewsAlert } = require('../../../models/alerts/Alert.js');
const { runNegativeReviewsCheck } = require('../../../Services/Alerts/Other-Alerts/ProductContentChangeAlertService.js');

describe('runNegativeReviewsCheck', () => {
  it('creates nothing for products with no reviews, and never queries alerts', async () => {
    const doc = {
      Products: [
        { asin: 'B1', product_star_ratings: '0', product_num_ratings: '0' },
        { asin: 'B2', product_star_ratings: null, product_num_ratings: '0' },
        { asin: 'B3', product_star_ratings: '3.2', product_num_ratings: '0' },
      ],
    };
    const result = await runNegativeReviewsCheck(doc, 'u1', 'NA', 'US');
    expect(result).toEqual({ created: false, productsWithChanges: 0 });
    expect(NegetiveReviewsAlert.findOne).not.toHaveBeenCalled();
  });
});
