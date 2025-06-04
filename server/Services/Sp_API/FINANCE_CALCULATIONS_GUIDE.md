# Amazon Finance Calculations Guide

## Overview
This guide explains how Amazon financial transactions are processed and calculated for database storage.

## Transaction Types

### 1. **Shipment** (Positive)
- Represents actual sales/orders
- Always positive amounts
- Contains product details (ASIN, quantity)
- Contributes to Total Sales

### 2. **Refund** (Negative)
- Customer returns and refunds
- Always negative amounts
- Reduces gross profit

### 3. **ProductAdsPayment** (Negative)
- Sponsored products advertising costs
- Always negative amounts
- Marketing expense

### 4. **ServiceFee** (Negative)
- Various Amazon service charges
- Categorized by description:
  - **FBA Fees**: Fulfillment fees (contains "fba" in description)
  - **Storage Fees**: Storage charges (contains "storage" or "FBAStorageBilling")
  - **Amazon Charges**: Subscription fees (contains "subscription")
  - **Other Service Fees**: Uncategorized service fees

### 5. **Tax** (Can be Positive or Negative)
- Sales tax collected (positive) - added to Total Sales
- Tax payments (negative) - reduces profit

### 6. **DebtRecovery** (Negative)
- Account balance recovery
- Usually negative

### 7. **Adjustment** (Can be Positive or Negative)
- Inventory reimbursements (positive)
- Other adjustments

## Calculations

### Total Sales
```
Total Sales = Sum of all Shipment amounts + Positive Tax amounts
```

### Gross Profit
```
Gross Profit = Total Sales + All Fees and Charges
           = Total Sales + Refunds + ProductAdsPayment + FBA_Fees 
             + Amazon_Charges + Storage + DebtRecovery + Adjustments
```
Note: Since fees are negative, they reduce the gross profit.

### Database Fields

1. **Total_Sales**: Total revenue from shipments
2. **Gross_Profit**: Net profit after all fees
3. **ProductAdsPayment**: Advertising costs (stored as positive)
4. **FBA_Fees**: Fulfillment and other service fees (stored as positive)
5. **Amazon_Charges**: Subscription fees (stored as positive)
6. **Refunds**: Total refunds (stored as positive)
7. **Storage**: Storage fees (stored as positive)
8. **ProductWiseSales**: Array of ASIN-level sales data

## Product-wise Sales Aggregation

The system aggregates sales by ASIN to avoid duplicates:
- Groups all shipments by ASIN
- Sums quantities and amounts for each ASIN
- Stores as an array in the ProductWiseSales collection

## Important Notes

1. All monetary values are stored with 2 decimal precision
2. Negative amounts (fees) are converted to positive for database storage using `Math.abs()`
3. The system handles missing or null values gracefully with default 0
4. Unhandled transaction types are logged for debugging

## Example Transaction Data

```json
{
  "transactionType": "Shipment",
  "description": "Order Payment",
  "totalAmount": {
    "currencyAmount": 150.00,
    "currencyCode": "USD"
  },
  "items": [{
    "contexts": [{
      "asin": "B08N5WRWNW",
      "quantityShipped": 2
    }],
    "totalAmount": {
      "currencyAmount": 150.00
    }
  }]
}
```

## Testing

Run the test file to validate calculations:
```bash
node server/Services/Test/TestFinanceCalculations.js
``` 