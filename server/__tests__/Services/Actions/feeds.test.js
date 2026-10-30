/**
 * Bulk stock through feeds: the feed document, reading Amazon's result per SKU,
 * and the checks before a feed is sent.
 */
const F = require('../../../Services/Sp_API/FeedsService.js');

describe('FeedsService (pure parts)', () => {
    const messages = [{ sku: 'A', patches: [{ op: 'replace' }] }, { sku: 'B', patches: [{ op: 'replace' }] }];

    it('builds a JSON_LISTINGS_FEED with numbered PATCH messages', () => {
        expect(F.buildListingsFeed({ sellerId: 'S1', messages })).toEqual({
            header: { sellerId: 'S1', version: '2.0', issueLocale: 'en_US' },
            messages: [
                { messageId: 1, sku: 'A', operationType: 'PATCH', productType: 'PRODUCT', patches: [{ op: 'replace' }] },
                { messageId: 2, sku: 'B', operationType: 'PATCH', productType: 'PRODUCT', patches: [{ op: 'replace' }] }
            ]
        });
    });

    it("turns Amazon's result into accepted counts and errors by SKU", () => {
        const result = { summary: { messagesAccepted: 1, messagesInvalid: 1 }, issues: [{ messageId: 2, severity: 'ERROR', message: 'SKU not found' }, { messageId: 1, severity: 'WARNING', message: 'note' }] };
        expect(F.summarizeFeedResult(result, messages)).toEqual({ accepted: 1, invalid: 1, errors: [{ sku: 'B', message: 'SKU not found' }] });
    });
});

describe('feeds.bulk_fbm_stock', () => {
    const h = require('../../../Services/Actions/registry.js').get('feeds.bulk_fbm_stock');
    it('is behind its own switch and is never resent after a timeout', () => {
        expect(h.flag).toBe('AMAZON_ACTIONS_FEEDS');
        expect(h.idempotent).toBe(false);
    });
    it('needs whole-number stock and each SKU once', () => {
        expect(() => h.validate({ items: [{ sku: 'A', quantity: 1.5 }] })).toThrow('whole number');
        expect(() => h.validate({ items: [{ sku: 'A', quantity: 1 }, { sku: 'A', quantity: 2 }] })).toThrow('listed twice');
        expect(h.validate({ items: [{ sku: ' A ', quantity: '3' }] })).toEqual({ items: [{ sku: 'A', quantity: 3 }] });
    });
});

describe('reports.cancel_report', () => {
    const h = require('../../../Services/Actions/registry.js').get('reports.cancel_report');
    it('is for the SellerQI team only, and takes a report id', () => {
        expect(h.staffOnly).toBe(true);
        expect(() => h.validate({ reportId: 'abc' })).toThrow('report id');
    });
});
