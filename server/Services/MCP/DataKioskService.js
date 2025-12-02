/**
 * DataKioskService.js
 * 
 * Service layer for Amazon Data Kiosk API integration
 * This service wraps the MCP functionality for use in the Express server
 */

const axios = require('axios');
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');

// API Version constant
const API_VERSION = '2023-11-15';

/**
 * Get seller credentials and access token for a specific user
 * @param {string} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Object with accessToken, accessKey, secretKey, sessionToken
 */
async function getUserCredentials(userId, region) {
    try {
        // Get seller credentials from database
        const seller = await Seller.findOne({ User: userId, region });
        if (!seller) {
            throw new ApiError(404, 'Seller account not found');
        }

        // Map region to AWS region for STS
        const regionMap = {
            'NA': 'us-east-1',
            'EU': 'eu-west-1',
            'FE': 'ap-southeast-1'
        };
        const awsRegion = regionMap[region] || 'us-east-1';

        // Get temporary AWS credentials (required for SP-API signing)
        const tempCredentials = await getTemporaryCredentials(awsRegion);

        if (!tempCredentials) {
            throw new ApiError(500, 'Failed to obtain temporary AWS credentials');
        }

        // Get access token using existing token generation
        const { generateAccessToken } = require('../Sp_API/GenerateTokens.js');
        const accessToken = await generateAccessToken(userId, seller.refreshToken);

        if (!accessToken) {
            throw new ApiError(500, 'Failed to obtain access token');
        }

        return {
            accessToken: accessToken,
            accessKey: tempCredentials.AccessKey,
            secretKey: tempCredentials.SecretKey,
            sessionToken: tempCredentials.SessionToken
        };
    } catch (error) {
        logger.error(`Error getting credentials for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Get credentials using refresh token directly (without database lookup)
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Object with accessToken, accessKey, secretKey, sessionToken
 */
async function getCredentialsFromRefreshToken(refreshToken, region) {
    try {
        if (!refreshToken) {
            throw new ApiError(400, 'Refresh token is required');
        }

        // Map region to AWS region for STS
        const regionMap = {
            'NA': 'us-east-1',
            'EU': 'eu-west-1',
            'FE': 'ap-southeast-1'
        };
        const awsRegion = regionMap[region] || 'us-east-1';

        // Get temporary AWS credentials (required for SP-API signing)
        const tempCredentials = await getTemporaryCredentials(awsRegion);

        if (!tempCredentials) {
            throw new ApiError(500, 'Failed to obtain temporary AWS credentials');
        }

        // Generate access token directly from refresh token
        const axios = require('axios');
        const credentials = require('../Sp_API/config.js');
        
        if (!credentials || !credentials.clientId || !credentials.clientSecret) {
            throw new ApiError(500, 'SP-API credentials not configured');
        }
        
        const clientId = credentials.clientId;
        const clientSecret = credentials.clientSecret;
        
        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            }),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );

        // Check for errors in the response
        if (response.data?.error) {
            const errorMsg = response.data.error_description || response.data.error;
            logger.error(`Token refresh failed: ${errorMsg}`, {
                error: response.data.error,
                errorDescription: response.data.error_description
            });
            throw new ApiError(
                response.status || 401,
                `Failed to refresh access token: ${errorMsg}`
            );
        }

        if (!response || !response.data || !response.data.access_token) {
            logger.error('Invalid token response structure', {
                hasResponse: !!response,
                hasData: !!response?.data,
                hasAccessToken: !!response?.data?.access_token
            });
            throw new ApiError(500, 'Failed to obtain access token from refresh token - invalid response structure');
        }

        const accessToken = response.data.access_token;
        
        // Log token info (without exposing the actual token)
        logger.info('Successfully generated access token from refresh token', {
            region,
            tokenLength: accessToken.length,
            tokenType: response.data.token_type,
            expiresIn: response.data.expires_in,
            scope: response.data.scope || 'not provided'
        });

        // Note: If scope is not provided in the response, it means the token inherits
        // the scopes from the original authorization. The refresh token must have been
        // created with Data Kiosk API permissions for this to work.

        return {
            accessToken: accessToken,
            accessKey: tempCredentials.AccessKey,
            secretKey: tempCredentials.SecretKey,
            sessionToken: tempCredentials.SessionToken
        };
    } catch (error) {
        logger.error(`Error getting credentials from refresh token:`, error);
        if (error.response?.data) {
            throw new ApiError(
                error.response.status || 500,
                error.response.data.error_description || error.response.data.error || 'Failed to obtain access token'
            );
        }
        throw error;
    }
}

/**
 * Get base URL for Data Kiosk API based on region
 * @param {string} region - Region (NA, EU, FE)
 * @returns {string} Base URL
 */
function getBaseUrl(region) {
    const baseUrls = {
        'NA': 'https://sellingpartnerapi-na.amazon.com',
        'EU': 'https://sellingpartnerapi-eu.amazon.com',
        'FE': 'https://sellingpartnerapi-fe.amazon.com'
    };
    return baseUrls[region] || baseUrls['NA'];
}

/**
 * Make authenticated API request to Data Kiosk API with AWS Signature V4
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} path - API path
 * @param {string} method - HTTP method
 * @param {Object} body - Request body (optional)
 * @returns {Promise<Object>} API response
 */
async function makeApiRequest(userId, region, path, method = 'GET', body = null) {
    try {
        const credentials = await getUserCredentials(userId, region);
        const baseUrl = getBaseUrl(region);
        const host = baseUrl.replace('https://', '');

        // Construct request object for AWS signing
        const request = {
            host: host,
            path: path,
            method: method,
            headers: {
                'host': host,
                'user-agent': 'IBEX/1.0',
                'content-type': 'application/json',
                'x-amz-access-token': credentials.accessToken
            },
            ...(body && { body: JSON.stringify(body) })
        };

        // Sign the request with AWS Signature V4
        aws4.sign(request, {
            accessKeyId: credentials.accessKey,
            secretAccessKey: credentials.secretKey,
            sessionToken: credentials.sessionToken
        });

        // Make the request
        const url = `https://${request.host}${request.path}`;
        const response = await axios({
            method: request.method,
            url: url,
            headers: request.headers,
            ...(body && { data: body })
        });

        return response.data;
    } catch (error) {
        logger.error(`Data Kiosk API request failed:`, {
            userId,
            region,
            path,
            error: error.response?.data || error.message
        });
        throw new ApiError(
            error.response?.status || 500,
            error.response?.data?.message || error.message || 'Data Kiosk API request failed'
        );
    }
}

/**
 * Make authenticated API request using refresh token directly
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region
 * @param {string} path - API path
 * @param {string} method - HTTP method
 * @param {Object} body - Request body (optional)
 * @returns {Promise<Object>} API response
 */
async function makeApiRequestWithRefreshToken(refreshToken, region, path, method = 'GET', body = null) {
    try {
        logger.info(`Making API request with refresh token`, { region, path, method });
        
        const credentials = await getCredentialsFromRefreshToken(refreshToken, region);
        const baseUrl = getBaseUrl(region);
        const host = baseUrl.replace('https://', '');

        logger.info(`Credentials obtained, signing request`, { 
            region, 
            host,
            hasAccessToken: !!credentials.accessToken,
            hasAccessKey: !!credentials.accessKey
        });

        // Construct request object for AWS signing
        const request = {
            host: host,
            path: path,
            method: method,
            headers: {
                'host': host,
                'user-agent': 'IBEX/1.0',
                'content-type': 'application/json',
                'x-amz-access-token': credentials.accessToken
            },
            ...(body && { body: JSON.stringify(body) })
        };

        // Sign the request with AWS Signature V4
        aws4.sign(request, {
            accessKeyId: credentials.accessKey,
            secretAccessKey: credentials.secretKey,
            sessionToken: credentials.sessionToken
        });

        logger.info(`Request signed, making API call`, { 
            url: `https://${request.host}${request.path}`,
            method: request.method,
            hasAuthHeader: !!request.headers['x-amz-access-token'],
            hasAuthorization: !!request.headers['Authorization']
        });

        // Make the request
        const url = `https://${request.host}${request.path}`;
        
        // Log request details (without sensitive data)
        logger.info(`Making Data Kiosk API request`, {
            region,
            path,
            method,
            host: request.host,
            hasAccessToken: !!credentials.accessToken,
            accessTokenLength: credentials.accessToken?.length,
            hasAccessKey: !!credentials.accessKey,
            hasSessionToken: !!credentials.sessionToken
        });
        
        const response = await axios({
            method: request.method,
            url: url,
            headers: request.headers,
            ...(body && { data: body })
        });

        logger.info(`API request successful`, { region, path, status: response.status });
        
        // Log raw response structure for debugging (especially for FE region)
        if (region === 'FE' && path.includes('/queries/')) {
            console.log('=== FE Region Raw Response Debug ===');
            console.log('Full axios response:', JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data
            }, null, 2));
            console.log('Response data type:', typeof response.data);
            console.log('Response data keys:', response.data ? Object.keys(response.data) : 'null');
            console.log('===================================');
        }
        
        return response.data;
    } catch (error) {
        const errorDetails = {
            region,
            path,
            method,
            status: error.response?.status,
            statusText: error.response?.statusText,
            error: error.response?.data || error.message
        };
        
        // Log more details for unauthorized errors
        if (error.response?.status === 401 || error.response?.status === 403) {
            const errorCode = error.response?.data?.errors?.[0]?.code;
            const errorMessage = error.response?.data?.errors?.[0]?.message;
            
            logger.error(`Data Kiosk API unauthorized/forbidden (refresh token):`, {
                ...errorDetails,
                errorCode,
                errorMessage,
                fullErrorResponse: error.response?.data,
                troubleshooting: {
                    possibleCauses: [
                        'Refresh token may not have Data Kiosk API scopes',
                        'Seller account may not have Data Kiosk API access enabled',
                        'Region (FE) may not match seller account authorization',
                        'Access token may not have required permissions',
                        'AWS credentials may not be configured correctly for FE region'
                    ]
                }
            });
            
            // Provide more helpful error message with troubleshooting steps
            const helpfulMessage = errorMessage || 
                                error.response?.data?.message || 
                                'Access denied. Troubleshooting steps:\n' +
                                '1. Verify the refresh token is valid and has Data Kiosk API scopes\n' +
                                '2. Confirm the seller account has Data Kiosk API access enabled in SP-API application\n' +
                                '3. Ensure the region (FE) matches the seller account\'s authorized regions\n' +
                                '4. Check that AWS credentials are properly configured for the FE region\n' +
                                '5. Verify the SP-API application has the correct permissions';
            
            throw new ApiError(
                error.response.status,
                helpfulMessage
            );
        }
        
        logger.error(`Data Kiosk API request failed (refresh token):`, errorDetails);
        throw new ApiError(
            error.response?.status || 500,
            error.response?.data?.message || error.message || 'Data Kiosk API request failed'
        );
    }
}

