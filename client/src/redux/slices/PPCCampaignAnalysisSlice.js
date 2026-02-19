/**
 * PPC Campaign Analysis Slice
 * 
 * Manages paginated data for Campaign Audit page tabs.
 * Each tab has its own state with data, pagination, loading, and error.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config';

const initialTabState = {
    data: [],
    pagination: null,
    loading: false,
    error: null,
    lastFetched: null
};

const initialState = {
    // KPI Summary for top boxes
    summary: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Tab counts for badges
    tabCounts: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Tab 0: High ACOS Campaigns
    highAcos: { ...initialTabState },
    // Tab 1: Wasted Spend Keywords
    wastedSpend: { ...initialTabState },
    // Tab 2: Campaigns Without Negative Keywords
    noNegatives: { ...initialTabState },
    // Tab 3: Top Performing Keywords
    topKeywords: { ...initialTabState },
    // Tab 4: Search Terms with Zero Sales
    zeroSales: { ...initialTabState },
    // Tab 5: Auto Campaign Insights
    autoInsights: { ...initialTabState }
};

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Fetch PPC KPI Summary
 */
export const fetchPPCKPISummary = createAsyncThunk(
    'ppcCampaignAnalysis/fetchSummary',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.ppcCampaignAnalysis?.summary?.lastFetched;
            
            // Return cached data if still valid
            if (lastFetched && (Date.now() - lastFetched) < CACHE_DURATION) {
                return state.ppcCampaignAnalysis.summary.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc/summary');
            return response.data.data;
        } catch (error) {
            console.error('Error fetching PPC KPI summary:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC summary');
        }
    }
);

/**
 * Fetch Tab Counts
 */
export const fetchPPCTabCounts = createAsyncThunk(
    'ppcCampaignAnalysis/fetchTabCounts',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.ppcCampaignAnalysis?.tabCounts?.lastFetched;
            
            // Return cached data if still valid
            if (lastFetched && (Date.now() - lastFetched) < CACHE_DURATION) {
                return state.ppcCampaignAnalysis.tabCounts.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc/tab-counts');
            return response.data.data;
        } catch (error) {
            console.error('Error fetching PPC tab counts:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch tab counts');
        }
    }
);

/**
 * Fetch High ACOS Campaigns (Tab 0)
 */
export const fetchHighAcosCampaigns = createAsyncThunk(
    'ppcCampaignAnalysis/fetchHighAcos',
    async ({ page = 1, limit = 10, startDate, endDate, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc/high-acos', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching high ACOS campaigns:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch high ACOS campaigns');
        }
    }
);

/**
 * Fetch Wasted Spend Keywords (Tab 1)
 */
export const fetchWastedSpendKeywords = createAsyncThunk(
    'ppcCampaignAnalysis/fetchWastedSpend',
    async ({ page = 1, limit = 10, startDate, endDate, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc/wasted-spend', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching wasted spend keywords:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch wasted spend keywords');
        }
    }
);

/**
 * Fetch Campaigns Without Negatives (Tab 2)
 */
export const fetchCampaignsWithoutNegatives = createAsyncThunk(
    'ppcCampaignAnalysis/fetchNoNegatives',
    async ({ page = 1, limit = 10, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            
            const response = await axiosInstance.get('/api/pagewise/ppc/no-negatives', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching campaigns without negatives:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaigns without negatives');
        }
    }
);

/**
 * Fetch Top Performing Keywords (Tab 3)
 */
export const fetchTopPerformingKeywords = createAsyncThunk(
    'ppcCampaignAnalysis/fetchTopKeywords',
    async ({ page = 1, limit = 10, startDate, endDate, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc/top-keywords', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching top performing keywords:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch top performing keywords');
        }
    }
);

/**
 * Fetch Search Terms with Zero Sales (Tab 4)
 */
export const fetchSearchTermsZeroSales = createAsyncThunk(
    'ppcCampaignAnalysis/fetchZeroSales',
    async ({ page = 1, limit = 10, startDate, endDate, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc/zero-sales', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching search terms with zero sales:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch search terms');
        }
    }
);

/**
 * Fetch Auto Campaign Insights (Tab 5)
 */
export const fetchAutoCampaignInsights = createAsyncThunk(
    'ppcCampaignAnalysis/fetchAutoInsights',
    async ({ page = 1, limit = 10, startDate, endDate, append = false } = {}, { rejectWithValue }) => {
        try {
            const params = { page, limit };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            
            const response = await axiosInstance.get('/api/pagewise/ppc/auto-insights', { params });
            return { ...response.data.data, append };
        } catch (error) {
            console.error('Error fetching auto campaign insights:', error);
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch auto campaign insights');
        }
    }
);

