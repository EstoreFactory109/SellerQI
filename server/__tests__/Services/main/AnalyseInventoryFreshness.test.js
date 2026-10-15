/**
 * processInventoryAnalysis must not present a stale stranded / inbound /
 * restock document as today's position, and must re-apply the inbound 30-day
 * window — production served such documents for up to 187 days.
 */

const { AnalyseService } = require('../../../Services/main/Analyse.js');

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const isoDay = (days) => ago(days).toISOString().slice(0, 10);

const strandedDoc = (createdAt) => ({
    createdAt,
    strandedUIData: [[{ asin: 'B-STRANDED', status_primary: 'Stranded', stranded_reason: 'No listing' }]],
});
const inboundDoc = (createdAt, ErrorData) => ({ createdAt, ErrorData });
const restockDoc = (createdAt) => ({
    createdAt,
    Products: [{ asin: 'B-RESTOCK', recommendedReplenishmentQty: '12', alert: 'out_of_stock' }],
});

const analyse = (data) => AnalyseService.processInventoryAnalysis(data, { userId: 'u', country: 'US', region: 'NA' }).analysis;

describe('processInventoryAnalysis report age guard', () => {
    it('uses fresh stranded, inbound and restock documents', () => {
        const out = analyse({
            inventoryStrandedData: strandedDoc(ago(1)),
            inboundNonComplianceData: inboundDoc(ago(1), [
                { asin: 'B-INBOUND', issueReportedDate: isoDay(3), shipmentCreationDate: isoDay(5), problemType: 'Labeling' },
            ]),
            restockInventoryRecommendationsData: restockDoc(ago(1)),
        });

        expect(out.strandedInventory.map((r) => r.asin)).toEqual(['B-STRANDED']);
        expect(out.inboundNonCompliance.map((r) => r.asin)).toEqual(['B-INBOUND']);
        expect(out.replenishment.length).toBeGreaterThan(0);
    });

    it('treats documents older than 7 days as absent', () => {
        const out = analyse({
            inventoryStrandedData: strandedDoc(ago(30)),
            inboundNonComplianceData: inboundDoc(ago(30), [
                { asin: 'B-INBOUND', issueReportedDate: isoDay(3), shipmentCreationDate: isoDay(5), problemType: 'Labeling' },
            ]),
            restockInventoryRecommendationsData: restockDoc(ago(30)),
        });

        expect(out.strandedInventory).toEqual([]);
        expect(out.inboundNonCompliance).toEqual([]);
        expect(out.replenishment).toEqual([]);
    });

    it('drops inbound issues that have aged out of the 30-day window', () => {
        const out = analyse({
            inboundNonComplianceData: inboundDoc(ago(1), [
                { asin: 'B-RECENT', issueReportedDate: isoDay(2), shipmentCreationDate: isoDay(4), problemType: 'Labeling' },
                { asin: 'B-OLD', issueReportedDate: isoDay(45), shipmentCreationDate: isoDay(50), problemType: 'Labeling' },
            ]),
        });

        expect(out.inboundNonCompliance.map((r) => r.asin)).toEqual(['B-RECENT']);
    });

    it('an empty stranded snapshot yields no stranded errors', () => {
        const out = analyse({ inventoryStrandedData: { createdAt: ago(0), strandedUIData: [[]] } });
        expect(out.strandedInventory).toEqual([]);
    });
});
