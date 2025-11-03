# Reimbursement Fetch Endpoint - Testing Guide

## 🎯 New Dedicated Endpoint Created!

I've created a **dedicated endpoint** that **ONLY** tests the reimbursement API function - it doesn't fetch all the other account data.

---

## 📍 Endpoint Details

### **POST** `/app/reimbursements/fetch`

**Purpose:** Fetch reimbursement data from Amazon SP-API and store in database

**What it does:**
1. ✅ Fetches reimbursement data from **Amazon SP-API** (GET_FBA_REIMBURSEMENTS_DATA report)
2. ✅ Fetches shipment data for discrepancy calculation
3. ✅ Calculates **potential claims** from shipment discrepancies  
4. ✅ Merges both data sources
5. ✅ **Saves everything to MongoDB database**
6. ✅ Returns results summary

**What it does NOT do:**
- ❌ Doesn't fetch all other account data (sales, reviews, etc.)
- ❌ Faster and focused - only reimbursement testing

---

## 🔐 Authentication

**Required Cookies:**
1. `IBEXAccessToken` - User authentication token
2. `IBEXLocationToken` - Location token (country & region)

**Required:**
- User must have SP-API tokens configured
- Seller account must exist for the specified country/region

---

## 🚀 Testing in Postman

### Step 1: Setup Request

**Request Type:** `POST`

**URL:**
```
{{base_url}}/app/reimbursements/fetch
```

**Headers:**
```
Content-Type: application/json
Cookie: IBEXAccessToken={{ibex_access_token}}; IBEXLocationToken={{ibex_location_token}}
```

**Body (Optional - uses location token if not provided):**
```json
{
  "country": "US",
  "region": "NA"
}
```

---

### Step 2: Expected Response

#### Success Response (200)

```json
{
  "statusCode": 200,
  "data": {
    "success": true,
    "data": {
      "apiDataCount": 15,
      "potentialClaimsCount": 8,
      "totalReimbursements": 23,
      "summary": {
        "totalReceived": 1250.50,
        "totalPending": 0,
        "totalPotential": 890.75,
        "totalDenied": 0,
        "claimsExpiringIn7Days": 3,
        "claimsExpiringIn30Days": 12,
        "countByType": {
          "LOST": 5,
          "DAMAGED": 3,
          "INBOUND_SHIPMENT": 8,
          "OTHER": 7
        },
        "amountByType": {
          "LOST": 500.00,
          "DAMAGED": 300.00,
          "INBOUND_SHIPMENT": 450.75,
          "OTHER": 0.00
        }
      },
      "saved": true
    },
    "message": "Reimbursement data fetched and saved successfully"
  },
  "message": "Reimbursement data fetched and saved successfully",
  "success": true
}
```

#### Error Response (400/404/500)

```json
{
  "statusCode": 400,
  "data": "",
  "message": "SP-API refresh token not found",
  "success": false
}
```

---

## 📊 Response Fields Explained

| Field | Description |
|-------|-------------|
| `apiDataCount` | Number of reimbursements fetched from Amazon SP-API |
| `potentialClaimsCount` | Number of potential claims calculated from shipment discrepancies |
| `totalReimbursements` | Total reimbursements saved (API + potential) |
| `summary.totalReceived` | Total approved reimbursements amount |
| `summary.totalPotential` | Total potential claims amount |
| `summary.claimsExpiringIn7Days` | Urgent claims count |
| `saved` | Confirmation that data was saved to database |

---

## ⚠️ Important Notes

### 1. **Long-Running Operation**
- This endpoint can take **1-3 minutes** to complete
- Don't timeout the request - let it finish
- Amazon report generation takes time (polling up to 30 times)

### 2. **SP-API Requirements**
- Your account must have **valid SP-API credentials** configured
- Tokens must have **Reports API permissions**
- Seller account must exist for the country/region

### 3. **Database Storage**
- Data is **immediately saved** to MongoDB
- Stored in `reimbursements` collection
- One document per user/country/region combination

### 4. **Idempotency**
- Running multiple times will **update** existing records
- Duplicate detection prevents duplicate potential claims
- Latest data overwrites old data

---

## 🧪 Step-by-Step Testing

### Test 1: Basic Fetch and Store

**Request:**
```
POST http://localhost:5000/app/reimbursements/fetch
Content-Type: application/json
Cookie: IBEXAccessToken=...; IBEXLocationToken=...
```

**Body (optional):**
```json
{
  "country": "US",
  "region": "NA"
}
```

