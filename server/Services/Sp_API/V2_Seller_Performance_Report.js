const axios = require("axios");
const logger = require("../../utils/Logger");
const {ApiError}=require('../../utils/ApiError');
const GET_V2_SELLER_PERFORMANCE_REPORT=require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

/**
 * Amazon's rates arrive as fractions (0.0024) with a target in the same unit
 * (0.01 for "under 1%"). The target is the one thing on the node that says which
 * unit Amazon used, so it decides the scale; without one the documented
 * fraction form is assumed. Returns a percentage, or null when there is no rate.
 */
const toPercent = (node) => {
    const rate = node?.rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    const target = node?.targetValue?.value;
    const isFraction = typeof target === 'number' ? target <= 1 : rate <= 1;
    return Math.round((isFraction ? rate * 100 : rate) * 10000) / 10000;
};

const countOf = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Everything the report carries beyond the seven fields stored since day one.
 *
 * The report has always held the rates, the chargeback and claim counts, the
 * tracking shipment counts and a dozen policy metrics — ours kept seven
 * statuses and threw the rest away. Nothing here is a new Amazon call.
 *
 * Read defensively, and unlike the original seven, never allowed to throw:
 * these fields vary by marketplace (unitOnTimeDeliveryRate is US-only) and by
 * fulfilment channel (an FBA-only seller has no mfn block), and a missing one
 * must cost its own row, not the whole snapshot. The original seven keep their
 * exact extraction so nothing that already reads them changes.
 *
 * No live response could be inspected (every SP-API account available here
 * returns 401), so this follows Amazon's published V2 schema; a policy metric
 * we have no label for is still kept, under its own key.
 */
const extractExtendedMetrics = (refinedData) => {
    const metrics = refinedData?.performanceMetrics?.[0] || {};
    const odr = metrics.orderDefectRate || {};
    // Channel blocks present on this account; an FBA-only seller has no mfn.
    const channels = [odr.afn, odr.mfn].filter(Boolean);
    const sumCounts = (field) => {
        const counts = channels.map((channel) => countOf(channel?.[field]?.count)).filter((c) => c !== null);
        return counts.length ? counts.reduce((sum, c) => sum + c, 0) : null;
    };
    // The worse of the two channels is the one Amazon acts on.
    const worstStatus = (field) => {
        const statuses = channels.map((channel) => String(channel?.[field]?.status || '')).filter(Boolean);
        return statuses.find((status) => status.toUpperCase() !== 'GOOD') || statuses[0] || '';
    };
    const primaryOdr = odr.afn || odr.mfn || null;

    const tracking = metrics.validTrackingRate || {};
    const otdr = metrics.onTimeDeliveryRate || {};
    const unitOtdr = metrics.unitOnTimeDeliveryRate || {};

    // Every node that reads as a policy metric: a status plus a defect count.
    // Collected generically so a metric Amazon adds later still arrives.
    const policyMetrics = [];
    for (const [key, node] of Object.entries(metrics)) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
        if (!('defectsCount' in node)) continue;
        policyMetrics.push({
            key,
            status: String(node.status || ''),
            count: countOf(node.defectsCount),
        });
    }

    return {
        orderDefectRatePct: primaryOdr ? toPercent(primaryOdr) : null,
        lateShipmentRatePct: toPercent(metrics.lateShipmentRate),
        cancellationRatePct: toPercent(metrics.preFulfillmentCancellationRate),
        validTrackingRatePct: toPercent(tracking),
        onTimeDeliveryRateStatus: String(otdr.status || ''),
        onTimeDeliveryRatePct: toPercent(otdr),
        unitOnTimeDeliveryRateStatus: String(unitOtdr.status || ''),
        unitOnTimeDeliveryRatePct: toPercent(unitOtdr),
        chargebackCount: sumCounts('chargebacks'),
        chargebackStatus: worstStatus('chargebacks'),
        claimsCount: sumCounts('claims'),
        // The window every ODR count was measured over; "0 chargebacks" means
        // nothing without it.
        odrWindowFrom: String(primaryOdr?.reportingDateRange?.reportingDateFrom || ''),
        odrWindowTo: String(primaryOdr?.reportingDateRange?.reportingDateTo || ''),
        trackedShipmentCount: countOf(tracking.shipmentCount),
        validTrackingCount: countOf(tracking.validTrackingCount),
        policyMetrics,
    };
};

/**
 * One snapshot's worth of fields, from the parsed report. The first seven are
 * extracted exactly as they always were — including throwing when absent,
 * which is what has always kept a malformed report out of the collection.
 */
const buildSnapshot = (refinedData) => ({
    ahrScore: refinedData.performanceMetrics[0].accountHealthRating.ahrScore,
    accountStatuses: refinedData.accountStatuses[0].status,
    listingPolicyViolations: refinedData.performanceMetrics[0].listingPolicyViolations.status,
    validTrackingRateStatus: refinedData.performanceMetrics[0].validTrackingRate.status,
    orderWithDefectsStatus: refinedData.performanceMetrics[0].orderDefectRate.afn.orderWithDefects.status,
    lateShipmentRateStatus: refinedData.performanceMetrics[0].lateShipmentRate.status,
    CancellationRate: refinedData.performanceMetrics[0].preFulfillmentCancellationRate.status,
    ...(() => {
        try {
            return extractExtendedMetrics(refinedData);
        } catch (error) {
            logger.warn(`V2_Seller_Performance_Report: extended metrics not read: ${error.message}`);
            return {};
        }
    })(),
});


