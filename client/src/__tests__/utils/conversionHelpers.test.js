import { describe, it, expect } from 'vitest';
import { checkNumberOfImages, checkStarRating } from '../../helpers/Conversion.js';

describe('client conversion helpers', () => {
  // Used to say "Your product rating is 0 stars" for a product with no reviews.
  it('treats a missing or zero rating as no data', () => {
    expect(checkStarRating(0).status).toBe('NoData');
    expect(checkStarRating(undefined).status).toBe('NoData');
    expect(checkStarRating('0').status).toBe('NoData');
  });

  it('still flags a real low rating', () => {
    expect(checkStarRating(4.1).status).toBe('Error');
    expect(checkStarRating(4.5).status).toBe('Success');
  });

  it('uses the same 5-image threshold as the server', () => {
    expect(checkNumberOfImages(Array(4).fill('a')).status).toBe('Error');
    expect(checkNumberOfImages(Array(5).fill('a')).status).toBe('Success');
    expect(checkNumberOfImages(Array(4).fill('a')).Message).toContain('fewer than 5 images');
  });
});
