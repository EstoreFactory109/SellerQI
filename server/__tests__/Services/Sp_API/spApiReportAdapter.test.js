/**
 * Tests for spApiReportAdapter.mapSpApiStatus (P8) — the shared SP-API report status
 * mapping used by every converted SP-API report service. Pure function, no HTTP.
 */
const { mapSpApiStatus } = require('../../../Services/Sp_API/spApiReportAdapter.js');

describe('mapSpApiStatus', () => {
    it('DONE → ready with the document id', () => {
        expect(mapSpApiStatus('DONE', 'doc-1')).toEqual({ ready: true, handle: { reportDocumentId: 'doc-1' } });
    });

    it('DONE_NO_DATA → ready + empty (terminal, not a failure)', () => {
        expect(mapSpApiStatus('DONE_NO_DATA', 'doc-2')).toEqual({ ready: true, empty: true, handle: { reportDocumentId: 'doc-2' } });
    });

    it('IN_QUEUE / IN_PROGRESS → PROCESSING (re-check next tick)', () => {
        expect(mapSpApiStatus('IN_QUEUE')).toBe('PROCESSING');
        expect(mapSpApiStatus('IN_PROGRESS')).toBe('PROCESSING');
    });

    it('FATAL / CANCELLED / FAILED → failed', () => {
        for (const s of ['FATAL', 'CANCELLED', 'FAILED']) {
            expect(mapSpApiStatus(s)).toEqual({ failed: true, note: `report ${s}` });
        }
    });

    it('unknown status → failed (never silently treated as ready)', () => {
        expect(mapSpApiStatus('SOMETHING_NEW')).toEqual({ failed: true, note: 'unknown status SOMETHING_NEW' });
    });
});
