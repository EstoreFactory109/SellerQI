import axios from 'axios';

const BASE_URL = import.meta.env.VITE_BASE_URI;

/**
 * Reimbursement Service
 * Handles all API calls related to Amazon FBA reimbursements
 */

/**
 * Get reimbursement summary for dashboard with pagination support
 * @param {Object} options - Pagination options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 20)
 * @param {boolean} options.summaryOnly - If true, return only summary without data (default: false)
 * @param {string} options.category - If specified, only return data for that category (shipment, lost, damaged, disposed)
 */
export const getReimbursementSummary = async ({ page = 1, limit = 20, summaryOnly = false, category = null } = {}) => {
    try {
        const params = new URLSearchParams();
        params.append('page', page);
        params.append('limit', limit);
        if (summaryOnly) params.append('summaryOnly', 'true');
        if (category) params.append('category', category);
        
        const response = await axios.get(`${BASE_URL}/app/reimbursements/summary?${params.toString()}`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursement summary:', error);
        throw error;
    }
};

/**
 * Get reimbursement data for a specific category with pagination
 * @param {string} category - Category type (shipment, lost, damaged, disposed)
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 */
export const getReimbursementByCategory = async (category, page = 1, limit = 20) => {
    try {
        const params = new URLSearchParams();
        params.append('page', page);
        params.append('limit', limit);
        params.append('category', category);
        
        const response = await axios.get(`${BASE_URL}/app/reimbursements/summary?${params.toString()}`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursement category data:', error);
        throw error;
    }
};

/**
 * Get all reimbursements with optional filters
 */
export const getAllReimbursements = async (filters = {}) => {
    try {
        const params = new URLSearchParams(filters).toString();
        const url = params ? `${BASE_URL}/app/reimbursements?${params}` : `${BASE_URL}/app/reimbursements`;
        
        const response = await axios.get(url, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursements:', error);
        throw error;
    }
};

/**
 * Get potential reimbursement claims (not yet filed)
 */
export const getPotentialClaims = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/potential`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching potential claims:', error);
        throw error;
    }
};

/**
 * Get urgent claims (expiring soon)
 */
export const getUrgentClaims = async (days = 7) => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/urgent?days=${days}`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching urgent claims:', error);
        throw error;
    }
};

/**
 * Get reimbursements by product (ASIN)
 */
export const getReimbursementsByProduct = async (asin) => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/product/${asin}`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursements by product:', error);
        throw error;
    }
};

/**
 * Get reimbursement statistics by type
 */
export const getReimbursementStatsByType = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/stats/by-type`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursement stats:', error);
        throw error;
    }
};

/**
 * Get reimbursement timeline data for charts
 */
export const getReimbursementTimeline = async (days = 30) => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/timeline?days=${days}`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursement timeline:', error);
        throw error;
    }
};

/**
 * Update product costs for reimbursement calculations
 */
export const updateReimbursementCosts = async (cogsValues) => {
    try {
        const response = await axios.post(
            `${BASE_URL}/app/reimbursements/update-costs`,
            { cogsValues },
            { withCredentials: true }
        );
        return response.data;
    } catch (error) {
        console.error('Error updating reimbursement costs:', error);
        throw error;
    }
};

export default {
    getReimbursementSummary,
    getReimbursementByCategory,
    getAllReimbursements,
    getPotentialClaims,
    getUrgentClaims,
    getReimbursementsByProduct,
    getReimbursementStatsByType,
    getReimbursementTimeline,
    updateReimbursementCosts
};