/**
 * Extract document ID from query status response
 * Handles different response structures for different regions
 * @param {Object} queryStatus - Query status response
 * @param {string} region - Region (NA, EU, FE)
 * @returns {string|null} Document ID or null if not found
 */
function extractDocumentId(queryStatus, region) {
    if (!queryStatus) return null;
    
    // Based on MCP API documentation and actual responses, reportDocumentId is the primary field
    // Check top-level fields first (reportDocumentId is the standard field name)
    if (queryStatus.reportDocumentId) return queryStatus.reportDocumentId;
    if (queryStatus.documentId) return queryStatus.documentId;
    if (queryStatus.dataDocumentId) return queryStatus.dataDocumentId;
    if (queryStatus.reportId) return queryStatus.reportId;
    
    // Check nested in data object
    if (queryStatus.data) {
        if (queryStatus.data.reportDocumentId) return queryStatus.data.reportDocumentId;
        if (queryStatus.data.documentId) return queryStatus.data.documentId;
        if (queryStatus.data.dataDocumentId) return queryStatus.data.dataDocumentId;
        if (queryStatus.data.reportId) return queryStatus.data.reportId;
    }
    
    // For FE region, also check additional nested structures
    if (region === 'FE') {
        // Check nested in query object
        if (queryStatus.query) {
            if (queryStatus.query.reportDocumentId) return queryStatus.query.reportDocumentId;
            if (queryStatus.query.documentId) return queryStatus.query.documentId;
            if (queryStatus.query.dataDocumentId) return queryStatus.query.dataDocumentId;
        }
        
        // Check nested in result object
        if (queryStatus.result) {
            if (queryStatus.result.reportDocumentId) return queryStatus.result.reportDocumentId;
            if (queryStatus.result.documentId) return queryStatus.result.documentId;
            if (queryStatus.result.dataDocumentId) return queryStatus.result.dataDocumentId;
        }
        
        // Log for debugging if not found
        console.log('=== FE Region: Document ID not found in expected locations ===');
        console.log('Available top-level keys:', Object.keys(queryStatus));
        console.log('Full response structure:', JSON.stringify(queryStatus, null, 2));
        console.log('=============================================================');
    }
    
    return null;
}