const ppcCampaignAnalysisSlice = createSlice({
    name: 'ppcCampaignAnalysis',
    initialState,
    reducers: {
        // Clear all campaign analysis data
        clearCampaignAnalysis: () => initialState,
        
        // Clear specific tab data
        clearTabData: (state, action) => {
            const tab = action.payload;
            if (state[tab]) {
                state[tab] = { ...initialTabState };
            }
        },
        
        // Invalidate all cache (force refresh on next fetch)
        invalidateAllCache: (state) => {
            state.summary.lastFetched = null;
            state.tabCounts.lastFetched = null;
            state.highAcos.lastFetched = null;
            state.wastedSpend.lastFetched = null;
            state.noNegatives.lastFetched = null;
            state.topKeywords.lastFetched = null;
            state.zeroSales.lastFetched = null;
            state.autoInsights.lastFetched = null;
        },
        
        // Reset pagination for a tab (used when date range changes)
        resetTabPagination: (state, action) => {
            const tab = action.payload;
            if (state[tab]) {
                state[tab].data = [];
                state[tab].pagination = null;
                state[tab].lastFetched = null;
            }
        }
    },
    extraReducers: (builder) => {
        // Fetch KPI Summary
        builder
            .addCase(fetchPPCKPISummary.pending, (state) => {
                state.summary.loading = true;
                state.summary.error = null;
            })
            .addCase(fetchPPCKPISummary.fulfilled, (state, action) => {
                state.summary.loading = false;
                state.summary.data = action.payload;
                state.summary.lastFetched = Date.now();
            })
            .addCase(fetchPPCKPISummary.rejected, (state, action) => {
                state.summary.loading = false;
                state.summary.error = action.payload;
            })
        
        // Fetch Tab Counts
            .addCase(fetchPPCTabCounts.pending, (state) => {
                state.tabCounts.loading = true;
                state.tabCounts.error = null;
            })
            .addCase(fetchPPCTabCounts.fulfilled, (state, action) => {
                state.tabCounts.loading = false;
                state.tabCounts.data = action.payload;
                state.tabCounts.lastFetched = Date.now();
            })
            .addCase(fetchPPCTabCounts.rejected, (state, action) => {
                state.tabCounts.loading = false;
                state.tabCounts.error = action.payload;
            })
        
        // Fetch High ACOS Campaigns
            .addCase(fetchHighAcosCampaigns.pending, (state) => {
                state.highAcos.loading = true;
                state.highAcos.error = null;
            })
            .addCase(fetchHighAcosCampaigns.fulfilled, (state, action) => {
                state.highAcos.loading = false;
                if (action.payload.append) {
                    state.highAcos.data = [...state.highAcos.data, ...action.payload.data];
                } else {
                    state.highAcos.data = action.payload.data;
                }
                state.highAcos.pagination = action.payload.pagination;
                state.highAcos.lastFetched = Date.now();
            })
            .addCase(fetchHighAcosCampaigns.rejected, (state, action) => {
                state.highAcos.loading = false;
                state.highAcos.error = action.payload;
            })
        
        // Fetch Wasted Spend Keywords
            .addCase(fetchWastedSpendKeywords.pending, (state) => {
                state.wastedSpend.loading = true;
                state.wastedSpend.error = null;
            })
            .addCase(fetchWastedSpendKeywords.fulfilled, (state, action) => {
                state.wastedSpend.loading = false;
                if (action.payload.append) {
                    state.wastedSpend.data = [...state.wastedSpend.data, ...action.payload.data];
                } else {
                    state.wastedSpend.data = action.payload.data;
                }
                state.wastedSpend.pagination = action.payload.pagination;
                state.wastedSpend.lastFetched = Date.now();
            })
            .addCase(fetchWastedSpendKeywords.rejected, (state, action) => {
                state.wastedSpend.loading = false;
                state.wastedSpend.error = action.payload;
            })
        
        // Fetch Campaigns Without Negatives
            .addCase(fetchCampaignsWithoutNegatives.pending, (state) => {
                state.noNegatives.loading = true;
                state.noNegatives.error = null;
            })
            .addCase(fetchCampaignsWithoutNegatives.fulfilled, (state, action) => {
                state.noNegatives.loading = false;
                if (action.payload.append) {
                    state.noNegatives.data = [...state.noNegatives.data, ...action.payload.data];
                } else {
                    state.noNegatives.data = action.payload.data;
                }
                state.noNegatives.pagination = action.payload.pagination;
                state.noNegatives.lastFetched = Date.now();
            })
            .addCase(fetchCampaignsWithoutNegatives.rejected, (state, action) => {
                state.noNegatives.loading = false;
                state.noNegatives.error = action.payload;
            })
        
        // Fetch Top Performing Keywords
            .addCase(fetchTopPerformingKeywords.pending, (state) => {
                state.topKeywords.loading = true;
                state.topKeywords.error = null;
            })
            .addCase(fetchTopPerformingKeywords.fulfilled, (state, action) => {
                state.topKeywords.loading = false;
                if (action.payload.append) {
                    state.topKeywords.data = [...state.topKeywords.data, ...action.payload.data];
                } else {
                    state.topKeywords.data = action.payload.data;
                }
                state.topKeywords.pagination = action.payload.pagination;
                state.topKeywords.lastFetched = Date.now();
            })
            .addCase(fetchTopPerformingKeywords.rejected, (state, action) => {
                state.topKeywords.loading = false;
                state.topKeywords.error = action.payload;
            })
        
        // Fetch Search Terms with Zero Sales
            .addCase(fetchSearchTermsZeroSales.pending, (state) => {
                state.zeroSales.loading = true;
                state.zeroSales.error = null;
            })
            .addCase(fetchSearchTermsZeroSales.fulfilled, (state, action) => {
                state.zeroSales.loading = false;
                if (action.payload.append) {
                    state.zeroSales.data = [...state.zeroSales.data, ...action.payload.data];
                } else {
                    state.zeroSales.data = action.payload.data;
                }
                state.zeroSales.pagination = action.payload.pagination;
                state.zeroSales.lastFetched = Date.now();
            })
            .addCase(fetchSearchTermsZeroSales.rejected, (state, action) => {
                state.zeroSales.loading = false;
                state.zeroSales.error = action.payload;
            })
        
        // Fetch Auto Campaign Insights
            .addCase(fetchAutoCampaignInsights.pending, (state) => {
                state.autoInsights.loading = true;
                state.autoInsights.error = null;
            })
            .addCase(fetchAutoCampaignInsights.fulfilled, (state, action) => {
                state.autoInsights.loading = false;
                if (action.payload.append) {
                    state.autoInsights.data = [...state.autoInsights.data, ...action.payload.data];
                } else {
                    state.autoInsights.data = action.payload.data;
                }
                state.autoInsights.pagination = action.payload.pagination;
                state.autoInsights.lastFetched = Date.now();
            })
            .addCase(fetchAutoCampaignInsights.rejected, (state, action) => {
                state.autoInsights.loading = false;
                state.autoInsights.error = action.payload;
            });
    }
});

