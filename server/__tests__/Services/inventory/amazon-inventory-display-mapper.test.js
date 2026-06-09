const {
  mapFbaDetailToAmazonInventory,
} = require('../../../Services/inventory/AmazonInventoryDisplayMapper.js');

describe('mapFbaDetailToAmazonInventory', () => {
  it('maps SP-API row to Seller Central buckets (US SKU 1000 sample)', () => {
    const mapped = mapFbaDetailToAmazonInventory({
      fulfillableQuantity: 2011,
      pendingTransshipmentQuantity: 29,
      inboundWorkingQuantity: 0,
      inboundShippedQuantity: 0,
      inboundReceivingQuantity: 95,
      pendingCustomerOrderQuantity: 2,
      fcProcessingQuantity: 115,
      totalUnfulfillableQuantity: 0,
      totalResearchingQuantity: 13,
      totalQuantity: 2252,
    });

    expect(mapped.available).toBe(2011);
    expect(mapped.onHand.total).toBe(2040);
    expect(mapped.inbound.total).toBe(0);
    expect(mapped.inbound.receiving).toBe(95);
    expect(mapped.reserved.total).toBe(117);
    expect(mapped.researching).toBe(13);
    expect(mapped.total).toBe(2170);
    expect(mapped.apiTotalQuantity).toBe(2252);
  });
});