/**
 * List all queries with optional filtering
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} List of queries
 */
async function listQueries(userId, region, filters = {}) {
    const { processingStatus, pageSize = 10, createdSince } = filters;
    
    let path = `/dataKiosk/${API_VERSION}/queries?pageSize=${pageSize}`;
    if (processingStatus) {
        path += `&processingStatuses=${processingStatus}`;
    }
    if (createdSince) {
        path += `&createdSince=${createdSince}`;
    }

    return makeApiRequest(userId, region, path, 'GET');
}

/**
 * Create a new GraphQL query
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} graphqlQuery - GraphQL query string
 * @returns {Promise<Object>} Query creation result
 */
async function createQuery(userId, region, graphqlQuery) {
    if (!graphqlQuery || graphqlQuery.trim().length === 0) {
        throw new ApiError(400, 'GraphQL query is required');
    }

    // Check query length (excluding whitespace)
    const queryWithoutWhitespace = graphqlQuery.replace(/\s+/g, '');
    if (queryWithoutWhitespace.length > 8000) {
        throw new ApiError(400, 'GraphQL query exceeds 8000 character limit (excluding whitespace)');
    }

    const body = { query: graphqlQuery };
    const path = `/dataKiosk/${API_VERSION}/queries`;
    
    return makeApiRequest(userId, region, path, 'POST', body);
}

