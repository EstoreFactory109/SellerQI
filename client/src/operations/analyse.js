/**
 * Analyse Data
 * 
 * This module has been refactored - calculations are now done in the backend.
 * This file is kept for backward compatibility but the old calculation logic 
 * has been moved to the backend.
 * 
 * For new implementations, use the Redux PageDataSlice which fetches pre-calculated
 * data from the backend endpoints.
 * 
 * @deprecated Use Redux PageDataSlice actions instead:
 * - fetchDashboardData() for main dashboard
 * - fetchProfitabilityData() for profitability page
 * - fetchPPCData() for PPC/sponsored ads page
 * - etc.
 */

import axiosInstance from '../config/axios.config';

/**
 * Legacy function - Fetches calculated dashboard data from backend
 * @deprecated Use Redux fetchDashboardData() action instead
 * @param {Object} data - Not used in new implementation (kept for compatibility)
 * @param {string} userId - Not used in new implementation (kept for compatibility)
 * @returns {Object} Calculated dashboard data from backend
 */
const analyseData = async (data, userId) => {
    console.log("analyseData called - fetching pre-calculated data from backend");
    
    try {
        // Fetch pre-calculated dashboard data from the new backend endpoint
        const response = await axiosInstance.get('/api/pagewise/dashboard');
        console.log("Dashboard data received from backend");
        return response.data.data;
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        throw error;
    }
}

export default analyseData;