export const {
    clearCampaignAnalysis,
    clearTabData,
    invalidateAllCache,
    resetTabPagination
} = ppcCampaignAnalysisSlice.actions;

// Selectors
export const selectPPCKPISummary = (state) => state.ppcCampaignAnalysis?.summary?.data;
export const selectPPCKPISummaryLoading = (state) => state.ppcCampaignAnalysis?.summary?.loading;

export const selectPPCTabCounts = (state) => state.ppcCampaignAnalysis?.tabCounts?.data;
export const selectPPCTabCountsLoading = (state) => state.ppcCampaignAnalysis?.tabCounts?.loading;

export const selectHighAcosCampaigns = (state) => state.ppcCampaignAnalysis?.highAcos?.data || [];
export const selectHighAcosPagination = (state) => state.ppcCampaignAnalysis?.highAcos?.pagination;
export const selectHighAcosLoading = (state) => state.ppcCampaignAnalysis?.highAcos?.loading;

export const selectWastedSpendKeywords = (state) => state.ppcCampaignAnalysis?.wastedSpend?.data || [];
export const selectWastedSpendPagination = (state) => state.ppcCampaignAnalysis?.wastedSpend?.pagination;
export const selectWastedSpendLoading = (state) => state.ppcCampaignAnalysis?.wastedSpend?.loading;

export const selectNoNegativesCampaigns = (state) => state.ppcCampaignAnalysis?.noNegatives?.data || [];
export const selectNoNegativesPagination = (state) => state.ppcCampaignAnalysis?.noNegatives?.pagination;
export const selectNoNegativesLoading = (state) => state.ppcCampaignAnalysis?.noNegatives?.loading;

export const selectTopPerformingKeywords = (state) => state.ppcCampaignAnalysis?.topKeywords?.data || [];
export const selectTopKeywordsPagination = (state) => state.ppcCampaignAnalysis?.topKeywords?.pagination;
export const selectTopKeywordsLoading = (state) => state.ppcCampaignAnalysis?.topKeywords?.loading;

export const selectZeroSalesTerms = (state) => state.ppcCampaignAnalysis?.zeroSales?.data || [];
export const selectZeroSalesPagination = (state) => state.ppcCampaignAnalysis?.zeroSales?.pagination;
export const selectZeroSalesLoading = (state) => state.ppcCampaignAnalysis?.zeroSales?.loading;

export const selectAutoInsights = (state) => state.ppcCampaignAnalysis?.autoInsights?.data || [];
export const selectAutoInsightsPagination = (state) => state.ppcCampaignAnalysis?.autoInsights?.pagination;
export const selectAutoInsightsLoading = (state) => state.ppcCampaignAnalysis?.autoInsights?.loading;

// Helper selector to check if any tab is loading
export const selectAnyTabLoading = (state) => {
    const analysis = state.ppcCampaignAnalysis;
    return analysis?.highAcos?.loading ||
           analysis?.wastedSpend?.loading ||
           analysis?.noNegatives?.loading ||
           analysis?.topKeywords?.loading ||
           analysis?.zeroSales?.loading ||
           analysis?.autoInsights?.loading;
};

export default ppcCampaignAnalysisSlice.reducer;