/**
 * Create a new GraphQL query using refresh token
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region
 * @param {string} graphqlQuery - GraphQL query string
 * @returns {Promise<Object>} Query creation result
 */
async function createQueryWithRefreshToken(refreshToken, region, graphqlQuery) {
    if (!graphqlQuery || graphqlQuery.trim().length === 0) {
        throw new ApiError(400, 'GraphQL query is required');
    }

    // Check query length (excluding whitespace)
    const queryWithoutWhitespace = graphqlQuery.replace(/\s+/g, '');
    if (queryWithoutWhitespace.length > 8000) {
        throw new ApiError(400, 'GraphQL query exceeds 8000 character limit (excluding whitespace)');
    }

    const body = { query: graphqlQuery };
    const path = `/dataKiosk/${API_VERSION}/queries`;
    
    return makeApiRequestWithRefreshToken(refreshToken, region, path, 'POST', body);
}

/**
 * Check query status
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} queryId - Query ID
 * @returns {Promise<Object>} Query status
 */
async function checkQueryStatus(userId, region, queryId) {
    if (!queryId) {
        throw new ApiError(400, 'Query ID is required');
    }

    const path = `/dataKiosk/${API_VERSION}/queries/${queryId}`;
    const response = await makeApiRequest(userId, region, path, 'GET');
    
    console.log('=== Status Check Response (checkQueryStatus) ===');
    console.log('Query ID:', queryId);
    console.log('Region:', region);
    console.log('Full Response:', JSON.stringify(response, null, 2));
    console.log('Available fields:', Object.keys(response || {}));
    console.log('Document ID fields check:');
    console.log('  - documentId:', response?.documentId);
    console.log('  - dataDocumentId:', response?.dataDocumentId);
    console.log('  - reportDocumentId:', response?.reportDocumentId);
    console.log('  - reportId:', response?.reportId);
    console.log('  - data.documentId:', response?.data?.documentId);
    console.log('  - data.dataDocumentId:', response?.data?.dataDocumentId);
    console.log('  - data.reportDocumentId:', response?.data?.reportDocumentId);
    console.log('  - data.reportId:', response?.data?.reportId);
    console.log('Processing Status:', response?.processingStatus || response?.status);
    console.log('Report Type:', response?.reportType);
    console.log('===============================================');
    
    return response;
}

