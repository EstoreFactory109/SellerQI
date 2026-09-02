import { describe, it, expect } from 'vitest';
import { getAdsPerformanceVerdict } from '../../utils/adsPerformanceVerdict.js';

/**
 * The PPC Dashboard banner used to read "Your ads are profitable overall"
 * whenever ROAS >= 1, in green. ROAS is ad-attributed sales divided by ad
 * spend — no COGS or fees in it — so it cannot support a profit claim; a
 * seller with margin thinner than their ACoS is still losing money on every
 * ad-driven sale despite a healthy ROAS. Only ROAS < 1 is unconditionally a
 * loss, since sales not covering spend can't be profitable at any margin.
 */
describe('getAdsPerformanceVerdict', () => {
    it('reports coversSpend=true at exactly the ROAS=1 breakeven boundary', () => {
        expect(getAdsPerformanceVerdict(1).coversSpend).toBe(true);
    });

    it('reports coversSpend=true for a healthy ROAS, without implying anything about profit', () => {
        const verdict = getAdsPerformanceVerdict(4.39);
        expect(verdict.coversSpend).toBe(true);
        expect(verdict.accentColorKey).toBe('good');
    });

    it('reports coversSpend=false, with the fix (red) color, below breakeven', () => {
        const verdict = getAdsPerformanceVerdict(0.8);
        expect(verdict.coversSpend).toBe(false);
        expect(verdict.accentColorKey).toBe('fix');
    });

    it('treats a numeric string the same as a number (defensive against loose upstream typing)', () => {
        expect(getAdsPerformanceVerdict('2.5').coversSpend).toBe(true);
    });

    it('reports coversSpend=false for zero ROAS (spend with no ad-attributed sales at all)', () => {
        expect(getAdsPerformanceVerdict(0).coversSpend).toBe(false);
    });
});