**Expected:**
- ✅ Status: 200
- ✅ Response includes `apiDataCount` and `potentialClaimsCount`
- ✅ `saved: true` confirms database save
- ✅ Database is updated with reimbursement records

### Test 2: Verify Data Was Stored

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

### Issue: "SP-API refresh token not found"

**Solution:**
1. Check if SP-API tokens are configured for the user
2. Verify seller account exists for the country/region
3. Test token generation endpoint first

### Issue: "No seller account found for region X and country Y"

**Solution:**
1. Ensure seller account is configured in database
2. Verify country and region match exactly
3. Check seller account has `spiRefreshToken`

### Issue: "Report did not complete within timeout"

**Solution:**
1. Amazon reports can take 1-3 minutes to generate
2. The service polls up to 30 times with exponential backoff
3. If consistently timing out, check Amazon SP-API status

### Issue: "No reimbursement data found from Amazon SP-API or shipment discrepancies"

**Possible Reasons:**
1. **No reimbursements exist** in Amazon for the date range (last 90 days)
2. **No shipment discrepancies** detected
3. **Report permissions** not granted to SP-API app

**Solution:**
1. Check Amazon Seller Central for actual reimbursements
2. Verify shipment data is being fetched successfully
3. Check SP-API app permissions in Amazon Developer Console

---

## 📊 Data Flow

```
User Request (Postman)
    ↓
POST /app/reimbursements/fetch
    ↓
ReimbursementController.fetchReimbursementData()
    ↓
Get Seller Data & Tokens
    ↓
Generate AWS Credentials
    ↓
Generate SP-API Access Token
    ↓
┌─────────────────────────────────┐
│  FETCH FROM AMAZON SP-API       │
│  GET_FBA_REIMBURSEMENT_DATA    │
│  → Create Report Request        │
│  → Poll for Completion         │
│  → Download & Parse TSV         │
│  → Transform to Schema          │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  FETCH SHIPMENT DATA            │
│  GET_FBA_INBOUND_SHIPMENT_ITEMS │
│  → Get Shipment Details         │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  CALCULATE POTENTIAL CLAIMS     │
│  calculateShipmentDiscrepancies │
│  → Analyze Shipped vs Received  │
│  → Create Potential Claims      │
│  → Calculate 60-day Deadline   │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  MERGE & SAVE                   │
│  mergeReimbursementData         │
│  → Combine API + Potential      │
│  → Remove Duplicates            │
│  → Calculate Summary Stats      │
│  → Save to MongoDB              │
└─────────────────────────────────┘
    ↓
Response with Results
    ↓
Database Updated ✅
```

---

## ✅ Testing Checklist

- [ ] Login and get authentication cookies
- [ ] Verify SP-API tokens are configured
- [ ] Call `POST /app/reimbursements/fetch` endpoint
- [ ] Wait for response (1-3 minutes)
- [ ] Verify response shows `saved: true`
- [ ] Check `apiDataCount` and `potentialClaimsCount`
- [ ] Verify data saved to database
- [ ] Test retrieval endpoint `GET /app/reimbursements/summary`
- [ ] Verify summary shows non-zero values
- [ ] Test `GET /app/reimbursements/potential` for potential claims
- [ ] Check `GET /app/reimbursements/` for all reimbursements

---

## 🆚 Comparison with Full Analysis Endpoint

| Feature | `/app/reimbursements/fetch` | `/app/info/getSpApiData` |
|---------|---------------------------|-------------------------|
| **Purpose** | Reimbursement only | Full account analysis |
| **Speed** | ⚡ Faster (1-3 min) | ⏳ Slower (2-5 min) |
| **Data Fetched** | Reimbursements + Shipments | Everything (sales, reviews, etc.) |
| **Use Case** | Testing reimbursement feature | Complete account sync |
| **Endpoint Type** | POST | GET |

---

## 📝 Example: Complete Test Flow

```bash
# Step 1: Login
POST /app/user/login
→ Save cookies

# Step 2: Fetch and Store Reimbursement Data (NEW ENDPOINT!)
POST /app/reimbursements/fetch
Body: { "country": "US", "region": "NA" }
→ Wait 1-3 minutes
→ Verify "saved": true in response

# Step 3: Verify Data in Database
GET /app/reimbursements/summary
→ Should show non-zero totals

# Step 4: Get All Reimbursements
GET /app/reimbursements
→ Should return array of reimbursements

# Step 5: Get Potential Claims
GET /app/reimbursements/potential
→ Should return potential claims from shipment discrepancies
```

---

*Endpoint created and ready for testing! 🚀*

