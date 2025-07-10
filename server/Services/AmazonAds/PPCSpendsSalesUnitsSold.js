const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);
/**
 * Helper function to analyze raw data and determine its format
 * @param {Buffer} data - Raw data buffer
 * @returns {Object} - Analysis results
 */
function analyzeRawData(data) {
    const analysis = {
        length: data.length,
        isGzipped: false,
        isPrintable: true,
        firstBytes: [],
        sample: ''
    };

    // Check first few bytes
    for (let i = 0; i < Math.min(10, data.length); i++) {
        analysis.firstBytes.push(data[i]);
    }

    // Check for gzip magic numbers
    if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
        analysis.isGzipped = true;
    }

    // Check if data is mostly printable
    let nonPrintableCount = 0;
    for (let i = 0; i < Math.min(100, data.length); i++) {
        if (data[i] < 32 || data[i] > 126) {
            nonPrintableCount++;
        }
    }
    analysis.isPrintable = nonPrintableCount < 20;

    // Get a sample of the data as string
    try {
        analysis.sample = data.toString('utf-8', 0, Math.min(200, data.length));
    } catch (e) {
        analysis.sample = 'Unable to convert to string';
    }

    return analysis;
}

// Base URIs for different regions
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

async function getReportId(accessToken, profileId, date, region) {
    try {
        // Validate region and get base URI
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
          throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }
    
        // Construct the endpoint URL
        const url = `${baseUri}/v1/campaigns/report`;
    
        // Set up headers
        const headers = {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-Scope': profileId,
          'Content-Type': 'application/json'
        };
    
        // Set up request body
        const body = {
          campaignType: 'sponsoredProducts',
          reportDate: date,
          metrics: 'campaignName,campaignId,impressions,clicks,cost,attributedConversions14d,attributedConversions14dSameSKU,attributedUnitsOrdered14d,attributedUnitsOrdered14dSameSKU,attributedSales14d,attributedSales14dSameSKU'
        };
    
        // Make the API request
        const response = await axios.post(url, body, { headers });
    
        // Return the response data
        return response.data;
    
      } catch (error) {
        // Handle different types of errors
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          console.error('API Error Response:', {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers
          });
          throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
          // The request was made but no response was received
          console.error('No response received:', error.request);
          throw new Error('No response received from Amazon Ads API');
        } else {
          // Something happened in setting up the request that triggered an Error
          console.error('Request setup error:', error.message);
          throw error;
        }
      }
}

async function checkReportStatus(reportId, accessToken, profileId, region) {
    try {
        // Validate region and get base URI
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
            throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }

        // Construct the endpoint URL with reportId as parameter
        const url = `${baseUri}/v1/reports/${reportId}`;

        // Set up headers
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-Scope': profileId,
            'Content-Type': 'application/json'
        };

        // Poll for report status
        let attempts = 0;
        const maxAttempts = 30; // Maximum 30 minutes (30 * 60 seconds)
        
        while (attempts < maxAttempts) {
            try {
                // Make GET request to check status
                const response = await axios.get(url, { headers });
                const { status,location} = response.data;

                // console.log(`Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'SUCCESS') {
                    return {
                        status: 'SUCCESS',
                        location: location,
                        reportId: reportId
                    };
                    
                } else if (status === 'FAILURE') {
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'IN_PROGRESS' || status === 'PENDING') {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // If it's a network error, we might want to retry
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    console.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    attempts++;
                    continue;
                }
                throw error;
            }
        }

        // If we've exceeded max attempts
        throw new Error(`Report status check timed out after ${maxAttempts} attempts`);

    } catch (error) {
        // Handle different types of errors
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Report status check error:', error.message);
            throw error;
        }
    }
}


async function downloadReportData(location, accessToken, profileId) {
    try {
      // 1) Always ask for binary so we can gunzip ourselves
      const response = await axios.get(location, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Amazon-Advertising-API-Scope': profileId,
          Accept: 'application/json'
        },
        responseType: 'arraybuffer',  // get raw bytes
        decompress: false             // turn off axios’s auto-inflate
      });
  
      // 2) Inflate the GZIP buffer
      const inflatedBuffer = await gunzip(response.data);
      const payloadText = inflatedBuffer.toString('utf8');
  
      // 3) Parse JSON
      const reportJson = JSON.parse(payloadText);
      // console.log('Successfully downloaded and parsed report:', {
      //   totalRows: reportJson.metadata?.totalRows ?? reportJson.length
      // });
  
      return reportJson;
  
    } catch (err) {
      // 4) Better error logging
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Body:', err.response.data.toString?.() ?? err.response.data);
        throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
      }
      console.error('Error downloading report:', err);
      throw err;
    }
  }

async function getPPCSpendsSalesUnitsSold(accessToken, profileId, date, region) {
    // console.log(profileId)
    try {
        // Get the report ID first
        const reportData = await getReportId(accessToken, profileId, date, region);
        
        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        // console.log(`Report ID generated: ${reportData.reportId}`);

        // Check report status until completion
        const reportStatus = await checkReportStatus(reportData.reportId, accessToken, profileId, region);

        if (reportStatus.status === 'SUCCESS') {
            // console.log('Report generated successfully:', reportStatus.location);
            
            // Download and parse the report data
            const reportContent = await downloadReportData(reportStatus.location, accessToken, profileId);
            
            return {
                success: true,
                reportId: reportStatus.reportId,
                location: reportStatus.location,
                data: reportContent
            };
        } else {
            console.error('Report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        console.error('Error in getPPCSpendsSalesUnitsSold:', error.message);
        throw error;
    }
}

module.exports = {
    getPPCSpendsSalesUnitsSold,
};

