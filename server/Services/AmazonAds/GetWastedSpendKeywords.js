const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const adsKeywordsPerformanceModel = require('../../models/adsKeywordsPerformanceModel');
const gunzip = promisify(zlib.gunzip);

// Analyze raw buffer (for debugging)
function analyzeRawData(data) {
    const analysis = {
        length: data.length,
        isGzipped: false,
        isPrintable: true,
        firstBytes: [],
        sample: ''
    };

    for (let i = 0; i < Math.min(10, data.length); i++) {
        analysis.firstBytes.push(data[i]);
    }

    if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
        analysis.isGzipped = true;
    }

    let nonPrintableCount = 0;
    for (let i = 0; i < Math.min(100, data.length); i++) {
        if (data[i] < 32 || data[i] > 126) {
            nonPrintableCount++;
        }
    }
    analysis.isPrintable = nonPrintableCount < 20;

    try {
        analysis.sample = data.toString('utf-8', 0, Math.min(200, data.length));
    } catch (e) {
        analysis.sample = 'Unable to convert to string';
    }

    return analysis;
}

// Region base URIs
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

// Create keyword report
async function getKeywordReportId(accessToken, profileId, startDate, endDate, region) {
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
        throw new Error(`Invalid region: ${region}`);
    }

    const url = `${baseUri}/reporting/reports`;

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-Scope': profileId,
        'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
    };

    const body = {
        name: "Keyword Performance for Wasted Spend Analysis",
        startDate,
        endDate,
        configuration: {
            adProduct: "SPONSORED_PRODUCTS",
            reportTypeId: "spKeywords",
            timeUnit: "SUMMARY",
            format: "GZIP_JSON",
            groupBy: ["adGroup"],
            columns: [
                "keywordId",
                "keyword",
                "campaignName",
                "adGroupName",
                "matchType",
                "clicks",
                "cost",
                "attributedSales30d",
                "impressions",
                "campaignId",
                "adGroupId"
            ]
        }
    };

    try {
        const response = await axios.post(url, body, { headers });
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            throw new Error('No response received from Amazon Ads API');
        } else {
            throw error;
        }
    }
}

// Check report status
async function checkReportStatus(reportId, accessToken, profileId, region) {
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
        throw new Error(`Invalid region: ${region}`);
    }

    const url = `${baseUri}/reporting/reports/${reportId}`;
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-Scope': profileId,
        'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
        'Content-Type': 'application/json'
    };

    let attempts = 0;
    const maxAttempts = 30;

    while (true) {
        try {
            const response = await axios.get(url, { headers });
            const data = response.data;
            const status = data.status;

            console.log(`Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

            if (status === 'COMPLETED') {
                return { status: 'SUCCESS', location:data.url, reportId };
            } else if (status === 'FAILED') {
                return { status: 'FAILURE', reportId, error: 'Report generation failed' };
            } else if (status === 'IN_PROGRESS' || status === 'PENDING') {
                await new Promise(res => setTimeout(res, 60000));
                attempts++;
            } else {
                throw new Error(`Unknown report status: ${status}`);
            }
        } catch (error) {
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.warn(`Network error, retrying... (attempt ${attempts + 1})`);
                await new Promise(res => setTimeout(res, 60000));
                attempts++;
            } else if (error.response) {
                console.error('API Error Response:', error.response);
                throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                throw error;
            }
        }
    }

    throw new Error(`Report status check timed out after ${maxAttempts} attempts`);
}

// Download and parse report data
async function downloadReportData(location, accessToken, profileId) {
    try {
        const response = await axios.get(location, {
            responseType: 'arraybuffer',
            decompress: false
        });

        const inflatedBuffer = await gunzip(response.data);
        const payloadText = inflatedBuffer.toString('utf8');
        const reportJson = JSON.parse(payloadText);

        console.log('Successfully downloaded report:', {
            totalRows: reportJson.metadata?.totalRows ?? reportJson.length
        });

        return reportJson;
    } catch (err) {
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Body:', err.response.data?.toString?.() ?? err.response.data);
            throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
        }
        console.error('Download error:', err);
        throw err;
    }
}

// Orchestrator function
async function getKeywordPerformanceReport(accessToken, profileId, startDate, endDate,userId,country, region) {
    try {
        const reportData = await getKeywordReportId(accessToken, profileId, startDate, endDate, region);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        console.log(`Report ID: ${reportData.reportId}`);

        const reportStatus = await checkReportStatus(reportData.reportId, accessToken, profileId, region);

        if (reportStatus.status === 'SUCCESS') {
            console.log('Downloading report from:', reportStatus.location);
            const reportContent = await downloadReportData(reportStatus.location, accessToken, profileId);

            const data = reportContent

            const adsKeywordsPerformanceData = await adsKeywordsPerformanceModel.create({
                userId: userId,
                country: country,
                region: region,
                keywordsData: data
            });
            return {
                success: true,
                reportId: reportStatus.reportId,
                location: reportStatus.location,
                data: adsKeywordsPerformanceData.keywordsData
            };
        } else {
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }
    } catch (error) {
        console.error('Error in getKeywordPerformanceReport:', error.message);
        throw error;
    }
}

module.exports = {
    getKeywordPerformanceReport
};
