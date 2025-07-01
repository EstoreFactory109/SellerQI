import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_BASE_URI;

class AgencyService {
  // Register a new client
  async registerClient(clientData) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/app/agency/register-client`,
        clientData,
        { withCredentials: true }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to register client');
    }
  }

  // Get all clients
  async getClients() {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/app/agency/clients`,
        { withCredentials: true }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to get clients');
    }
  }

  // Switch to a specific client
  async switchToClient(clientId) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/app/agency/switch-client`,
        { clientId },
        { withCredentials: true }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to switch to client');
    }
  }

  // Check if current user is an agency owner
  async checkAgencyOwnerStatus() {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/app/stripe/check-agency-owner`,
        {},
        { withCredentials: true }
      );
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to check agency owner status');
    }
  }
}

export default new AgencyService(); 