/**
 * Check query status using refresh token
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region
 * @param {string} queryId - Query ID
 * @returns {Promise<Object>} Query status
 */
async function checkQueryStatusWithRefreshToken(refreshToken, region, queryId) {
    if (!queryId) {
        throw new ApiError(400, 'Query ID is required');
    }

    const path = `/dataKiosk/${API_VERSION}/queries/${queryId}`;
    const response = await makeApiRequestWithRefreshToken(refreshToken, region, path, 'GET');
    
    console.log('=== Status Check Response (checkQueryStatusWithRefreshToken) ===');
    console.log('Query ID:', queryId);
    console.log('Region:', region);
    console.log('Full Response:', JSON.stringify(response, null, 2));
    console.log('Available fields:', Object.keys(response || {}));
    console.log('Document ID fields check:');
    console.log('  - documentId:', response?.documentId);
    console.log('  - dataDocumentId:', response?.dataDocumentId);
    console.log('  - reportDocumentId:', response?.reportDocumentId);
    console.log('  - reportId:', response?.reportId);
    console.log('  - data.documentId:', response?.data?.documentId);
    console.log('  - data.dataDocumentId:', response?.data?.dataDocumentId);
    console.log('  - data.reportDocumentId:', response?.data?.reportDocumentId);
    console.log('  - data.reportId:', response?.data?.reportId);
    console.log('Processing Status:', response?.processingStatus || response?.status);
    console.log('Report Type:', response?.reportType);
    console.log('===============================================================');
    
    return response;
}

/**
 * Cancel a query
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} queryId - Query ID
 * @returns {Promise<Object>} Cancellation result
 */
async function cancelQuery(userId, region, queryId) {
    if (!queryId) {
        throw new ApiError(400, 'Query ID is required');
    }

    const path = `/dataKiosk/${API_VERSION}/queries/${queryId}`;
    return makeApiRequest(userId, region, path, 'DELETE');
}

/**
 * Get document details
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} documentId - Document ID
 * @returns {Promise<Object>} Document details including download URL
 */
async function getDocumentDetails(userId, region, documentId) {
    if (!documentId) {
        throw new ApiError(400, 'Document ID is required');
    }

    const path = `/dataKiosk/${API_VERSION}/documents/${documentId}`;
    return makeApiRequest(userId, region, path, 'GET');
}

/**
 * Get document details using refresh token
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region
 * @param {string} documentId - Document ID
 * @returns {Promise<Object>} Document details including download URL
 */
async function getDocumentDetailsWithRefreshToken(refreshToken, region, documentId) {
    if (!documentId) {
        throw new ApiError(400, 'Document ID is required');
    }

    const path = `/dataKiosk/${API_VERSION}/documents/${documentId}`;
    return makeApiRequestWithRefreshToken(refreshToken, region, path, 'GET');
}

/**
 * Download document content
 * @param {string} documentUrl - Document download URL
 * @returns {Promise<string>} Document content (JSONL format)
 */
async function downloadDocument(documentUrl) {
    if (!documentUrl) {
        throw new ApiError(400, 'Document URL is required');
    }

    try {
        const response = await axios.get(documentUrl, {
            responseType: 'text',
            timeout: 30000 // 30 second timeout
        });
        return response.data;
    } catch (error) {
        logger.error('Error downloading document:', error);
        throw new ApiError(
            error.response?.status || 500,
            error.response?.data?.message || error.message || 'Failed to download document'
        );
    }
}

