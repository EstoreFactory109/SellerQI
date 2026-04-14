export const DEMO_NAVBAR = {
  Brand: 'SellerQI Demo Brand',
  Country: 'US',
  Region: 'NA',
  AllSellerAccounts: [
    { userId: 'demo-account-1', country: 'US', region: 'NA', brand: 'SellerQI Demo Brand' },
    { userId: 'demo-account-2', country: 'DE', region: 'EU', brand: 'SellerQI Demo Brand EU' }
  ]
};

export const DEMO_USER = {
  accessType: 'user',
  packageType: 'PRO',
  // DemoTasks.jsx fetches only if `userData.userId` is present.
  userId: 'demo-account-1',
  isVerified: true,
  isInTrialPeriod: false,
  FirstAnalysisDone: true,
  // Fields used by integration checks are not strictly required for this demo,
  // because the demo routes bypass auth + gating.
  spiRefreshToken: 'demo-sp-token',
  adsRefreshToken: 'demo-ads-token',
  brand: DEMO_NAVBAR.Brand
};

const mkAlert = ({
  id,
  type,
  alertType,
  title,
  message,
  issueCount,
  timestamp,
  viewed = false,
  products = []
}) => ({
  id,
  type,
  alertType,
  title,
  message,
  issueCount: issueCount ?? null,
  timestamp,
  isRead: viewed,
  viewed,
  products
});

export const DEMO_NOTIFICATIONS = [
  mkAlert({
    id: 'a1',
    type: 'alert',
    alertType: 'ProductContentChange',
    title: 'Content change detected',
    message: 'We detected product title/bullet point changes for 2 products.',
    issueCount: 2,
    timestamp: '2026-03-18T10:12:00.000Z',
    viewed: false,
    products: [
      { asin: 'B0DEMO001', sku: 'SKU-001', title: 'Demo Product 1' },
      { asin: 'B0DEMO002', sku: 'SKU-002', title: 'Demo Product 2' }
    ]
  }),
  mkAlert({
    id: 'a2',
    type: 'alert',
    alertType: 'BuyBoxMissing',
    title: 'Buy box missing',
    message: 'Buy box is missing on your listing. Check pricing and inventory.',
    issueCount: 1,
    timestamp: '2026-03-17T09:40:00.000Z',
    viewed: true,
    products: [{ asin: 'B0DEMO003', sku: 'SKU-003', title: 'Demo Product 3' }]
  }),
  mkAlert({
    id: 'a3',
    type: 'alert',
    alertType: 'NegativeReviews',
    title: 'Negative reviews detected',
    message: 'We found negative reviews affecting the rating for 1 product.',
    issueCount: 1,
    timestamp: '2026-03-16T15:02:00.000Z',
    viewed: false,
    products: [{ asin: 'B0DEMO001', sku: 'SKU-001', title: 'Demo Product 1' }]
  }),
  mkAlert({
    id: 'n1',
    type: 'analysis_complete',
    title: 'Scheduled Analysis Complete',
    message: 'Your scheduled analysis finished successfully.',
    timestamp: '2026-03-15T12:00:00.000Z',
    viewed: true,
    products: []
  })
];

