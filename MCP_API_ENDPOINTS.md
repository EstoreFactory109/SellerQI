# MCP API Endpoints Reference

This document lists all API endpoints that should be called via MCP (Model Context Protocol) to retrieve Amazon seller analytics data.

## Amazon Data Kiosk API Endpoints (via MCP)

The MCP functions wrap the Amazon Data Kiosk API, which uses GraphQL queries. The underlying HTTP endpoints are:

### 1. Query Management Endpoints

#### Create Query
- **MCP Function**: `mcp_amazon-seller-analytics_create-query`
- **HTTP Endpoint**: `POST https://{region}-data-kiosk-api.amazon.com/queries`
- **Purpose**: Create a new GraphQL query to retrieve data
- **Parameters**: 
  - `graphqlQuery` (string, max 8000 chars)

#### List Queries
- **MCP Function**: `mcp_amazon-seller-analytics_list-queries`
- **HTTP Endpoint**: `GET https://{region}-data-kiosk-api.amazon.com/queries`
- **Purpose**: List all queries with optional filtering
- **Query Parameters**:
  - `processingStatus` (optional): PROCESSING, SUCCEEDED, FAILED
  - `createdSince` (optional): ISO date format
  - `pageSize` (optional): 1-100, default 10

#### Check Query Status
- **MCP Function**: `mcp_amazon-seller-analytics_check-query-status`
- **HTTP Endpoint**: `GET https://{region}-data-kiosk-api.amazon.com/queries/{queryId}`
- **Purpose**: Check the processing status of a query
- **Status Values**: IN_QUEUE, IN_PROGRESS, DONE, FATAL, CANCELLED

#### Cancel Query
- **MCP Function**: `mcp_amazon-seller-analytics_cancel-query`
- **HTTP Endpoint**: `DELETE https://{region}-data-kiosk-api.amazon.com/queries/{queryId}`
- **Purpose**: Cancel a running query

### 2. Document Management Endpoints

#### Get Document Details
- **MCP Function**: `mcp_amazon-seller-analytics_get-document-details`
- **HTTP Endpoint**: `GET https://{region}-data-kiosk-api.amazon.com/documents/{documentId}`
- **Purpose**: Get document details including download URL
- **Note**: Download URLs expire after 5 minutes

#### Download Document
- **MCP Function**: `mcp_amazon-seller-analytics_download-document`
- **HTTP Endpoint**: `GET {documentUrl}` (from document details)
- **Purpose**: Download the actual data document
- **Format**: JSONL (JSON Lines format)

### 3. Available Datasets (GraphQL Queries)

#### Sales and Traffic Data
- **Dataset**: `analytics_salesAndTraffic_2024_04_24`
- **MCP Helper**: `mcp_amazon-seller-analytics_build-sales-and-traffic-query`
- **MCP Explorer**: `mcp_amazon-seller-analytics_explore-sales-and-traffic-schema`
- **MCP Examples**: `mcp_amazon-seller-analytics_get-sales-and-traffic-example`
- **Data Types**:
  - Sales by Date
  - Sales by ASIN
  - Traffic and Conversion metrics
  - Business Analytics

#### Seller Economics Data
- **Dataset**: `analytics_economics_2024_03_15`
- **MCP Helper**: `mcp_amazon-seller-analytics_build-economics-query`
- **MCP Preview Helper**: `mcp_amazon-seller-analytics_build-economics-preview-query`
- **MCP Explorer**: `mcp_amazon-seller-analytics_explore-economics-schema`
- **MCP Examples**: `mcp_amazon-seller-analytics_get-economics-example`
- **Data Types**:
  - Profitability Analysis
  - Fee Breakdown
  - Fee Change Impact
  - Cost Analysis
  - Future Impact Preview

#### Cross-Domain Vendor Analytics
- **Dataset**: `analytics_vendorAnalytics_2024_09_30`
- **Note**: Requires vendor account access

## Amazon Selling Partner API Endpoints (Current Implementation)

These are the endpoints currently used in the codebase (not via MCP, but may be migrated):

### Reports API
- **Base URL**: `https://{region}.sellingpartnerapi.amazon.com`
- **Create Report**: `POST /reports/2021-06-30/reports`
- **Get Report Status**: `GET /reports/2021-06-30/reports/{reportId}`
- **Get Report Document**: `GET /reports/2021-06-30/documents/{documentId}`

