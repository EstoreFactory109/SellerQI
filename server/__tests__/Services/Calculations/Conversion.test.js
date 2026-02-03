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
} = require('../../../Services/Calculations/Conversion.js');

describe('Conversion Calculations', () => {
  describe('checkNumberOfImages', () => {
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

    it('should handle exactly 6 images as error', () => {
      const images = Array(6).fill('img.jpg');
      const result = checkNumberOfImages(images);

      expect(result.status).toBe('Error');
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
  });

  describe('checkStarRating', () => {
    it('should return error when rating below 4.3', () => {
      const result = checkStarRating(4.2);

      expect(result.status).toBe('Error');
      expect(result.Message).toContain('below 4.3 stars');
      expect(result.HowToSolve).toContain('Investigate the causes');
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
    it('should return error for products without brand story', () => {
      const productsList = [{ asin: 'B000ABC123', has_brandstory: false }];
      const result = checkBrandStory(productsList);

      expect(result).toHaveLength(1);
      expect(result[0].asin).toBe('B000ABC123');
      expect(result[0].data.status).toBe('Error');
      expect(result[0].data.Message).toContain('lacks a brand story');
    });

    it('should return error when has_brandstory is undefined', () => {
      const productsList = [{ asin: 'B000ABC123' }];
      const result = checkBrandStory(productsList);

      expect(result[0].data.status).toBe('Error');
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
