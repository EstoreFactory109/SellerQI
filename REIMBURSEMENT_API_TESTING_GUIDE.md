# Reimbursement API Testing Guide

This guide explains how to test all reimbursement APIs together using Postman.

## Overview

The reimbursement API testing is organized into two main test suites:

1. **API Tests** - Calls all APIs and stores data in the database
2. **Fetch All Data** - Retrieves all data from database for frontend

## Prerequisites

1. **Postman** installed on your machine
2. **Server running** on `http://localhost:3000` (or update baseUrl in collection)
3. **Valid authentication token** (JWT token from login)
4. **User ID, Country, and Region** for testing

## Setup

### 1. Import Postman Collection

1. Open Postman
2. Click **Import** button
3. Select the file: `REIMBURSEMENT_POSTMAN_COLLECTION.json`
4. The collection will be imported with all endpoints

### 2. Configure Environment Variables

Set the following variables in Postman (Collection Variables or Environment):

- `baseUrl`: `http://localhost:3000` (or your server URL)
- `authToken`: Your JWT authentication token
- `userId`: Your user ID for testing
- `country`: Country code (e.g., `US`, `UK`, `DE`)
- `region`: Region code (`NA`, `EU`, `FE`)
- `asin`: Product ASIN for testing (optional)

### 3. Get Authentication Token

If you don't have a token, login first:

```
POST {{baseUrl}}/app/auth/login
Body: {
    "email": "your-email@example.com",
    "password": "your-password"
}
```

Copy the token from response and set it in `authToken` variable.

## Test Suite 1: API Tests - Store Data in Database

This suite tests all reimbursement APIs and stores data in the database.

### Execution Order

**IMPORTANT**: Run these requests in the following order:

1. **1.1 Fetch Reimbursement Data (Store in DB)**
   - This is the **FIRST** request you must run
   - Fetches data from Amazon SP-API and stores in database
   - Takes time (may take 1-5 minutes depending on data volume)
   - **Wait for this to complete** before running other requests

2. **1.2 Get Reimbursement Summary**
   - Gets summary statistics (total received, pending, potential)

3. **1.3 Get All Reimbursements**
   - Gets all reimbursements with optional filters

4. **1.4 Get Potential Claims**
   - Gets potential claims not yet filed

5. **1.5 Get Urgent Claims**
   - Gets claims expiring within 7 days

6. **1.6 Get Stats By Type**
   - Gets statistics grouped by reimbursement type

7. **1.7 Get Timeline Data**
   - Gets timeline data for charts (last 30 days)

8. **1.8 Get Reimbursements By Product (ASIN)**
   - Gets reimbursements for a specific product
   - Requires `asin` variable to be set

9. **1.9 Update Product Costs**
   - Updates COGS values for products
   - Used for cost-based calculations

### Running the Suite

#### Option 1: Run Individual Requests

1. Open the collection folder: **"1. API Tests - Store Data in Database"**
2. Run requests one by one in the order listed above
3. Check responses and test results

#### Option 2: Run Collection (Automated)

1. Right-click on the folder: **"1. API Tests - Store Data in Database"**
2. Select **"Run folder"**
3. Postman will run all requests in sequence
4. Review the test results summary

### Expected Results

- All requests should return `200` status code
- Test scripts will automatically validate responses
- Data should be stored in database after step 1.1
- Subsequent requests should return data from database

## Test Suite 2: Fetch All Data - For Frontend

This suite provides a single endpoint that fetches all reimbursement data for frontend consumption.

### Endpoint

**2.1 Get All Reimbursement Data (Complete)**

- **Method**: GET
- **URL**: `{{baseUrl}}/app/test/getAllReimbursementData`
- **Query Parameters**:
  - `userId`: User ID
  - `country`: Country code
  - `region`: Region code

### Response Structure