export const DEMO_TASKS = {
  taskRenewalDate: '2026-04-01T00:00:00.000Z',
  tasks: [
    {
      taskId: 't1',
      title: 'Fix title character limit (B0DEMO001)',
      asin: 'B0DEMO001',
      errorCategory: 'Ranking',
      error: 'Character limit issue detected for B0DEMO001.',
      solution: 'Update the listing text to comply with Amazon character and policy requirements.',
      status: 'completed'
    },
    {
      taskId: 't2',
      title: 'Remove restricted words from title (B0DEMO001)',
      asin: 'B0DEMO001',
      errorCategory: 'Ranking',
      error: 'Restricted words found in B0DEMO001.',
      solution: 'Remove restricted terms and re-check compliance.',
      status: 'in_progress'
    },
    {
      taskId: 't3',
      title: 'Improve image compliance (B0DEMO002)',
      asin: 'B0DEMO002',
      errorCategory: 'Conversion',
      error: 'Conversion optimization issue for B0DEMO002. Images may be missing or not policy-compliant.',
      solution: 'Upload compliant primary image(s) and ensure the main image matches the product.',
      status: 'pending'
    },
    {
      taskId: 't4',
      title: 'Stabilize Buy Box (B0DEMO003)',
      asin: 'B0DEMO003',
      errorCategory: 'Conversion',
      error: 'Conversion optimization issue for B0DEMO003. Buy Box ownership is unstable.',
      solution: 'Improve pricing, fulfillment/shipping, and seller health metrics to secure Buy Box.',
      status: 'pending'
    },
    {
      taskId: 't5',
      title: 'Reduce long-term storage risk (B0DEMO004)',
      asin: 'B0DEMO004',
      errorCategory: 'Inventory',
      error: 'Long-term storage fee risk for B0DEMO004.',
      solution: 'Reduce storage duration or optimize inventory replenishment cycles.',
      status: 'pending'
    },
    {
      taskId: 't6',
      title: 'Resolve unfulfillable inbound issue (B0DEMO004)',
      asin: 'B0DEMO004',
      errorCategory: 'Inventory',
      error: 'Unfulfillable inventory flagged for B0DEMO004.',
      solution: 'Check inbound shipment/receiving status and ensure correct prep requirements.',
      status: 'pending'
    },
    {
      taskId: 't7',
      title: 'Fix stranded inventory placement (B0DEMO001)',
      asin: 'B0DEMO001',
      errorCategory: 'Inventory',
      error: 'Stranded inventory detected for B0DEMO001.',
      solution: 'Resolve listing/eligibility issues and update inventory placement to make units sellable.',
      status: 'in_progress'
    },
    {
      taskId: 't8',
      title: 'Refresh brand story content (B0DEMO005)',
      asin: 'B0DEMO005',
      errorCategory: 'Conversion',
      error: 'Conversion optimization issue for B0DEMO005. Brand story content needs update.',
      solution: 'Ensure brand story text and assets are accurate and policy-compliant.',
      status: 'pending'
    }
  ]
};

