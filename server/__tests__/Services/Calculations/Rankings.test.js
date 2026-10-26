/**
 * Tests for Rankings calculation service
 */

const {
  getRankings,
  BackendKeyWordOrAttributesStatus,
  checkTitle,
  checkBulletPoints,
  checkDescription,
  findPromotionalTerms,
  findProhibitedClaims,
  PROMOTIONAL_TERMS,
  PROHIBITED_CLAIMS,
} = require('../../../Services/Calculations/Rankings.js');

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
    // Amazon's title requirements (21 Jan 2025): max 200 characters, no
    // prohibited/decorative characters, no word more than twice, title case,
    // numerals over spelled-out numbers. tasks-logics.xlsx adds: under 80
    // characters is a low-priority task, and our restricted-word list is a review
    // flag (Warning), not an error.
    const titleOf = (title) => getRankings({
      product_title: title,
      about_product: [],
      product_description: [],
    }).finalResult.TitleResult;

    it('should detect a title over 200 characters', () => {
      const result = titleOf('Amazon Essentials Super Comfortable Womens Winter Fleece Jacket with Pockets and Zipper Closure, ' + 'Warm Soft Lightweight Outdoor Hiking Camping Travel Layer '.repeat(2));

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain("exceeds Amazon's 200-character limit");
    });

    // 75 used to be the bar, which flagged most titles; Amazon's rule is 200.
    it('should pass a title between 80 and 200 characters', () => {
      const result = titleOf('Amazon Essentials Super Comfortable Womens Winter Fleece Jacket with Pockets and Zipper Closure');

      expect(result.charLim.status).toBe('Success');
    });

    it('should flag a title under 80 characters as too short to carry search terms', () => {
      const result = titleOf("Amazon Essentials Women's Fleece Jacket, Black, Medium");

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('only 54 characters');
    });

    it('should treat a missing title as an error', () => {
      const result = titleOf('   ');

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('missing');
    });

    it('should detect promotional and subjective wording', () => {
      const result = titleOf('Cotton Crew Socks, Hot Item, Top Rated, Grey, 6 Pack');

      expect(result.RestictedWords.status).toBe('Warning');
      expect(result.RestictedWords.Message).toContain('hot item');
      expect(result.RestictedWords.Message).toContain('top rated');
    });

    it('should detect restricted eligibility phrases', () => {
      const result = titleOf('Compression Socks, FSA/HSA Eligible, Black, Large');

      expect(result.RestictedWords.status).toBe('Warning');
    });

    it('should detect decorative symbols', () => {
      const result = titleOf('Brother Printer★HL-L2350DW★Wireless Monochrome');

      expect(result.checkSpecialCharacters.status).toBe('Error');
      expect(result.checkSpecialCharacters.Message).toContain('decorative symbols');
    });

    // tasks-logics.xlsx: ~ # < > * are flagged for review only.
    it('should flag contextual symbols used decoratively for review, not as an error', () => {
      const result = titleOf('Paradise Towel Beach Coverup << Size Kids XXS >>');

      expect(result.checkSpecialCharacters.status).toBe('Success');
      expect(result.contextualCharacters.status).toBe('Warning');
    });

    it('should allow a banned character that is part of the brand name', () => {
      const title = 'Yahoo! Brand Stainless Steel Garlic Press With Silicone Peeler, Dishwasher Safe, Silver';
      expect(checkTitle(title).checkSpecialCharacters.status).toBe('Error');
      expect(checkTitle(title, { brand: 'Yahoo!' }).checkSpecialCharacters.status).toBe('Success');
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
      const result = titleOf('Two-Pack Cotton Bath Towels, Twenty-Four x Forty-Eight inches, Quick Dry Soft Absorbent');

      expect(result.spelledOutNumbers.status).toBe('Warning');
      expect(result.NumberOfErrors).toBe(0);
    });

    it('should pass a fully compliant title with no errors', () => {
      const result = titleOf('Amazon Fresh Decaf Colombia Whole Bean Coffee, Medium Roast, 100% Arabica, 12 oz Bag');

      expect(result.NumberOfErrors).toBe(0);
    });

    it('should detect restricted words in title', () => {
      const productDetails = {
        product_title: 'This product will cure your diabetes and heal all wounds naturally',
        about_product: [],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.TitleResult.RestictedWords.status).toBe('Warning');
      expect(result.finalResult.TitleResult.RestictedWords.Message).toContain('Please review');
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
        about_product: Array.from({ length: 5 }, (_, i) => `Bullet ${i} ` + 'A'.repeat(150)),
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.charLim.status).toBe('Success');
    });

    it('should flag fewer than 5 bullet points even when each is long enough', () => {
      const result = checkBulletPoints(['A'.repeat(150), 'B'.repeat(150)]);
      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('2 bullet points; Amazon gives you 5');
    });

    it('should detect restricted words in bullet points', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['This product is FDA approved and will cure cancer naturally with antibacterial properties'],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.RestictedWords.status).toBe('Warning');
    });

    // This used to expect an Error: the title-only character rule was applied to
    // bullets too. Amazon restricts these characters in titles only.
    it('should not apply the title character rule to bullet points', () => {
      const productDetails = {
        product_title: 'A'.repeat(100),
        about_product: ['This bullet has special chars! #hashtag <tag> $money'],
        product_description: [],
      };

      const result = getRankings(productDetails);

      expect(result.finalResult.BulletPoints.checkSpecialCharacters.status).toBe('Success');
    });

    it('should report every claim found, not only the first per bullet', () => {
      const result = checkBulletPoints(['Relieves anxiety and depression with CBD', 'Kills germs']);
      expect(result.RestictedWords.Message).toMatch(/anxiety, depression, cbd, germs, kills germs/);
    });

    it('should count every failing check (used to be stuck at 1); claims are a review flag only', () => {
      expect(checkBulletPoints(['Short bullet that relieves anxiety']).NumberOfErrors).toBe(1);
      expect(checkBulletPoints(['Short bullet that relieves anxiety'], { strict: true }).NumberOfErrors).toBe(2);
      expect(checkBulletPoints(['Short bullet']).NumberOfErrors).toBe(1);
      expect(checkBulletPoints(Array.from({ length: 5 }, (_, i) => `Bullet ${i} ` + 'A'.repeat(150))).NumberOfErrors).toBe(0);
    });

    it('should treat missing bullets as no data, not an error', () => {
      expect(checkBulletPoints([]).NumberOfErrors).toBe(0);
      expect(checkBulletPoints(undefined).NumberOfErrors).toBe(0);
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

      expect(result.finalResult.Description.RestictedWords.status).toBe('Warning');
    });
  });

  describe('Description checks across paragraphs', () => {
    it('should judge length once over the whole description', () => {
      const result = checkDescription(['A'.repeat(1000), 'B'.repeat(800)]);
      expect(result.charLim.status).toBe('Success');
      expect(result.NumberOfErrors).toBe(0);
    });

    // Used to overwrite each status per paragraph (the last one won) while the
    // count added up across paragraphs: 3 short paragraphs counted 3 errors and
    // showed 1, and an early claim could be hidden by a clean last paragraph.
    it('should count each failing check once, however many paragraphs fail it', () => {
      const result = checkDescription(['Short one with antibacterial claims', 'Short two', 'Short three']);
      expect(result.charLim.status).toBe('Error');
      expect(result.RestictedWords.status).toBe('Warning');
      expect(result.RestictedWords.Message).toContain('antibacterial');
      expect(result.NumberOfErrors).toBe(1);
      expect(checkDescription(['Short one with antibacterial claims'], { strict: true }).NumberOfErrors).toBe(2);
    });

    it('should not apply the title character rule to descriptions', () => {
      expect(checkDescription(['Wow! #1 <choice> ' + 'A'.repeat(1700)]).checkSpecialCharacters.status).toBe('Success');
    });

    it('should treat a missing description as no data', () => {
      expect(checkDescription([])).toEqual({ NumberOfErrors: 0 });
      expect(checkDescription(['   ']).NumberOfErrors).toBe(0);
      expect(checkDescription(null).NumberOfErrors).toBe(0);
    });
  });

  describe('Restricted wording by section', () => {
    it('should flag promotional terms in the title only', () => {
      expect(checkTitle('Cotton Towel Set, Free Shipping').RestictedWords.status).toBe('Warning');
      expect(checkTitle('Cotton Towel Set, Free Shipping', { strict: true }).RestictedWords.status).toBe('Error');
      expect(checkTitle('Cheap Cotton Towel Bargain').RestictedWords.Message).toMatch(/cheap, bargain/);
      expect(checkBulletPoints(['Backed by our lifetime guarantee - free shipping on every order, plus a discount']).RestictedWords.status).toBe('Success');
      expect(checkDescription(['Every order ships free and is guaranteed. Limited time deal on sale now.']).RestictedWords.status).toBe('Success');
    });

    it('should flag prohibited claims in title, bullets and description', () => {
      expect(checkTitle('Joint Cream for Arthritis').RestictedWords.status).toBe('Warning');
      expect(checkBulletPoints(['Antimicrobial coating']).RestictedWords.status).toBe('Warning');
      expect(checkDescription(['Helps cure insomnia and anxiety']).RestictedWords.status).toBe('Warning');
    });

    it('should no longer flag ordinary product words', () => {
      const ordinary = [
        'prevent', 'eco-friendly', 'recommended', 'certified', 'treat', 'stress', 'non-toxic',
        'bpa-free', 'mold', 'stroke', 'mono', 'weed', 'repellent', 'eliminates', 'biodegradable',
        'tested', 'approved', 'kidney', 'liver', 'hypoallergenic', 'whitening', 'proven',
        'contaminants', 'compostable', 'aids', 'als', 'toxic', 'mildew', 'wrinkle-free',
      ];
      for (const word of ordinary) {
        expect([word, findProhibitedClaims(`Our ${word} product`)]).toEqual([word, []]);
        expect([word, findPromotionalTerms(`Our ${word} product`)]).toEqual([word, []]);
      }
    });

    it('should match whole hyphenated tokens only', () => {
      // "germ-free" is a claim; "germs" must not be found inside it, nor "virus" in "antivirus".
      expect(findProhibitedClaims('Germ-free surface')).toEqual(['germ-free']);
      expect(findProhibitedClaims('Antivirus software license')).toEqual([]);
      expect(findProhibitedClaims('Anti-viral? no: anti-bacterial wipes')).toEqual(['anti-bacterial']);
      expect(findPromotionalTerms('Salesforce compatible, wholesale pack')).toEqual([]);
    });

    it('should match multi-word terms with a space, a hyphen or nothing between words', () => {
      expect(findProhibitedClaims('FDA-approved formula')).toEqual(['fda approved']);
      expect(findProhibitedClaims('Covid19 test')).toEqual(['covid-19']);
      expect(findProhibitedClaims('covid 19 test')).toContain('covid-19');
      expect(findProhibitedClaims('Kills germs fast')).toEqual(['germs', 'kills germs']);
      expect(findPromotionalTerms('Bestseller edition')).toEqual(['best seller']);
    });

    it('should be case-insensitive and accept curly apostrophes', () => {
      expect(findProhibitedClaims('CANCER')).toEqual(['cancer']);
      expect(findProhibitedClaims('Alzheimer’s support')).toEqual(["alzheimer's"]);
    });

    it('should keep the promotional and claim lists disjoint', () => {
      expect(PROMOTIONAL_TERMS.filter((t) => PROHIBITED_CLAIMS.includes(t))).toEqual([]);
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

    // tasks-logics.xlsx: under 150 of the 250 bytes is a (low-priority) task.
    it('should flag backend keywords under 150 bytes', () => {
      const result = BackendKeyWordOrAttributesStatus('short keywords');

      expect(result.charLim.status).toBe('Error');
      expect(result.charLim.Message).toContain('250');
      expect(result.charLim.Message).toContain('bytes');
    });

    it('should pass backend keywords within 150-250 bytes', () => {
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

    it('should count the under-150-byte error', () => {
      expect(BackendKeyWordOrAttributesStatus('short').NumberOfErrors).toBe(1);
      expect(BackendKeyWordOrAttributesStatus('a'.repeat(160)).NumberOfErrors).toBe(0);
    });

    it('should count each failing check once', () => {
      expect(BackendKeyWordOrAttributesStatus('duplicate duplicate').NumberOfErrors).toBe(2); // short + duplicates
    });

    it('should flag words already in the title, ignoring short and stop words', () => {
      const keywords = 'garlic mincer crusher stainless for kitchen ' + 'zesty '.repeat(25);
      const result = BackendKeyWordOrAttributesStatus(keywords, { title: 'Stainless Steel Garlic Press for the Kitchen' });
      expect(result.titleOverlap.status).toBe('Error');
      expect(result.titleOverlap.Message).toContain('garlic, stainless, kitchen');
      expect(BackendKeyWordOrAttributesStatus(keywords).titleOverlap).toBeUndefined();
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
        // Found words are a review flag (Warning) now, never an error.
        const flagged = result.finalResult.TitleResult.RestictedWords.status === 'Warning';

        expect(flagged).toBe(expected);
        expect(result.finalResult.TitleResult.RestictedWords.status).not.toBe('Error');
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
      // Decorative use of ~ # < > * is a review flag only (contextualCharacters).
      { char: '# 2 # 3 #', expected: false },
      { char: '<<', expected: false },
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
