/**
 * spApiReportAdapter.js — shared helpers for driving SP-API reports through the
 * non-blocking asyncReportEngine (P8). Every SP-API report service in this folder uses
 * the SAME create→poll→download shape (POST /reports, GET /reports/{id} for
 * processingStatus, GET /documents/{id} for the URL), so the status-check and document
 * URL fetch live here once instead of being reimplemented per service.
 *
 * Each service supplies its own `generateReport` (create), `parse`, and `save`; it wires
 * them into an `spApiAsync` adapter ({ serviceName, buildSpecs, saveFromRows }) using
 * these helpers for the two uniform steps.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');

// axios has no default timeout — a socket that connects but never responds hangs the
// caller forever, with nothing for BullMQ's stalled-job detection to reclaim (a keep-alive
// timer just kept renewing the lock). This is a status-check GET, not a download, so it
// should return in well under a second normally; 30s matches FinanceService.js's own
// httpsRequest default for the same class of call.
const SP_API_STATUS_TIMEOUT_MS = 30000;

/**
 * Pure mapping of Amazon's SP-API `processingStatus` to the engine's adapter result.
 * Kept separate from the HTTP call so it is trivially unit-testable.
 * Returns: 'PROCESSING' | {ready:true, handle:{reportDocumentId}} |
 *          {ready:true, empty:true, handle:{reportDocumentId}} | {failed:true, note}
 */
function mapSpApiStatus(status, reportDocumentId = null) {
    switch (status) {
        case 'DONE':
            return { ready: true, handle: { reportDocumentId } };
        case 'DONE_NO_DATA':
            return { ready: true, empty: true, handle: { reportDocumentId } };
        case 'IN_QUEUE':
        case 'IN_PROGRESS':
            return 'PROCESSING';
        case 'FATAL':
        case 'CANCELLED':
        case 'FAILED':
            return { failed: true, note: `report ${status}` };
        default:
            return { failed: true, note: `unknown status ${status}` };
    }
}

/** Single-shot status check (no poll loop). */
async function checkSpApiStatusOnce(accessToken, reportId, baseuri) {
    const response = await axios.get(
        `https://${baseuri}/reports/2021-06-30/reports/${reportId}`,
        { headers: { 'x-amz-access-token': accessToken }, timeout: SP_API_STATUS_TIMEOUT_MS }
    );
    return mapSpApiStatus(response.data.processingStatus, response.data.reportDocumentId || null);
}

/** Resolve a completed report document's pre-signed download URL. */
async function getSpApiDocumentUrl(accessToken, reportDocumentId, baseuri) {
    const response = await axios.get(
        `https://${baseuri}/reports/2021-06-30/documents/${reportDocumentId}`,
        { headers: { 'x-amz-access-token': accessToken }, timeout: SP_API_STATUS_TIMEOUT_MS }
    );
    if (!response.data || !response.data.url) throw new Error('No valid report URL found');
    return response.data.url;
}

module.exports = { mapSpApiStatus, checkSpApiStatusOnce, getSpApiDocumentUrl };