```json
{
  "success": true,
  "message": "All reimbursement data retrieved successfully",
  "data": {
    "summary": {
      "totalReceived": 0,
      "totalPending": 0,
      "totalPotential": 0,
      "reimbursementCount": 0
    },
    "allReimbursements": {
      "data": [],
      "count": 0
    },
    "potentialClaims": {
      "data": [],
      "count": 0
    },
    "urgentClaims": {
      "data": [],
      "count": 0
    },
    "statsByType": {
      "byType": {},
      "countByType": {},
      "total": 0
    },
    "timeline": {
      "data": [],
      "days": 30,
      "count": 0
    },
    "metadata": {
      "userId": "...",
      "country": "...",
      "region": "...",
      "fetchedAt": "...",
      "hasData": true
    }
  }
}
```

### Usage

This endpoint is perfect for:
- Frontend dashboard initialization
- Single API call to get all data
- Testing complete data flow
- Performance testing

## Test Suite 3: Test Setup Helper

### Endpoint

**3.1 Test All APIs Setup**

- **Method**: POST
- **URL**: `{{baseUrl}}/app/test/testAllReimbursementAPIs`
- **Body**:
```json
{
  "userId": "your-user-id",
  "country": "US",
  "region": "NA"
}
```

This endpoint provides a test plan showing what APIs will be tested. Useful for understanding the test structure.

## Common Issues and Solutions

### Issue: 401 Unauthorized

**Solution**: 
- Check if `authToken` is set correctly
- Token may have expired - login again to get new token
- Ensure token is in format: `Bearer <token>`

### Issue: 400 Bad Request - Missing parameters

**Solution**:
- Ensure `userId`, `country`, and `region` are set in variables
- Check request body/query parameters

### Issue: 404 Not Found

**Solution**:
- Verify `baseUrl` is correct
- Check if server is running
- Ensure routes are properly registered

### Issue: No data returned

**Solution**:
- Make sure you ran **1.1 Fetch Reimbursement Data** first
- Check if user has seller account connected
- Verify country/region match seller account configuration
- Check server logs for errors

### Issue: Timeout on Fetch Data

**Solution**:
- This is normal - fetching from Amazon SP-API can take time
- Increase Postman timeout settings
- Check server logs for progress
- May need to wait 2-5 minutes for large datasets

## Testing Workflow

### Complete Test Workflow

1. **Setup**
   - Import collection
   - Set environment variables
   - Get authentication token

2. **Fetch Data**
   - Run **1.1 Fetch Reimbursement Data**
   - Wait for completion (1-5 minutes)
   - Verify data was stored

3. **Test Individual APIs**
   - Run requests 1.2 through 1.9
   - Verify each response
   - Check test results

4. **Test Frontend Endpoint**
   - Run **2.1 Get All Reimbursement Data**
   - Verify complete data structure
   - Check all nested data

5. **Verify Database**
   - Check MongoDB for stored data
   - Verify ReimbursementModel documents
   - Check data integrity

## Database Verification

After running tests, verify data in MongoDB:

```javascript
// Connect to MongoDB
use your-database-name

// Check reimbursement records
db.reimbursements.find({ User: ObjectId("your-user-id") })

// Check latest record
db.reimbursements.find({ User: ObjectId("your-user-id") }).sort({ createdAt: -1 }).limit(1)
```

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/app/reimbursements/fetch` | POST | Fetch and store data from Amazon SP-API |
| `/app/reimbursements/summary` | GET | Get summary statistics |
| `/app/reimbursements` | GET | Get all reimbursements (with filters) |
| `/app/reimbursements/potential` | GET | Get potential claims |
| `/app/reimbursements/urgent` | GET | Get urgent claims (expiring soon) |
| `/app/reimbursements/stats/by-type` | GET | Get statistics by type |
| `/app/reimbursements/timeline` | GET | Get timeline data for charts |
| `/app/reimbursements/product/:asin` | GET | Get reimbursements by product |
| `/app/reimbursements/update-costs` | POST | Update product costs |
| `/app/test/getAllReimbursementData` | GET | Get all data for frontend |

## Notes

- All endpoints require authentication (except test endpoints)
- Country and region must match seller account configuration
- Some endpoints may take time due to Amazon SP-API rate limits
- Test scripts are included in each request for automatic validation
- Use Postman's collection runner for automated testing

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure database connection is active
4. Check Amazon SP-API credentials and permissions

