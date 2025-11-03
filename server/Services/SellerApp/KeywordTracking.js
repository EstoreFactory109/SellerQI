const axios = require('axios');

// Configure axios with timeout and better error handling
const axiosInstance = axios.create({
    timeout: 30000, // 30 second timeout
    validateStatus: function (status) {
        return status >= 200 && status < 500; // Don't throw on 4xx errors
    }
});

const SELLERAPP_API_BASE_URL = process.env.SELLERAPP_API_BASE_URL || 'https://api.sellerapp.com';

// Retry helper for transient errors (5xx/429)
const requestWithRetry = async (fn, { maxRetries = 3, delaysMs = [1000, 3000, 7000] } = {}) => {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            const status = error?.response?.status;
            const isTransient = status === 429 || (typeof status === 'number' && status >= 500);
            if (attempt < maxRetries && isTransient) {
                const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] || 1000;
                console.warn(`[SellerApp Retry] Transient error (status=${status}). Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                attempt++;
                continue;
            }
            throw error;
        }
    }
};

const keywordTracking = async (keywords,asin,geo) => {
    try {
        const options={
            method: 'POST',
            url: `${SELLERAPP_API_BASE_URL}/sellmetricsv2/keyword_tracking_schedule`,
            headers: {
                'client-id': process.env.SELLERAPPCLIENTID || "access-estorefactory",
                'token': process.env.SELLERAPPTOKEN || "819425ba-22db-4df9-a945-f7a061d69182",
                'Content-Type': 'application/json'
            },
            data: {
                keywords: keywords,
                product_ids:[asin],
                geo:geo,
                enable_index_checking:true
            }
        }
        const response = await requestWithRetry(() => axiosInstance.request(options));
        
        if (response.status >= 400) {
            const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            throw new Error(`API request failed with status ${response.status}: ${payload}`);
        }
        
        if (!response.data || !response.data.request_id) {
            throw new Error(`Invalid response from API: ${JSON.stringify(response.data)}`);
        }
        
        return response.data.request_id;
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error(`Cannot connect to SellerApp API (${SELLERAPP_API_BASE_URL}). Please check your network connection and DNS settings. Error: ${error.message}`);
        }
        if (error.code === 'ETIMEDOUT') {
            throw new Error(`Request to SellerApp API timed out. Please try again later.`);
        }
        throw error;
    }
}


const getKeywordTrackingReportUrl = async (request_id, retryDelay = 60000)=>{
    let attempt = 1;
    
    while (true) {
        try {
            const options={
                method: 'GET',
                url: `${SELLERAPP_API_BASE_URL}/sellmetricsv2/keyword_tracking_report`,
                headers: {
                    'client-id': process.env.SELLERAPPCLIENTID || "access-estorefactory",
                    'token': process.env.SELLERAPPTOKEN || "819425ba-22db-4df9-a945-f7a061d69182",
                    'Content-Type': 'application/json'
                },
                params: {
                    request_id: request_id
                }
            }
            
            let response;
            try {
                response = await axiosInstance.request(options);
            } catch (error) {
                const status = error?.response?.status;
                const isTransient = status === 429 || (typeof status === 'number' && status >= 500);
                if (isTransient) {
                    console.warn(`Transient error while polling report (status=${status}). Waiting ${retryDelay}ms before retry ${attempt + 1}`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    attempt++;
                    continue;
                }
                throw error;
            }
            console.log(`Attempt ${attempt}: Response from getKeywordTrackingReportUrl:`, JSON.stringify(response.data, null, 2));
            
            if (response.status >= 400) {
                const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                throw new Error(`API request failed with status ${response.status}: ${payload}`);
            }
            
            // Check if the report is ready
            if (response.data.status === 'completed' && response.data.report_url) {
                console.log(`Report ready after ${attempt} attempts`);
                return response.data.report_url;
            }
            
            // If failed, throw error immediately
            if (response.data.status === 'failed') {
                throw new Error(`Report generation failed: ${response.data.message || 'Unknown error'}`);
            }
            
            // If still processing, wait and retry
            if (response.data.status === 'processing') {
                console.log(`Report still processing, waiting ${retryDelay}ms before retry ${attempt + 1}`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                attempt++;
                continue;
            }
            
            // If unknown status, throw error
            throw new Error(`Unknown status received: ${response.data.status}. Message: ${response.data.message || 'No message provided'}`);
        } catch (error) {
            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to SellerApp API (${SELLERAPP_API_BASE_URL}). Please check your network connection and DNS settings. Error: ${error.message}`);
            }
            if (error.code === 'ETIMEDOUT') {
                throw new Error(`Request to SellerApp API timed out. Please try again later.`);
            }
            throw error;
        }
    }
}