export const DEMO_REIMBURSEMENT = {
  summary: {
    totalUnderpaid: 128.75,
    totalRecoverable: 4286.2,
    totalPotential: 2514.7,
    totalReceived: 1771.5,
    claimsExpiringIn7Days: 4,
    totalClaims: 22,
    lastUpdated: '2026-03-18T08:00:00.000Z',
    feeProtector: {
      backendShipmentItems: {
        count: 7,
        totalExpectedAmount: 2410.1,
        data: [
          {
            date: '2026-03-18T12:00:00.000Z',
            shipmentId: 'SHP-10001',
            shipmentName: 'MSKU-Refresh-1',
            asin: 'B0DEMO001',
            sku: 'SKU-001',
            quantityShipped: 1000,
            quantityReceived: 990,
            discrepancyUnits: 10,
            expectedAmount: 420.25
          },
          {
            date: '2026-03-14T00:00:00.000Z',
            shipmentId: 'SHP-10002',
            shipmentName: 'Inbound-Run-2',
            asin: 'B0DEMO002',
            sku: 'SKU-002',
            quantityShipped: 500,
            quantityReceived: 495,
            discrepancyUnits: 5,
            expectedAmount: 330.0
          },
          {
            date: '2026-03-09T00:00:00.000Z',
            shipmentId: 'SHP-10003',
            shipmentName: 'Repack-Dispatch-3',
            asin: 'B0DEMO003',
            sku: 'SKU-003',
            quantityShipped: 150,
            quantityReceived: 145,
            discrepancyUnits: 5,
            expectedAmount: 250.75
          },
          {
            date: '2026-03-05T00:00:00.000Z',
            shipmentId: 'SHP-10004',
            shipmentName: 'West-Coast-Restock',
            asin: 'B0DEMO010',
            sku: 'SKU-010',
            quantityShipped: 420,
            quantityReceived: 410,
            discrepancyUnits: 10,
            expectedAmount: 308.4
          },
          {
            date: '2026-03-03T00:00:00.000Z',
            shipmentId: 'SHP-10005',
            shipmentName: 'EU-Bridge-Run',
            asin: 'B0DEMO014',
            sku: 'SKU-014',
            quantityShipped: 360,
            quantityReceived: 352,
            discrepancyUnits: 8,
            expectedAmount: 214.65
          },
          {
            date: '2026-02-28T00:00:00.000Z',
            shipmentId: 'SHP-10006',
            shipmentName: 'Prime-Prep-Lot',
            asin: 'B0DEMO019',
            sku: 'SKU-019',
            quantityShipped: 510,
            quantityReceived: 500,
            discrepancyUnits: 10,
            expectedAmount: 289.5
          },
          {
            date: '2026-02-25T00:00:00.000Z',
            shipmentId: 'SHP-10007',
            shipmentName: 'Seasonal-Home-Set',
            asin: 'B0DEMO021',
            sku: 'SKU-021',
            quantityShipped: 700,
            quantityReceived: 695,
            discrepancyUnits: 5,
            expectedAmount: 196.55
          }
        ]
      }
    },
    backendLostInventory: {
      totalExpectedAmount: 1184.95,
      data: [
        {
          date: '2026-04-12T00:00:00.000Z',
          asin: 'B0DEMO003',
          sku: 'SKU-003',
          fnsku: 'FNSKU-003',
          lostUnits: 20,
          foundUnits: 12,
          reimbursedUnits: 8,
          discrepancyUnits: 8,
          expectedAmount: 98.4,
          underpaidExpectedAmount: 45.1,
          isUnderpaid: true
        },
        {
          date: '2026-04-08T00:00:00.000Z',
          asin: 'B0DEMO004',
          sku: 'SKU-004',
          fnsku: 'FNSKU-004',
          lostUnits: 30,
          foundUnits: 25,
          reimbursedUnits: 10,
          discrepancyUnits: 5,
          expectedAmount: 85.25,
          underpaidExpectedAmount: 0,
          isUnderpaid: false
        },
        {
          date: '2026-04-05T00:00:00.000Z',
          asin: 'B0DEMO001',
          sku: 'SKU-001',
          fnsku: 'FNSKU-001',
          lostUnits: 40,
          foundUnits: 20,
          reimbursedUnits: 15,
          discrepancyUnits: 20,
          expectedAmount: 66.1,
          underpaidExpectedAmount: 0,
          isUnderpaid: false
        },
        {
          date: '2026-04-03T00:00:00.000Z',
          asin: 'B0DEMO011',
          sku: 'SKU-011',
          fnsku: 'FNSKU-011',
          lostUnits: 26,
          foundUnits: 17,
          reimbursedUnits: 4,
          discrepancyUnits: 9,
          expectedAmount: 132.6,
          underpaidExpectedAmount: 38.25,
          isUnderpaid: true
        },
        {
          date: '2026-03-30T00:00:00.000Z',
          asin: 'B0DEMO018',
          sku: 'SKU-018',
          fnsku: 'FNSKU-018',
          lostUnits: 14,
          foundUnits: 8,
          reimbursedUnits: 3,
          discrepancyUnits: 6,
          expectedAmount: 88.75,
          underpaidExpectedAmount: 12.4,
          isUnderpaid: true
        },
        {
          date: '2026-03-27T00:00:00.000Z',
          asin: 'B0DEMO020',
          sku: 'SKU-020',
          fnsku: 'FNSKU-020',
          lostUnits: 18,
          foundUnits: 10,
          reimbursedUnits: 5,
          discrepancyUnits: 8,
          expectedAmount: 110.6,
          underpaidExpectedAmount: 0,
          isUnderpaid: false
        },
        {
          date: '2026-04-11T00:00:00.000Z',
          asin: 'B0DEMO007',
          sku: 'SKU-007',
          fnsku: 'FNSKU-007',
          lostUnits: 22,
          foundUnits: 13,
          reimbursedUnits: 4,
          discrepancyUnits: 9,
          expectedAmount: 149.8,
          underpaidExpectedAmount: 21.35,
          isUnderpaid: true
        },
        {
          date: '2026-04-09T00:00:00.000Z',
          asin: 'B0DEMO015',
          sku: 'SKU-015',
          fnsku: 'FNSKU-015',
          lostUnits: 19,
          foundUnits: 12,
          reimbursedUnits: 3,
          discrepancyUnits: 7,
          expectedAmount: 117.6,
          underpaidExpectedAmount: 0,
          isUnderpaid: false
        },
        {
          date: '2026-04-06T00:00:00.000Z',
          asin: 'B0DEMO022',
          sku: 'SKU-022',
          fnsku: 'FNSKU-022',
          lostUnits: 16,
          foundUnits: 9,
          reimbursedUnits: 2,
          discrepancyUnits: 7,
          expectedAmount: 103.5,
          underpaidExpectedAmount: 18.2,
          isUnderpaid: true
        }
      ]
    },
    backendDamagedInventory: {
      totalExpectedAmount: 1010.35,
      data: [
        {
          date: '2026-04-13T00:00:00.000Z',
          asin: 'B0DEMO005',
          sku: 'SKU-005',
          fnsku: 'FNSKU-005',
          damagedUnits: 12,
          salesPrice: 10.99,
          fees: 3.2,
          reimbursementPerUnit: 6.25,
          expectedAmount: 75.0
        },
        {
          date: '2026-04-10T00:00:00.000Z',
          asin: 'B0DEMO002',
          sku: 'SKU-002',
          fnsku: 'FNSKU-002',
          damagedUnits: 9,
          salesPrice: 19.5,
          fees: 5.0,
          reimbursementPerUnit: 8.37,
          expectedAmount: 80.3
        },
        {
          date: '2026-04-08T00:00:00.000Z',
          asin: 'B0DEMO013',
          sku: 'SKU-013',
          fnsku: 'FNSKU-013',
          damagedUnits: 15,
          salesPrice: 25.2,
          fees: 6.4,
          reimbursementPerUnit: 9.15,
          expectedAmount: 137.25
        },
        {
          date: '2026-04-04T00:00:00.000Z',
          asin: 'B0DEMO019',
          sku: 'SKU-019',
          fnsku: 'FNSKU-019',
          damagedUnits: 11,
          salesPrice: 23.9,
          fees: 5.8,
          reimbursementPerUnit: 8.17,
          expectedAmount: 89.9
        },
        {
          date: '2026-03-31T00:00:00.000Z',
          asin: 'B0DEMO021',
          sku: 'SKU-021',
          fnsku: 'FNSKU-021',
          damagedUnits: 28,
          salesPrice: 12.95,
          fees: 2.7,
          reimbursementPerUnit: 3.57,
          expectedAmount: 99.96
        },
        {
          date: '2026-04-12T00:00:00.000Z',
          asin: 'B0DEMO006',
          sku: 'SKU-006',
          fnsku: 'FNSKU-006',
          damagedUnits: 17,
          salesPrice: 27.49,
          fees: 6.1,
          reimbursementPerUnit: 10.2,
          expectedAmount: 173.4
        },
        {
          date: '2026-04-09T00:00:00.000Z',
          asin: 'B0DEMO014',
          sku: 'SKU-014',
          fnsku: 'FNSKU-014',
          damagedUnits: 14,
          salesPrice: 28.0,
          fees: 6.0,
          reimbursementPerUnit: 9.6,
          expectedAmount: 134.4
        },
        {
          date: '2026-04-06T00:00:00.000Z',
          asin: 'B0DEMO017',
          sku: 'SKU-017',
          fnsku: 'FNSKU-017',
          damagedUnits: 20,
          salesPrice: 17.3,
          fees: 4.2,
          reimbursementPerUnit: 6.05,
          expectedAmount: 121.0
        },
        {
          date: '2026-04-02T00:00:00.000Z',
          asin: 'B0DEMO011',
          sku: 'SKU-011',
          fnsku: 'FNSKU-011',
          damagedUnits: 22,
          salesPrice: 39.0,
          fees: 8.5,
          reimbursementPerUnit: 14.1,
          expectedAmount: 310.2
        }
      ]
    },
    backendDisposedInventory: {
      totalExpectedAmount: 356.7,
      data: [
        {
          date: '2026-04-12T00:00:00.000Z',
          asin: 'B0DEMO001',
          sku: 'SKU-001',
          fnsku: 'FNSKU-001',
          disposedUnits: 25,
          salesPrice: 29.99,
          fees: 7.5,
          reimbursementPerUnit: 2.88,
          expectedAmount: 72.1
        },
        {
          date: '2026-04-07T00:00:00.000Z',
          asin: 'B0DEMO004',
          sku: 'SKU-004',
          fnsku: 'FNSKU-004',
          disposedUnits: 18,
          salesPrice: 24.75,
          fees: 5.0,
          reimbursementPerUnit: 2.69,
          expectedAmount: 48.4
        },
        {
          date: '2026-04-04T00:00:00.000Z',
          asin: 'B0DEMO008',
          sku: 'SKU-008',
          fnsku: 'FNSKU-008',
          disposedUnits: 21,
          salesPrice: 32.25,
          fees: 7.2,
          reimbursementPerUnit: 4.15,
          expectedAmount: 87.15
        },
        {
          date: '2026-03-29T00:00:00.000Z',
          asin: 'B0DEMO016',
          sku: 'SKU-016',
          fnsku: 'FNSKU-016',
          disposedUnits: 26,
          salesPrice: 22.6,
          fees: 5.6,
          reimbursementPerUnit: 3.22,
          expectedAmount: 83.72
        },
        {
          date: '2026-03-24T00:00:00.000Z',
          asin: 'B0DEMO023',
          sku: 'SKU-023',
          fnsku: 'FNSKU-023',
          disposedUnits: 20,
          salesPrice: 15.7,
          fees: 3.4,
          reimbursementPerUnit: 3.87,
          expectedAmount: 77.4
        }
      ]
    }
  },
  reimbursements: [
    {
      id: 'r1',
      status: 'underpaid',
      type: 'shipment',
      shipmentId: 'SHP-10001',
      date: '2026-03-12T00:00:00.000Z',
      amount: 420.25
    },
    {
      id: 'r2',
      status: 'underpaid',
      type: 'invoice',
      shipmentId: 'INV-20021',
      date: '2026-03-09T00:00:00.000Z',
      amount: 330.0
    },
    {
      id: 'r3',
      status: 'open',
      type: 'lost_inventory',
      shipmentId: 'LI-31011',
      date: '2026-03-06T00:00:00.000Z',
      amount: 132.6
    },
    {
      id: 'r4',
      status: 'received',
      type: 'damaged_inventory',
      shipmentId: 'DI-41009',
      date: '2026-03-03T00:00:00.000Z',
      amount: 89.9
    },
    {
      id: 'r5',
      status: 'open',
      type: 'disposed_inventory',
      shipmentId: 'DP-51005',
      date: '2026-03-01T00:00:00.000Z',
      amount: 83.72
    },
    {
      id: 'r6',
      status: 'underpaid',
      type: 'shipment',
      shipmentId: 'SHP-10005',
      date: '2026-02-28T00:00:00.000Z',
      amount: 214.65
    },
    {
      id: 'r7',
      status: 'received',
      type: 'shipment',
      shipmentId: 'SHP-10006',
      date: '2026-02-27T00:00:00.000Z',
      amount: 289.5
    }
  ]
};

