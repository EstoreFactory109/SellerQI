/**
 * Tests for Conversion calculation service
 */

const {
  checkNumberOfImages,
  checkIfVideoExists,
  checkStarRating,
  checkAPlus,
  checkProductWithOutBuyBox,
  checkBrandStory,
  marketplaceShowsBrandStory,
  aplusStateOf,
} = require('../../../Services/Calculations/Conversion.js');

describe('Conversion Calculations', () => {
  describe('checkNumberOfImages', () => {
    // One threshold everywhere; tasks-logics.xlsx: fewer than 7 images.
    it('should return error when less than 7 images', () => {
      const images = ['img1.jpg', 'img2.jpg', 'img3.jpg'];
      const result = checkNumberOfImages(images);

      expect(result.status).toBe('Error');
      expect(result.Message).toContain('fewer than 7 images');
      expect(result.MainImage).toBe('img1.jpg');
    });

    it('should return success when 7 or more images', () => {
      const images = ['img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg', 'img5.jpg', 'img6.jpg', 'img7.jpg'];
      const result = checkNumberOfImages(images);

      expect(result.status).toBe('Success');
      expect(result.Message).toContain('recommended number of images');
      expect(result.MainImage).toBe('img1.jpg');
    });

    it('should return success when more than 7 images', () => {
      const images = Array(10).fill('img.jpg');
      const result = checkNumberOfImages(images);

      expect(result.status).toBe('Success');
    });

    it('should return error for empty array', () => {
      const result = checkNumberOfImages([]);

      expect(result.status).toBe('Error');
      expect(result.MainImage).toBeUndefined();
    });

    it('treats exactly 6 images as an error and exactly 7 as enough', () => {
      expect(checkNumberOfImages(Array(6).fill('img.jpg')).status).toBe('Error');
      expect(checkNumberOfImages(Array(7).fill('img.jpg')).status).toBe('Success');
    });

    it('treats a missing image array as no data, not as zero images', () => {
      expect(checkNumberOfImages(undefined).status).toBe('NoData');
      expect(checkNumberOfImages(null).status).toBe('NoData');
    });
  });

  describe('checkIfVideoExists', () => {
    it('should return error when no video', () => {
      const result = checkIfVideoExists([]);

      expect(result.status).toBe('Error');
      expect(result.Message).toContain('does not include a video');
      expect(result.HowToSolve).toContain('Add a high-quality video');
    });

    it('should return success when video exists', () => {
      const result = checkIfVideoExists(['video.mp4']);

      expect(result.status).toBe('Success');
      expect(result.Message).toContain('Including a video');
      expect(result.HowToSolve).toBe('');
    });

    it('should return success when multiple videos exist', () => {
      const result = checkIfVideoExists(['video1.mp4', 'video2.mp4']);

      expect(result.status).toBe('Success');
    });

    // A video entry with no URL used to be stored as [undefined] and count as a video.
    it('does not count entries without a URL as videos', () => {
      expect(checkIfVideoExists([undefined, null]).status).toBe('Error');
    });

    it('treats a missing video array as no data', () => {
      expect(checkIfVideoExists(undefined).status).toBe('NoData');
    });
  });

  describe('checkStarRating', () => {
    it('should return error when rating below 4.3', () => {
      const result = checkStarRating(4.2);

      expect(result.status).toBe('Error');
      expect(result.Message).toContain('rated 4.2 stars, below 4.3');
      expect(result.HowToSolve).toContain('Investigate the causes');
    });

    // tasks-logics.xlsx: under 4.0 is the serious tier; judged on 20+ ratings only.
    it('names the serious tier under 4.0', () => {
      const result = checkStarRating(3.8, 120);
      expect(result.status).toBe('Error');
      expect(result.Message).toContain('below 4.0');
      expect(result.Message).toContain('4 stars & up');
    });

    it('does not judge a rating on fewer than 20 ratings', () => {
      expect(checkStarRating(3.1, 12).status).toBe('NoData');
      expect(checkStarRating(3.1, 20).status).toBe('Error');
    });

    it('should return success when rating 4.3 or above', () => {
      const result = checkStarRating(4.3);

      expect(result.status).toBe('Success');
      expect(result.Message).toContain('4.3 stars or higher');
      expect(result.HowToSolve).toBe('');
    });

    it('should return success when rating above 4.3', () => {
      const result = checkStarRating(4.8);

      expect(result.status).toBe('Success');
    });

    it('should handle string rating', () => {
      const result = checkStarRating('4.5');

      expect(result.status).toBe('Success');
    });

    it('should handle edge case of exactly 4.3', () => {
      const result = checkStarRating(4.3);

      expect(result.status).toBe('Success');
    });

    it('should return error for very low ratings', () => {
      const result = checkStarRating(1.0);

      expect(result.status).toBe('Error');
    });
  });

  // A product with no reviews has no rating. Ingest stored that as "0", and 33,549
  // of 44,415 open low-rating tasks in production were for such products.
  describe('checkStarRating with no reviews', () => {
    it.each([['0', '0'], ['0', undefined], [null, '0'], [undefined, undefined], ['', '12'], [0, 5]])(
      'rating %p with %p ratings is no data, not a low rating', (rating, count) => {
        expect(checkStarRating(rating, count).status).toBe('NoData');
      });

    it('a real rating with no rating count is still judged', () => {
      expect(checkStarRating('4.1', undefined).status).toBe('Error');
    });

    it('zero reviews means no data even if a stray rating is present', () => {
      expect(checkStarRating('3.9', '0').status).toBe('NoData');
    });

    it('a real low rating with reviews is still an error', () => {
      expect(checkStarRating('4.2', '37').status).toBe('Error');
      expect(checkStarRating('4.6', '37').status).toBe('Success');
    });
  });

  // Stored A+ statuses are strings from several ingest generations. The check used to
  // compare against boolean false, so it never fired in production.
  describe('checkAPlus with the values production actually stores', () => {
    it.each(['NOT_AVAILABLE', 'false', 'DRAFT', ' not_available '])('%p is missing A+', (status) => {
      const [r] = checkAPlus([{ Asins: 'B1', status }]);
      expect(r.data.status).toBe('Error');
    });

    it.each(['APPROVED', 'PUBLISHED', 'true'])('%p has A+', (status) => {
      const [r] = checkAPlus([{ Asins: 'B1', status }]);
      expect(r.data.status).toBe('Success');
    });

    it('an unknown status (null, or anything else) gives no verdict and no entry', () => {
      expect(checkAPlus([{ Asins: 'B1', status: null }, { Asins: 'B2', status: 'SUBMITTED' }])).toEqual([]);
    });

    it('tolerates a non-array input', () => {
      expect(checkAPlus(undefined)).toEqual([]);
    });
  });

  describe('aplusStateOf', () => {
    it('maps every production value', () => {
      expect(['APPROVED', 'PUBLISHED', 'true', true].map(aplusStateOf)).toEqual(['present', 'present', 'present', 'present']);
      expect(['NOT_AVAILABLE', 'false', false, 'DRAFT'].map(aplusStateOf)).toEqual(['missing', 'missing', 'missing', 'missing']);
      expect([null, undefined, 'SUBMITTED', 7].map(aplusStateOf)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    });
  });

  describe('checkAPlus', () => {
    it('should return error for products without A+ content', () => {
      const asinList = [{ Asins: 'B000ABC123', status: false }];
      const result = checkAPlus(asinList);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
      expect(result[0].data.status).toBe('Error');
      expect(result[0].data.Message).toContain('lacks A+ Content');
    });

    it('should return success for products with A+ content', () => {
      const asinList = [{ Asins: 'B000ABC123', status: true }];
      const result = checkAPlus(asinList);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
      expect(result[0].data.status).toBe('Success');
      expect(result[0].data.Message).toContain('includes A+ Content');
    });

    it('should handle multiple products with mixed A+ status', () => {
      const asinList = [
        { Asins: 'B000ABC123', status: true },
        { Asins: 'B000DEF456', status: false },
        { Asins: 'B000GHI789', status: true },
      ];
      const result = checkAPlus(asinList);

      expect(result).toHaveLength(3);
      expect(result[0].data.status).toBe('Success');
      expect(result[1].data.status).toBe('Error');
      expect(result[2].data.status).toBe('Success');
    });

    it('should return empty array for empty input', () => {
      const result = checkAPlus([]);

      expect(result).toEqual([]);
    });
  });

  describe('checkProductWithOutBuyBox', () => {
    it('should return success for products with buy box', () => {
      const asinList = [{ asin: 'B000ABC123', belongsToRequester: true }];
      const result = checkProductWithOutBuyBox(asinList);

      expect(result.buyboxResult).toHaveLength(1);
      expect(result.buyboxResult[0].status).toBe('Success');
      expect(result.buyboxResult[0].Message).toContain('hold the Buy Box');
      expect(result.presentAsin).toContain('B000ABC123');
    });

    it('should return error for products without buy box', () => {
      const asinList = [{ asin: 'B000ABC123', belongsToRequester: false }];
      const result = checkProductWithOutBuyBox(asinList);

      expect(result.buyboxResult).toHaveLength(1);
      expect(result.buyboxResult[0].status).toBe('Error');
      expect(result.buyboxResult[0].Message).toContain('Buy Box is not available');
    });

    it('should handle multiple products with mixed buy box status', () => {
      const asinList = [
        { asin: 'B000ABC123', belongsToRequester: true },
        { asin: 'B000DEF456', belongsToRequester: false },
        { asin: 'B000GHI789', belongsToRequester: true },
      ];
      const result = checkProductWithOutBuyBox(asinList);

      expect(result.buyboxResult).toHaveLength(3);
      expect(result.buyboxResult[0].status).toBe('Success');
      expect(result.buyboxResult[1].status).toBe('Error');
      expect(result.buyboxResult[2].status).toBe('Success');
      expect(result.presentAsin).toHaveLength(3);
    });

    it('should return all ASINs in presentAsin array', () => {
      const asinList = [
        { asin: 'B000ABC123', belongsToRequester: true },
        { asin: 'B000DEF456', belongsToRequester: false },
      ];
      const result = checkProductWithOutBuyBox(asinList);

      expect(result.presentAsin).toEqual(['B000ABC123', 'B000DEF456']);
    });
  });

  describe('checkBrandStory', () => {
    // A sibling that shows a Brand Story opens the gate: the seller can add one
    // and the scrape can see one, so "missing" on the others is a real finding.
    const withShowcase = (...products) => [{ asin: 'B0SHOWCASE', has_brandstory: true }, ...products];

    it('should return error for products without brand story', () => {
      const productsList = withShowcase({ asin: 'B000ABC123', has_brandstory: false });
      const result = checkBrandStory(productsList);

      expect(result).toHaveLength(2);
      expect(result[1].asin).toBe('B000ABC123');
      expect(result[1].data.status).toBe('Error');
      expect(result[1].data.Message).toContain('lacks a brand story');
    });

    it('should return error when has_brandstory is undefined', () => {
      const productsList = withShowcase({ asin: 'B000ABC123' });
      const result = checkBrandStory(productsList);

      expect(result[1].data.status).toBe('Error');
    });

    // Gate closed: 36 of 76 production marketplaces had no product showing a Brand
    // Story (11,543 open tasks) - no Brand Registry or a scrape blind spot. These
    // tests used to expect an Error per product; no verdict is made now.
    it('makes no verdict when no product in the marketplace shows a Brand Story', () => {
      expect(checkBrandStory([
        { asin: 'B000ABC123', has_brandstory: false },
        { asin: 'B000DEF456' },
      ])).toEqual([]);
    });

    it('is gated on a strict true, not a truthy value', () => {
      expect(checkBrandStory([{ asin: 'A', has_brandstory: 'true' }, { asin: 'B', has_brandstory: false }])).toEqual([]);
      expect(checkBrandStory([])).toEqual([]);
      expect(checkBrandStory(undefined)).toEqual([]);
    });

    it('marketplaceShowsBrandStory reports whether the gate is open', () => {
      expect(marketplaceShowsBrandStory([{ has_brandstory: false }, { has_brandstory: true }])).toBe(true);
      expect(marketplaceShowsBrandStory([{ has_brandstory: false }])).toBe(false);
      expect(marketplaceShowsBrandStory(null)).toBe(false);
    });

    it('should return success for products with brand story', () => {
      const productsList = [{ asin: 'B000ABC123', has_brandstory: true }];
      const result = checkBrandStory(productsList);

      expect(result[0].data.status).toBe('Success');
      expect(result[0].data.Message).toContain('includes a Brand Story');
    });

    it('should handle multiple products with mixed brand story status', () => {
      const productsList = [
        { asin: 'B000ABC123', has_brandstory: true },
        { asin: 'B000DEF456', has_brandstory: false },
        { asin: 'B000GHI789', has_brandstory: true },
      ];
      const result = checkBrandStory(productsList);

      expect(result).toHaveLength(3);
      expect(result[0].data.status).toBe('Success');
      expect(result[1].data.status).toBe('Error');
      expect(result[2].data.status).toBe('Success');
    });
  });
});
