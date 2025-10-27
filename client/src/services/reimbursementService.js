import axios from 'axios';

const BASE_URL = import.meta.env.VITE_BASE_URI;

/**
 * Reimbursement Service
 * Handles all API calls related to Amazon FBA reimbursements
 */

/**
 * Get reimbursement summary for dashboard
 */
export const getReimbursementSummary = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/app/reimbursements/summary`, {
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching reimbursement summary:', error);
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
    getAllReimbursements,
    getPotentialClaims,
    getUrgentClaims,
    getReimbursementsByProduct,
    getReimbursementStatsByType,
    getReimbursementTimeline,
    updateReimbursementCosts
};