export const DEMO_PRODUCTS = [
  { asin: 'B0DEMO001', sku: 'SKU-001', name: 'ErgoFlow Wireless Mouse', price: 29.99, quantity: 120 },
  { asin: 'B0DEMO002', sku: 'SKU-002', name: 'LumaDesk LED Lamp', price: 19.5, quantity: 54 },
  { asin: 'B0DEMO003', sku: 'SKU-003', name: 'ThermoSip Steel Bottle', price: 42.0, quantity: 9 },
  { asin: 'B0DEMO004', sku: 'SKU-004', name: 'CableNest Organizer Kit', price: 24.75, quantity: 33 },
  { asin: 'B0DEMO005', sku: 'SKU-005', name: 'QuickSeal Food Clips Set', price: 10.99, quantity: 200 },
  { asin: 'B0DEMO006', sku: 'SKU-006', name: 'CloudRest Neck Pillow', price: 27.49, quantity: 88 },
  { asin: 'B0DEMO007', sku: 'SKU-007', name: 'GripMax Resistance Bands', price: 21.99, quantity: 150 },
  { asin: 'B0DEMO008', sku: 'SKU-008', name: 'SnapFresh Produce Containers', price: 32.25, quantity: 67 },
  { asin: 'B0DEMO009', sku: 'SKU-009', name: 'BrightFold Travel Mirror', price: 16.8, quantity: 95 },
  { asin: 'B0DEMO010', sku: 'SKU-010', name: 'PureBrew Coffee Canister', price: 34.9, quantity: 42 },
  { asin: 'B0DEMO011', sku: 'SKU-011', name: 'FlexCharge USB Hub 7-in-1', price: 39.0, quantity: 58 },
  { asin: 'B0DEMO012', sku: 'SKU-012', name: 'CalmSleep Eye Mask Pro', price: 14.4, quantity: 180 },
  { asin: 'B0DEMO013', sku: 'SKU-013', name: 'SafeStep Non-Slip Mat', price: 25.2, quantity: 73 },
  { asin: 'B0DEMO014', sku: 'SKU-014', name: 'AeroPack Vacuum Bags', price: 28.0, quantity: 61 },
  { asin: 'B0DEMO015', sku: 'SKU-015', name: 'KitchenEdge Knife Guard Set', price: 18.75, quantity: 110 },
  { asin: 'B0DEMO016', sku: 'SKU-016', name: 'SmartPour Oil Dispenser', price: 22.6, quantity: 47 },
  { asin: 'B0DEMO017', sku: 'SKU-017', name: 'ZenPad Desk Wrist Rest', price: 17.3, quantity: 84 },
  { asin: 'B0DEMO018', sku: 'SKU-018', name: 'FreshGrid Fridge Bins', price: 31.4, quantity: 39 },
  { asin: 'B0DEMO019', sku: 'SKU-019', name: 'ComfyPaws Pet Blanket', price: 23.9, quantity: 126 },
  { asin: 'B0DEMO020', sku: 'SKU-020', name: 'HydraLoop Running Belt', price: 26.5, quantity: 52 },
  { asin: 'B0DEMO021', sku: 'SKU-021', name: 'SparkClean Bottle Brush', price: 12.95, quantity: 210 },
  { asin: 'B0DEMO022', sku: 'SKU-022', name: 'ThermaWrap Lunch Tote', price: 20.4, quantity: 0 },
  { asin: 'B0DEMO023', sku: 'SKU-023', name: 'ClipLite Book Lamp', price: 15.7, quantity: 0 }
];

