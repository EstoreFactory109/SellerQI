import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getRankings,
  checkBulletPoints,
  checkDescription,
  findPromotionalTerms,
  findProhibitedClaims,
} from '../../helpers/Rankingsj.js';
import { checkIfVideoExists } from '../../helpers/Conversion.js';

const root = resolve(__dirname, '../../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

/** The lists and matcher, from `const PROMOTIONAL_TERMS` to the last finder. */
const rulesSection = (source) => {
  const start = source.indexOf('const PROMOTIONAL_TERMS');
  const endMarker = 'const findProhibitedClaims = (str) => matchTerms(str, PROHIBITED_CLAIMS);';
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0) return null;
  return source.slice(start, end + endMarker.length);
};

describe('client listing rules match the server', () => {
  // The restricted-word lists live in four places; tasks come from the server
  // copy, so any drift makes the analyzers disagree with the task list.
  const server = rulesSection(read('server/Services/Calculations/Rankings.js'));

  it.each([
    'client/src/helpers/Rankingsj.js',
    'client/src/Pages/Products/PreAnalysis.jsx',
    'client/src/Pages/DemoSellerCentralChecker/DemoPreAnalysis.jsx',
  ])('%s carries an identical copy of the restricted wording rules', (path) => {
    expect(server).toBeTruthy();
    expect(rulesSection(read(path))).toBe(server);
  });
});

describe('Rankingsj restricted wording', () => {
  it('flags promotional terms in titles only', () => {
    const result = getRankings({
      product_title: 'Acme Mug, Free Shipping',
      about_product: ['Backed by our guarantee, with free shipping and a discount on every order of this mug we sell'],
      product_description: ['Limited time deal'],
    });
    expect(result.TitleResult.RestictedWords.status).toBe('Error');
    expect(result.BulletPoints.RestictedWords.status).toBe('Success');
    expect(result.Description.RestictedWords.status).toBe('Success');
  });

  it('flags prohibited claims in every section', () => {
    expect(checkBulletPoints(['Antibacterial coating']).RestictedWords.status).toBe('Error');
    expect(checkDescription(['Relieves anxiety']).RestictedWords.status).toBe('Error');
  });

  it('does not find "toxic" inside "non-toxic", nor flag ordinary words', () => {
    expect(findProhibitedClaims('Non-toxic, BPA-free, eco-friendly, certified')).toEqual([]);
    expect(findPromotionalTerms('Non-toxic, BPA-free, eco-friendly, certified')).toEqual([]);
  });

  it('applies the special-character rule to titles only', () => {
    const result = getRankings({
      product_title: 'Acme Mug!',
      about_product: ['Wow! #1 choice <for> coffee *lovers*'],
      product_description: ['Wow! #1 choice'],
    });
    expect(result.TitleResult.checkSpecialCharacters.status).toBe('Error');
    expect(result.BulletPoints.checkSpecialCharacters.status).toBe('Success');
    expect(result.Description.checkSpecialCharacters.status).toBe('Success');
  });

  it('counts each failing bullet check once', () => {
    expect(checkBulletPoints(['Short and cures anxiety']).NumberOfErrors).toBe(2);
  });
});

describe('Rankingsj treats missing bullets and description as no data', () => {
  // The server (Rankings.js) raises no error and no task for these; the analyzer
  // used to count each one as a failure.
  it.each([
    ['empty', []],
    ['null', null],
    ['undefined', undefined],
    ['not an array', 'a string'],
  ])('%s bullets produce no errors', (_, bullets) => {
    expect(checkBulletPoints(bullets).NumberOfErrors).toBe(0);
  });

  it('skips non-string bullet entries rather than erroring on them', () => {
    const result = checkBulletPoints([null, undefined]);
    expect(result.NumberOfErrors).toBe(0);
    expect(result.nullItems).toBeUndefined();
  });

  it.each([
    ['empty', []],
    ['null', null],
    ['undefined', undefined],
    ['a blank paragraph', ['']],
    ['whitespace and nulls', ['   ', null]],
    ['not an array', 'a string'],
    ['a number', 42],
  ])('%s description produces no errors', (_, description) => {
    const result = checkDescription(description);
    expect(result.NumberOfErrors).toBe(0);
    expect(result.charLim).toBeUndefined();
  });

  it('counts a null product as no data, not three failures', () => {
    const result = getRankings(null);
    expect(result.TotalErrors).toBe(0);
    expect(result.finalResult).toBeUndefined();
  });

  it('counts only the title for a product with no bullets or description', () => {
    const result = getRankings({ product_title: 'Acme Ceramic Coffee Mug', about_product: [], product_description: [''] });
    expect(result.TotalErrors).toBe(0);
  });

  it('still flags real short and overlong content', () => {
    expect(checkBulletPoints(['Too short']).charLim.status).toBe('Error');
    expect(checkBulletPoints(['x'.repeat(150)]).NumberOfErrors).toBe(0);
    expect(checkDescription(['Too short']).charLim.status).toBe('Error');
    expect(checkDescription(['x'.repeat(1700)]).NumberOfErrors).toBe(0);

    const result = getRankings({
      product_title: 'Acme Ceramic Coffee Mug with Lid, Dishwasher Safe, Microwave Safe, Large 16 oz Size',
      about_product: ['Too short'],
      product_description: ['Too short'],
    });
    expect(result.TitleResult.charLim.status).toBe('Error');
    expect(result.BulletPoints.NumberOfErrors).toBe(1);
    expect(result.Description.NumberOfErrors).toBe(1);
  });
});

describe('client checkIfVideoExists matches the server', () => {
  it('treats a missing list as no data, not a missing video', () => {
    expect(checkIfVideoExists(undefined).status).toBe('NoData');
    expect(checkIfVideoExists(null).status).toBe('NoData');
  });

  it('expects URLs: entries without one are not videos', () => {
    expect(checkIfVideoExists([]).status).toBe('Error');
    expect(checkIfVideoExists([undefined]).status).toBe('Error');
    expect(checkIfVideoExists(['https://example.com/v.mp4']).status).toBe('Success');
  });
});
