/**
 * Jest Global Setup
 * 
 * This file sets up global mocks for external dependencies to ensure
 * tests are isolated and don't interact with real databases or APIs.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.JWT_LOCATION_SECRET = 'test-jwt-location-secret';
process.env.CORS_ORIGIN_DOMAIN = 'http://localhost:3000';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_razorpay_secret';
process.env.AMAZON_ADS_CLIENT_ID = 'mock_amazon_ads_client_id';
process.env.AMAZON_ADS_CLIENT_SECRET = 'mock_amazon_ads_secret';

// Mock Logger to prevent console noise during tests
jest.mock('../utils/Logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock MongoDB connection
jest.mock('../config/dbConn.js', () => jest.fn());

// Mock Redis connection
jest.mock('../config/redisConn.js', () => ({
  connectRedis: jest.fn().mockResolvedValue(true),
  getRedisClient: jest.fn().mockReturnValue({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    quit: jest.fn(),
  }),
}));

// Mock Queue Redis connection
jest.mock('../config/queueRedisConn.js', () => ({
  getQueueRedisConnection: jest.fn().mockReturnValue({
    duplicate: jest.fn().mockReturnValue({
      quit: jest.fn(),
    }),
  }),
}));

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_mock123' }),
      retrieve: jest.fn().mockResolvedValue({ id: 'cus_mock123', email: 'test@test.com' }),
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'active' }),
      retrieve: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'active' }),
      update: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'active' }),
      cancel: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'canceled' }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: 'cs_mock123', url: 'https://checkout.stripe.com/mock' }),
      },
    },
    invoices: {
      retrieve: jest.fn().mockResolvedValue({ id: 'inv_mock123', invoice_pdf: 'https://invoice.pdf' }),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

// Mock Razorpay
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    orders: {
      create: jest.fn().mockResolvedValue({ id: 'order_mock123', amount: 1000 }),
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'active' }),
      fetch: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'active' }),
      cancel: jest.fn().mockResolvedValue({ id: 'sub_mock123', status: 'cancelled' }),
    },
    payments: {
      fetch: jest.fn().mockResolvedValue({ id: 'pay_mock123', status: 'captured' }),
    },
  }));
});

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
  }),
}));

// Mock Cloudinary
jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn().mockResolvedValue({ secure_url: 'https://cloudinary.com/mock-image.jpg' }),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

// Mock axios for external API calls
jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  }),
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  put: jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
}));

// Mock BullMQ
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job_mock123' }),
    getJob: jest.fn().mockResolvedValue(null),
    getJobs: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({ sid: 'mock-message-sid' }),
    },
  }));
});

// Mock Google Auth Library
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      getPayload: jest.fn().mockReturnValue({
        email: 'test@gmail.com',
        given_name: 'Test',
        family_name: 'User',
      }),
    }),
  })),
}));

// Helper function to create mock Express request
global.mockRequest = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  cookies: {},
  user: null,
  ...overrides,
});

// Helper function to create mock Express response
global.mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  return res;
};

// Helper function to create mock next function
global.mockNext = () => jest.fn();

// Cleanup after all tests
afterAll(async () => {
  // Allow any pending promises to resolve
  await new Promise(resolve => setTimeout(resolve, 100));
});
