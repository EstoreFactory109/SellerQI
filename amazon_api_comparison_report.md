# Amazon FBA Reimbursement Flow APIs - Status Comparison Report

## Executive Summary
This document analyzes the APIs and reports referenced in your reimbursement flow diagram, comparing them with the current Amazon SP-API landscape to identify which are active, discontinued, and their replacements.

---

## 1. API/Report Status Overview

### 📊 Status Categories:
- ✅ **ACTIVE** - Still available and functioning
- ❌ **DEPRECATED** - Discontinued/No longer available
- ⚠️ **RESTRICTED** - Requires special permissions or has limitations
- 🔄 **REPLACED** - Has a newer replacement API/report

---

## 2. Detailed Status Analysis

### A. INVENTORY REPORTS

#### 1. GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Previously provided corrections and updates to inventory due to damage, loss, receiving discrepancies
- **Replacement:** 
  - **GET_LEDGER_DETAIL_VIEW_DATA** (with `eventType: "Adjustments"`)
  - **GET_LEDGER_SUMMARY_VIEW_DATA** (for summary reconciliation)
- **Migration Notes:** 
  - The new Ledger reports provide more comprehensive data but require combining both reports for complete reconciliation
  - Use reportOptions to filter for specific adjustment types

#### 2. GET_FBA_FULFILLMENT_CURRENT_INVENTORY_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Previously provided current FBA inventory snapshot
- **Replacement:** 
  - **GET_AFN_INVENTORY_DATA** (for real-time inventory)
  - **GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA** (for detailed inventory)
  - **FBA Inventory API** `/fba/inventory/v1/summaries` (for API access)

#### 3. GET_FBA_FULFILLMENT_MONTHLY_INVENTORY_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Monthly inventory aggregation
- **Replacement:** 
  - **GET_LEDGER_SUMMARY_VIEW_DATA** (with `aggregatedByTimePeriod: "MONTHLY"`)

#### 4. GET_FBA_RECONCILIATION_REPORT_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Inventory reconciliation
- **Replacement:** 
  - **GET_LEDGER_SUMMARY_VIEW_DATA**
  - Provides end-to-end inventory reconciliation with starting balance, receipts, orders, returns, adjustments, and ending balance

#### 5. GET_FBA_FULFILLMENT_INVENTORY_SUMMARY_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Inventory summary data
- **Replacement:** 
  - **GET_LEDGER_SUMMARY_VIEW_DATA**
  - **GET_AFN_INVENTORY_DATA** (for current inventory snapshot)

#### 6. GET_FBA_FULFILLMENT_INVENTORY_RECEIPTS_DATA
- **Status:** ❌ **DEPRECATED** (as of January 31, 2023)
- **Purpose:** Tracking inventory receipts
- **Replacement:** 
  - **GET_LEDGER_DETAIL_VIEW_DATA** (with `eventType: "Receipts"`)

---

### B. REIMBURSEMENT REPORTS

#### 7. GET_FBA_REIMBURSEMENTS_DATA
- **Status:** ✅ **ACTIVE** (Still Available)
- **Purpose:** Contains itemized details of seller's inventory reimbursements, including reason for reimbursement
- **Frequency:** Content updated daily
- **Request Type:** Can only be requested (not scheduled)
- **Required Role:** Amazon Fulfillment
- **Important Notes:**
  - This report has throttling limits (approximately 238 minutes between requests)
  - The report returns data across all marketplaces regardless of marketplaceIds parameter
  - Still actively used and maintained as of 2024

---

### C. FINANCIAL REPORTS

#### 8. Financial Events API
- **Status:** ✅ **ACTIVE** (Updated version available)
- **Current Version:** Finances API v2024-06-19
- **Purpose:** Provides financial information relevant to seller's business
- **Endpoints:**
  - `/finances/v2024-06-19/financialEvents`
  - `/finances/v2024-06-19/financialEventGroups`
- **Key Features:**
  - Can obtain financial events for specified order or date range
  - No need to wait for statement period to close
  - Includes reimbursement events

---

### D. SHIPMENT & ORDER REPORTS

#### 9. GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL
- **Status:** ✅ **ACTIVE**
- **Purpose:** Detailed order/shipment/item information
- **Frequency:** Near real-time (1-3 hour delay)
- **Required Roles:** Pricing, Amazon Fulfillment, Inventory and Order Tracking

#### 10. GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL
- **Status:** ✅ **ACTIVE**
- **Purpose:** All orders updated in specified date range
- **Use Case:** Order tracking across all fulfillment channels

---

### E. FEE REPORTS

#### 11. GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA
- **Status:** ✅ **ACTIVE**
- **Purpose:** Estimated Amazon Selling and Fulfillment Fees
- **Update Frequency:** At least once every 72 hours
- **Limitation:** Can only be requested once per day per seller

#### 12. GET_FBA_STORAGE_FEE_CHARGES_DATA
- **Status:** ✅ **ACTIVE**
- **Purpose:** Estimated monthly inventory storage fees
- **Can be requested or scheduled**

---

## 3. NEW LEDGER REPORTS - Detailed Overview

### GET_LEDGER_SUMMARY_VIEW_DATA
**Purpose:** Comprehensive inventory reconciliation "bank statement"

**Key Features:**
- Shows starting inventory balance
- Received inventory
- Customer orders
- Customer returns
- Adjustments
- Removals
- Ending balance

**Report Options:**
```json
{
  "aggregateByLocation": "COUNTRY" or "FC",
  "aggregatedByTimePeriod": "MONTHLY", "WEEKLY", or "DAILY",
  "FNSKU": "specific_fnsku",
  "MSKU": "specific_msku",
  "ASIN": "specific_asin"
}
```

