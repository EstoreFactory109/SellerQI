/**
 * Tests for Rankings calculation service
 */

const { getRankings, BackendKeyWordOrAttributesStatus } = require('../../../Services/Calculations/Rankings.js');

describe('Rankings Calculations', () => {
  describe('getRankings', () => {
    it('should analyze product details and return combined results', () => {
      const productDetails = {
        product_title: 'This is a very long product title that contains more than eighty characters for testing purposes',
        about_product: [
          'This is a bullet point that contains more than one hundred and fifty characters for testing purposes and should pass the minimum character requirement test',
          'This is another bullet point that also contains more than one hundred and fifty characters for testing purposes and should pass the minimum character requirement',
        ],
        product_description: [
          'This is a very long product description that contains more than one thousand seven hundred characters. '.repeat(20),
        ],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult).toBeDefined();
      expect(result.finalResult.Title).toBe(productDetails.product_title);
      expect(result.finalResult.TitleResult).toBeDefined();
      expect(result.finalResult.BulletPoints).toBeDefined();
      expect(result.finalResult.Description).toBeDefined();
      expect(typeof result.finalResult.TotalErrors).toBe('number');
    });

    it('should count errors across title, bullets, and description', () => {
      const productDetails = {
        product_title: 'A'.repeat(80), // Error: > 75 chars, and all caps
        about_product: ['Short'], // Error: < 150 chars
        product_description: ['Short'], // Error: < 1700 chars
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.TotalErrors).toBeGreaterThan(0);
      expect(result.finalResult.TitleResult.NumberOfErrors).toBeGreaterThan(0);
      expect(result.finalResult.BulletPoints.NumberOfErrors).toBeGreaterThan(0);
      expect(result.finalResult.Description.NumberOfErrors).toBeGreaterThan(0);
    });
  });

  describe('Title checks', () => {
    // Amazon's title requirements: max 75 characters, no promotional or
    // subjective wording, no prohibited/decorative characters, no word more
    // than twice, title case, numerals over spelled-out numbers.
    const titleOf = (title) => getRankings({
      product_title: title,
      about_product: [],
      product_description: [],
    }).finalResult.TitleResult;

    it('should detect a title over 75 characters', () => {
      const result = titleOf('Amazon Essentials Super Comfortable Womens Winter Fleece Jacket with Pockets and Zipper Closure');

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain("exceeds Amazon's 75-character limit");
    });

    it('should pass a title within 75 characters', () => {
      const result = titleOf("Amazon Essentials Women's Fleece Jacket, Black, Medium");

      expect(result.charLim.status).toBe('Success');
    });

    it('should treat a missing title as an error', () => {
      const result = titleOf('   ');

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('missing');
    });

    it('should detect promotional and subjective wording', () => {
      const result = titleOf('Cotton Crew Socks, Hot Item, Top Rated, Grey, 6 Pack');

      expect(result.RestictedWords.status).toBe('Error');
      expect(result.RestictedWords.Message).toContain('hot item');
      expect(result.RestictedWords.Message).toContain('top rated');
    });

    it('should detect restricted eligibility phrases', () => {
      const result = titleOf('Compression Socks, FSA/HSA Eligible, Black, Large');

      expect(result.RestictedWords.status).toBe('Error');
    });

    it('should detect decorative symbols', () => {
      const result = titleOf('Brother Printer★HL-L2350DW★Wireless Monochrome');

      expect(result.checkSpecialCharacters.status).toBe('Error');
      expect(result.checkSpecialCharacters.Message).toContain('decorative symbols');
    });

    it('should detect contextual symbols used decoratively', () => {
      const result = titleOf('Paradise Towel Beach Coverup << Size Kids XXS >>');

      expect(result.checkSpecialCharacters.status).toBe('Error');
    });

    it('should allow contextual symbols used as identifiers or measurements', () => {
      expect(titleOf('Style #4301 Cotton Crew Socks, Grey, 6 Pack').checkSpecialCharacters.status).toBe('Success');
      expect(titleOf('Digital Kitchen Scale, <10 lb Capacity, Steel').checkSpecialCharacters.status).toBe('Success');
    });

    it('should detect a word repeated more than twice', () => {
      const result = titleOf("Levi's Men's Jeans Men's 501 Original Fit Men's Denim Jeans");

      expect(result.wordRepetition.status).toBe('Error');
      expect(result.wordRepetition.Message).toContain("men's (3 times)");
    });

    it('should allow a word used exactly twice', () => {
      const result = titleOf('Samsung 55-inch 4K Smart TV, 55 in, 2023 Model');

      expect(result.wordRepetition.status).toBe('Success');
    });

    it('should not count prepositions, articles, or conjunctions as repetition', () => {
      const result = titleOf('Shelf for the Kitchen and for the Bath and for the Office');

      expect(result.wordRepetition.status).toBe('Success');
    });

    it('should detect all-caps and all-lowercase titles', () => {
      expect(titleOf('NIKE AIR RUNNING SHOES').capitalization.status).toBe('Error');
      expect(titleOf('nike air running shoes').capitalization.status).toBe('Error');
      expect(titleOf('Nike Air Running Shoes with Cushioned Sole').capitalization.status).toBe('Success');
    });

    it('should not flag short uppercase acronyms as all caps', () => {
      const result = titleOf('Anker USB C to HDMI Cable, 6 ft, 4K');

      expect(result.capitalization.status).toBe('Success');
    });

    it('should warn about spelled-out numbers without counting them as errors', () => {
      const result = titleOf('Two-Pack Cotton Towels, Twenty-Four x Forty-Eight inches');

      expect(result.spelledOutNumbers.status).toBe('Warning');
      expect(result.NumberOfErrors).toBe(0);
    });

    it('should pass a fully compliant title with no errors', () => {
      const result = titleOf('Amazon Fresh Decaf Colombia Whole Bean Coffee, Medium Roast, 12 oz');

      expect(result.NumberOfErrors).toBe(0);
    });

    it('should detect restricted words in title', () => {
      const productDetails = {
        product_title: 'This product will cure your diabetes and heal all wounds naturally',
        about_product: [],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.TitleResult.RestictedWords.status).toBe('Error');
      expect(result.finalResult.TitleResult.RestictedWords.Message).toContain('restricted, promotional, or subjective wording');
    });

    it('should detect special characters in title', () => {
      const productDetails = {
        product_title: 'Product with special chars! $price# <tag>',
        about_product: [],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.TitleResult.checkSpecialCharacters.status).toBe('Error');
    });

    it('should pass title without restricted words or special chars', () => {
      const productDetails = {
        product_title: 'A'.repeat(100), // Clean title with enough chars
        about_product: [],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.TitleResult.RestictedWords.status).toBe('Success');
      expect(result.finalResult.TitleResult.checkSpecialCharacters.status).toBe('Success');
    });
  });

  describe('Bullet points checks', () => {
    it('should detect short bullet points (< 150 chars)', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['Short bullet point'],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.charLim.status).toBe('Error');
      expect(result.finalResult.BulletPoints.charLim.Message).toContain('under 150 characters');
    });

    it('should pass bullet points with 150+ characters', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['A'.repeat(150)],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.charLim.status).toBe('Success');
    });

    it('should detect restricted words in bullet points', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['This product is FDA approved and will cure cancer naturally with antibacterial properties'],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.RestictedWords.status).toBe('Error');
    });

    it('should detect special characters in bullet points', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['This bullet has special chars! #hashtag <tag> $money'],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.checkSpecialCharacters.status).toBe('Error');
    });
  });

  describe('Description checks', () => {
    it('should detect short description (< 1700 chars)', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: [],
        product_description: ['Short description'],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.Description.charLim.status).toBe('Error');
      expect(result.finalResult.Description.charLim.Message).toContain('under 1700 characters');
    });

    it('should pass description with 1700+ characters', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: [],
        product_description: ['A'.repeat(1700)],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.Description.charLim.status).toBe('Success');
    });

    it('should detect restricted words in description', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: [],
        product_description: ['This product will cure diabetes and treat cancer with CBD oil'],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.Description.RestictedWords.status).toBe('Error');
    });
  });

  describe('BackendKeyWordOrAttributesStatus', () => {
    it('should return error for null input', () => {
      const result = BackendKeyWordOrAttributesStatus(null);

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('missing or invalid');
    });

    it('should return error for undefined input', () => {
      const result = BackendKeyWordOrAttributesStatus(undefined);

      expect(result.charLim.status).toBe('Error');
    });

    it('should return error for non-string input', () => {
      const result = BackendKeyWordOrAttributesStatus(12345);

      expect(result.charLim.status).toBe('Error');
    });

    it('should warn when backend keywords are under 200 bytes', () => {
      const result = BackendKeyWordOrAttributesStatus('short keywords');

      expect(result.charLim.status).toBe('Warning');
      expect(result.charLim.Message).toContain('250');
      expect(result.charLim.Message).toContain('bytes');
    });

    it('should pass backend keywords within 200-250 bytes', () => {
      const result = BackendKeyWordOrAttributesStatus('a'.repeat(220)); // 220 bytes

      expect(result.charLim.status).toBe('Success');
      expect(result.charLim.Message).toContain('effectively');
    });

    it('should detect duplicate words', () => {
      const keywordsWithDuplicates = 'keyword1 keyword2 keyword1 keyword3';
      const result = BackendKeyWordOrAttributesStatus(keywordsWithDuplicates);

      expect(result.dublicateWords.status).toBe('Error');
      expect(result.dublicateWords.Message).toContain('duplicate words');
    });

    it('should pass unique keywords', () => {
      const uniqueKeywords = Array.from({ length: 100 }, (_, i) => `unique${i}`).join(' ');
      const result = BackendKeyWordOrAttributesStatus(uniqueKeywords);

      expect(result.dublicateWords.status).toBe('Success');
    });

    it('should count errors correctly', () => {
      const result = BackendKeyWordOrAttributesStatus('short');

      expect(result.NumberOfErrors).toBe(1); // Only char limit error
    });

    it('should count multiple errors', () => {
      const result = BackendKeyWordOrAttributesStatus('duplicate duplicate');

      expect(result.NumberOfErrors).toBe(2); // Char limit + duplicates
    });
  });

  describe('Restricted words detection', () => {
    const restrictedWordsTestCases = [
      { word: 'cure', expected: true },
      { word: 'heal', expected: true },
      { word: 'cancer', expected: true },
      { word: 'diabetes', expected: true },
      { word: 'fda approved', expected: true },
      { word: 'antibacterial', expected: true },
      { word: 'covid', expected: true },
      { word: 'coronavirus', expected: true },
      { word: 'normal word', expected: false },
      { word: 'product quality', expected: false },
    ];

    restrictedWordsTestCases.forEach(({ word, expected }) => {
      it(`should ${expected ? 'detect' : 'not detect'} "${word}" as restricted`, () => {
        const productDetails = {
          product_title: `Product with ${word} in title ${'A'.repeat(80)}`,
          about_product: [],
          product_description: [],
        };

        const result = getRankings(productDetails);
        const hasError = result.finalResult.TitleResult.RestictedWords.status === 'Error';

        expect(hasError).toBe(expected);
      });
    });
  });

  describe('Special characters detection', () => {
    // ! $ ? _ { } ^ ¬ ¦ are never allowed. ~ # < > * are allowed as identifiers
    // or measurements, so a single use passes and repeated use does not.
    const specialCharsTestCases = [
      { char: '!', expected: true },
      { char: '$', expected: true },
      { char: '?', expected: true },
      { char: '_', expected: true },
      { char: '{', expected: true },
      { char: '^', expected: true },
      { char: '★', expected: true },
      { char: '#', expected: false },
      { char: '<', expected: false },
      { char: '>', expected: false },
      { char: '*', expected: false },
      { char: '# 2 # 3 #', expected: true },
      { char: '<<', expected: true },
      { char: '-', expected: false },
      { char: '()', expected: false },
      { char: ',', expected: false },
    ];

    specialCharsTestCases.forEach(({ char, expected }) => {
      it(`should ${expected ? 'detect' : 'not detect'} "${char}" as a prohibited character`, () => {
        const productDetails = {
          product_title: `Product with ${char} Character`,
          about_product: [],
          product_description: [],
        };

        const result = getRankings(productDetails);
        const hasError = result.finalResult.TitleResult.checkSpecialCharacters.status === 'Error';

        expect(hasError).toBe(expected);
      });
    });
  });
});
