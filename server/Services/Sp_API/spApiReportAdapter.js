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

const SP_API_DOWNLOAD_TIMEOUT_MS = 120000;

/**
 * Amazon's documented meaning of CANCELLED on a report nobody cancelled: "an
 * automatic cancellation if there is no data to return". Seen live on the
 * removal-order report for two India accounts with no FBA removals.
 *
 * For the report services that opt in, that is NO_DATA, not a failure. It is
 * NOT applied in mapSpApiStatus, which older services rely on treating it as
 * a failure (their finalize cannot run without a document).
 */
const cancelledMeansNoData = (result) => (result?.failed && /CANCELLED/.test(result.note || '')
    ? { ready: true, empty: true, handle: { reportDocumentId: null } }
    : result);

/** checkSpApiStatusOnce for a service that reads CANCELLED as no data. */
async function checkSpApiStatusOnceNoDataOnCancel(accessToken, reportId, baseuri) {
    return cancelledMeansNoData(await checkSpApiStatusOnce(accessToken, reportId, baseuri));
}

/** POST /reports. Returns the reportId. */
async function createSpApiReport(accessToken, baseuri, body) {
    const response = await axios.post(
        `https://${baseuri}/reports/2021-06-30/reports`,
        body,
        {
            headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
            timeout: SP_API_STATUS_TIMEOUT_MS,
        }
    );
    return response.data.reportId;
}

/** Download a completed report document as a raw buffer (gzip is handled by the parser). */
async function downloadSpApiDocument(accessToken, reportDocumentId, baseuri) {
    const url = await getSpApiDocumentUrl(accessToken, reportDocumentId, baseuri);
    const response = await axios({ method: 'GET', url, responseType: 'arraybuffer', timeout: SP_API_DOWNLOAD_TIMEOUT_MS });
    return response.data;
}

/**
 * The inline create -> poll -> download cycle, for report services written
 * after this helper existed. Returns one of:
 *   { status: 'DONE', buffer }
 *   { status: 'NO_DATA' }          Amazon answered, with nothing in it
 *   { status: 'FAILED', note }
 *
 * `retries` re-submits on FATAL/CANCELLED: some report types fail on Amazon's
 * side intermittently and succeed on a fresh request. A failure after that is
 * returned, not thrown, so one report cannot sink the batch it runs in — the
 * one exception being an expired token, which must reach the refresh wrapper.
 */
async function runSpApiReportInline({ accessToken, baseuri, body, retries = 0, pollMs = 20000, maxPolls = 30, label = body?.reportType }) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        let reportId;
        try {
            reportId = await createSpApiReport(accessToken, baseuri, body);
        } catch (error) {
            // An expired token is rethrown, not returned: TokenManager's
            // wrapSpApiFunction refreshes only on a thrown 401/403, and a
            // quiet failure here would disable that for this report.
            if ([401, 403].includes(error.response?.status)) throw error;
            return { status: 'FAILED', note: `create failed: ${error.response?.status || error.message}` };
        }

        let result = 'PROCESSING';
        for (let poll = 0; poll < maxPolls && result === 'PROCESSING'; poll += 1) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            try {
                result = cancelledMeansNoData(await checkSpApiStatusOnce(accessToken, reportId, baseuri));
            } catch (error) {
                logger.warn(`[${label}] status check failed, retrying: ${error.message}`);
            }
        }

        if (result === 'PROCESSING') return { status: 'FAILED', note: 'report did not complete in time' };
        if (result.ready && result.empty) return { status: 'NO_DATA' };
        if (result.ready) {
            try {
                return { status: 'DONE', buffer: await downloadSpApiDocument(accessToken, result.handle.reportDocumentId, baseuri) };
            } catch (error) {
                return { status: 'FAILED', note: `download failed: ${error.message}` };
            }
        }
        logger.warn(`[${label}] ${result.note}${attempt < retries ? ', requesting it again' : ''}`);
        if (attempt === retries) return { status: 'FAILED', note: result.note };
    }
    return { status: 'FAILED', note: 'no attempt made' };
}

module.exports = {
    mapSpApiStatus,
    checkSpApiStatusOnce,
    checkSpApiStatusOnceNoDataOnCancel,
    getSpApiDocumentUrl,
    createSpApiReport,
    downloadSpApiDocument,
    runSpApiReportInline,
};
