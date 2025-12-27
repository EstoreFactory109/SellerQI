/**
 * PPC Units Sold Slice
 * 
 * Manages PPC units sold data from the PPCUnitsSold model.
 * Simplified to only use 1-day attribution (units sold within 1 day of click).
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config';

const initialState = {
    // Latest units sold data (default: 30 days)
    latestUnitsSold: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Filtered units sold (by date range)
    filteredUnitsSold: {
        data: null,
        loading: false,
        error: null,
        startDate: null,
        endDate: null
    }
};

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Fetch latest PPC units sold data
 */
export const fetchLatestPPCUnitsSold = createAsyncThunk(
    'ppcUnitsSold/fetchLatest',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.ppcUnitsSold?.latestUnitsSold?.lastFetched;
            
            // Return cached data if still valid
            if (lastFetched && (Date.now() - lastFetched) < CACHE_DURATION) {
                return state.ppcUnitsSold.latestUnitsSold.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc-units-sold/latest');
            return response.data.data;
        } catch (error) {
            console.error('Error fetching latest PPC units sold:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC units sold');
        }
    }
);

/**
 * Fetch PPC units sold filtered by date range
 */
export const fetchPPCUnitsSoldByDateRange = createAsyncThunk(
    'ppcUnitsSold/fetchByDateRange',
    async ({ startDate, endDate }, { rejectWithValue }) => {
        try {
            console.log('=== Fetching PPC Units Sold by Date Range ===');
            console.log('Start Date:', startDate);
            console.log('End Date:', endDate);
            
            const response = await axiosInstance.get('/api/pagewise/ppc-units-sold/filter', {
                params: { startDate, endDate }
            });
            
            console.log('API Response:', response.data);
            
            const responseData = response.data?.data;
            
            return {
                ...responseData,
                requestedStartDate: startDate,
                requestedEndDate: endDate
            };
        } catch (error) {
            console.error('Error fetching PPC units sold by date range:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch filtered PPC units sold');
        }
    }
);

/**
 * Fetch PPC units sold summary for KPI display
 */
export const fetchPPCUnitsSoldSummary = createAsyncThunk(
    'ppcUnitsSold/fetchSummary',
    async ({ startDate, endDate } = {}, { rejectWithValue }) => {
        try {
            const params = {};
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc-units-sold/summary', { params });
            return response.data.data;
        } catch (error) {
            console.error('Error fetching PPC units sold summary:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC units sold summary');
        }
    }
);

const ppcUnitsSoldSlice = createSlice({
    name: 'ppcUnitsSold',
    initialState,
    reducers: {
        clearPPCUnitsSold: (state) => {
            state.latestUnitsSold = initialState.latestUnitsSold;
            state.filteredUnitsSold = initialState.filteredUnitsSold;
        },
        clearFilteredUnitsSold: (state) => {
            state.filteredUnitsSold = initialState.filteredUnitsSold;
        },
        invalidateUnitsSoldCache: (state) => {
            state.latestUnitsSold.lastFetched = null;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchLatestPPCUnitsSold.pending, (state) => {
                state.latestUnitsSold.loading = true;
                state.latestUnitsSold.error = null;
            })
            .addCase(fetchLatestPPCUnitsSold.fulfilled, (state, action) => {
                state.latestUnitsSold.loading = false;
                state.latestUnitsSold.data = action.payload;
                state.latestUnitsSold.lastFetched = Date.now();
            })
            .addCase(fetchLatestPPCUnitsSold.rejected, (state, action) => {
                state.latestUnitsSold.loading = false;
                state.latestUnitsSold.error = action.payload;
            })
            .addCase(fetchPPCUnitsSoldByDateRange.pending, (state) => {
                state.filteredUnitsSold.loading = true;
                state.filteredUnitsSold.error = null;
            })
            .addCase(fetchPPCUnitsSoldByDateRange.fulfilled, (state, action) => {
                state.filteredUnitsSold.loading = false;
                state.filteredUnitsSold.data = action.payload;
                state.filteredUnitsSold.startDate = action.payload.requestedStartDate;
                state.filteredUnitsSold.endDate = action.payload.requestedEndDate;
            })
            .addCase(fetchPPCUnitsSoldByDateRange.rejected, (state, action) => {
                state.filteredUnitsSold.loading = false;
                state.filteredUnitsSold.error = action.payload;
            })
            .addCase(fetchPPCUnitsSoldSummary.pending, (state) => {
                state.latestUnitsSold.loading = true;
                state.latestUnitsSold.error = null;
            })
            .addCase(fetchPPCUnitsSoldSummary.fulfilled, (state, action) => {
                state.latestUnitsSold.loading = false;
                state.latestUnitsSold.data = {
                    ...state.latestUnitsSold.data,
                    summary: action.payload
                };
            })
            .addCase(fetchPPCUnitsSoldSummary.rejected, (state, action) => {
                state.latestUnitsSold.loading = false;
                state.latestUnitsSold.error = action.payload;
            });
    }
});

export const { 
    clearPPCUnitsSold, 
    clearFilteredUnitsSold, 
    invalidateUnitsSoldCache 
} = ppcUnitsSoldSlice.actions;

// Selectors
export const selectLatestPPCUnitsSold = (state) => state.ppcUnitsSold?.latestUnitsSold?.data;
export const selectPPCUnitsSoldLoading = (state) => state.ppcUnitsSold?.latestUnitsSold?.loading;
export const selectFilteredPPCUnitsSold = (state) => state.ppcUnitsSold?.filteredUnitsSold?.data;
export const selectFilteredPPCUnitsSoldLoading = (state) => state.ppcUnitsSold?.filteredUnitsSold?.loading;

/**
 * Select total units sold from latest data
 * Now simplified: just returns totalUnits directly
 */
export const selectPPCUnitsSoldTotal = (state) => {
    const unitsData = state.ppcUnitsSold?.latestUnitsSold?.data;
    
    if (!unitsData?.found || !unitsData?.data) {
        return null;
    }
    
    // totalUnits is now a simple number
    return unitsData.data.totalUnits || 0;
};

/**
 * Select date-wise units sold
 */
export const selectPPCUnitsSoldDateWise = (state) => {
    const unitsData = state.ppcUnitsSold?.latestUnitsSold?.data;
    if (!unitsData?.found || !unitsData?.data) return [];
    return unitsData.data.dateWiseUnits || [];
};

/**
 * Select total units from filtered data
 * Now simplified: just returns totalUnits directly
 */
export const selectFilteredUnitsSoldTotal = (state) => {
    const filteredData = state.ppcUnitsSold?.filteredUnitsSold?.data;
    
    if (!filteredData) {
        return null;
    }
    
    // Check if found is false - means no data
    if (filteredData.found === false) {
        return null;
    }
    
    // Check if it's the wrapped response format { found: true, data: {...} }
    if (filteredData.found && filteredData.data) {
        return filteredData.data.totalUnits || 0;
    }
    
    // Check if totalUnits is directly on the filtered data
    if (filteredData.totalUnits !== undefined) {
        return filteredData.totalUnits;
    }
    
    return null;
};

/**
 * Check if filtered data is available
 */
export const selectHasFilteredUnitsSold = (state) => {
    const filteredData = state.ppcUnitsSold?.filteredUnitsSold?.data;
    if (!filteredData) return false;
    return filteredData.found === true;
};

export default ppcUnitsSoldSlice.reducer;
