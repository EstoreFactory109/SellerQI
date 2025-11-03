# Reimbursement API - Postman Testing Guide

## 🔐 Authentication Requirements

The reimbursement endpoints require **two cookies** to be set:

1. **IBEXAccessToken** - User authentication token (JWT)
2. **IBEXLocationToken** - Location token containing country and region

## 📋 Setup Instructions

### Step 1: Get Your Authentication Tokens

You need to authenticate through the login endpoint first to get the cookies:

**Login Request:**
```
POST http://localhost:5000/app/user/login
Content-Type: application/json

{
  "email": "your-email@example.com",
  "password": "your-password"
}
```

After successful login, Postman will automatically capture the cookies, or you can:
1. Go to the **Cookies** tab in Postman
2. Find your domain (e.g., `localhost`)
3. Copy the values of `IBEXAccessToken` and `IBEXLocationToken`

### Step 2: Configure Postman Environment Variables

Create a Postman Environment with these variables:

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `base_url` | `http://localhost:5000` | Your server base URL |
| `ibex_access_token` | `your-access-token-here` | From login response cookies |
| `ibex_location_token` | `your-location-token-here` | From login response cookies |

## 🚀 Testing Endpoints

### Base URL Pattern
All reimbursement endpoints follow this pattern:
```
{{base_url}}/app/reimbursements/{endpoint}
```

---

### 1. Get Reimbursement Summary
**Purpose:** Get dashboard summary with totals and statistics

**Request:**
```
GET {{base_url}}/app/reimbursements/summary
```

**Headers:**
```
Cookie: IBEXAccessToken={{ibex_access_token}}; IBEXLocationToken={{ibex_location_token}}
```

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "totalReceived": 1250.50,
    "totalPending": 340.25,
    "totalPotential": 890.75,
    "totalDenied": 120.00,
    "last7Days": 250.00,
    "last30Days": 800.00,
    "last90Days": 1200.00,
    "claimsExpiringIn7Days": 3,
    "claimsExpiringIn30Days": 12,
    "reimbursementCount": 45,
    "byType": {
      "count": {
        "LOST": 5,
        "DAMAGED": 3,
        "INBOUND_SHIPMENT": 12,
        "OTHER": 25
      },
      "amount": {
        "LOST": 500.00,
        "DAMAGED": 300.00,
        "INBOUND_SHIPMENT": 450.00,
        "OTHER": 0.00
      }
    },
    "automatedCount": 30,
    "manualCount": 15
  },
  "message": "Reimbursement summary retrieved successfully",
  "success": true
}
```

---

### 2. Get All Reimbursements (with Filters)
**Purpose:** Get all reimbursement cases with optional filtering

**Request:**
```
GET {{base_url}}/app/reimbursements?status=APPROVED&type=LOST&startDate=2024-01-01&endDate=2024-12-31
```

**Query Parameters:**
- `status` (optional): `APPROVED`, `PENDING`, `POTENTIAL`, `DENIED`
- `type` (optional): `LOST`, `DAMAGED`, `CUSTOMER_RETURN`, `FEE_CORRECTION`, `INBOUND_SHIPMENT`, `REMOVAL_ORDER`, `WAREHOUSE_DAMAGE`, `INVENTORY_DIFFERENCE`, `OTHER`
- `startDate` (optional): `YYYY-MM-DD`
- `endDate` (optional): `YYYY-MM-DD`
- `country` (optional): Override location token country
- `region` (optional): Override location token region

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "reimbursementId": "REIMB-12345",
      "asin": "B01234567",
      "sku": "MY-PRODUCT-SKU",
      "fnsku": "X001234567",
      "reimbursementType": "LOST",
      "amount": 125.50,
      "currency": "USD",
      "quantity": 2,
      "reasonCode": "WAREHOUSE_LOST",
      "status": "APPROVED",
      "approvalDate": "2024-10-15T00:00:00.000Z",
      "reimbursementDate": "2024-10-20T00:00:00.000Z",
      "marketplace": "ATVPDKIKX0DER",
      "isAutomated": true
    }
  ],
  "message": "Reimbursements retrieved successfully",
  "success": true
}
```

---

### 3. Get Potential Claims
**Purpose:** Get potential reimbursement claims (not yet filed with Amazon)

**Request:**
```
GET {{base_url}}/app/reimbursements/potential
```

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "asin": "B01234568",
      "sku": "MY-OTHER-SKU",
      "reimbursementType": "INBOUND_SHIPMENT",
      "amount": 89.99,
      "quantity": 1,
      "status": "POTENTIAL",
      "discoveryDate": "2024-10-25T00:00:00.000Z",
      "expiryDate": "2024-12-24T00:00:00.000Z",
      "daysToDeadline": 45,
      "shipmentId": "FBA123456",
      "shipmentName": "FBA123456 (10/10/2024)",
      "reasonDescription": "1 unit(s) not received in shipment"
    }
  ],
  "message": "Potential claims retrieved successfully",
  "success": true
}
```

---

### 4. Get Urgent Claims
**Purpose:** Get potential claims expiring soon (within 7 days by default)

**Request:**
```
GET {{base_url}}/app/reimbursements/urgent?days=7
```

**Query Parameters:**
- `days` (optional): Number of days to check for urgency (default: 7)

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "asin": "B01234569",
      "sku": "URGENT-SKU",
      "reimbursementType": "INBOUND_SHIPMENT",
      "amount": 150.00,
      "quantity": 3,
      "status": "POTENTIAL",
      "daysToDeadline": 2,
      "expiryDate": "2024-10-27T00:00:00.000Z"
    }
  ],
  "message": "Urgent claims retrieved successfully",
  "success": true
}
```

---

### 5. Get Reimbursements by Product (ASIN)
**Purpose:** Get all reimbursements for a specific product

