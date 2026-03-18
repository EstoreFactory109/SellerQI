export const DEMO_RECENT_ORDERS = {
  reviewRequestAuthStatus: true,
  orders: [
    {
      id: 'o1',
      amazonOrderId: '100-DEM0-0001',
      orderDate: '2026-03-18T09:20:00.000Z',
      buyerName: 'John D.',
      status: 'Delivered',
      orderTotal: 59.99,
      itemsCount: 2
    },
    {
      id: 'o2',
      amazonOrderId: '100-DEM0-0002',
      orderDate: '2026-03-17T15:10:00.000Z',
      buyerName: 'Maria S.',
      status: 'Shipped',
      orderTotal: 42.5,
      itemsCount: 1
    }
  ],
  orderItemsByOrderId: {
    '100-DEM0-0001': [
      {
        asin: 'B0DEMO001',
        sellerSKU: 'SKU-001',
        title: 'Demo Product 1',
        quantityOrdered: 1,
        quantityShipped: 1,
        itemPrice: { Amount: 29.99, CurrencyCode: 'USD' }
      },
      {
        asin: 'B0DEMO002',
        sellerSKU: 'SKU-002',
        title: 'Demo Product 2',
        quantityOrdered: 1,
        quantityShipped: 1,
        itemPrice: { Amount: 30.0, CurrencyCode: 'USD' }
      }
    ],
    '100-DEM0-0002': [
      {
        asin: 'B0DEMO003',
        sellerSKU: 'SKU-003',
        title: 'Demo Product 3',
        quantityOrdered: 1,
        quantityShipped: 0,
        itemPrice: { Amount: 42.5, CurrencyCode: 'USD' }
      }
    ]
  }
};

export const DEMO_ECOMMERCE_HOLIDAYS = {
  theme: 'Spring campaign season (demo)',
  months: [
    {
      month: 'March',
      year: 2025,
      holidays: [
        { day: 14, name: 'Demo Holiday: Mid-Month Promo', type: 'holiday', flag: 'Deal' },
        { day: 21, name: 'Demo Holiday: Prime Week', type: 'sports', flag: 'Hot' },
        { day: 29, name: 'Demo Holiday: Clearance Day', type: 'other', flag: 'Save' }
      ],
      additional: [{ day: 8, name: 'Awareness Wednesday (demo)', type: 'awareness', flag: 'New' }]
    }
  ]
};

export const DEMO_USER_LOGGING = {
  sessions: [
    {
      id: 's1',
      user: 'demo@sellerqi.com',
      date: '2026-03-18T10:00:00.000Z',
      durationSec: 412,
      pages: ['/dashboard', '/issues']
    },
    {
      id: 's2',
      user: 'demo@sellerqi.com',
      date: '2026-03-17T13:30:00.000Z',
      durationSec: 268,
      pages: ['/ppc-dashboard', '/your-products']
    }
  ],
  errors: [
    { id: 'e1', date: '2026-03-18T10:22:00.000Z', route: '/ppc-dashboard', message: 'Mock demo error: PPC table scroll sentinel.' },
    { id: 'e2', date: '2026-03-17T13:55:00.000Z', route: '/product-details', message: 'Mock demo error: history graph missing.' }
  ]
};

export const DEMO_ACCOUNT_HISTORY = {
  // The UI (Account/Table + Account/Chart) expects this exact shape.
  // Each row represents a daily snapshot of account health + total issues.
  accountHistory: [
    {
      Date: '2026-03-12',
      HealthScore: 86,
      ProductsWithIssues: 6,
      TotalNumberOfIssues: 12
    },
    {
      Date: '2026-03-13',
      HealthScore: 78,
      ProductsWithIssues: 8,
      TotalNumberOfIssues: 17
    },
    {
      Date: '2026-03-14',
      HealthScore: 83,
      ProductsWithIssues: 5,
      TotalNumberOfIssues: 9
    },
    {
      Date: '2026-03-15',
      HealthScore: 80,
      ProductsWithIssues: 7,
      TotalNumberOfIssues: 14
    }
  ],
  summarySeries: [
    { date: '2026-03-12', issuesCount: 12 },
    { date: '2026-03-13', issuesCount: 17 },
    { date: '2026-03-14', issuesCount: 9 },
    { date: '2026-03-15', issuesCount: 14 }
  ],
  table: [
    { id: 'h1', date: '2026-03-15', issuesDelta: -3, summary: 'Improved conversion for top ASIN.' },
    { id: 'h2', date: '2026-03-14', issuesDelta: 5, summary: 'Buy box missing detected.' }
  ]
};