### Sales API
- **Order Metrics**: `GET /sales/v1/orderMetrics?marketplaceIds={ids}&interval={start}--{end}&granularity={granularity}`
- **Used in**: `server/Services/Sp_API/WeeklySales.js`

### Finance API
- **Financial Transactions**: `GET /finances/2024-06-19/transactions?postedAfter={date}&postedBefore={date}&marketplaceId={id}`
- **Used in**: `server/Services/Sp_API/Finance.js`

### Products API
- **Competitive Pricing**: `GET /products/pricing/v0/competitivePrice?MarketplaceId={id}&Asins={asins}&ItemType=Asin`
- **Used in**: `server/Services/Sp_API/CompetitivePrices.js`

### Amazon Advertising API
- **Base URLs**:
  - NA: `https://advertising-api.amazon.com`
  - EU: `https://advertising-api-eu.amazon.com`
  - FE: `https://advertising-api-fe.amazon.com`
- **Endpoints**:
  - Profiles: `GET /v2/profiles`
  - Keywords: `GET /v2/keywords`
  - Negative Keywords: `GET /v2/negativeKeywords`
  - Campaigns: `GET /v2/campaigns`
  - Ad Groups: `GET /v2/adGroups`
  - Reports: `POST /v2/reports` (various report types)

### Authentication Endpoints
- **Token Endpoint**: `POST https://api.amazon.com/auth/o2/token`
- **Used for**: OAuth token generation and refresh

## Region-Specific Base URLs

### Selling Partner API
- **NA (North America)**: `sellingpartnerapi-na.amazon.com`
- **EU (Europe)**: `sellingpartnerapi-eu.amazon.com`
- **FE (Far East)**: `sellingpartnerapi-fe.amazon.com`

### Data Kiosk API (Inferred)
- **NA**: `na-data-kiosk-api.amazon.com` (or similar)
- **EU**: `eu-data-kiosk-api.amazon.com` (or similar)
- **FE**: `fe-data-kiosk-api.amazon.com` (or similar)

## Report Types Used in Current Implementation

1. **GET_V1_SELLER_PERFORMANCE_REPORT** - Seller performance metrics (V1)
2. **GET_V2_SELLER_PERFORMANCE_REPORT** - Seller performance metrics (V2)
3. **GET_MERCHANT_LISTINGS_ALL_DATA** - All merchant listings
4. **GET_FBA_INVENTORY_PLANNING_DATA** - FBA inventory planning
5. **GET_STRANDED_INVENTORY_UI_DATA** - Stranded inventory data
6. **GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA** - Inbound non-compliance
7. **GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT** - Restock recommendations
8. **GET_LEDGER_SUMMARY_VIEW_DATA** - Ledger summary

## MCP Helper Functions Summary

### Query Building Helpers
- `build-sales-and-traffic-query` - Build GraphQL query for sales/traffic data
- `build-economics-query` - Build GraphQL query for economics data
- `build-economics-preview-query` - Build preview query for future fee impacts

### Schema Exploration
- `explore-sales-and-traffic-schema` - Explore sales/traffic schema structure
- `explore-economics-schema` - Explore economics schema structure

### Example Queries
- `get-sales-and-traffic-example` - Get example queries for sales/traffic
- `get-economics-example` - Get example queries for economics

### API Help
- `get-api-help` - Get help documentation for topics:
  - `overview` - General API overview
  - `authentication` - Authentication details
  - `queries` - Query management
  - `documents` - Document handling
  - `graphql` - GraphQL syntax
  - `troubleshooting` - Common issues

## Workflow for Using MCP Endpoints

1. **Build Query**: Use helper functions to build GraphQL query
2. **Create Query**: Submit query via `create-query` endpoint
3. **Monitor Status**: Poll `check-query-status` until DONE
4. **Get Document**: Retrieve document details via `get-document-details`
5. **Download Data**: Download document using provided URL
6. **Process Data**: Parse JSONL format and process data

## Important Notes

- **Query Length Limit**: 8,000 characters (excluding whitespace)
- **Download URL Expiry**: 5 minutes after retrieval
- **Document Format**: JSONL (JSON Lines) - one JSON object per line
- **Authentication**: Requires AWS Signature V4 signing
- **Rate Limits**: Varies by account tier and endpoint
- **Data Retention**: Documents are automatically deleted after retention period

