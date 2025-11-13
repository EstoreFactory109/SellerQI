# Database Data Documentation

This document outlines all the data being stored in the database from existing reports and API endpoints.

## Table of Contents
1. [Reports](#reports)
2. [API Endpoints](#api-endpoints)
3. [Data Models Summary](#data-models-summary)

---

## Reports

### 1. GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA
**Service:** `server/Services/Sp_API/GetProductWiseFBAData.js`  
**Model:** `ProductWiseFBAData`  
**Date Range:** Last 30 days  
**Test Endpoint:** `POST /app/test/testGetProductWiseFBAData`

**Stored Data:**
- `userId` (ObjectId) - Reference to User
- `country` (String)
- `region` (String)
- `fbaData` (Array of objects):
  - `asin` (String) - Product ASIN
  - `sku` (String) - Seller SKU
  - `fnsku` (String) - Fulfillment Network SKU
  - `totalFba` (String) - Expected fulfillment fee per unit
  - `totalAmzFee` (String) - Estimated fee total
  - `longestSide` (String) - Longest side dimension
  - `medianSide` (String) - Median side dimension
  - `shortestSide` (String) - Shortest side dimension
  - `unitOfDimension` (String) - Unit of dimension (e.g., "inches", "cm")
  - `itemPackageWeight` (String) - Item package weight
  - `unitOfWeight` (String) - Unit of weight (e.g., "pounds", "kg")
  - `salesPrice` (String) - Sales price from report
  - `currency` (String) - Currency code (default: "USD")
  - `reimbursementPerUnit` (Number) - **Calculated field: (Sales Price – Fees)**

---

### 2. GET_FBA_REIMBURSEMENTS_DATA
**Service:** `server/Services/Sp_API/GET_FBA_REIMBURSEMENT_DATA.js`  
**Model:** `Reimbursement`  
**Date Range:** Last 90 days

**Stored Data:**
- `User` (ObjectId) - Reference to User
- `region` (String)
- `country` (String)
- `reimbursements` (Array of objects):
  - `reimbursementId` (String)
  - `asin` (String)
  - `sku` (String)
  - `fnsku` (String)
  - `reimbursementType` (Enum: LOST, DAMAGED, CUSTOMER_RETURN, FEE_CORRECTION, INBOUND_SHIPMENT, REMOVAL_ORDER, WAREHOUSE_DAMAGE, INVENTORY_DIFFERENCE, OTHER)
  - `amount` (Number)
  - `currency` (String)
  - `quantity` (Number)
  - `reasonCode` (String)
  - `reasonDescription` (String)
  - `caseId` (String)
  - `status` (Enum: APPROVED, PENDING, DENIED, POTENTIAL, EXPIRED)
  - `approvalDate` (Date)
  - `reimbursementDate` (Date)
  - `isAutomated` (Boolean)
  - `marketplace` (String)
  - `retailValue` (Number)
  - `shipmentId` (String)
  - `notes` (String)
- `summary` (Object):
  - `totalReceived` (Number)
  - `totalPending` (Number)
  - `totalPotential` (Number)
  - `totalDenied` (Number)
  - `countByType` (Object) - Counts by reimbursement type
  - `amountByType` (Object) - Amounts by reimbursement type
  - `last7Days` (Number)
  - `last30Days` (Number)
  - `last90Days` (Number)
  - `claimsExpiringIn7Days` (Number)
  - `claimsExpiringIn30Days` (Number)
  - `automatedCount` (Number)
  - `manualCount` (Number)
- `lastFetchDate` (Date)
- `dataSource` (String) - Default: 'SP_API'

---

## API Endpoints

### 1. /fba/inbound/v0/shipments
**Service:** `server/Services/Sp_API/shipment.js`  
**Model:** `Shipment`  
**Endpoint:** GET `/fba/inbound/v0/shipments?ShipmentStatusList=...&QueryType=SHIPMENT&MarketplaceId=...`

**Stored Data:**
- `User` (ObjectId) - Reference to User
- `region` (String)
- `country` (String)
- `shipmentData` (Array of objects):
  - `shipmentId` (String)
  - `shipmentName` (String)
  - `itemDetails` (Array of objects):
    - `SellerSKU` (String)
    - `FulfillmentNetworkSKU` (String)
    - `QuantityShipped` (String)
    - `QuantityReceived` (String)

**Note:** Only CLOSED shipments are stored with their item details fetched from the items endpoint.

---

### 2. /fba/inbound/v0/shipments/{id}/items
**Service:** `server/Services/Sp_API/shipment.js`  
**Model:** `Shipment` (nested in shipmentData.itemDetails)  
**Endpoint:** GET `/fba/inbound/v0/shipments/{shipmentId}/items`

**Stored Data:**
- Used to fetch item details for each shipment
- Data is stored as part of the Shipment model in `shipmentData[].itemDetails[]`

---

### 3. /listings/2021-08-01/items/{seller}/{sku}
**Service:** `server/Services/Sp_API/GetListingItemsIssues.js`  
**Model:** `ListingItems`  
**Endpoint:** GET `/listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...&issueLocale=...&includedData=...`

**Stored Data:**
- `User` (ObjectId) - Reference to User
- `region` (String)
- `country` (String)
- `GenericKeyword` (Array of objects):
  - `asin` (String)
  - `value` (String) - Generic keyword value
  - `marketplace_id` (String)

**Note:** Only extracts `generic_keyword` attribute from the listing item data.

---

## Data Models Summary

### Models with User, Region, Country Pattern
Most models follow this pattern:
- `User` (ObjectId) - Reference to User model
- `region` (String)
- `country` (String)
- `timestamps: true` - Automatically adds `createdAt` and `updatedAt`

### Models List
1. `ProductWiseFBAData` - FBA estimated fees data
2. `Reimbursement` - FBA reimbursement data with comprehensive tracking
3. `Shipment` - FBA shipment data
4. `ListingItems` - Listing items with generic keywords

---

## Notes

1. **Date Ranges:**
   - GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA: 30 days
   - GET_FBA_REIMBURSEMENTS_DATA: 90 days

2. **Data Processing:** 
   - GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA: TSV format converted to JSON, calculates `reimbursementPerUnit = (Sales Price – Fees)` automatically
   - GET_FBA_REIMBURSEMENTS_DATA: TSV format converted to JSON
   - Shipment endpoints: JSON response from SP-API
   - Listings endpoint: JSON response from SP-API

3. **Calculated Fields:**
   - `ProductWiseFBAData.reimbursementPerUnit`: Automatically calculated as `(Sales Price – Fees)` during data processing
   - This value is used in reimbursement calculations for shipment discrepancies

4. **Shipment Endpoints Relationship:**
   - The `/fba/inbound/v0/shipments` endpoint fetches shipment list
   - The `/fba/inbound/v0/shipments/{id}/items` endpoint is called for each CLOSED shipment to get item details
   - Both endpoints' data are combined and stored in the `Shipment` model

---

## Last Updated
- **2025-01-XX**: Updated ProductWiseFBAData model with all fields from GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA report
- **2025-01-XX**: Added reimbursementPerUnit calculation (Sales Price – Fees)
- **2025-01-XX**: Added test endpoint for GetProductWiseFBAData