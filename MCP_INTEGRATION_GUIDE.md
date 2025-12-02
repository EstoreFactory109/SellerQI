# MCP Integration Guide

This guide explains how the MCP (Model Context Protocol) functionality has been integrated with the Express server.

## Overview

The MCP core files have been integrated into the server as a service layer that provides access to Amazon Data Kiosk API functionality. Instead of running the MCP server as a separate process (which is designed for MCP clients like Claude Desktop), we've created a service wrapper that exposes the same functionality through REST API endpoints.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Express Server                       │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                │
│  │   Routes     │───▶│ Controllers  │                │
│  │  /app/mcp/*  │    │ DataKiosk   │                │
│  └──────────────┘    │ Controller   │                │
│                       └──────┬───────┘                │
│                              │                        │
│                       ┌──────▼───────┐                │
│                       │   Services   │                │
│                       │              │                │
│                       │ DataKiosk   │                │
│                       │ Service     │                │
│                       │              │                │
│                       │ QueryBuilder│                │
│                       │ Service     │                │
│                       └──────┬───────┘                │
│                              │                        │
└──────────────────────────────┼────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Amazon Data Kiosk   │
                    │       API            │
                    └──────────────────────┘
```

## File Structure

```
server/
├── Services/
│   └── MCP/
│       ├── DataKioskService.js      # Core API service
│       ├── QueryBuilderService.js   # GraphQL query builders
│       └── constants.js             # Constants and mappings
├── controllers/
│   └── mcp/
│       └── DataKioskController.js  # Request handlers
└── routes/
    └── mcp.routes.js                 # Route definitions
```

## API Endpoints

All endpoints are prefixed with `/app/mcp` and require authentication.

### Query Management

#### List Queries
```
GET /app/mcp/queries
Query Parameters:
  - processingStatus (optional): PROCESSING, SUCCEEDED, FAILED
  - pageSize (optional): 1-100, default 10
  - createdSince (optional): ISO date format
```

#### Create Query
```
POST /app/mcp/queries
Body:
{
  "graphqlQuery": "query { ... }"
}
```

#### Check Query Status
```
GET /app/mcp/queries/:queryId/status
```

#### Cancel Query
```
DELETE /app/mcp/queries/:queryId
```

#### Wait for Query Completion
```
POST /app/mcp/queries/:queryId/wait
Body (optional):
{
  "maxWaitTime": 300000,  // milliseconds, default 5 minutes
  "pollInterval": 10000    // milliseconds, default 10 seconds
}
```

### Document Management

#### Get Document Details
```
GET /app/mcp/documents/:documentId
```

#### Download Document
```
GET /app/mcp/documents/:documentId/download
Returns: JSONL format (application/x-ndjson)
```

### Pre-built Query Endpoints

#### Sales and Traffic by Date
```
POST /app/mcp/queries/sales-traffic/date
Body:
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "granularity": "DAY",  // DAY, WEEK, or MONTH
  "marketplace": "US",
  "includeB2B": false    // optional
}
```

#### Sales and Traffic by ASIN
```
POST /app/mcp/queries/sales-traffic/asin
Body:
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "granularity": "PARENT",  // PARENT, CHILD, or SKU
  "marketplace": "US",
  "includeB2B": false
}
```

#### Economics Query
```
POST /app/mcp/queries/economics
Body:
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dateGranularity": "DAY",      // DAY, WEEK, MONTH, or RANGE
  "productIdGranularity": "PARENT_ASIN",  // PARENT_ASIN, CHILD_ASIN, FNSKU, or MSKU
  "marketplace": "US",
  "includeFeeComponents": false,
  "feeTypesForComponents": []    // optional array of fee types
}
```

## Authentication

All endpoints use the existing authentication middleware:
- `auth` middleware: Validates JWT token and sets `req.userId`
- `getLocation` middleware: Extracts region and country from request

The service automatically retrieves the user's Amazon credentials from the database using the `userId` and `region`.

## Usage Examples

### Example 1: Create and Wait for Sales Query

```javascript
// 1. Create a sales query
const createResponse = await fetch('/app/mcp/queries/sales-traffic/date', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token>'
  },
  body: JSON.stringify({
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    granularity: 'DAY',
    marketplace: 'US'
  })
});

const { data: { queryId } } = await createResponse.json();

// 2. Wait for query to complete
const waitResponse = await fetch(`/app/mcp/queries/${queryId}/wait`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>'
  },
  body: JSON.stringify({
    maxWaitTime: 300000,  // 5 minutes
    pollInterval: 10000   // 10 seconds
  })
});

const { data: { url } } = await waitResponse.json();

// 3. Download the document
const downloadResponse = await fetch(`/app/mcp/documents/${documentId}/download`, {
  headers: {
    'Authorization': 'Bearer <token>'
  }
});

const jsonlData = await downloadResponse.text();
// Process JSONL data (one JSON object per line)
```

### Example 2: Check Query Status Manually

```javascript
// Check status
const statusResponse = await fetch(`/app/mcp/queries/${queryId}/status`, {
  headers: {
    'Authorization': 'Bearer <token>'
  }
});

const { data } = await statusResponse.json();
console.log('Status:', data.status);  // IN_QUEUE, IN_PROGRESS, DONE, FATAL, CANCELLED

if (data.status === 'DONE' && data.documentId) {
  // Get document details
  const docResponse = await fetch(`/app/mcp/documents/${data.documentId}`, {
    headers: {
      'Authorization': 'Bearer <token>'
    }
  });
  const docData = await docResponse.json();
  console.log('Download URL:', docData.data.url);
}
```

### Example 3: List All Queries

```javascript
const response = await fetch('/app/mcp/queries?processingStatus=SUCCEEDED&pageSize=20', {
  headers: {
    'Authorization': 'Bearer <token>'
  }
});

const { data } = await response.json();
console.log('Queries:', data.queries);
```

## Integration with Existing Services

The MCP service integrates with existing services:

1. **Token Generation**: Uses `generateAccessToken` from `Services/Sp_API/GenerateTokens.js`
2. **Database**: Retrieves seller credentials from `Seller` model
3. **Authentication**: Uses existing auth middleware
4. **Error Handling**: Uses existing `ApiError` and `ApiResponse` utilities

## Environment Variables

No additional environment variables are required. The service uses:
- Existing database connection for seller credentials
- Existing token generation service
- Region-based base URLs (configured in the service)

## Error Handling

All endpoints return standardized error responses:

```json
{
  "statusCode": 400,
  "message": "Error message",
  "success": false
}
```

Common error scenarios:
- **400**: Invalid request parameters
- **404**: Query or document not found
- **408**: Query timeout
- **500**: Internal server error or API failure

## Query Status Values

- `IN_QUEUE`: Query is waiting to be processed
- `IN_PROGRESS`: Query is currently being processed
- `DONE`: Query completed successfully
- `FATAL`: Query failed with errors
- `CANCELLED`: Query was cancelled

## Limitations

1. **Query Length**: GraphQL queries are limited to 8,000 characters (excluding whitespace)
2. **Download URL Expiry**: Document download URLs expire after 5 minutes
3. **Query Timeout**: Default wait time is 5 minutes (configurable)
4. **Rate Limits**: Subject to Amazon API rate limits

## Testing

### Using cURL

```bash
# List queries
curl -X GET "http://localhost:3000/app/mcp/queries" \
  -H "Authorization: Bearer <token>"

# Create sales query
curl -X POST "http://localhost:3000/app/mcp/queries/sales-traffic/date" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-01-01",
    "endDate": "2024-01-31",
    "granularity": "DAY",
    "marketplace": "US"
  }'
```

### Using Postman

1. Set up authentication header: `Authorization: Bearer <token>`
2. Use the endpoints listed above
3. Check response status and data

## Next Steps

1. **Add to Background Jobs**: Consider integrating Data Kiosk queries into the background job system for automated data fetching
2. **Caching**: Add caching layer for frequently accessed queries
3. **Data Processing**: Create services to parse and store JSONL data in database
4. **Monitoring**: Add logging and monitoring for query performance
5. **Rate Limiting**: Implement rate limiting to prevent API abuse

## Troubleshooting

### Query Not Completing
- Check query status manually
- Verify date ranges are valid (not more than 2 years old)
- Check Amazon API status
- Review server logs for errors

### Authentication Errors
- Verify seller credentials in database
- Check token generation service
- Ensure refresh token is valid

### Document Download Fails
- Download URLs expire after 5 minutes - get fresh URL
- Check network connectivity
- Verify document ID is correct

## Support

For issues or questions:
1. Check server logs: `server/logs.txt`
2. Review Amazon Data Kiosk API documentation
3. Check MCP package documentation in `MCP/README.md`