/**
 * Wait for query to complete and return document
 * Continues polling until query completes (DONE, FATAL, or CANCELLED)
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} queryId - Query ID
 * @param {number} pollInterval - Polling interval in milliseconds (default: 10 seconds)
 * @returns {Promise<Object>} Document details when query completes
 */
async function waitForQueryCompletion(userId, region, queryId, pollInterval = 10000) {
    const startTime = Date.now();
    let status = null;
    let pollCount = 0;

    logger.info(`Starting to wait for query completion`, {
        userId,
        region,
        queryId,
        pollInterval: `${pollInterval / 1000}s`
    });

    while (true) {
        pollCount++;
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        
        logger.info(`Polling query status (attempt #${pollCount}, elapsed: ${elapsedSeconds}s)`, {
            queryId,
            region,
            elapsedTime: `${elapsedSeconds}s`
        });

        try {
        const queryStatus = await checkQueryStatus(userId, region, queryId);
            // Handle both 'status' and 'processingStatus' field names
            status = queryStatus.status || queryStatus.processingStatus;
            // Extract document ID using region-specific logic
            const documentId = extractDocumentId(queryStatus, region);

            logger.info(`Query status check result`, {
                queryId,
                status,
                hasDocumentId: !!documentId,
                documentId: documentId || 'not available',
                fullStatus: queryStatus
            });

        if (status === 'DONE') {
                logger.info(`Query completed successfully`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount
                });

                if (documentId) {
                    logger.info(`Retrieving document details`, {
                        queryId,
                        documentId: documentId
                    });
                    const documentDetails = await getDocumentDetails(userId, region, documentId);
                    
                    logger.info(`Document details retrieved successfully`, {
                        queryId,
                        documentId: documentId,
                        hasUrl: !!documentDetails.url
                    });
                    
                    return documentDetails;
                } else {
                    // Query completed but no document ID - this can happen when there's no data matching the query
                    logger.warn(`Query completed but no document ID found - likely no data matches query criteria`, {
                        queryId,
                        queryStatus,
                        processingStatus: queryStatus.processingStatus,
                        region
                    });
                    
                    // Return a response indicating no data was found instead of throwing an error
                    return {
                        queryId: queryId,
                        status: 'DONE',
                        processingStatus: 'DONE',
                        hasDocument: false,
                        message: 'Query completed successfully but no data document was generated. This could be due to no data matching your query criteria.',
                        queryStatus: queryStatus
                    };
                }
            } else if (status === 'FATAL') {
                logger.error(`Query failed with FATAL status`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount,
                    queryStatus
                });
                throw new ApiError(500, `Query failed with FATAL status. Query ID: ${queryId}`);
            } else if (status === 'CANCELLED') {
                logger.warn(`Query was cancelled`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount
                });
                throw new ApiError(500, `Query was cancelled. Query ID: ${queryId}`);
            } else {
                // Query is still processing (IN_QUEUE, IN_PROGRESS, etc.)
                logger.info(`Query still processing`, {
                    queryId,
                    status,
                    elapsedTime: `${elapsedSeconds}s`,
                    nextPollIn: `${pollInterval / 1000}s`
                });
            }
        } catch (error) {
            // If it's a fatal/cancelled error, re-throw it
            if (error instanceof ApiError && (error.message.includes('FATAL') || error.message.includes('CANCELLED'))) {
                throw error;
            }
            
            // Log other errors but continue polling
            logger.error(`Error checking query status (will retry)`, {
                queryId,
                error: error.message,
                elapsedTime: `${elapsedSeconds}s`,
                pollCount
            });
        }

        // Wait before next poll
        logger.debug(`Waiting ${pollInterval / 1000}s before next poll`, { queryId });
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
}

/**
 * Wait for query to complete and return document using refresh token
 * Continues polling until query completes (DONE, FATAL, or CANCELLED)
 * @param {string} refreshToken - Refresh token
 * @param {string} region - Region
 * @param {string} queryId - Query ID
 * @param {number} pollInterval - Polling interval in milliseconds (default: 10 seconds)
 * @returns {Promise<Object>} Document details when query completes
 */
