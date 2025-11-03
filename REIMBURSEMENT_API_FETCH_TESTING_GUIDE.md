# Reimbursement API Fetch & Storage - Postman Testing Guide

## 🎯 Purpose

This guide shows you how to test the endpoint that **fetches reimbursement data from Amazon SP-API and stores it in the database**.

---

## 📍 Main Endpoint

### **Fetch and Store Reimbursement Data**

**Endpoint:** `GET /app/info/getSpApiData`

**What it does:**
1. ✅ Fetches reimbursement data from **Amazon SP-API** (GET_FBA_REIMBURSEMENTS_DATA report)
2. ✅ Calculates **potential claims** from shipment discrepancies
3. ✅ Merges both data sources
4. ✅ **Saves everything to MongoDB database**
5. ✅ Also fetches ALL other account data (sales, shipments, financials, etc.)

---

## 🔐 Authentication Requirements

**Required Cookies:**
1. `IBEXAccessToken` - User authentication token
2. `IBEXLocationToken` - Location token (country & region)

**Required Subscription:**
- Must have valid SP-API tokens configured for your account
- Tokens must have permissions for Reports API

---

## 🚀 Testing in Postman

### Step 1: Setup Request

**Request Type:** `GET`

**URL:**
```
{{base_url}}/app/info/getSpApiData
```

**Headers:**
```
Cookie: IBEXAccessToken={{ibex_access_token}}; IBEXLocationToken={{ibex_location_token}}
```

**No Body Required** - It's a GET request

---

### Step 2: Understanding the Process

This endpoint performs a **comprehensive account analysis** that includes:

#### **Batch 1: Initial Data Fetch**
- Merchant listings
- V1/V2 Seller Performance Reports
- Restock inventory recommendations
- Product reviews
- Search terms
- And more...

#### **Batch 2: Additional Reports**
- Competitive pricing
- FBA inventory planning
- Stranded inventory
- Inbound non-compliance
- And more...

#### **Batch 3: Financial & Reimbursement Data** ⭐
- Weekly sales data
- **Shipment data** (used for discrepancy calculation)
- Brand data
- Amazon fees
- Financial events
- **🔄 REIMBURSEMENT DATA** ← This is what we're testing!

#### **Batch 4: Amazon Ads Data** (if available)
- Campaign data
- Ad groups
- Keywords performance
- And more...

---

### Step 3: What Happens with Reimbursement Data

When this endpoint runs, it:

1. **Fetches from Amazon SP-API:**
   ```
   GET_FBA_REIMBURSEMENT_DATA service
   ↓
   Creates report request to Amazon
   ↓
   Polls for report completion
   ↓
   Downloads and parses TSV data
   ↓
   Transforms to our schema format
   ```

2. **Calculates Potential Claims:**
   ```
   calculateShipmentDiscrepancies()
   ↓
   Analyzes shipment data (shipped vs received)
   ↓
   Identifies missing units
   ↓
   Creates POTENTIAL claims with 60-day deadline tracking
   ```

3. **Merges and Saves:**
   ```
   mergeReimbursementData()
   ↓
   Combines API data + potential claims
   ↓
   Avoids duplicates
   ↓
   Calculates summary statistics
   ↓
   Saves to ReimbursementModel (MongoDB)
   ```

---

## 📝 Expected Response

### Success Response (200)

**Note:** This is a **long-running operation** (can take 2-5 minutes)

**Response Structure:**
```json
{
  "statusCode": 200,
  "data": {
    "success": true,
    "message": "Data fetched and processed successfully",
    "services": {
      "Reimbursement Data": {
        "success": true,
        "data": {
          "_id": "...",
          "User": "user-id",
          "country": "US",
          "region": "NA",
          "reimbursements": [
            {
              "reimbursementId": "REIMB-12345",
              "asin": "B01234567",
              "sku": "MY-SKU",
              "amount": 125.50,
              "status": "APPROVED",
              "reimbursementType": "LOST",
              ...
            },
            {
              "asin": "B01234568",
              "sku": "ANOTHER-SKU",
              "amount": 89.99,
              "status": "POTENTIAL",
              "reimbursementType": "INBOUND_SHIPMENT",
              "daysToDeadline": 45,
              ...
            }
          ],
          "summary": {
            "totalReceived": 1250.50,
            "totalPending": 340.25,
            "totalPotential": 890.75,
            ...
          }
        }
      },
      "Weekly Sales": { ... },
      "Shipment Data": { ... },
      "Financial Events": { ... },
      ...
    }
  },
  "message": "All data fetched successfully",
  "success": true
}
```

### Partial Success (200)

If some services succeed but reimbursement fails:
```json
{
  "statusCode": 200,
  "data": {
    "success": true,
    "message": "Partial success - some critical services failed",
    "services": {
      "Reimbursement Data": {
        "success": false,
        "error": "SP-API token not available"
      },
      ...
    }
  }
}
```

### Error Response (400/500)

```json
{
  "statusCode": 400,
  "data": "",
  "message": "Region and country are required",
  "success": false
}
```

---

## ⚠️ Important Notes

### 1. **Long-Running Operation**
- This endpoint can take **2-5 minutes** to complete
- Don't timeout the request - let it finish
- Postman default timeout is 5 minutes (should be enough)

### 2. **SP-API Requirements**
- Your account must have **valid SP-API credentials** configured
- Tokens must have **Reports API permissions**
- Amazon may rate-limit requests

### 3. **Database Storage**
- Data is **immediately saved** to MongoDB
- Stored in `reimbursements` collection
- One document per user/country/region combination

