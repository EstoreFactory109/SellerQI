/**
 * QMate must not tell a seller their products are "missing a Brand Story" in a
 * marketplace where no product shows one: there the scrape cannot tell a missing
 * Brand Story from no Brand Registry or a blind spot (36 of 76 production
 * marketplaces; the same gate keeps missing_brand_story tasks out).
 */

jest.mock('../../../Services/AI/QMateProductsService.js', () => ({
    getFullAsinIssues: jest.fn(),
    getListingQualityAnalysis: jest.fn(),
}));

const QMateProductsService = require('../../../Services/AI/QMateProductsService.js');
const { getBrandStoryStatus } = require('../../../Services/AI/layers/services/SellerOpsEngine.js');

const ctx = { userId: '507f1f77bcf86cd799439011', country: 'US', region: 'NA' };
const quality = (summary) => ({ success: true, data: { summary, qualityMetrics: { brandStoryAdoption: summary.brandStoryStatusKnown === false ? null : 50 } } });

describe('getBrandStoryStatus in a gated marketplace', () => {
    beforeEach(() => {
        QMateProductsService.getFullAsinIssues.mockResolvedValue({
            success: true,
            data: { name: 'Mug', conversionErrors: { brandStoryErrorData: null } },
        });
    });

    it('reports unknown account-wide rather than "N products missing"', async () => {
        QMateProductsService.getListingQualityAnalysis.mockResolvedValue(quality({ totalProducts: 10, productsWithBrandStory: null, brandStoryStatusKnown: false }));
        const r = await getBrandStoryStatus(ctx);
        expect(r.statusKnown).toBe(false);
        expect(r.present).toBeNull();
        expect(r.productsWithoutBrandStory).toBeNull();
        expect(r.message).toMatch(/Brand Registry/);
    });

    it('reports unknown for one ASIN rather than "already has a Brand Story"', async () => {
        QMateProductsService.getListingQualityAnalysis.mockResolvedValue(quality({ totalProducts: 10, brandStoryStatusKnown: false }));
        const r = await getBrandStoryStatus(ctx, 'B000000001');
        expect(r.statusKnown).toBe(false);
        expect(r.present).toBeNull();
    });

    it('keeps the normal verdicts where the status is known', async () => {
        QMateProductsService.getListingQualityAnalysis.mockResolvedValue(quality({ totalProducts: 10, productsWithBrandStory: 4, brandStoryStatusKnown: true }));
        expect((await getBrandStoryStatus(ctx)).productsWithoutBrandStory).toBe(6);
        expect((await getBrandStoryStatus(ctx, 'B000000001')).present).toBe(true);
    });
});
