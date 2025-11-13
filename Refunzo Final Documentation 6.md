


**Formulas:**

All Shipments:

1. Call API: "/fba/inbound/v0/shipments", with status = Closed for Last 12 months
1. UPDATE/INSERT all data in AllShipments Table
1. Call the same API in loop till there is more data – it is pagination wise api

Shipment Items:

1. For All Shipments above in loop, Call the API: $"/fba/inbound/v0/shipments/{ship}/items" Where “ship” is shipment id.
1. INSERT/UPDATE all data in ShipmentItems Table

Listing Items:

1. For all Shipment Items, get Seller SKU, and call "/listings/2021-08-01/items/{token.SellerPartnerId}/{sku}” API in loop
1. This one is to get metadata about each shipment item, like image and other things
1. Store all data in Listing Items table (INSERT/UPDATE)

` `Fee Protector Data:

1. Get All the data from Report: GET\_FBA\_ESTIMATED\_FBA\_FEES\_TXT\_DATA
1. Following fields are fetched from the report
   1. a.       "sku","fnsku","asin","longest-side",”median-side","shortest-side","unit-of-dimension","item-package-weight","unit-of-weight","estimated-fee-total","currency","sales-price"
1. Based on these fields, Fee Protector BackendShipmentItems and BackendShipments is populated
1. For Backend Shipment Item, SKU, FNSKU, ASIN is used with Sales Price and Estimated total fees to calculate Reimbursement Per Unit
1. Reimbursement Per Unit is : (Sales Price – Fees) 
1. Backend Shipments is calculated from Shipments where there is a discrepancy. First “Adjustments” are taken into account, if Adjustments are done by client, they are pulled, otherwise, if Amazon Reported discrepancy then those are pulled.



Units sold:

1. Just to get Unit Sold for Fee Protector we are calling the following API in loop for All ASINs that we got previously.
1. /sales/v1/orderMetrics
1. Units Sold are stored in Fee Protector

` `Backend Lost Inventory / Backend Underpaid:

1. Following two reports are called for this:
1. GET\_LEDGER\_SUMMARY\_VIEW\_DATA
1. GET\_FBA\_REIMBURSEMENTS\_DATA
1. From first report, we get found and lost quantity which is stored in Backend lost inventory
1. From second report we get Reimbursed Units where reason is “Lost\_warehouse”
1. Based on these 3 values, we calculate Reimbursement Per Unit and expected amount
1. Discrepancy Units = Lost Units – Found Units – Reimbursed Units
1. Expected Amount = Discrepancy Units \* (Sales Price – Fees) (from previous reports)
1. ` `From Second report we get “Amount per unit”
1. If Amount per Unit < ((Sales Price – Fees) \* 0.4) then that gets stored as Underpaid item
1. Here, expected amount is: ((Sales Price – Fees) - Amount per Unit) \* quantity;

` `Backend Damaged Inventory:

1. Report: GET\_FBA\_FULFILLMENT\_INVENTORY\_ADJUSTMENTS\_DATA
1. If Reason is “SELLABLE”, “WAREHOUSE\_DAMAGED”, “DISTRIBUTOR\_DAMAGED”, “EXPIRED”
1. Then Quantity is Discrepancy Units
1. And Expected Amount is: Discrepancy Units \* (Sales Price – fees);

` `Backend Fees:

1\.       Based on Actual Values specified by client in Fee Protector, difference is calculated and stored based on Region wise values for FBA fees given in a different sheet (already shared).



