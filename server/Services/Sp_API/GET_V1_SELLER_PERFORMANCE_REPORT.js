const axios = require("axios");
const xml2js = require("xml2js");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');



const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_V1_SELLER_PERFORMANCE_REPORT",
                marketplaceIds: marketplaceIds, // Use array as-is, already passed as array from controller
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString(),
            },
            {
                headers: {
                    "x-amz-access-token": accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.reportId;
    } catch (error) {
        logger.error("Error generating report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
};

const checkReportStatus = async (accessToken, reportId, baseuri) => {
    try {
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/reports/${reportId}`,
            {
                headers: { "x-amz-access-token": accessToken },
            }
        );

        const status = response.data.processingStatus;
        const reportDocumentId = response.data.reportDocumentId || null;

        // console.log(`🔄 Report Status: ${status}`);

                  switch (status) {
              case "DONE":
                logger.info(`Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                logger.error("Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.error("Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                // console.log("⏳ Report is still processing...");
                return null;

            case "IN_QUEUE":
                // console.log("📋 Report is queued for processing...");
                return null;

            case "DONE_NO_DATA":
                logger.error("Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("Report failed for an unknown reason.");
                return false;

            default:
                logger.error(`Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("Error checking report status:", error.response ? error.response.data : error.message);
        throw new Error("Failed to check report status");
    }
};

const getReportLink = async (accessToken, reportDocumentId, baseuri) => {
    try {
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        if (!response.data.url) {
            throw new Error("No valid report URL found");
        }

        return response.data.url;
    } catch (error) {
        logger.error("Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, userId, baseuri,country,region) => {
    logger.info("V1_Seller_Performance_Report starting");
    
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        // Check Report Status with Retry Logic
        let reportDocumentId = null;
        let attemptCount = 0;

        while (reportDocumentId === null) {
            attemptCount++;
            logger.info(`Checking report status... (Attempt ${attemptCount})`);
            await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait 20 seconds before retrying
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseuri);
            
            if (reportDocumentId === false) {
                return {
                    success: false,
                    message: "Error in generating the report",
                };
            }
        }

        return await _processV1Document(accessToken, reportDocumentId, baseuri, userId, country, region);

    } catch (error) {
        logger.error(`V1_Seller_Performance_Report Error: ${error.message}`);
        throw new ApiError(500, error.message);
    }
};

// Extracted post-poll step (download → parse XML → save). Shared by the inline path
// (above) and the P8 async adapter (below) so both produce identical data — one source.
async function _processV1Document(accessToken, reportDocumentId, baseuri, userId, country, region) {
    const reportUrl = await getReportLink(accessToken, reportDocumentId, baseuri);
    const fullReport = await axios({
        method: "GET",
        url: reportUrl,
        responseType: "text",
    });

    if (!fullReport || !fullReport.data) {
        throw new ApiError(500, "Internal server error in generating the report");
    }

    const xmlData = fullReport.data;
    const jsonData = await convertXMLToJson(xmlData);

    const User=userId
    const metrics = extractV1Metrics(jsonData);
    const previous = await GET_V1_SELLER_PERFORMANCE_REPORT.findOne({ User, country, region })
        .sort({ createdAt: -1 })
        .select('negativeFeedbacks negativeFeedbacksRoseAt')
        .lean()
        .catch(() => null);

    const createReportData=await GET_V1_SELLER_PERFORMANCE_REPORT.create({
        User,
        region,
        country,
        ...metrics,
        ...feedbackRise(previous, metrics, new Date())
    })

    if(!createReportData){
        logger.error("Failed to store report data");
        logger.error(new ApiError(500, "Internal server error in generating the report"));
        return false;
    }

    logger.info("Data saved successfully");
    logger.info("V1_Seller_Performance_Report ended");
    return createReportData;
}

/**
 * The counts we keep, from the parsed V1 XML. Exported for tests.
 *
 * WHICH WINDOW
 * The metric lists hold several entries. This used to sort them by window end,
 * oldest first, and take [0] — the OLDEST window: reports fetched on 20-24 Oct
 * 2026 all stored windows ending 23-24 Sep. Now the entries ending latest are
 * used. If several share that end (one per fulfilment channel, say), their
 * counts are added, which is right whichever way Amazon splits the list.
 *
 * xml2js runs with explicitArray:false, so a list of one arrives as a bare
 * object; both shapes are accepted.
 *
 * RESPONSE TIME
 * `responseUnder24Hours` counts replies made in time; it is still stored but no
 * longer judged (on 24 Oct 2026 it was 0 on all 81 live marketplaces).
 * `noResponseForContactsOlderThan24Hours` — the field the spec names — is the
 * count of buyer messages left unanswered past 24 hours. It is read from
 * wherever it sits (Amazon's docs list it under buyerSellerContactResponseTimeMetrics;
 * the old code found responseUnder24Hours one level deeper) and stored as null
 * when the report does not carry it, so no task is ever raised on a guess.
 */
const asList = (x) => (Array.isArray(x) ? x : (x ? [x] : []));
const countOf = (node) => {
    const raw = node && typeof node === 'object' ? (node.count ?? node._) : node;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
};

function latestWindow(entries, fields) {
    const list = asList(entries).filter(e => e && e.timeFrame && e.timeFrame.end);
    if (list.length === 0) return Object.fromEntries(fields.map(f => [f, null]));
    const newestEnd = list.reduce((max, e) => (new Date(e.timeFrame.end) > new Date(max) ? e.timeFrame.end : max), list[0].timeFrame.end);
    const newest = list.filter(e => new Date(e.timeFrame.end).getTime() === new Date(newestEnd).getTime());
    const out = {};
    for (const field of fields) {
        const counts = newest.map(e => countOf(e[field])).filter(c => c !== null);
        out[field] = {
            startDate: newest[0].timeFrame.start,
            endDate: newest[0].timeFrame.end,
            count: counts.length ? String(counts.reduce((a, b) => a + b, 0)) : ''
        };
    }
    return out;
}

/**
 * Carries "when did negative feedback last go up" from the previous report.
 * @returns {{negativeFeedbacksRoseAt: Date|null, negativeFeedbacksCompared: boolean}}
 */
function feedbackRise(previous, metrics, now) {
    const count = (doc) => {
        const raw = doc?.negativeFeedbacks?.count;
        if (raw === '' || raw === null || raw === undefined) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    };
    const before = count(previous);
    const after = count(metrics);
    if (before === null || after === null) {
        return { negativeFeedbacksRoseAt: previous?.negativeFeedbacksRoseAt || null, negativeFeedbacksCompared: false };
    }
    return {
        negativeFeedbacksRoseAt: after > before ? now : (previous.negativeFeedbacksRoseAt || null),
        negativeFeedbacksCompared: true
    };
}

function extractV1Metrics(jsonData) {
    const report = jsonData.sellerPerformanceReports.sellerPerformanceReport;
    const defects = latestWindow(report.orderDefects.orderDefectMetrics, ['negativeFeedbacks', 'a_z_claims']);
    const cx = latestWindow(report.customerExperience.customerExperienceMetrics, ['lateShipment', 'preFulfillmentCancellation', 'refunds']);

    const contact = report.buyerSellerContactResponseTimeMetrics || {};
    const timing = asList(contact.responseTimeMetrics)[0] || {};
    const firstNumber = (...values) => {
        for (const v of values) {
            const n = countOf(v);
            if (n !== null) return n;
        }
        return null;
    };

    return {
        negativeFeedbacks: defects.negativeFeedbacks,
        a_z_claims: defects.a_z_claims,
        lateShipmentCount: cx.lateShipment,
        preFulfillmentCancellationCount: cx.preFulfillmentCancellation,
        refundsCount: cx.refunds,
        responseUnder24HoursCount: timing.responseUnder24Hours ?? contact.responseUnder24Hours,
        noResponseOver24HoursCount: firstNumber(
            contact.noResponseForContactsOlderThan24Hours,
            timing.noResponseForContactsOlderThan24Hours
        )
    };
}

async function convertXMLToJson(xmlData) {
    try {
        const parser = new xml2js.Parser({ explicitArray: false });
        const jsonResult = await parser.parseStringPromise(xmlData);
        return jsonResult;
    } catch (error) {
        logger.error("Error converting XML to JSON:", error.message);
        throw new Error("Failed to parse XML data");
    }
}

// P8: Non-blocking async adapter — reuses _processV1Document (the SAME code the inline
// path runs) so data is identical by construction. Status check via shared helper.
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'v1data',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'v1data',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            await _processV1Document(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: false };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.extractV1Metrics = extractV1Metrics;
module.exports.feedbackRise = feedbackRise;