export const DEMO_ISSUES_BY_ASIN = {
  B0DEMO001: {
    asin: 'B0DEMO001',
    sku: 'SKU-001',
    totalErrors: 3,
    rankingErrors: [
      { sectionLabel: 'Title', issueLabel: 'Character Limit', message: 'Title is below required character length.' },
      { sectionLabel: 'Bullet Points', issueLabel: 'Restricted Words', message: 'Detected restricted words. Remove them.' }
    ],
    conversionErrors: [{ sectionLabel: 'Conversion', issueLabel: 'Buy Box', message: 'Conversion rate decreased due to Buy Box.' }],
    inventoryErrors: [{ sectionLabel: 'Inventory', issueLabel: 'Stranded', message: 'Units are stranded due to compliance.' }]
  },
  B0DEMO002: {
    asin: 'B0DEMO002',
    sku: 'SKU-002',
    totalErrors: 1,
    rankingErrors: [{ sectionLabel: 'Backend Keywords', issueLabel: 'Banned Words', message: 'Backend keywords contain a banned term.' }],
    conversionErrors: [],
    inventoryErrors: []
  },
  B0DEMO003: {
    asin: 'B0DEMO003',
    sku: 'SKU-003',
    totalErrors: 2,
    rankingErrors: [{ sectionLabel: 'Description', issueLabel: 'Special Characters', message: 'Description contains prohibited special characters.' }],
    conversionErrors: [{ sectionLabel: 'Conversion', issueLabel: 'Buy Box', message: 'Buy box missing intermittently.' }],
    inventoryErrors: []
  },
  B0DEMO004: {
    asin: 'B0DEMO004',
    sku: 'SKU-004',
    totalErrors: 3,
    rankingErrors: [
      { sectionLabel: 'Backend Keywords', issueLabel: 'Banned Words', message: 'Backend keywords contain a banned term.' }
    ],
    conversionErrors: [
      { sectionLabel: 'Conversion', issueLabel: 'Buy Box', message: 'Buy box is won intermittently.' }
    ],
    inventoryErrors: [
      { sectionLabel: 'Inventory', issueLabel: 'Stranded', message: 'Units are stranded due to compliance.' }
    ]
  },
  B0DEMO005: {
    asin: 'B0DEMO005',
    sku: 'SKU-005',
    totalErrors: 1,
    rankingErrors: [],
    conversionErrors: [{ sectionLabel: 'Conversion', issueLabel: 'A+ Content', message: 'A+ content is missing or incomplete.' }],
    inventoryErrors: []
  }
};

