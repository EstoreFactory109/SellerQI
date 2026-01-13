/**
 * Page Data Slice
 * 
 * Manages page-wise data with Redux caching.
 * Data is fetched from backend endpoints and cached in Redux.
 * Each page has its own data slice to avoid unnecessary re-fetches.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config';

// Initial state for each page's data
const initialState = {
    // Main Dashboard Data
    dashboard: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Profitability Dashboard Data
    profitability: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // PPC Dashboard Data
    ppc: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Issues Page Data
    issues: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Issues By Product Data
    issuesByProduct: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Keyword Analysis Data
    keywordAnalysis: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Reimbursement Data
    reimbursement: {
        summary: null,
        reimbursements: [],
        loading: false,
        error: null,
        lastFetched: null
    },
    // Tasks Data
    tasks: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Inventory Data
    inventory: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Your Products Data
    yourProducts: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    }
};

// Async thunks for fetching page data
export const fetchDashboardData = createAsyncThunk(
    'pageData/fetchDashboard',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            // Check if data already exists and is less than 5 minutes old
            const lastFetched = state.pageData?.dashboard?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.dashboard.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard data');
        }
    }
);

export const fetchProfitabilityData = createAsyncThunk(
    'pageData/fetchProfitability',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.profitability?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.profitability.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/profitability');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability data');
        }
    }
);

export const fetchPPCData = createAsyncThunk(
    'pageData/fetchPPC',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.ppc?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.ppc.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC data');
        }
    }
);

export const fetchIssuesData = createAsyncThunk(
    'pageData/fetchIssues',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.issues?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.issues.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/issues');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch issues data');
        }
    }
);

export const fetchIssuesByProductData = createAsyncThunk(
    'pageData/fetchIssuesByProduct',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.issuesByProduct?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.issuesByProduct.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/issues-by-product');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch issues by product data');
        }
    }
);

export const fetchKeywordAnalysisData = createAsyncThunk(
    'pageData/fetchKeywordAnalysis',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.keywordAnalysis?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.keywordAnalysis.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/keyword-analysis');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch keyword analysis data');
        }
    }
);

export const fetchReimbursementData = createAsyncThunk(
    'pageData/fetchReimbursement',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.reimbursement?.lastFetched;
            // Check if data exists and is less than 5 minutes old
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return {
                    summary: state.pageData.reimbursement.summary,
                    reimbursements: state.pageData.reimbursement.reimbursements
                };
            }
            
            // Fetch both summary and reimbursements in parallel
            const [summaryRes, reimbursementsRes] = await Promise.all([
                axiosInstance.get('/app/reimbursements/summary'),
                axiosInstance.get('/app/reimbursements')
            ]);
            
            return {
                summary: summaryRes.data?.data || summaryRes.data,
                reimbursements: reimbursementsRes.data?.data || reimbursementsRes.data || []
            };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch reimbursement data');
        }
    }
);

export const fetchTasksData = createAsyncThunk(
    'pageData/fetchTasks',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.tasks?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.tasks.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/tasks');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch tasks data');
        }
    }
);

export const updateTaskStatus = createAsyncThunk(
    'pageData/updateTaskStatus',
    async ({ taskId, status }, { rejectWithValue }) => {
        try {
            const response = await axiosInstance.put('/api/pagewise/tasks/status', {
                taskId,
                status
            });
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to update task status');
        }
    }
);

export const fetchInventoryData = createAsyncThunk(
    'pageData/fetchInventory',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.inventory?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000) {
                return state.pageData.inventory.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/inventory');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory data');
        }
    }
);

export const fetchYourProductsData = createAsyncThunk(
    'pageData/fetchYourProducts',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            // Check if data exists in Redux - only fetch if empty
            if (state.pageData?.yourProducts?.data) {
                return state.pageData.yourProducts.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/your-products');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch your products data');
        }
    }
);

// Create the slice
const pageDataSlice = createSlice({
    name: 'pageData',
    initialState,
    reducers: {
        // Clear all page data (e.g., on logout or account switch)
        clearAllPageData: (state) => {
            return initialState;
        },
        // Clear specific page data
        clearPageData: (state, action) => {
            const page = action.payload;
            if (state[page]) {
                state[page] = {
                    data: null,
                    loading: false,
                    error: null,
                    lastFetched: null
                };
            }
        },
        // Force refresh - clear lastFetched to allow re-fetch
        forceRefresh: (state, action) => {
            const page = action.payload;
            if (state[page]) {
                state[page].lastFetched = null;
            }
        },
        // Force refresh all pages
        forceRefreshAll: (state) => {
            Object.keys(state).forEach(page => {
                if (state[page] && state[page].lastFetched !== undefined) {
                    state[page].lastFetched = null;
                }
            });
        }
    },
    extraReducers: (builder) => {
        // Dashboard
        builder
            .addCase(fetchDashboardData.pending, (state) => {
                state.dashboard.loading = true;
                state.dashboard.error = null;
            })
            .addCase(fetchDashboardData.fulfilled, (state, action) => {
                state.dashboard.loading = false;
                state.dashboard.data = action.payload;
                state.dashboard.lastFetched = Date.now();
            })
            .addCase(fetchDashboardData.rejected, (state, action) => {
                state.dashboard.loading = false;
                state.dashboard.error = action.payload;
            })
        
        // Profitability
            .addCase(fetchProfitabilityData.pending, (state) => {
                state.profitability.loading = true;
                state.profitability.error = null;
            })
            .addCase(fetchProfitabilityData.fulfilled, (state, action) => {
                state.profitability.loading = false;
                state.profitability.data = action.payload;
                state.profitability.lastFetched = Date.now();
            })
            .addCase(fetchProfitabilityData.rejected, (state, action) => {
                state.profitability.loading = false;
                state.profitability.error = action.payload;
            })
        
        // PPC
            .addCase(fetchPPCData.pending, (state) => {
                state.ppc.loading = true;
                state.ppc.error = null;
            })
            .addCase(fetchPPCData.fulfilled, (state, action) => {
                state.ppc.loading = false;
                state.ppc.data = action.payload;
                state.ppc.lastFetched = Date.now();
            })
            .addCase(fetchPPCData.rejected, (state, action) => {
                state.ppc.loading = false;
                state.ppc.error = action.payload;
            })
        
        // Issues
            .addCase(fetchIssuesData.pending, (state) => {
                state.issues.loading = true;
                state.issues.error = null;
            })
            .addCase(fetchIssuesData.fulfilled, (state, action) => {
                state.issues.loading = false;
                state.issues.data = action.payload;
                state.issues.lastFetched = Date.now();
            })
            .addCase(fetchIssuesData.rejected, (state, action) => {
                state.issues.loading = false;
                state.issues.error = action.payload;
            })
        
        // Issues By Product
            .addCase(fetchIssuesByProductData.pending, (state) => {
                state.issuesByProduct.loading = true;
                state.issuesByProduct.error = null;
            })
            .addCase(fetchIssuesByProductData.fulfilled, (state, action) => {
                state.issuesByProduct.loading = false;
                state.issuesByProduct.data = action.payload;
                state.issuesByProduct.lastFetched = Date.now();
            })
            .addCase(fetchIssuesByProductData.rejected, (state, action) => {
                state.issuesByProduct.loading = false;
                state.issuesByProduct.error = action.payload;
            })
        
        // Keyword Analysis
            .addCase(fetchKeywordAnalysisData.pending, (state) => {
                state.keywordAnalysis.loading = true;
                state.keywordAnalysis.error = null;
            })
            .addCase(fetchKeywordAnalysisData.fulfilled, (state, action) => {
                state.keywordAnalysis.loading = false;
                state.keywordAnalysis.data = action.payload;
                state.keywordAnalysis.lastFetched = Date.now();
            })
            .addCase(fetchKeywordAnalysisData.rejected, (state, action) => {
                state.keywordAnalysis.loading = false;
                state.keywordAnalysis.error = action.payload;
            })
        
        // Reimbursement
            .addCase(fetchReimbursementData.pending, (state) => {
                state.reimbursement.loading = true;
                state.reimbursement.error = null;
            })
            .addCase(fetchReimbursementData.fulfilled, (state, action) => {
                state.reimbursement.loading = false;
                state.reimbursement.summary = action.payload.summary;
                state.reimbursement.reimbursements = action.payload.reimbursements;
                state.reimbursement.lastFetched = Date.now();
            })
            .addCase(fetchReimbursementData.rejected, (state, action) => {
                state.reimbursement.loading = false;
                state.reimbursement.error = action.payload;
            })
        
        // Tasks
            .addCase(fetchTasksData.pending, (state) => {
                state.tasks.loading = true;
                state.tasks.error = null;
            })
            .addCase(fetchTasksData.fulfilled, (state, action) => {
                state.tasks.loading = false;
                state.tasks.data = action.payload;
                state.tasks.lastFetched = Date.now();
            })
            .addCase(fetchTasksData.rejected, (state, action) => {
                state.tasks.loading = false;
                state.tasks.error = action.payload;
            })
            .addCase(updateTaskStatus.fulfilled, (state, action) => {
                state.tasks.data = action.payload;
            })
        
        // Inventory
            .addCase(fetchInventoryData.pending, (state) => {
                state.inventory.loading = true;
                state.inventory.error = null;
            })
            .addCase(fetchInventoryData.fulfilled, (state, action) => {
                state.inventory.loading = false;
                state.inventory.data = action.payload;
                state.inventory.lastFetched = Date.now();
            })
            .addCase(fetchInventoryData.rejected, (state, action) => {
                state.inventory.loading = false;
                state.inventory.error = action.payload;
            })
        
        // Your Products
            .addCase(fetchYourProductsData.pending, (state) => {
                state.yourProducts.loading = true;
                state.yourProducts.error = null;
            })
            .addCase(fetchYourProductsData.fulfilled, (state, action) => {
                state.yourProducts.loading = false;
                state.yourProducts.data = action.payload;
                state.yourProducts.lastFetched = Date.now();
            })
            .addCase(fetchYourProductsData.rejected, (state, action) => {
                state.yourProducts.loading = false;
                state.yourProducts.error = action.payload;
            });
    }
});

export const { 
    clearAllPageData, 
    clearPageData, 
    forceRefresh, 
    forceRefreshAll 
} = pageDataSlice.actions;

export default pageDataSlice.reducer;