**Request:**
```
GET {{base_url}}/app/reimbursements/product/B01234567
```

**Path Parameters:**
- `asin`: Product ASIN (e.g., `B01234567`)

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "reimbursements": [
      {
        "_id": "507f1f77bcf86cd799439014",
        "reimbursementId": "REIMB-12346",
        "asin": "B01234567",
        "sku": "MY-PRODUCT-SKU",
        "amount": 125.50,
        "quantity": 2,
        "status": "APPROVED"
      }
    ],
    "summary": {
      "totalAmount": 125.50,
      "totalQuantity": 2,
      "count": 1
    }
  },
  "message": "Product reimbursements retrieved successfully",
  "success": true
}
```

---

### 6. Get Statistics by Type
**Purpose:** Get reimbursement statistics grouped by type

**Request:**
```
GET {{base_url}}/app/reimbursements/stats/by-type
```

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "byType": {
      "LOST": 500.00,
      "DAMAGED": 300.00,
      "INBOUND_SHIPMENT": 450.00,
      "OTHER": 0.00
    },
    "countByType": {
      "LOST": 5,
      "DAMAGED": 3,
      "INBOUND_SHIPMENT": 12,
      "OTHER": 0
    },
    "total": 1250.00
  },
  "message": "Reimbursement statistics retrieved successfully",
  "success": true
}
```

---

### 7. Get Timeline Data
**Purpose:** Get reimbursement timeline data for charts (last 30 days by default)

**Request:**
```
GET {{base_url}}/app/reimbursements/timeline?days=90
```

**Query Parameters:**
- `days` (optional): Number of days to include (default: 30)

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": [
    {
      "date": "2024-10-01",
      "totalAmount": 125.50,
      "count": 2,
      "byType": {
        "LOST": 125.50,
        "DAMAGED": 0,
        "INBOUND_SHIPMENT": 0
      }
    },
    {
      "date": "2024-10-15",
      "totalAmount": 89.99,
      "count": 1,
      "byType": {
        "LOST": 0,
        "DAMAGED": 0,
        "INBOUND_SHIPMENT": 89.99
      }
    }
  ],
  "message": "Reimbursement timeline retrieved successfully",
  "success": true
}
```

---

### 8. Update Product Costs
**Purpose:** Update COGS (Cost of Goods Sold) values for cost-based reimbursement calculations

**Request:**
```
POST {{base_url}}/app/reimbursements/update-costs
Content-Type: application/json
```

**Body:**
```json
{
  "cogsValues": {
    "MY-PRODUCT-SKU": 15.50,
    "MY-OTHER-SKU": 22.00,
    "ANOTHER-SKU": 8.75
  },
  "country": "US",
  "region": "NA"
}
```

**Expected Response (200):**
```json
{
  "statusCode": 200,
  "data": {
    "updated": true
  },
  "message": "Product costs updated successfully",
  "success": true
}
```

---

## 🧪 Testing in Postman

### Method 1: Using Postman's Cookie Manager

1. **Login First:**
   ```
   POST http://localhost:5000/app/user/login
   Body: { "email": "...", "password": "..." }
   ```

2. **Postman will automatically save cookies** from the response

3. **Test Reimbursement Endpoints:**
   - Cookies are automatically sent with subsequent requests
   - No need to manually set headers

### Method 2: Manual Cookie Headers

If cookies aren't automatically captured, manually add them:

**Headers Tab:**
```
Cookie: IBEXAccessToken=your-token-here; IBEXLocationToken=your-location-token-here
```

### Method 3: Using Postman Environment Variables

1. Create environment variables for tokens
2. Add to Headers:
   ```
   Cookie: IBEXAccessToken={{ibex_access_token}}; IBEXLocationToken={{ibex_location_token}}
   ```

---

## ⚠️ Common Error Responses

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "data": "",
  "message": "Unauthorized",
  "success": false
}
```
**Solution:** Check that both cookies are set correctly

### 400 Bad Request - Missing Parameters
```json
{
  "statusCode": 400,
  "data": "",
  "message": "User ID, country, and region are required",
  "success": false
}
```
**Solution:** Ensure location token is set or provide country/region in query parameters

### 404 Not Found - No Data
```json
{
  "statusCode": 200,
  "data": [],
  "message": "No reimbursements found",
  "success": true
}
```
**Note:** This is actually a success response, just with no data

---

## 📝 Quick Test Checklist

- [ ] Login and verify cookies are captured
- [ ] Test `/summary` endpoint
- [ ] Test `/` endpoint with filters
- [ ] Test `/potential` endpoint
- [ ] Test `/urgent` endpoint
- [ ] Test `/product/:asin` endpoint
- [ ] Test `/stats/by-type` endpoint
- [ ] Test `/timeline` endpoint
- [ ] Test `/update-costs` POST endpoint

---

## 🔧 Troubleshooting

### Cookies Not Being Sent
1. Check Postman Settings → General → Automatically follow redirects
2. Ensure cookies are enabled in Postman
3. Verify the domain matches (localhost vs 127.0.0.1)

### Getting 401 Errors
1. Verify tokens are not expired
2. Check cookie names match exactly: `IBEXAccessToken` and `IBEXLocationToken`
3. Ensure tokens include semicolons if setting manually: `token1; token2`

### Getting Empty Data
- This is normal if no reimbursement data exists yet
- Data is populated when:
  1. Account analysis runs (`/app/info/getSpApiData`)
  2. Amazon SP-API returns reimbursement data
  3. Shipment discrepancies are detected

---

## 🌐 Base URLs

**Local Development:**
```
http://localhost:5000
```

**Production (if applicable):**
```
https://your-production-domain.com
```

---

*Last Updated: Based on server implementation review*

