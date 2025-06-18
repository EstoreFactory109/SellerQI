import axiosInstance from '../config/axios.config.js';

// Create API instance with proper base URL for Stripe endpoints
const api = {
  get: (url, config) => axiosInstance.get(`/app${url}`, config),
  post: (url, data, config) => axiosInstance.post(`/app${url}`, data, config),
  put: (url, data, config) => axiosInstance.put(`/app${url}`, data, config),
  delete: (url, config) => axiosInstance.delete(`/app${url}`, config),
};

// Stripe API service
const stripeService = {
  // Get Stripe publishable key
  getPublishableKey: async () => {
    try {
      const response = await api.get('/stripe/publishable-key');
      return response.data.data.publishableKey;
    } catch (error) {
      console.error('Error fetching publishable key:', error);
      throw error;
    }
  },

  // Create checkout session
  createCheckoutSession: async (planType) => {
    try {
      const response = await api.post('/stripe/create-checkout-session', {
        planType
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  },

  // Create portal session
  createPortalSession: async () => {
    try {
      const response = await api.post('/stripe/create-portal-session');
      return response.data.data;
    } catch (error) {
      console.error('Error creating portal session:', error);
      throw error;
    }
  },

  // Get subscription status
  getSubscriptionStatus: async () => {
    try {
      const response = await api.get('/stripe/subscription-status');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      throw error;
    }
  },

  // Cancel subscription
  cancelSubscription: async () => {
    try {
      const response = await api.post('/stripe/cancel-subscription');
      return response.data.data;
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw error;
    }
  },

  // Reactivate subscription
  reactivateSubscription: async () => {
    try {
      const response = await api.post('/stripe/reactivate-subscription');
      return response.data.data;
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      throw error;
    }
  },

  // Update subscription plan
  updateSubscriptionPlan: async (newPlanType) => {
    try {
      const response = await api.put('/stripe/update-subscription', {
        newPlanType
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
  },

  // Get invoice preview
  getInvoicePreview: async (newPlanType) => {
    try {
      const response = await api.get(`/stripe/invoice-preview?newPlanType=${newPlanType}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching invoice preview:', error);
      throw error;
    }
  },

  // Get payment methods
  getPaymentMethods: async () => {
    try {
      const response = await api.get('/stripe/payment-methods');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      throw error;
    }
  },

  // Get invoices
  getInvoices: async (limit = 10) => {
    try {
      const response = await api.get(`/stripe/invoices?limit=${limit}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching invoices:', error);
      throw error;
    }
  }
};

export default stripeService;