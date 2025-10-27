const axios = require('axios');

const keywordTracking = async (keywords,asin,geo) => {
    const options={
        method: 'POST',
        url: `https://api.sellerapp.com/sellmetricsv2/keyword_tracking_schedule`,
        headers: {
            'client-id': "access-estorefactory",
            'token': "819425ba-22db-4df9-a945-f7a061d69182",
            'Content-Type': 'application/json'
        },
        data: {
            keywords: keywords,
            product_ids:[asin],
            geo:geo,
            enable_index_checking:true
        }
    }
    const response = await axios.request(options);
    return response.data.request_id;
}


const getKeywordTrackingReportUrl = async (request_id)=>{
    const options={
        method: 'GET',
        url: `https://api.sellerapp.com/sellmetricsv2/keyword_tracking_report`,
        headers: {
            'client-id': "access-estorefactory",
            'token': "819425ba-22db-4df9-a945-f7a061d69182",
            'Content-Type': 'application/json'
        },
        params: {
            request_id: request_id
        }
    }
    const response = await axios.request(options);
    return response.data.report_url;
}

const getKeywordTrackingReportData = async (report_url)=>{
    const response = await axios.get(report_url);
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
}

const getFinalReportData = async (keywords,asin,geo)=>{
    const request_id = await keywordTracking(keywords,asin,geo);
    const report_url = await getKeywordTrackingReportUrl(request_id);
    const report_data = await getKeywordTrackingReportData(report_url);
    return report_data;
}

module.exports = getFinalReportData