export const DEMO_DASHBOARD_SUMMARY = {
  accountHealthPercent: 80,
  topIssues: [
    { label: 'Buy Box missing', count: 2 },
    { label: 'Negative reviews', count: 1 },
    { label: 'Low conversion', count: 3 }
  ],
  kpis: [
    { label: 'Sessions (30d)', value: 48620 },
    { label: 'Sales (30d)', value: 112190 },
    { label: 'PPC Spend (30d)', value: 5295.4 },
    { label: 'ACOS', value: 16.99 }
  ]
};

export const DEMO_PPC = {
  kpiSummary: {
    totalSpend: 5295.4,
    totalSales: 31160,
    acos: 16.99,
    tacOs: 19.45
  },
  tabCounts: {
    wastedSpend: 4,
    topPerforming: 3,
    searchTermsZeroSales: 2
  },
  tabs: {
    wastedSpend: {
      totalWastedSpend: 145.2,
      totalItems: 4,
      rows: [
        {
          keywordId: 'kw1',
          keyword: 'wireless mouse',
          campaignName: 'SP - Top',
          campaignId: 'c1',
          adGroupName: 'AG - Exact',
          adGroupId: 'ag1',
          sales: 0,
          spend: 55.1
        },
        {
          keywordId: 'kw2',
          keyword: 'ergonomic chair',
          campaignName: 'SP - Top',
          campaignId: 'c1',
          adGroupName: 'AG - Broad',
          adGroupId: 'ag2',
          sales: 0,
          spend: 39.0
        }
      ]
    },
    topPerforming: {
      totalItems: 3,
      rows: [
        {
          keywordId: 'kw3',
          keyword: 'desk lamp',
          campaignName: 'SD - Lux',
          campaignId: 'c2',
          adGroupName: 'AG - SD',
          adGroupId: 'ag3',
          sales: 249.99,
          spend: 41.2,
          acos: 16.5
        }
      ]
    },
    searchTermsZeroSales: {
      totalWastedSpend: 22.3,
      totalItems: 2,
      rows: [
        {
          searchTerm: 'stainless mug 500ml',
          campaignId: 'c3',
          campaignName: 'SP - Others',
          keyword: 'stainless mug',
          clicks: 18,
          spend: 22.3
        }
      ]
    }
  }
};