### 4. **Idempotency**
- Running multiple times will **update** existing records
- Duplicate detection prevents duplicate potential claims
- Latest data overwrites old data for the same user/country/region

---

## 🧪 Step-by-Step Testing

### Test 1: Basic Fetch and Store

**Request:**
```
GET http://localhost:5000/app/info/getSpApiData
```

**Expected:**
- ✅ Status: 200
- ✅ Response includes "Reimbursement Data" in services
- ✅ Database is updated with reimbursement records

**Verify in Database:**
```javascript
// In MongoDB or your database client
db.reimbursements.findOne({ 
  User: ObjectId("your-user-id"),
  country: "US",
  region: "NA"
})
```

### Test 2: Verify Data Retrieval

After running the fetch endpoint, test retrieval:

**Request:**
```
GET http://localhost:5000/app/reimbursements/summary
```

**Expected:**
- Should return summary with data (not all zeros)
- `totalReceived`, `totalPotential`, etc. should have values

### Test 3: Check Potential Claims

**Request:**
```
GET http://localhost:5000/app/reimbursements/potential
```

**Expected:**
- Should return array of potential claims
- Each claim should have `status: "POTENTIAL"`
- Should have `daysToDeadline` calculated

---

## 🔍 Troubleshooting

### Issue: "SP-API token not available"

**Solution:**
1. Check if SP-API tokens are configured for the user
2. Verify tokens haven't expired
3. Test token generation endpoint first

### Issue: "Report did not complete within timeout"

**Solution:**
1. Amazon reports can take 1-3 minutes to generate
2. The service polls up to 30 times with exponential backoff
3. If consistently timing out, check Amazon SP-API status

### Issue: Empty Reimbursement Data

**Possible Reasons:**
1. **No reimbursements exist** in Amazon for the date range (last 90 days)
2. **No shipment discrepancies** detected
3. **Report permissions** not granted to SP-API app

**Solution:**
1. Check Amazon Seller Central for actual reimbursements
2. Verify shipment data is being fetched successfully
3. Check SP-API app permissions in Amazon Developer Console

### Issue: Reimbursement Data Missing in Response

**Check:**
1. Look in `data.services["Reimbursement Data"]`
2. May be `null` if service failed but overall request succeeded
3. Check logs for detailed error messages

---

## 📊 Data Flow Diagram

```
User Request (Postman)
    ↓
GET /app/info/getSpApiData
    ↓
SpApiDataController.getSpApiData()
    ↓
Batch 3 Processing
    ├─→ GET_FBA_REIMBURSEMENT_DATA()
    │   ├─→ Amazon SP-API (Reports API)
    │   ├─→ Create Report Request
    │   ├─→ Poll for Completion
    │   ├─→ Download TSV Report
    │   └─→ Transform to Schema
    │
    └─→ calculateShipmentDiscrepancies()
        ├─→ Analyze Shipment Data
        ├─→ Find Missing Units
        └─→ Create Potential Claims
    ↓
mergeReimbursementData()
    ├─→ Combine API Data + Potential Claims
    ├─→ Remove Duplicates
    ├─→ Calculate Summary Stats
    └─→ Save to MongoDB
    ↓
Response with Results
    ↓
Database Updated ✅
```

---

## ✅ Testing Checklist

- [ ] Login and get authentication cookies
- [ ] Verify SP-API tokens are configured
- [ ] Call `/app/info/getSpApiData` endpoint
- [ ] Wait for response (2-5 minutes)
- [ ] Check response includes "Reimbursement Data"
- [ ] Verify data saved to database
- [ ] Test retrieval endpoint `/app/reimbursements/summary`
- [ ] Verify summary shows non-zero values
- [ ] Test `/app/reimbursements/potential` for potential claims
- [ ] Check `/app/reimbursements/` for all reimbursements

---

## 🔗 Related Endpoints

After fetching data, test these **read endpoints**:

1. **Get Summary:** `GET /app/reimbursements/summary`
2. **Get All:** `GET /app/reimbursements`
3. **Get Potential Claims:** `GET /app/reimbursements/potential`
4. **Get Urgent Claims:** `GET /app/reimbursements/urgent`
5. **Get Timeline:** `GET /app/reimbursements/timeline`
6. **Get Stats:** `GET /app/reimbursements/stats/by-type`

---

## 📝 Example: Complete Test Flow

```bash
# Step 1: Login
POST /app/user/login
→ Save cookies

# Step 2: Fetch and Store Reimbursement Data
GET /app/info/getSpApiData
→ Wait 2-5 minutes
→ Verify "Reimbursement Data" in response

# Step 3: Verify Data in Database
# (Use MongoDB client or check via retrieval endpoint)

# Step 4: Retrieve Summary
GET /app/reimbursements/summary
→ Should show non-zero totals

# Step 5: Get All Reimbursements
GET /app/reimbursements
→ Should return array of reimbursements

# Step 6: Get Potential Claims
GET /app/reimbursements/potential
→ Should return potential claims from shipment discrepancies
```

---

## 🎯 Key Differences

| Endpoint | Purpose | Data Source | Stores to DB? |
|----------|---------|-------------|---------------|
| `/app/info/getSpApiData` | **Fetch from Amazon** | Amazon SP-API | ✅ **YES** |
| `/app/reimbursements/summary` | Read summary | MongoDB | ❌ No |
| `/app/reimbursements/` | Read all | MongoDB | ❌ No |
| `/app/reimbursements/potential` | Read potential | MongoDB | ❌ No |

---

*Last Updated: Based on SpApiDataController implementation*

