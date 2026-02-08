/**
 * Page Data Slice
 * 
 * Manages page-wise data with Redux caching.
 * Data is fetched from backend endpoints and cached in Redux.
 * Each page has its own data slice to avoid unnecessary re-fetches.
 * 
 * Cache TTL: 1 hour (aligned with backend Redis cache)
 * 
 * NOTE: Data is also synced to DashboardSlice for backward compatibility
 * with child components that still access state.Dashboard.DashBoardInfo
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios.config';
import { setDashboardInfo } from './DashboardSlice';

// Cache TTL: 1 hour (aligned with backend cache)
const CACHE_TTL_MS = 60 * 60 * 1000;

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
    },
    // Account History Data
    accountHistory: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    }
};

// Async thunks for fetching page data
export const fetchDashboardData = createAsyncThunk(
    'pageData/fetchDashboard',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            // Check if data already exists and is within cache TTL (1 hour)
            const lastFetched = state.pageData?.dashboard?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.dashboard.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard');
            const data = response.data.data;
            
            // Also sync to DashboardSlice for backward compatibility with child components
            if (data?.dashboardData) {
                dispatch(setDashboardInfo(data.dashboardData));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard data');
        }
    }
);

export const fetchProfitabilityData = createAsyncThunk(
    'pageData/fetchProfitability',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.profitability?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.profitability.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/profitability');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components
            if (data) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability data');
        }
    }
);

export const fetchPPCData = createAsyncThunk(
    'pageData/fetchPPC',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.ppc?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.ppc.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/ppc');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components
            if (data) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch PPC data');
        }
    }
);

export const fetchIssuesData = createAsyncThunk(
    'pageData/fetchIssues',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.issues?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.issues.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/issues');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components (Category.jsx, Account.jsx)
            if (data) {
                // Merge issues data with existing DashboardSlice data
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            return data;
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
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
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
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.keywordAnalysis?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.keywordAnalysis.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/keyword-analysis');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components
            if (data) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            return data;
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
            // Check if data exists and is within cache TTL (1 hour)
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return {
                    summary: state.pageData.reimbursement.summary,
                    reimbursements: state.pageData.reimbursement.reimbursements
                };
            }
            
            // Single endpoint call - summary includes all reimbursement data
            const summaryRes = await axiosInstance.get('/app/reimbursements/summary');
            const summaryData = summaryRes.data?.data || summaryRes.data;
            
            return {
                summary: summaryData,
                reimbursements: [] // Reimbursements table data - empty for now (claims tracking not implemented)
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
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
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
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.inventory.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/inventory');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory data');
        }
    }
);

export const fetchAccountHistoryData = createAsyncThunk(
    'pageData/fetchAccountHistory',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.accountHistory?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.accountHistory.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/account-history');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch account history data');
        }
    }
);

export const fetchYourProductsData = createAsyncThunk(
    'pageData/fetchYourProducts',
    async ({ page = 1, limit = 20, summaryOnly = false, append = false, status = undefined, reset = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existingData = state.pageData?.yourProducts?.data;
            const lastFetched = state.pageData?.yourProducts?.lastFetched;
            
            // If reset is true, always fetch fresh data (bypass cache)
            // Otherwise, check cache first before fetching
            if (reset) {
                console.log('[Redux] Reset flag set - fetching fresh data from database');
                const response = await axiosInstance.get('/api/pagewise/your-products', {
                    params: { page, limit, summaryOnly, status }
                });
                return { ...response.data.data, currentStatus: status, fromCache: false };
            }
            
            // Check cache BEFORE fetching - only fetch if data doesn't exist or is stale
            // For page 1 requests (initial load or tab switch), check if we have cached data for this status
            if (page === 1 && !append) {
                const hasCachedData = existingData && 
                                    existingData.products && 
                                    Array.isArray(existingData.products) && 
                                    existingData.products.length > 0;
                
                const statusMatches = existingData?.currentStatus === status;
                const isRecent = lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS;
                
                // If we have cached data for this exact status and it's recent, return it
                if (hasCachedData && statusMatches && isRecent && existingData.issuesData !== undefined) {
                    console.log('[Redux] Using cached data from Redux (no database call):', {
                        status,
                        productsCount: existingData.products.length,
                        lastFetched: new Date(lastFetched).toISOString(),
                        ageMinutes: ((Date.now() - lastFetched) / 1000 / 60).toFixed(2)
                    });
                    return { ...existingData, fromCache: true };
                }
                
                // If we don't have data or status doesn't match or data is stale, fetch from database
                console.log('[Redux] Cache miss - fetching from database:', {
                    hasCachedData,
                    statusMatches,
                    isRecent,
                    requestedStatus: status,
                    cachedStatus: existingData?.currentStatus
                });
            }
            
            // IMPORTANT: When append is true (Load More), ALWAYS fetch from backend - NEVER use cache
            if (append) {
                // Fetch the requested page from backend with status filter
                // IMPORTANT: Ensure we're passing the correct page number to the backend
                console.log('[Redux] Load More - Fetching page:', {
                    requestedPage: page,
                    limit,
                    status,
                    existingProductsCount: existingData?.products?.length || 0,
                    existingPage: existingData?.pagination?.page || 1
                });
                
                const response = await axiosInstance.get('/api/pagewise/your-products', {
                    params: { page, limit, summaryOnly, status }
                });
                
                const newData = response.data.data;
                
                // Always merge when append is true - we're loading the next page
                // The backend returns only the requested page (e.g., page 2 = products 21-40)
                // We need to append these to existing products (e.g., products 1-20)
                // existingData should always exist when append is true (we're loading more of existing data)
                if (existingData && existingData.products && Array.isArray(existingData.products) && existingData.products.length > 0) {
                    const existingKeys = new Set(
                        existingData.products.map(p => `${p.asin}-${p.sku}`)
                    );
                    
                    // Filter out duplicates (in case backend returns some overlap)
                    const uniqueNewProducts = (newData.products || []).filter(
                        p => !existingKeys.has(`${p.asin}-${p.sku}`)
                    );
                    
                    // Merge: existing products + new unique products
                    const mergedProducts = [...existingData.products, ...uniqueNewProducts];
                    const totalItems = newData.pagination?.totalItems || 0;
                    
                    // Verify we got new products
                    if (uniqueNewProducts.length === 0 && newData.products && newData.products.length > 0) {
                        console.warn('[Redux] Load More - All new products were duplicates!', {
                            requestedPage: page,
                            backendReturnedCount: newData.products.length,
                            existingCount: existingData.products.length,
                            lastExistingAsin: existingData.products[existingData.products.length - 1]?.asin,
                            firstNewAsin: newData.products[0]?.asin
                        });
                    }
                    
                console.log('[Redux] Load More - Merging products:', {
                    hasExistingData: !!existingData,
                    existingCount: existingData.products.length,
                    newCount: newData.products?.length || 0,
                    uniqueNewCount: uniqueNewProducts.length,
                    mergedCount: mergedProducts.length,
                    totalItems,
                    requestedPage: page,
                    backendReturnedPage: newData.pagination?.page,
                    status,
                    lastExistingAsin: existingData.products[existingData.products.length - 1]?.asin,
                    firstNewAsin: uniqueNewProducts[0]?.asin,
                    lastNewAsin: uniqueNewProducts[uniqueNewProducts.length - 1]?.asin
                });
                    
                    return {
                        ...newData,
                        products: mergedProducts, // Merged products list
                        currentStatus: status || existingData.currentStatus, // Preserve or set status
                        pagination: {
                            ...newData.pagination,
                            page: page, // Use the requested page number (should match backend response)
                            totalItems: totalItems, // Keep the filtered total
                            hasMore: mergedProducts.length < totalItems
                        },
                        summary: newData.summary || existingData.summary, // Preserve summary
                        issuesData: existingData.issuesData || newData.issuesData,
                        fromCache: false
                    };
                }
                
                // If no existing data, just return new data (shouldn't happen in normal flow)
                console.warn('[Redux] Load More - No existing data to merge with', {
                    hasExistingData: !!existingData,
                    hasProducts: !!existingData?.products,
                    isArray: Array.isArray(existingData?.products),
                    productsLength: existingData?.products?.length || 0
                });
                return { ...newData, currentStatus: status, fromCache: false };
            }
            
            // Fetch from backend for initial load (cache check already done above for page 1)
            const response = await axiosInstance.get('/api/pagewise/your-products', {
                params: { page, limit, summaryOnly, status }
            });
            
            const newData = response.data.data;
            
            // Return fresh data for initial load (append is handled at the top)
            return { ...newData, currentStatus: status, fromCache: false };
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
            })
        
        // Account History
            .addCase(fetchAccountHistoryData.pending, (state) => {
                state.accountHistory.loading = true;
                state.accountHistory.error = null;
            })
            .addCase(fetchAccountHistoryData.fulfilled, (state, action) => {
                state.accountHistory.loading = false;
                state.accountHistory.data = action.payload;
                state.accountHistory.lastFetched = Date.now();
            })
            .addCase(fetchAccountHistoryData.rejected, (state, action) => {
                state.accountHistory.loading = false;
                state.accountHistory.error = action.payload;
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

