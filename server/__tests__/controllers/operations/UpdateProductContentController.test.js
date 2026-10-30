/**
 * Fix It's endpoint: the account and marketplace come from the session only, and
 * the change goes through the logged change-request flow.
 */
const mockRuns = [];
jest.mock('../../../Services/Actions/ChangeRequestService.js', () => ({
    runApproved: async (args) => { mockRuns.push(args); return { id: 'R1', message: 'Done on Amazon.' }; }
}));
jest.mock('../../../models/MCP/AmazonChangeRequestModel.js', () => ({
    findById: () => ({ select: () => ({ lean: async () => ({ status: 'succeeded', response: { status: 'SUCCESS', asin: 'B01' } }) }) })
}));
jest.mock('../../../Services/Sp_API/UpdateProductContentService.js', () => ({
    updateProductContent: async () => ({ status: 'ANALYZED' }),
    FIX_STATUS: { SUCCESS: 'SUCCESS' }
}));
const { updateProductContentController } = require('../../../controllers/operations/UpdateProductContentController.js');

const call = async (body) => {
    const req = { body, userId: 'U1', country: 'US', region: 'NA' };
    let out;
    // asyncHandler does not return its promise, so wait for the response itself.
    await new Promise((resolve) => { const r = { status: (code) => ({ json: (payload) => { out = { code, payload }; resolve(); } }) }; updateProductContentController(req, r, (e) => { out = { error: e }; resolve(); }); });
    return out;
};

describe('UpdateProductContentController', () => {
    beforeEach(() => { mockRuns.length = 0; });

    it('ignores userId, country and region from the body', async () => {
        const out = await call({ sku: 'SKU-1', dataToBeUpdated: 'title', valueToBeUpdated: 'New title', userId: 'OTHER', country: 'DE', region: 'EU' });
        expect(out.code).toBe(200);
        expect(mockRuns[0]).toMatchObject({ userId: 'U1', country: 'US', region: 'NA', actionType: 'listings.update_content', input: { sku: 'SKU-1', field: 'title', value: 'New title' } });
        expect(out.payload.data).toEqual({ status: 'SUCCESS', asin: 'B01' });
    });

    it('analyses without logging a change', async () => {
        const out = await call({ sku: 'SKU-1', dataToBeUpdated: 'title', analyzeOnly: true });
        expect(out.payload.data).toEqual({ status: 'ANALYZED' });
        expect(mockRuns).toHaveLength(0);
    });
});
