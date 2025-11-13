# Refund Calculation Implementation Comparison

This document compares the requirements from "Refunzo Final Documentation 6.md" with the current implementation in the codebase.

## Summary

### ✅ Fully Implemented
1. **All Shipments API** - Fetches and stores shipment data
2. **Shipment Items API** - Fetches and stores shipment item details
3. **Listing Items API** - Fetches and stores listing metadata
4. **GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA** - Fetches fee data
5. **GET_FBA_REIMBURSEMENTS_DATA** - Fetches reimbursement data
6. **GET_LEDGER_SUMMARY_VIEW_DATA** - Fetches ledger summary data
7. **Basic Refund Tracking** - Refunds are tracked in financial calculations

### ⚠️ Partially Implemented
1. ~~**Fee Protector Calculations**~~ - ✅ **NOW COMPLETE** - All fields stored, Reimbursement Per Unit calculation implemented
2. ~~**Backend Lost Inventory Calculations**~~ - ✅ **NOW COMPLETE** - All formulas implemented, model created, test endpoints added
3. **Shipment Discrepancy Calculations** - ✅ **NOW USES CORRECT FORMULA** - Uses (Sales Price – Fees) when FBA data is available

### ❌ Not Implemented
1. **GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA** - Report not found in codebase
2. **Units Sold API** - `/sales/v1/orderMetrics` endpoint not found
3. **Backend Fees Calculations** - Region-wise FBA fee calculations not found
4. **Specific Reimbursement Formulas** - Exact formulas from documentation may not match implementation

---

## Detailed Comparison

### 1. All Shipments ✅

**Documentation Requirements:**
- Call API: `/fba/inbound/v0/shipments` with status = Closed for Last 12 months
- UPDATE/INSERT all data in AllShipments Table
- Call the same API in loop till there is more data (pagination)

**Current Implementation:**
- ✅ **File:** `server/Services/Sp_API/shipment.js`
- ✅ **Model:** `ShipmentModel`
- ✅ API endpoint implemented: `/fba/inbound/v0/shipments`
- ✅ Fetches shipments with status: WORKING, SHIPPED, RECEIVING, CLOSED, CANCELLED, DELETED, ERROR, IN_TRANSIT
- ✅ Only CLOSED shipments are stored with item details
- ⚠️ **Note:** Date range is not explicitly set to "Last 12 months" - may need verification
- ⚠️ **Note:** Pagination handling may need verification

---

### 2. Shipment Items ✅

**Documentation Requirements:**
- For All Shipments above in loop, Call the API: `/fba/inbound/v0/shipments/{ship}/items` where "ship" is shipment id
- INSERT/UPDATE all data in ShipmentItems Table

**Current Implementation:**
- ✅ **File:** `server/Services/Sp_API/shipment.js`
- ✅ Function: `getShipmentDetails()` fetches items for each shipment
- ✅ Data stored in `ShipmentModel` under `shipmentData[].itemDetails[]`
- ✅ Fields stored: SellerSKU, FulfillmentNetworkSKU, QuantityShipped, QuantityReceived

---

### 3. Listing Items ✅

**Documentation Requirements:**
- For all Shipment Items, get Seller SKU, and call `/listings/2021-08-01/items/{token.SellerPartnerId}/{sku}` API in loop
- Store all data in Listing Items table (INSERT/UPDATE)

**Current Implementation:**
- ✅ **File:** `server/Services/Sp_API/GetListingItemsIssues.js`
- ✅ **Model:** `ListingItems`
- ✅ API endpoint implemented: `/listings/2021-08-01/items/{sellerId}/{sku}`
- ✅ Data stored with User, region, country
- ⚠️ **Note:** Currently only extracts `generic_keyword` attribute - may need to store more metadata

---

### 4. Fee Protector Data ⚠️

**Documentation Requirements:**
1. Get All the data from Report: `GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA`
2. Following fields are fetched:
   - sku, fnsku, asin, longest-side, median-side, shortest-side, unit-of-dimension, item-package-weight, unit-of-weight, estimated-fee-total, currency, sales-price