const getKeywordTrackingReportData = async (report_url)=>{
    if (!report_url) {
        throw new Error('Report URL is undefined. The keyword tracking request may have failed.');
    }
    
    try {
        const response = await requestWithRetry(() => axiosInstance.get(report_url));
        const csvData = response.data;
        
        // Parse CSV data and convert to JSON
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',').map(header => header.replace(/"/g, ''));
        const jsonData = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(value => value.replace(/"/g, ''));
            const row = {};
            
            headers.forEach((header, index) => {
                let value = values[index];
                
                // Convert string booleans to actual booleans
                if (value === 'true') {
                    value = true;
                } else if (value === 'false') {
                    value = false;
                }
                
                // Convert numeric strings to numbers
                if (!isNaN(value) && value !== '') {
                    value = Number(value);
                }
                
                row[header] = value;
            });
            
            jsonData.push(row);
        }
        
        return jsonData;
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error(`Cannot connect to report URL. Please check your network connection. Error: ${error.message}`);
        }
        if (error.code === 'ETIMEDOUT') {
            throw new Error(`Request to report URL timed out. Please try again later.`);
        }
        throw error;
    }
}

const getFinalReportData = async (keywords,asin,geo)=>{
    try {
        console.log(`Starting keyword tracking for ASIN: ${asin}, Geo: ${geo}, Keywords: ${keywords.length}`);

        // Chunk keywords to reduce payload and avoid 503s
        const CHUNK_SIZE = parseInt(process.env.SELLERAPP_KEYWORD_CHUNK_SIZE) || 50;
        const retryDelay = parseInt(process.env.SELLERAPP_RETRY_DELAY) || 60000;
        const chunks = [];
        for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
            chunks.push(keywords.slice(i, i + CHUNK_SIZE));
        }

        console.log(`Submitting ${chunks.length} schedule request(s) for ASIN ${asin} (chunk size ${CHUNK_SIZE})`);

        const allData = [];
        for (let idx = 0; idx < chunks.length; idx++) {
            const chunk = chunks[idx];
            console.log(`Submitting chunk ${idx + 1}/${chunks.length} with ${chunk.length} keywords`);

            const request_id = await requestWithRetry(() => keywordTracking(chunk, asin, geo));
            console.log(`Chunk ${idx + 1}: request_id=${request_id}`);

            console.log(`Polling configuration: retryDelay=${retryDelay}ms (chunk ${idx + 1})`);
            const report_url = await getKeywordTrackingReportUrl(request_id, retryDelay);
            console.log(`Chunk ${idx + 1}: report URL=${report_url}`);

            if (!report_url) {
                throw new Error(`Failed to get report URL for request ID: ${request_id} (chunk ${idx + 1})`);
            }

            const report_data = await getKeywordTrackingReportData(report_url);
            console.log(`Chunk ${idx + 1}: retrieved ${report_data.length} records`);
            allData.push(...report_data);
        }

        console.log(`All chunks completed for ASIN ${asin}. Total records: ${allData.length}`);
        return allData;
    } catch (error) {
        console.error(`Error in getFinalReportData for ASIN ${asin}:`, error.message);
        throw error;
    }
}

module.exports = getFinalReportData