export const DEMO_PROFITABILITY = {
  dateRange: { mode: 'last30', startDate: '2026-02-17', endDate: '2026-03-18' },
  summary: {
    totalSales: 112190,
    totalNetProfit: 44260,
    totalGrossProfit: 63765,
    profitableProducts: 18,
    criticalProducts: 5
  },
  tableRows: [
    {
      asin: 'B0DEMO001',
      name: 'ErgoFlow Wireless Mouse',
      sku: 'SKU-001',
      sales: 2350,
      units: 70,
      adSpend: 280,
      fees: 360,
      grossProfit: 1080,
      netProfit: 820,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO002',
      name: 'LumaDesk LED Lamp',
      sku: 'SKU-002',
      sales: 1220,
      units: 63,
      adSpend: 210,
      fees: 290,
      grossProfit: 520,
      netProfit: 310,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO003',
      name: 'ThermoSip Steel Bottle',
      sku: 'SKU-003',
      sales: 680,
      units: 16,
      adSpend: 240,
      fees: 290,
      grossProfit: 60,
      netProfit: -55,
      status: 'bad',
      children: []
    },
    {
      asin: 'B0DEMO004',
      name: 'CableNest Organizer Kit',
      sku: 'SKU-004',
      sales: 960,
      units: 42,
      adSpend: 165,
      fees: 230,
      grossProfit: 410,
      netProfit: 245,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO005',
      name: 'QuickSeal Food Clips Set',
      sku: 'SKU-005',
      sales: 1890,
      units: 172,
      adSpend: 180,
      fees: 360,
      grossProfit: 860,
      netProfit: 680,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO006',
      name: 'CloudRest Neck Pillow',
      sku: 'SKU-006',
      sales: 1410,
      units: 64,
      adSpend: 205,
      fees: 305,
      grossProfit: 600,
      netProfit: 395,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO007',
      name: 'GripMax Resistance Bands',
      sku: 'SKU-007',
      sales: 1680,
      units: 104,
      adSpend: 260,
      fees: 315,
      grossProfit: 640,
      netProfit: 380,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO008',
      name: 'SnapFresh Produce Containers',
      sku: 'SKU-008',
      sales: 1510,
      units: 47,
      adSpend: 235,
      fees: 340,
      grossProfit: 520,
      netProfit: 285,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO009',
      name: 'BrightFold Travel Mirror',
      sku: 'SKU-009',
      sales: 990,
      units: 59,
      adSpend: 145,
      fees: 210,
      grossProfit: 430,
      netProfit: 285,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO010',
      name: 'PureBrew Coffee Canister',
      sku: 'SKU-010',
      sales: 1260,
      units: 36,
      adSpend: 225,
      fees: 275,
      grossProfit: 470,
      netProfit: 245,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO011',
      name: 'FlexCharge USB Hub 7-in-1',
      sku: 'SKU-011',
      sales: 1730,
      units: 44,
      adSpend: 350,
      fees: 355,
      grossProfit: 590,
      netProfit: 240,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO012',
      name: 'CalmSleep Eye Mask Pro',
      sku: 'SKU-012',
      sales: 1490,
      units: 131,
      adSpend: 135,
      fees: 280,
      grossProfit: 720,
      netProfit: 585,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO013',
      name: 'SafeStep Non-Slip Mat',
      sku: 'SKU-013',
      sales: 1120,
      units: 51,
      adSpend: 190,
      fees: 255,
      grossProfit: 430,
      netProfit: 240,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO014',
      name: 'AeroPack Vacuum Bags',
      sku: 'SKU-014',
      sales: 1190,
      units: 45,
      adSpend: 170,
      fees: 250,
      grossProfit: 510,
      netProfit: 340,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO015',
      name: 'KitchenEdge Knife Guard Set',
      sku: 'SKU-015',
      sales: 1035,
      units: 78,
      adSpend: 155,
      fees: 235,
      grossProfit: 415,
      netProfit: 260,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO016',
      name: 'SmartPour Oil Dispenser',
      sku: 'SKU-016',
      sales: 980,
      units: 40,
      adSpend: 210,
      fees: 255,
      grossProfit: 280,
      netProfit: 70,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO017',
      name: 'ZenPad Desk Wrist Rest',
      sku: 'SKU-017',
      sales: 860,
      units: 57,
      adSpend: 130,
      fees: 205,
      grossProfit: 360,
      netProfit: 230,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO018',
      name: 'FreshGrid Fridge Bins',
      sku: 'SKU-018',
      sales: 920,
      units: 34,
      adSpend: 175,
      fees: 230,
      grossProfit: 315,
      netProfit: 140,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO019',
      name: 'ComfyPaws Pet Blanket',
      sku: 'SKU-019',
      sales: 1625,
      units: 96,
      adSpend: 240,
      fees: 320,
      grossProfit: 640,
      netProfit: 400,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO020',
      name: 'HydraLoop Running Belt',
      sku: 'SKU-020',
      sales: 1010,
      units: 38,
      adSpend: 205,
      fees: 245,
      grossProfit: 300,
      netProfit: 95,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO021',
      name: 'SparkClean Bottle Brush',
      sku: 'SKU-021',
      sales: 1750,
      units: 185,
      adSpend: 165,
      fees: 335,
      grossProfit: 770,
      netProfit: 605,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO022',
      name: 'ThermaWrap Lunch Tote',
      sku: 'SKU-022',
      sales: 460,
      units: 19,
      adSpend: 175,
      fees: 180,
      grossProfit: 85,
      netProfit: -90,
      status: 'bad',
      children: []
    },
    {
      asin: 'B0DEMO023',
      name: 'ClipLite Book Lamp',
      sku: 'SKU-023',
      sales: 420,
      units: 22,
      adSpend: 160,
      fees: 165,
      grossProfit: 95,
      netProfit: -65,
      status: 'bad',
      children: []
    }
  ],
  cogs: {
    'B0DEMO001': 6.5,
    'B0DEMO002': 4.2,
    'B0DEMO003': 9.1,
    'B0DEMO004': 5.1,
    'B0DEMO005': 2.2,
    'B0DEMO006': 6.0,
    'B0DEMO007': 4.8,
    'B0DEMO008': 7.2,
    'B0DEMO009': 3.9,
    'B0DEMO010': 8.1,
    'B0DEMO011': 10.2,
    'B0DEMO012': 2.9,
    'B0DEMO013': 5.8,
    'B0DEMO014': 6.3,
    'B0DEMO015': 4.0,
    'B0DEMO016': 5.4,
    'B0DEMO017': 3.7,
    'B0DEMO018': 6.9,
    'B0DEMO019': 5.6,
    'B0DEMO020': 6.1,
    'B0DEMO021': 2.6,
    'B0DEMO022': 4.9,
    'B0DEMO023': 3.5
  }
};

export const DEMO_KEYWORD_ANALYSIS = {
  insights: [
    { title: 'Your top keywords are under-sized titles', details: 'Expand titles for better indexing and CTR.' },
    { title: 'Backend keywords space has unused potential', details: 'Add long-tail variants that match your top search terms.' },
    { title: 'PPC wasted spend can be reduced', details: 'Pause keywords with 0 sales and high spend; add negatives.' }
  ]
};

export const DEMO_PRODUCT_HISTORY = {
  B0DEMO001: {
    points: [
      { date: '2026-03-12', sessions: 1200, pageViews: 8000, conversionRate: 2.8, sales: 120, unitsSold: 100 },
      { date: '2026-03-13', sessions: 980, pageViews: 7200, conversionRate: 2.5, sales: 90, unitsSold: 80 },
      { date: '2026-03-14', sessions: 1100, pageViews: 7600, conversionRate: 2.9, sales: 140, unitsSold: 120 }
    ]
  }
};

export const DEMO_QMATE = {
  suggestedChats: [
    { id: 'qc1', title: 'Account Health Analysis', seed: 'Analyze my account health and identify any issues.' },
    { id: 'qc2', title: 'Sales Performance', seed: 'Show sales performance trends and metrics for last 30 days.' }
  ]
};