3. Based on these fields, Fee Protector BackendShipmentItems and BackendShipments is populated
4. For Backend Shipment Item, SKU, FNSKU, ASIN is used with Sales Price and Estimated total fees to calculate **Reimbursement Per Unit**
5. **Reimbursement Per Unit = (Sales Price – Fees)**
6. Backend Shipments is calculated from Shipments where there is a discrepancy. First "Adjustments" are taken into account, if Adjustments are done by client, they are pulled, otherwise, if Amazon Reported discrepancy then those are pulled.

**Current Implementation:**
- ✅ **File:** `server/Services/Sp_API/GetProductWiseFBAData.js`
- ✅ **Model:** `ProductWiseFBAData`
- ✅ Report type: `GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA`
- ✅ Date range: Last 30 days
- ✅ **All fields from documentation are now stored:**
  - ✅ asin, sku, fnsku
  - ✅ longestSide, medianSide, shortestSide
  - ✅ unitOfDimension, itemPackageWeight, unitOfWeight
  - ✅ salesPrice, currency
- ✅ **Reimbursement Per Unit calculation = (Sales Price – Fees)** - **IMPLEMENTED**
  - Calculated automatically during data processing
  - Stored as `reimbursementPerUnit` field in the model
  - Used in reimbursement calculations (`Reimburstment.js` and `EnhancedReimbursement.js`)
- ✅ **Test Endpoint:** `POST /app/test/testGetProductWiseFBAData`
- ⚠️ **Still Missing:**
  - BackendShipmentItems and BackendShipments tables/models not found (may be separate feature)
  - Adjustment handling logic not found (may be separate feature)

---

### 5. Units Sold ❌

**Documentation Requirements:**
- Just to get Unit Sold for Fee Protector we are calling the following API in loop for All ASINs that we got previously
- `/sales/v1/orderMetrics`
- Units Sold are stored in Fee Protector

**Current Implementation:**
- ❌ **Not Found:** No implementation of `/sales/v1/orderMetrics` API endpoint
- ❌ No storage of Units Sold data in Fee Protector

---

### 6. Backend Lost Inventory / Backend Underpaid ⚠️

**Documentation Requirements:**
1. Following two reports are called for this:
   - `GET_LEDGER_SUMMARY_VIEW_DATA`
   - `GET_FBA_REIMBURSEMENTS_DATA`
2. From first report, we get found and lost quantity which is stored in Backend lost inventory
3. From second report we get Reimbursed Units where reason is "Lost_warehouse"
4. Based on these 3 values, we calculate Reimbursement Per Unit and expected amount
5. **Discrepancy Units = Lost Units – Found Units – Reimbursed Units**
6. **Expected Amount = Discrepancy Units × (Sales Price – Fees)** (from previous reports)
7. From Second report we get "Amount per unit"
8. **If Amount per Unit < ((Sales Price – Fees) × 0.4) then that gets stored as Underpaid item**
9. Here, expected amount is: **((Sales Price – Fees) - Amount per Unit) × quantity**

**Current Implementation:**
- ✅ **GET_LEDGER_SUMMARY_VIEW_DATA:** 
  - **File:** `server/Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js`
  - **Model:** `LedgerSummaryViewModel`
  - ✅ Data fetched and stored
- ✅ **GET_FBA_REIMBURSEMENTS_DATA:**
  - **File:** `server/Services/Sp_API/GET_FBA_REIMBURSEMENT_DATA.js`
  - **Model:** `ReimbursementModel`
  - ✅ Data fetched and stored
  - ✅ Reason code mapping includes LOST type
- ✅ **Backend Lost Inventory Model:**
  - **File:** `server/models/BackendLostInventoryModel.js`
  - ✅ Model created to store calculated lost inventory data
- ✅ **Backend Lost Inventory Calculations:**
  - **File:** `server/Services/Calculations/BackendLostInventory.js`
  - ✅ **Discrepancy Units = Lost Units – Found Units – Reimbursed Units** - **IMPLEMENTED**
  - ✅ **Expected Amount = Discrepancy Units × (Sales Price – Fees)** - **IMPLEMENTED**
  - ✅ **Underpaid detection: Amount per Unit < ((Sales Price – Fees) × 0.4)** - **IMPLEMENTED**
  - ✅ **Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity** - **IMPLEMENTED**
  - ✅ Specific filtering for "Lost_warehouse" reason - **IMPLEMENTED** (handles multiple formats: lost_warehouse, lost-warehouse, lost warehouse, and LOST type)
  - ✅ **Test Endpoints:** 
    - `POST /app/test/testCalculateBackendLostInventory` - Calculate lost inventory
    - `POST /app/test/testGetBackendLostInventory` - Retrieve calculated data