async function waitForQueryCompletionWithRefreshToken(refreshToken, region, queryId, pollInterval = 10000) {
    const startTime = Date.now();
    let status = null;
    let pollCount = 0;

    logger.info(`Starting to wait for query completion (refresh token)`, {
        region,
        queryId,
        pollInterval: `${pollInterval / 1000}s`
    });

    while (true) {
        pollCount++;
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        
        logger.info(`Polling query status (attempt #${pollCount}, elapsed: ${elapsedSeconds}s)`, {
            queryId,
            region,
            elapsedTime: `${elapsedSeconds}s`
        });

        try {
            const queryStatus = await checkQueryStatusWithRefreshToken(refreshToken, region, queryId);
            // Handle both 'status' and 'processingStatus' field names
            status = queryStatus.status || queryStatus.processingStatus;
            // Extract document ID using region-specific logic
            const documentId = extractDocumentId(queryStatus, region);

            logger.info(`Query status check result`, {
                queryId,
                status,
                hasDocumentId: !!documentId,
                documentId: documentId || 'not available',
                fullStatus: queryStatus
            });

            if (status === 'DONE') {
                logger.info(`Query completed successfully`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount
                });

                if (documentId) {
                    logger.info(`Retrieving document details`, {
                        queryId,
                        documentId: documentId
                    });
                    const documentDetails = await getDocumentDetailsWithRefreshToken(refreshToken, region, documentId);
                    
                    logger.info(`Document details retrieved successfully`, {
                        queryId,
                        documentId: documentId,
                        hasUrl: !!documentDetails.url,
                        urlExpiresAt: documentDetails.expiration || 'not provided'
                    });
                    
                    return documentDetails;
                } else {
                    // Query completed but no document ID - this can happen when there's no data matching the query
                    logger.warn(`Query completed but no document ID found - likely no data matches query criteria`, {
                        queryId,
                        queryStatus,
                        processingStatus: queryStatus.processingStatus,
                        region
                    });
                    
                    // Return a response indicating no data was found instead of throwing an error
                    return {
                        queryId: queryId,
                        status: 'DONE',
                        processingStatus: 'DONE',
                        hasDocument: false,
                        message: 'Query completed successfully but no data document was generated. This could be due to no data matching your query criteria.',
                        queryStatus: queryStatus
                    };
                }
            } else if (status === 'FATAL') {
                logger.error(`Query failed with FATAL status`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount,
                    queryStatus
                });
                throw new ApiError(500, `Query failed with FATAL status. Query ID: ${queryId}`);
            } else if (status === 'CANCELLED') {
                logger.warn(`Query was cancelled`, {
                    queryId,
                    elapsedTime: `${elapsedSeconds}s`,
                    totalPolls: pollCount
                });
                throw new ApiError(500, `Query was cancelled. Query ID: ${queryId}`);
            } else {
                // Query is still processing (IN_QUEUE, IN_PROGRESS, etc.)
                logger.info(`Query still processing`, {
                    queryId,
                    status,
                    elapsedTime: `${elapsedSeconds}s`,
                    nextPollIn: `${pollInterval / 1000}s`
                });
            }
        } catch (error) {
            // If it's a fatal/cancelled error, re-throw it
            if (error instanceof ApiError && (error.message.includes('FATAL') || error.message.includes('CANCELLED'))) {
                throw error;
            }
            
            // Log other errors but continue polling
            logger.error(`Error checking query status (will retry)`, {
                queryId,
                error: error.message,
                errorStack: error.stack,
                elapsedTime: `${elapsedSeconds}s`,
                pollCount
            });
        }

        // Wait before next poll
        logger.debug(`Waiting ${pollInterval / 1000}s before next poll`, { queryId });
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
}

module.exports = {
    listQueries,
    createQuery,
    createQueryWithRefreshToken,
    checkQueryStatus,
    checkQueryStatusWithRefreshToken,
    cancelQuery,
    getDocumentDetails,
    getDocumentDetailsWithRefreshToken,
    downloadDocument,
    waitForQueryCompletion,
    waitForQueryCompletionWithRefreshToken,
    makeApiRequest,
    makeApiRequestWithRefreshToken,
    getCredentialsFromRefreshToken
};

