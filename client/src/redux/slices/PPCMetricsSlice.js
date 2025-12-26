/**
 * PPC Metrics Slice
 * 
 * Manages PPC metrics data from the PPCMetrics model.
 * Used by Dashboard (PPC spend, ACOS) and PPC Dashboard (sales, spend, ACOS, TACOS, graphs)
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config';

const initialState = {
    // Latest PPC metrics
    latestMetrics: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Filtered metrics (by date range)
    filteredMetrics: {
        data: null,
        loading: false,
        error: null,
        startDate: null,
        endDate: null
    },
    // Graph data
    graphData: {
        data: [],
        loading: false,
        error: null
    }
};

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Fetch latest PPC metrics
 */
export const fetchLatestPPCMetrics = createAsyncThunk(
    'ppcMetrics/fetchLatest',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.ppcMetrics?.latestMetrics?.lastFetched;
            
            // Return cached data if still valid
            if (lastFetched && (Date.now() - lastFetched) < CACHE_DURATION) {
                return state.ppcMetrics.latestMetrics.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc-metrics/latest');
            return response.data.data;
        } catch (error) {
            console.error('Error fetching latest PPC metrics:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC metrics');
        }
    }
);

/**
 * Fetch PPC metrics filtered by date range
 */
export const fetchPPCMetricsByDateRange = createAsyncThunk(
    'ppcMetrics/fetchByDateRange',
    async ({ startDate, endDate }, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.get('/api/pagewise/ppc-metrics/filter', {
                params: { startDate, endDate }
            });
            return {
                ...response.data.data,
                requestedStartDate: startDate,
                requestedEndDate: endDate
            };
        } catch (error) {
            console.error('Error fetching PPC metrics by date range:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch filtered PPC metrics');
        }
    }
);

/**
 * Fetch PPC metrics for graph/chart display
 */
export const fetchPPCMetricsForGraph = createAsyncThunk(
    'ppcMetrics/fetchForGraph',
    async ({ startDate, endDate } = {}, { rejectWithValue }) => {
        try {
            const params = {};
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc-metrics/graph', { params });
            return response.data.data;
        } catch (error) {
            console.error('Error fetching PPC graph data:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC graph data');
        }
    }
);

const ppcMetricsSlice = createSlice({
    name: 'ppcMetrics',
    initialState,
    reducers: {
        // Clear all PPC metrics data
        clearPPCMetrics: (state) => {
            state.latestMetrics = initialState.latestMetrics;
            state.filteredMetrics = initialState.filteredMetrics;
            state.graphData = initialState.graphData;
        },
        // Clear filtered metrics only
        clearFilteredMetrics: (state) => {
            state.filteredMetrics = initialState.filteredMetrics;
        },
        // Invalidate cache (force refresh on next fetch)
        invalidateCache: (state) => {
            state.latestMetrics.lastFetched = null;
        }
    },
    extraReducers: (builder) => {
        // Fetch latest metrics
        builder
            .addCase(fetchLatestPPCMetrics.pending, (state) => {
                state.latestMetrics.loading = true;
                state.latestMetrics.error = null;
            })
            .addCase(fetchLatestPPCMetrics.fulfilled, (state, action) => {
                state.latestMetrics.loading = false;
                state.latestMetrics.data = action.payload;
                state.latestMetrics.lastFetched = Date.now();
            })
            .addCase(fetchLatestPPCMetrics.rejected, (state, action) => {
                state.latestMetrics.loading = false;
                state.latestMetrics.error = action.payload;
            })
        
        // Fetch metrics by date range
            .addCase(fetchPPCMetricsByDateRange.pending, (state) => {
                state.filteredMetrics.loading = true;
                state.filteredMetrics.error = null;
            })
            .addCase(fetchPPCMetricsByDateRange.fulfilled, (state, action) => {
                state.filteredMetrics.loading = false;
                state.filteredMetrics.data = action.payload;
                state.filteredMetrics.startDate = action.payload.requestedStartDate;
                state.filteredMetrics.endDate = action.payload.requestedEndDate;
            })
            .addCase(fetchPPCMetricsByDateRange.rejected, (state, action) => {
                state.filteredMetrics.loading = false;
                state.filteredMetrics.error = action.payload;
            })
        
        // Fetch graph data
            .addCase(fetchPPCMetricsForGraph.pending, (state) => {
                state.graphData.loading = true;
                state.graphData.error = null;
            })
            .addCase(fetchPPCMetricsForGraph.fulfilled, (state, action) => {
                state.graphData.loading = false;
                state.graphData.data = action.payload?.graphData || [];
            })
            .addCase(fetchPPCMetricsForGraph.rejected, (state, action) => {
                state.graphData.loading = false;
                state.graphData.error = action.payload;
            });
    }
});

export const { clearPPCMetrics, clearFilteredMetrics, invalidateCache } = ppcMetricsSlice.actions;

// Selectors
export const selectLatestPPCMetrics = (state) => state.ppcMetrics?.latestMetrics?.data;
export const selectLatestPPCMetricsLoading = (state) => state.ppcMetrics?.latestMetrics?.loading;
export const selectFilteredPPCMetrics = (state) => state.ppcMetrics?.filteredMetrics?.data;
export const selectPPCGraphData = (state) => state.ppcMetrics?.graphData?.data || [];

// Helper selectors for commonly used values
export const selectPPCSummary = (state) => {
    const metrics = state.ppcMetrics?.latestMetrics?.data;
    if (!metrics?.found || !metrics?.data) return null;
    return metrics.data.summary;
};

export const selectPPCDateRange = (state) => {
    const metrics = state.ppcMetrics?.latestMetrics?.data;
    if (!metrics?.found || !metrics?.data) return null;
    return metrics.data.dateRange;
};

export const selectPPCDateWiseMetrics = (state) => {
    const metrics = state.ppcMetrics?.latestMetrics?.data;
    if (!metrics?.found || !metrics?.data) return [];
    return metrics.data.dateWiseMetrics || [];
};

export const selectCampaignTypeBreakdown = (state) => {
    const metrics = state.ppcMetrics?.latestMetrics?.data;
    if (!metrics?.found || !metrics?.data) return null;
    return metrics.data.campaignTypeBreakdown;
};

export default ppcMetricsSlice.reducer;