---

### 7. Backend Damaged Inventory ❌

**Documentation Requirements:**
1. Report: `GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA`
2. If Reason is "SELLABLE", "WAREHOUSE_DAMAGED", "DISTRIBUTOR_DAMAGED", "EXPIRED"
3. Then Quantity is Discrepancy Units
4. And Expected Amount is: **Discrepancy Units × (Sales Price – fees)**

**Current Implementation:**
- ❌ **Not Found:** No implementation of `GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA` report
- ❌ No Backend Damaged Inventory calculations
- ⚠️ **Note:** ReimbursementModel has DAMAGED and WAREHOUSE_DAMAGE types, but these come from GET_FBA_REIMBURSEMENTS_DATA, not from inventory adjustments report

---

### 8. Backend Fees ⚠️

**Documentation Requirements:**
- Based on Actual Values specified by client in Fee Protector, difference is calculated and stored based on Region wise values for FBA fees given in a different sheet (already shared).

**Current Implementation:**
- ⚠️ **Partial:** Fee data is fetched from `GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA`
- ❌ **Missing:**
  - No client-specified actual values input mechanism found
  - No region-wise FBA fee calculations found
  - No difference calculation between actual and estimated fees
  - Backend Fees model/table not found

---

## Current Refund Calculation Implementation

### Financial Refunds (Transaction-based) ✅

**Location:** `server/Services/Sp_API/Finance.js`

**Implementation:**
- ✅ Tracks refunds from financial events API
- ✅ Calculates total refunds: `totalRefunds += amount` for transactionType === "Refund"
- ✅ Subtracts refunds from total sales: `totalSales = totalSales - Math.abs(totalRefunds)`
- ✅ Returns refunds in financial data: `Refunds: Math.abs(totalRefunds).toFixed(2)`

**Note:** This is different from the reimbursement calculations in the documentation. This tracks customer refunds, not Amazon reimbursements.

---

### Reimbursement Calculations ✅

**Location:** `server/Services/Calculations/Reimburstment.js` and `server/Services/Calculations/EnhancedReimbursement.js`

**Current Implementation:**
- ✅ Basic shipment discrepancy calculation: `reimbustment = price * (quantityShipped - quantityReceived)` (fallback when FBA data not available)
- ✅ Enhanced reimbursement service exists with shipment discrepancy analysis
- ✅ **NOW MATCHES DOCUMENTATION FORMULAS:**
  - **Primary Formula:** `(Sales Price – Fees) × Discrepancy Units` when FBA data is available
  - Uses `reimbursementPerUnit` from ProductWiseFBAData model
  - Falls back to `price * discrepancy` if FBA data is not available (backward compatible)
  - Both calculation files updated to accept optional `fbaData` parameter

---

## Key Missing Components

1. **Fee Protector BackendShipmentItems Model** - Not found (may be separate feature)
2. **Fee Protector BackendShipments Model** - Not found (may be separate feature)
3. ~~**Backend Lost Inventory Model**~~ - ✅ **IMPLEMENTED**
4. **Backend Damaged Inventory Model** - Not found
5. **Backend Fees Model** - Not found
6. **Backend Underpaid Model** - Not found (underpaid items are now tracked within BackendLostInventory model)
7. **GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA Report** - Not implemented
8. **Units Sold API (`/sales/v1/orderMetrics`)** - Not implemented
9. ~~**Reimbursement Per Unit Formula: (Sales Price – Fees)**~~ - ✅ **IMPLEMENTED**
10. ~~**Underpaid Detection Logic (40% threshold)**~~ - ✅ **IMPLEMENTED**
11. ~~**Discrepancy Units Calculation**~~ - ✅ **IMPLEMENTED**
12. **Region-wise FBA fee calculations** - Not found

---

## Recommendations

1. **Implement Missing Reports:**
   - Add `GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA` report service
   - Add `/sales/v1/orderMetrics` API endpoint

2. **Create Missing Models:**
   - BackendShipmentItems
   - BackendShipments
   - BackendLostInventory
   - BackendDamagedInventory
   - BackendFees
   - BackendUnderpaid