const generateReport=async(accessToken, marketplaceIds,baseuri)=> {
   
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_V2_SELLER_PERFORMANCE_REPORT",
                marketplaceIds: marketplaceIds, 
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString()
            },
            {
                headers: {
                    "x-amz-access-token": `${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.reportId;
    } catch (error) {
        logger.error("Error generating report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
}

const checkReportStatus = async (accessToken, reportId,baseuri) => {
    try {
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/reports/${reportId}`,
            {
                headers: { "x-amz-access-token": accessToken },
            }
        );

        const status = response.data.processingStatus;
        const reportDocumentId = response.data.reportDocumentId || null;

        logger.info(`Report Status: ${status}`);

        // Handle different statuses
        switch (status) {
            case "DONE":
                logger.info(`Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                logger.error("Report failed with a fatal error.");
                if (reportDocumentId) {
                    return false;
                }

            case "CANCELLED":
                logger.error("Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                return null;

            case "IN_QUEUE":
                return null;

            case "DONE_NO_DATA":
                logger.error("Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("Report failed for an unknown reason.");
                return false;

            default:
                logger.error(`Unknown report status: ${status}`);
        }
    } catch (error) {
        logger.error("Error checking report status:", error.response ? error.response.data : error.message);
        throw new Error("Failed to check report status");
    }
};


const getReportLink=async(accessToken, reportDocumentId,baseuri)=> {
    try {
     
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        const documentUrl = response.data.url;
        // Return the pre-signed document URL directly. Previously this downloaded the
        // entire (gzipped) report body just to read back its own request URL and then
        // discarded it — the real download happens once in getReport(). Avoids a full
        // duplicate download per run. Value is identical (config.url === documentUrl).
        return documentUrl;
    } catch (error) {
        logger.error("Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
}

const getReport = async (accessToken, marketplaceIds,userId,baseuri,country,region ) => {
    logger.info("V2_Seller_Performance_Report starting");

    if (!accessToken || !marketplaceIds) {
        logger.error(new ApiError(400, "Credentials are missing"));
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if(!reportId){
            logger.error(new ApiError(408,"Report did not complete within 5 minutes"));
            return false;
        }
        
        // Check Report Status with Retry Logic
        let reportDocumentId = null;
        let attemptCount = 0;

        while (reportDocumentId === null) {
            attemptCount++;
            logger.debug(`Checking report status... (Attempt ${attemptCount})`);
            await new Promise((resolve) => setTimeout(resolve, 90000)); // Wait 90 seconds before retrying
            reportDocumentId = await checkReportStatus(accessToken, reportId,baseuri);
            
            if(reportDocumentId === false){
                return {
                    success:false,
                    message:"Error in generating the report"
                }; 
            }
        }

        const reportPath = await getReportLink(accessToken, reportDocumentId,baseuri);
        const fullReport=await axios(
            {
                method: "GET",
                url: reportPath,
                responseType: "arraybuffer",
            }
        );

        if (!fullReport || !fullReport.data) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
        }

       const decompressedBuffer = await gunzip(fullReport.data);
       fullReport.data = null; // free the compressed buffer ASAP
       const ReportData = decompressedBuffer.toString("utf8");
       const refinedData=JSON.parse(ReportData);
       // ReportData (raw JSON string) no longer needed — let GC reclaim it

       const User=userId;
       const storeData=await GET_V2_SELLER_PERFORMANCE_REPORT.create({User,region,country,...buildSnapshot(refinedData)});

       if(!storeData){
        logger.error("Failed to store report data");
        logger.error(new ApiError(500,"Internal seerror in storing the report"));
        return false;
       }

       logger.info("Data saved successfully");
       logger.info("V2_Seller_Performance_Report ended");
       return storeData;

    } catch (error) {
        logger.error(`V2_Seller_Performance_Report Error: ${error.message}`);
        logger.error(new ApiError(500,"Internal server error in generating the report"));
        return false
    }
}



// ============================================================================
// P8: Non-blocking (async) SP-API adapter. The inline getReport() above is the UNCHANGED
// fallback. TEMPLATE for the other SP-API report services: reuses this file's own
// generateReport() (create) + model save; the status check + document URL come from the
// shared spApiReportAdapter. Data is identical — only the polling is moved off the worker.
// Amazon-facing → validate in staging.
// ============================================================================
const { checkSpApiStatusOnce, getSpApiDocumentUrl } = require('./spApiReportAdapter.js');

getReport.spApiAsync = {
    serviceName: 'v2data',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'v2data',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        // Self-contained finalize: download + parse + save (same as inline path lines ~145-183).
        finalize: async (handle) => {
            const url = await getSpApiDocumentUrl(accessToken, handle.reportDocumentId, baseuri);
            const fullReport = await axios({ method: 'GET', url, responseType: 'arraybuffer' });
            const decompressedBuffer = await gunzip(fullReport.data);
            fullReport.data = null;
            const refinedData = JSON.parse(decompressedBuffer.toString('utf8'));
            const User = userId;
            await GET_V2_SELLER_PERFORMANCE_REPORT.create({ User, region, country, ...buildSnapshot(refinedData) });
            return { empty: false };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }), // finalize saves per report
};

module.exports = getReport;
// Exported for tests: the part that can be checked without a live response.
module.exports.buildSnapshot = buildSnapshot;
module.exports.extractExtendedMetrics = extractExtendedMetrics;
