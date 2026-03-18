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
    totalUnderpaid: 45.1,
    totalRecoverable: 1526.55,
    totalPotential: 876.35,
    totalReceived: 650.2,
    claimsExpiringIn7Days: 2,
    totalClaims: 9,
    lastUpdated: '2026-03-18T08:00:00.000Z',
    feeProtector: {
      backendShipmentItems: {
        count: 3,
        totalExpectedAmount: 1001.0,
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
          }
        ]
      }
    },
    backendLostInventory: {
      totalExpectedAmount: 249.75,
      data: [
        {
          date: '2026-03-16T00:00:00.000Z',
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
          date: '2026-03-10T00:00:00.000Z',
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
          date: '2026-03-06T00:00:00.000Z',
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
        }
      ]
    },
    backendDamagedInventory: {
      totalExpectedAmount: 155.3,
      data: [
        {
          date: '2026-03-17T00:00:00.000Z',
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
          date: '2026-03-09T00:00:00.000Z',
          asin: 'B0DEMO002',
          sku: 'SKU-002',
          fnsku: 'FNSKU-002',
          damagedUnits: 9,
          salesPrice: 19.5,
          fees: 5.0,
          reimbursementPerUnit: 8.37,
          expectedAmount: 80.3
        }
      ]
    },
    backendDisposedInventory: {
      totalExpectedAmount: 120.5,
      data: [
        {
          date: '2026-03-15T00:00:00.000Z',
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
          date: '2026-03-08T00:00:00.000Z',
          asin: 'B0DEMO004',
          sku: 'SKU-004',
          fnsku: 'FNSKU-004',
          disposedUnits: 18,
          salesPrice: 24.75,
          fees: 5.0,
          reimbursementPerUnit: 2.69,
          expectedAmount: 48.4
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
    }
  ]
};

export const DEMO_PRODUCTS = [
  { asin: 'B0DEMO001', sku: 'SKU-001', name: 'Demo Product 1', price: 29.99, quantity: 120 },
  { asin: 'B0DEMO002', sku: 'SKU-002', name: 'Demo Product 2', price: 19.5, quantity: 54 },
  { asin: 'B0DEMO003', sku: 'SKU-003', name: 'Demo Product 3', price: 42.0, quantity: 9 },
  { asin: 'B0DEMO004', sku: 'SKU-004', name: 'Demo Product 4', price: 24.75, quantity: 33 },
  { asin: 'B0DEMO005', sku: 'SKU-005', name: 'Demo Product 5', price: 10.99, quantity: 200 }
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
    { label: 'Sessions (30d)', value: 12450 },
    { label: 'Sales (30d)', value: 3825 },
    { label: 'PPC Spend (30d)', value: 915.35 },
    { label: 'ACOS', value: 18.6 }
  ]
};

export const DEMO_PPC = {
  kpiSummary: {
    totalSpend: 915.35,
    totalSales: 3825,
    acos: 18.6,
    tacOs: 22.1
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
    totalSales: 3825,
    totalNetProfit: 1480.25,
    totalGrossProfit: 1920.5,
    profitableProducts: 2,
    criticalProducts: 1
  },
  tableRows: [
    {
      asin: 'B0DEMO001',
      name: 'Demo Product 1',
      sku: 'SKU-001',
      sales: 2100,
      units: 70,
      adSpend: 290,
      fees: 280,
      grossProfit: 1530,
      netProfit: 1250,
      status: 'good',
      children: []
    },
    {
      asin: 'B0DEMO002',
      name: 'Demo Product 2',
      sku: 'SKU-002',
      sales: 980,
      units: 30,
      adSpend: 210,
      fees: 230,
      grossProfit: 540,
      netProfit: 180,
      status: 'warn',
      children: []
    },
    {
      asin: 'B0DEMO003',
      name: 'Demo Product 3',
      sku: 'SKU-003',
      sales: 745,
      units: 10,
      adSpend: 415,
      fees: 310,
      grossProfit: 20,
      netProfit: -95,
      status: 'bad',
      children: []
    }
  ],
  cogs: {
    'B0DEMO001': 6.5,
    'B0DEMO002': 4.2,
    'B0DEMO003': 9.1
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