3. **Implement Missing Calculations:**
   - ~~Reimbursement Per Unit = (Sales Price – Fees)~~ - ✅ **COMPLETED**
   - ~~Discrepancy Units = Lost Units – Found Units – Reimbursed Units~~ - ✅ **COMPLETED**
   - ~~Expected Amount = Discrepancy Units × (Sales Price – Fees)~~ - ✅ **COMPLETED**
   - ~~Underpaid detection: Amount per Unit < ((Sales Price – Fees) × 0.4)~~ - ✅ **COMPLETED**
   - ~~Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity~~ - ✅ **COMPLETED**

4. **Enhance Existing Services:**
   - ~~Update `GetProductWiseFBAData.js` to store all required fields including sales-price~~ - ✅ **COMPLETED**
   - ~~Update reimbursement calculations to use (Sales Price – Fees) instead of just price~~ - ✅ **COMPLETED**
   - Add adjustment handling logic for shipments

5. **Add Client Input Mechanisms:**
   - Allow clients to specify actual fee values
   - Store region-wise FBA fee values
   - Calculate differences between actual and estimated fees

---

## Files to Review/Modify

1. ~~`server/Services/Sp_API/GetProductWiseFBAData.js` - Add missing fields and calculations~~ - ✅ **COMPLETED**
2. ~~`server/Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js` - Add discrepancy calculations~~ - ✅ **COMPLETED** (via BackendLostInventory service)
3. ~~`server/Services/Sp_API/GET_FBA_REIMBURSEMENT_DATA.js` - Add underpaid detection~~ - ✅ **COMPLETED** (via BackendLostInventory service)
4. ~~`server/Services/Calculations/Reimburstment.js` - Update formula to use (Sales Price – Fees)~~ - ✅ **COMPLETED**
5. ~~`server/Services/Calculations/EnhancedReimbursement.js` - Add missing calculations~~ - ✅ **COMPLETED**
6. ✅ **NEW:** `server/models/BackendLostInventoryModel.js` - Model for storing lost inventory calculations
7. ✅ **NEW:** `server/Services/Calculations/BackendLostInventory.js` - Service implementing all lost inventory formulas
8. Create new service: `server/Services/Sp_API/GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA.js`
9. Create new service: `server/Services/Sp_API/GetUnitsSold.js`
10. Create additional Backend* models if needed (BackendShipmentItems, BackendShipments, etc.)

---

## Implementation Status Update

### ✅ Completed (2025-01-XX)
1. **ProductWiseFBAData Model Enhancement:**
   - Added all missing fields: sku, fnsku, dimensions, weight, salesPrice, currency
   - Added calculated field: `reimbursementPerUnit = (Sales Price – Fees)`
   - All fields from GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA report are now stored

2. **GetProductWiseFBAData Service:**
   - Extracts all fields from TSV report
   - Calculates and stores `reimbursementPerUnit` automatically
   - Handles multiple field name formats (hyphens, underscores, camelCase)

3. **Reimbursement Calculations:**
   - Updated `Reimburstment.js` to use `(Sales Price – Fees) × Discrepancy Units`
   - Updated `EnhancedReimbursement.js` to use the same formula
   - Both functions accept optional `fbaData` parameter for enhanced calculations
   - Backward compatible - falls back to price-based calculation if FBA data not available

4. **Test Endpoints:**
   - Added `POST /app/test/testGetProductWiseFBAData` endpoint
   - Includes summary statistics and sample data in response

5. **Backend Lost Inventory Implementation:**
   - Created `BackendLostInventoryModel` to store calculated lost inventory data
   - Created `BackendLostInventory` calculation service implementing all formulas:
     - Discrepancy Units = Lost Units – Found Units – Reimbursed Units
     - Expected Amount = Discrepancy Units × (Sales Price – Fees)
     - Underpaid detection: Amount per Unit < ((Sales Price – Fees) × 0.4)
     - Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity
   - Filters reimbursements for "Lost_warehouse" reason (handles multiple formats)
   - Aggregates data from LedgerSummaryView, ReimbursementModel, and ProductWiseFBAData
   - Includes summary statistics calculation
   - Added test endpoints:
     - `POST /app/test/testCalculateBackendLostInventory` - Calculate lost inventory
     - `POST /app/test/testGetBackendLostInventory` - Retrieve calculated data

---

*Last Updated: 2025-01-XX*