### GET_LEDGER_DETAIL_VIEW_DATA
**Purpose:** Detailed inventory movement analysis

**Key Features:**
- 18 months of historical data
- Detailed transaction-level information
- Can filter by event type

**Event Types:**
- `Adjustments` - Inventory corrections
- `CustomerReturns` - Returned items
- `Receipts` - Incoming inventory
- `Shipments` - Outgoing orders
- `VendorReturns` - Returns to vendor
- `WhseTransfers` - Warehouse transfers

**Report Options:**
```json
{
  "eventType": "Adjustments",
  "FNSKU": "specific_fnsku",
  "MSKU": "specific_msku",
  "ASIN": "specific_asin"
}
```

---

## 4. Migration Recommendations

### For Reimbursement Tracking Workflow:

1. **Continue Using:**
   - GET_FBA_REIMBURSEMENTS_DATA (still active)
   - Financial Events API
   - GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL

2. **Replace Immediately:**
   - GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA → GET_LEDGER_DETAIL_VIEW_DATA
   - GET_FBA_RECONCILIATION_REPORT_DATA → GET_LEDGER_SUMMARY_VIEW_DATA

3. **Implementation Strategy:**
   ```python
   # Example: Getting adjustment data with new API
   {
     "reportType": "GET_LEDGER_DETAIL_VIEW_DATA",
     "dataStartTime": "2024-01-01T00:00:00Z",
     "dataEndTime": "2024-01-31T23:59:59Z",
     "marketplaceIds": ["ATVPDKIKX0DER"],
     "reportOptions": {
       "eventType": "Adjustments"
     }
   }
   ```

---

## 5. Key Differences in New Reports

### Advantages of New Ledger Reports:
✅ More comprehensive data coverage
✅ 18 months of historical data
✅ Better aggregation options
✅ Unified reconciliation view

### Limitations Compared to Old Reports:
❌ More complex to parse (combines multiple data types)
❌ Doesn't clearly separate inventory statuses (fulfillable, reserved, inbound)
❌ Requires combining multiple reports for complete picture
❌ Some specific details from old reports may be obscured

---

## 6. API Rate Limits & Best Practices

### Report Generation Limits:
- **Near Real-Time Reports:** Maximum once every 30 minutes
- **Daily Reports:** Maximum once every 4 hours
- **GET_FBA_REIMBURSEMENTS_DATA:** ~238 minutes between requests

### Best Practices:
1. Implement exponential backoff for retry logic
2. Cache report data to minimize API calls
3. Use report scheduling where available
4. Monitor throttling responses
5. Combine data requests when possible

---

## 7. Required Roles & Permissions

### Essential Seller Central Roles:
- **Amazon Fulfillment** - Required for most FBA reports
- **Inventory and Order Tracking** - For order-related reports
- **Pricing** - For fee-related reports
- **Tax Invoicing/Remittance (Restricted)** - For tax reports

### Setup Requirements:
1. Enable appropriate roles in Seller Central
2. Wait for role propagation (can take several minutes)
3. Generate refresh tokens with proper scopes
4. Test with minimal API calls first

---

## 8. Action Items for Your System

### Immediate Actions:
1. ✅ Continue using GET_FBA_REIMBURSEMENTS_DATA (still active)
2. 🔄 Migrate from deprecated inventory adjustments report to Ledger reports
3. 📝 Update API documentation and error handling

### Code Updates Required:
```javascript
// OLD CODE (Deprecated)
{
  "reportType": "GET_FBA_FULFILLMENT_INVENTORY_ADJUSTMENTS_DATA",
  "dataStartTime": "2024-01-01T00:00:00Z",
  "dataEndTime": "2024-01-31T23:59:59Z"
}

// NEW CODE (Replacement)
{
  "reportType": "GET_LEDGER_DETAIL_VIEW_DATA",
  "dataStartTime": "2024-01-01T00:00:00Z",
  "dataEndTime": "2024-01-31T23:59:59Z",
  "reportOptions": {
    "eventType": "Adjustments"
  }
}
```

---

## 9. Testing Checklist

- [ ] Test GET_LEDGER_DETAIL_VIEW_DATA with adjustment filter
- [ ] Test GET_LEDGER_SUMMARY_VIEW_DATA for reconciliation
- [ ] Verify GET_FBA_REIMBURSEMENTS_DATA still working
- [ ] Compare data between old and new reports (if still accessible)
- [ ] Update data parsing logic for new report formats
- [ ] Test rate limiting and throttling behavior
- [ ] Verify all required roles are enabled

---

## 10. Support Resources

- **Official Documentation:** https://developer-docs.amazon.com/sp-api/
- **Report Type Values:** https://developer-docs.amazon.com/sp-api/docs/report-type-values
- **Migration Hub:** https://developer-docs.amazon.com/sp-api/docs/migration-hub
- **GitHub Issues:** https://github.com/amzn/selling-partner-api-docs/issues

---

## Conclusion

While the GET_FBA_REIMBURSEMENTS_DATA report remains active and is still the primary source for reimbursement data, several supporting inventory reports have been deprecated and replaced with the new Ledger reports. The migration to these new reports is mandatory as the old reports are no longer available as of January 31, 2023.

The new Ledger reports provide more comprehensive data but require adjustments to parsing logic and potentially combining multiple reports to achieve the same level of detail previously available in individual specialized reports.

---

*Last Updated: November 2024*
*Note: Amazon's API landscape changes frequently. Always refer to official documentation for the most current information.*
