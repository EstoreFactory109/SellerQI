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
    // Multi-phase dashboard loading
    dashboardPhase1: { data: null, loading: false, error: null, lastFetched: null },
    dashboardPhase2: { data: null, loading: false, error: null, lastFetched: null },
    dashboardPhase3: { data: null, loading: false, error: null, lastFetched: null },
    // Dashboard Summary (Phase 1 - fast, lightweight) - LEGACY, kept for backward compatibility
    dashboardSummary: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Top 4 Products (Phase 4 - optimized, minimal)
    top4Products: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Product Checker Data (Full - for detailed pages)
    productChecker: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Main Dashboard Data (legacy, full)
    dashboard: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Profitability Dashboard Data (Full)
    profitability: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Profitability Summary (Phase 1 - Fast, metrics only) - LEGACY
    profitabilitySummary: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Phased Profitability (NEW - Parallel loading architecture)
    profitabilityMetrics: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    profitabilityChart: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    profitabilityTable: {
        data: null,           // Current page data being displayed
        pagination: null,     // Current pagination info
        loading: false,
        error: null,
        lastFetched: null,    // When page 1 was first fetched (for TTL)
        cachedPages: {},      // Map of page number -> { data, fetchedAt }
        // Total counts across ALL data (not page-wise)
        totalParents: 0,
        totalChildren: 0,
        totalProducts: 0
    },
    // Profitability Issues (detailed issues with recommendations)
    profitabilityIssues: {
        data: null,
        summary: null,
        pagination: null,
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
    // Issues Page Data (legacy - full data)
    issues: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    },
    // Issues By Product Data (legacy - full data)
    issuesByProduct: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null,
        comparison: 'none' // Current comparison type: 'wow', 'mom', or 'none'
    },
    // ============================================================================
    // ISSUES PAGINATED (NEW - OPTIMIZED)
    // Separate endpoints per category with server-side pagination
    // ============================================================================
    issuesPaginated: {
        // Summary counts (from pre-computed IssueSummary)
        summary: {
            data: null,
            loading: false,
            error: null,
            lastFetched: null
        },
        // Ranking issues (paginated)
        ranking: {
            data: [],           // Current page items
            pagination: null,   // { page, limit, total, hasMore, totalPages }
            loading: false,
            error: null,
            lastFetched: null
        },
        // Conversion issues (paginated + buy box data)
        conversion: {
            data: [],
            buyBoxData: [],     // Buy box data for conversion tab
            pagination: null,
            loading: false,
            error: null,
            lastFetched: null
        },
        // Inventory issues (paginated)
        inventory: {
            data: [],
            pagination: null,
            loading: false,
            error: null,
            lastFetched: null
        },
        // Account issues (no pagination - small data set)
        account: {
            data: null,
            loading: false,
            error: null,
            lastFetched: null
        }
    },
    // Issues by Product (paginated with sorting/filtering)
    issuesByProductPaginated: {
        data: [],               // Current page products
        pagination: null,       // { page, limit, total, hasMore, totalPages }
        filters: {              // Current filter state
            sort: 'issues',
            sortOrder: 'desc',
            priority: null,
            search: null
        },
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
    // Your Products Data (per-status cache so Inactive/Incomplete don't refetch on tab switch)
    yourProducts: {
        data: null,
        cacheByStatus: {}, // { 'Active'|'Inactive'|'Incomplete'|'All': { products, summary, pagination, currentStatus, lastFetched } }
        loading: false,
        error: null,
        lastFetched: null
    },
    // Your Products V2 (Optimized - single initial call + lazy load tabs)
    yourProductsV2: {
        // Initial load state
        initialLoading: false,
        initialError: null,
        initialLastFetched: null,
        // Summary counts (from initial call)
        summary: null, // { totalProducts, activeProducts, inactiveProducts, incompleteProducts, productsWithAPlus, productsWithoutAPlus, productsNotTargetedInAds }
        // Per-status product data with pagination
        byStatus: {
            // Active|Inactive|Incomplete: { products: [], pagination: {}, loading: false, error: null, lastFetched: null }
        }
    },
    // Your Products V3 (HIGHLY OPTIMIZED - separate endpoints, parallel calls)
    yourProductsV3: {
        // Summary counts (separate endpoint)
        summary: {
            data: null, // { totalProducts, activeProducts, inactiveProducts, incompleteProducts, productsWithAPlus, productsWithoutAPlus, hasBrandStory }
            loading: false,
            error: null,
            lastFetched: null
        },
        // Active products (separate endpoint - NO A+/Ads columns)
        active: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        },
        // Inactive products (separate endpoint)
        inactive: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        },
        // Incomplete products (separate endpoint)
        incomplete: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        },
        // Without A+ products (separate endpoint)
        withoutAPlus: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        },
        // Not targeted in ads (separate endpoint)
        notTargetedInAds: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        },
        // Optimization tab (lightweight endpoint - skips full Analyse/analyseData)
        optimization: {
            products: [],
            pagination: {},
            loading: false,
            error: null,
            lastFetched: null
        }
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

/**
 * Fetch Dashboard Summary (Phase 1 - fast, lightweight)
 * This is the new optimized endpoint for first-load performance
 */
export const fetchDashboardSummary = createAsyncThunk(
    'pageData/fetchDashboardSummary',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.dashboardSummary?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.dashboardSummary.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard-summary');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components
            if (data?.dashboardData) {
                dispatch(setDashboardInfo(data.dashboardData));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard summary');
        }
    }
);

/**
 * MULTI-PHASE DASHBOARD LOADING
 * Phase 1: Instant (~50ms) - precomputed error counts, product counts, date range
 */
export const fetchDashboardPhase1 = createAsyncThunk(
    'pageData/fetchDashboardPhase1',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.dashboardPhase1?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.dashboardPhase1.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard-phase1');
            const data = response.data.data?.dashboardData;
            
            if (data) {
                const existing = getState().Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({ ...existing, ...data }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard phase 1');
        }
    }
);

/**
 * Phase 2: Core (~150ms) - sales totals, account health, finance summary, PPC summary
 */
export const fetchDashboardPhase2 = createAsyncThunk(
    'pageData/fetchDashboardPhase2',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.dashboardPhase2?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.dashboardPhase2.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard-phase2');
            const data = response.data.data?.dashboardData;
            
            if (data) {
                const existing = getState().Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({ ...existing, ...data }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard phase 2');
        }
    }
);

/**
 * Phase 3: Charts (~200ms) - datewiseSales, ppcDateWiseMetrics, orders, products, adsKeywordsData
 */
export const fetchDashboardPhase3 = createAsyncThunk(
    'pageData/fetchDashboardPhase3',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.dashboardPhase3?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.dashboardPhase3.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/dashboard-phase3');
            const data = response.data.data?.dashboardData;
            
            if (data) {
                const existing = getState().Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({ ...existing, ...data }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch dashboard phase 3');
        }
    }
);

/**
 * Fetch Product Checker Data (Phase 2 - error analysis)
 * Called after dashboard summary for progressive loading
 */
/**
 * Fetch top 4 products (Phase 2 - OPTIMIZED)
 * 
 * Lightweight endpoint that ONLY returns top 4 products for main dashboard.
 * Does NOT run full Analyse service - single MongoDB aggregation.
 * Expected response time: 50-200ms (vs 2-5s for /product-checker)
 */
export const fetchTop4Products = createAsyncThunk(
    'pageData/fetchTop4Products',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.top4Products?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.top4Products.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/top4-products');
            const data = response.data.data;
            
            // Merge top 4 products into DashboardSlice
            // IMPORTANT: Get latest state AFTER the API call to ensure Phase 1 data is included
            if (data) {
                const currentState = getState();
                const existingDashboard = currentState.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    first: data.first,
                    second: data.second,
                    third: data.third,
                    fourth: data.fourth
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch top 4 products');
        }
    }
);

/**
 * Fetch product checker data (FULL - for detailed pages)
 * 
 * Returns full error analysis including productWiseError, profitabilityErrorDetails, etc.
 * Use this for IssuesByProduct, ProductDetails, YourProducts pages.
 * For main dashboard, use fetchTop4Products instead.
 */
export const fetchProductCheckerData = createAsyncThunk(
    'pageData/fetchProductChecker',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.productChecker?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.productChecker.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/product-checker');
            const data = response.data.data;
            
            // Merge product checker data into DashboardSlice
            if (data) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch product checker data');
        }
    }
);

/**
 * Fetch full dashboard data (legacy)
 * Use this only when full data is needed, not for initial load
 */
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

/**
 * Fetch Profitability Summary (Phase 1 - FAST)
 * Returns only metrics and chart data for instant rendering (~100-200ms)
 * Use this for initial load, then fetch full data for table
 */
export const fetchProfitabilitySummary = createAsyncThunk(
    'pageData/fetchProfitabilitySummary',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.profitabilitySummary?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.profitabilitySummary.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/profitability-summary');
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
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability summary');
        }
    }
);

/**
 * Fetch Full Profitability Data (OPTIMIZED)
 * Uses ProfitabilityService which fetches only 5-8 collections instead of 24+
 * Returns full data including profitability table (~300-500ms, previously 2-5s)
 */
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

/**
 * ============================================================================
 * PHASED PROFITABILITY LOADING (NEW ARCHITECTURE)
 * ============================================================================
 * These 3 thunks are designed to be dispatched in parallel for fastest page load.
 * Each endpoint can complete independently and display as soon as ready.
 */

/**
 * PHASE 1: Fetch Profitability Metrics (KPI boxes)
 * Returns: Total Sales, Total PPC Sales, Total Ad Spend, ACOS%, Amazon Fees, Gross Profit
 * Expected time: ~50-100ms
 */
export const fetchProfitabilityMetrics = createAsyncThunk(
    'pageData/fetchProfitabilityMetrics',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.profitabilityMetrics?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.profitabilityMetrics.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/profitability/metrics');
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility
            if (data) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    accountFinance: data.accountFinance,
                    TotalWeeklySale: data.totalSales,
                    Country: data.Country
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability metrics');
        }
    }
);

/**
 * PHASE 2: Fetch Profitability Chart Data
 * Returns: Datewise gross profit and total sales for chart
 * Expected time: ~50-100ms
 */
export const fetchProfitabilityChart = createAsyncThunk(
    'pageData/fetchProfitabilityChart',
    async (_, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.profitabilityChart?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return state.pageData.profitabilityChart.data;
            }
            
            const response = await axiosInstance.get('/api/pagewise/profitability/chart');
            const data = response.data.data;
            
            // Sync economicsMetrics to DashboardSlice for chart compatibility
            if (data?.chartData) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    economicsMetrics: {
                        ...existingDashboard.economicsMetrics,
                        datewiseSales: data.chartData.map(item => ({
                            date: item.date,
                            sales: { amount: item.totalSales },
                            grossProfit: { amount: item.grossProfit }
                        })),
                        dateRange: data.dateRange
                    }
                }));
            }
            
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability chart');
        }
    }
);

/**
 * PHASE 3: Fetch Profitability Table Data (PAGINATED)
 * Returns: Paginated ASIN-wise profitability data
 * Expected time: ~100-300ms
 * 
 * Caches each page separately to allow navigation between pages without re-fetching.
 * 
 * @param {Object} options - { page: number, limit: number }
 */
export const fetchProfitabilityTable = createAsyncThunk(
    'pageData/fetchProfitabilityTable',
    async ({ page = 1, limit = 10 } = {}, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            const tableState = state.pageData?.profitabilityTable;
            
            // Check if this page is already cached and still fresh
            const cachedPage = tableState?.cachedPages?.[page];
            if (cachedPage && cachedPage.fetchedAt && (Date.now() - cachedPage.fetchedAt) < CACHE_TTL_MS) {
                // Return cached page data
                return {
                    data: cachedPage.data,
                    pagination: { ...cachedPage.pagination, page },
                    totalProfitabilityErrors: cachedPage.totalProfitabilityErrors,
                    profitabilityErrorDetails: cachedPage.profitabilityErrorDetails,
                    totalParents: cachedPage.totalParents,
                    totalChildren: cachedPage.totalChildren,
                    totalProducts: cachedPage.totalProducts,
                    fromCache: true,
                    page
                };
            }
            
            const response = await axiosInstance.get(`/api/pagewise/profitability/table?page=${page}&limit=${limit}`);
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with child components
            if (data?.profitibilityData) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                
                // Always replace data (proper pagination, not infinite scroll)
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    profitibilityData: data.profitibilityData,
                    totalProfitabilityErrors: data.totalProfitabilityErrors,
                    profitabilityErrorDetails: data.profitabilityErrorDetails
                }));
            }
            
            return {
                data: data.profitibilityData,
                pagination: data.pagination,
                totalProfitabilityErrors: data.totalProfitabilityErrors,
                profitabilityErrorDetails: data.profitabilityErrorDetails,
                totalParents: data.totalParents,
                totalChildren: data.totalChildren,
                totalProducts: data.totalProducts,
                fromCache: false,
                page
            };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability table');
        }
    }
);

/**
 * PHASE 4: Fetch Profitability Issues (PAGINATED)
 * Returns: Detailed profitability issues with recommendations
 * Uses SAME logic as DashboardCalculation.calculateProfitabilityErrors
 * Expected time: ~100-200ms
 * 
 * @param {Object} options - { page: number, limit: number }
 */
export const fetchProfitabilityIssues = createAsyncThunk(
    'pageData/fetchProfitabilityIssues',
    async ({ page = 1, limit = 10 } = {}, { getState, dispatch, rejectWithValue }) => {
        try {
            const state = getState();
            
            // Only use cache for page 1
            if (page === 1) {
                const lastFetched = state.pageData?.profitabilityIssues?.lastFetched;
                if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                    return {
                        data: state.pageData.profitabilityIssues.data,
                        summary: state.pageData.profitabilityIssues.summary,
                        pagination: state.pageData.profitabilityIssues.pagination,
                        fromCache: true
                    };
                }
            }
            
            const response = await axiosInstance.get(`/api/pagewise/profitability/issues?page=${page}&limit=${limit}`);
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility
            if (data?.summary) {
                const existingDashboard = state.Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    totalProfitabilityErrors: data.summary.totalIssues,
                    profitabilityErrorDetails: data.issues
                }));
            }
            
            return {
                data: data.issues,
                summary: data.summary,
                pagination: data.pagination,
                fromCache: false
            };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch profitability issues');
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

/**
 * Fetch issues by product data with optional comparison type
 * @param {Object} options - Optional parameters
 * @param {string} options.comparison - Comparison type: 'wow' | 'mom' | 'none' (default: 'none')
 * @param {boolean} options.forceRefresh - Force refresh ignoring cache
 */
export const fetchIssuesByProductData = createAsyncThunk(
    'pageData/fetchIssuesByProduct',
    async (options = {}, { getState, dispatch, rejectWithValue }) => {
        try {
            const { comparison = 'none', forceRefresh = false } = options || {};
            const state = getState();
            const lastFetched = state.pageData?.issuesByProduct?.lastFetched;
            const cachedComparison = state.pageData?.issuesByProduct?.comparison;
            
            // Use cache if available, not forcing refresh, and comparison type matches
            if (!forceRefresh && lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS && cachedComparison === comparison) {
                const cachedData = state.pageData.issuesByProduct.data;
                
                // Still sync cached data to DashboardSlice for ProductDetails.jsx
                // This ensures enriched productWiseError (with performance) is available
                if (cachedData) {
                    const existingDashboard = getState().Dashboard?.DashBoardInfo || {};
                    dispatch(setDashboardInfo({
                        ...existingDashboard,
                        ...cachedData
                    }));
                }
                
                return cachedData;
            }
            
            // Build URL with optional comparison and forceRefresh params (forceRefresh bypasses server Redis cache)
            let url = '/api/pagewise/issues-by-product';
            const params = new URLSearchParams();
            if (comparison && comparison !== 'none') params.set('comparison', comparison);
            if (forceRefresh) params.set('forceRefresh', 'true');
            if (params.toString()) url += `?${params.toString()}`;
            
            const response = await axiosInstance.get(url);
            const data = response.data.data;
            
            // Sync to DashboardSlice for backward compatibility with ProductDetails.jsx
            // This ensures the single-product detail view has access to enriched data
            // (performance metrics and recommendations)
            if (data) {
                const existingDashboard = getState().Dashboard?.DashBoardInfo || {};
                dispatch(setDashboardInfo({
                    ...existingDashboard,
                    ...data
                }));
            }
            
            // Return data along with comparison type for caching
            return { ...data, _comparison: comparison };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch issues by product data');
        }
    }
);

// ============================================================================
// ISSUES PAGINATED THUNKS (NEW - OPTIMIZED)
// These thunks fetch data from the new paginated endpoints
// ============================================================================

/**
 * Fetch Issues Summary (counts only - fast)
 * Uses pre-computed IssueSummary model
 */
export const fetchIssuesSummary = createAsyncThunk(
    'pageData/fetchIssuesSummary',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.issuesPaginated?.summary?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return { fromCache: true, data: state.pageData.issuesPaginated.summary.data };
            }
            
            const response = await axiosInstance.get('/api/pagewise/issues/summary');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch issues summary');
        }
    }
);

/**
 * Fetch Ranking Issues (paginated)
 * @param {Object} options - { page: number, limit: number, append: boolean }
 */
export const fetchRankingIssues = createAsyncThunk(
    'pageData/fetchRankingIssues',
    async ({ page = 1, limit = 10, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.issuesPaginated?.ranking;
            
            // For page 1, check cache (unless appending)
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < CACHE_TTL_MS && existing.data?.length > 0) {
                return { fromCache: true };
            }
            
            const response = await axiosInstance.get(`/api/pagewise/issues/ranking?page=${page}&limit=${limit}`);
            const result = response.data.data;
            
            // If appending (Load More), merge with existing
            // Merge by ASIN and combine error fields (a product's errors may span multiple pages)
            if (append && existing?.data?.length > 0) {
                const rankingMap = new Map();
                existing.data.forEach(item => {
                    rankingMap.set(item.asin, JSON.parse(JSON.stringify(item)));
                });
                (result.data || []).forEach(item => {
                    if (rankingMap.has(item.asin)) {
                        // Merge data fields into existing product
                        const existingItem = rankingMap.get(item.asin);
                        const mergedData = { ...existingItem.data };
                        if (item.data) {
                            // Merge each section (TitleResult, BulletPoints, Description, charLim)
                            Object.keys(item.data).forEach(key => {
                                if (key === 'Title') {
                                    mergedData.Title = item.data.Title;
                                } else if (typeof item.data[key] === 'object' && item.data[key] !== null) {
                                    mergedData[key] = { ...(mergedData[key] || {}), ...item.data[key] };
                                } else {
                                    mergedData[key] = item.data[key];
                                }
                            });
                        }
                        rankingMap.set(item.asin, { ...existingItem, ...item, data: mergedData });
                    } else {
                        rankingMap.set(item.asin, JSON.parse(JSON.stringify(item)));
                    }
                });
                const mergedData = Array.from(rankingMap.values());
                
                return {
                    data: mergedData,
                    pagination: {
                        ...result.pagination,
                        page,
                        hasMore: result.pagination?.hasMore ?? false
                    },
                    fromCache: false,
                    append: true
                };
            }
            
            return { ...result, fromCache: false, append: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch ranking issues');
        }
    }
);

/**
 * Fetch Conversion Issues (paginated + buy box data)
 * @param {Object} options - { page: number, limit: number, append: boolean }
 */
export const fetchConversionIssues = createAsyncThunk(
    'pageData/fetchConversionIssues',
    async ({ page = 1, limit = 10, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.issuesPaginated?.conversion;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < CACHE_TTL_MS && existing.data?.length > 0) {
                return { fromCache: true };
            }
            
            const response = await axiosInstance.get(`/api/pagewise/issues/conversion?page=${page}&limit=${limit}`);
            const result = response.data.data;
            
            if (append && (existing?.data?.length > 0 || existing?.buyBoxData?.length > 0)) {
                // Merge conversion errors by ASIN - combine error fields from same product
                // (A product's errors may span multiple pages, so we merge rather than dedupe)
                const conversionMap = new Map();
                existing.data.forEach(item => {
                    conversionMap.set(item.asin, { ...item });
                });
                (result.data || []).forEach(item => {
                    if (conversionMap.has(item.asin)) {
                        // Merge error fields into existing product
                        const existing = conversionMap.get(item.asin);
                        conversionMap.set(item.asin, { ...existing, ...item });
                    } else {
                        conversionMap.set(item.asin, { ...item });
                    }
                });
                const mergedConversionData = Array.from(conversionMap.values());
                
                // Merge buybox data (dedupe by ASIN - each ASIN has one buybox status)
                const existingBuyboxAsins = new Set((existing.buyBoxData || []).map(item => item.asin));
                const uniqueNewBuyboxItems = (result.buyBoxData || []).filter(item => !existingBuyboxAsins.has(item.asin));
                const mergedBuyboxData = [...(existing.buyBoxData || []), ...uniqueNewBuyboxItems];
                
                return {
                    data: mergedConversionData,
                    buyBoxData: mergedBuyboxData,
                    pagination: {
                        ...result.pagination,
                        page,
                        hasMore: result.pagination?.hasMore ?? false
                    },
                    fromCache: false,
                    append: true
                };
            }
            
            return { ...result, fromCache: false, append: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch conversion issues');
        }
    }
);

/**
 * Fetch Inventory Issues (paginated)
 * @param {Object} options - { page: number, limit: number, append: boolean }
 */
export const fetchInventoryIssues = createAsyncThunk(
    'pageData/fetchInventoryIssues',
    async ({ page = 1, limit = 10, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.issuesPaginated?.inventory;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < CACHE_TTL_MS && existing.data?.length > 0) {
                return { fromCache: true };
            }
            
            const response = await axiosInstance.get(`/api/pagewise/issues/inventory?page=${page}&limit=${limit}`);
            const result = response.data.data;
            
            // If appending (Load More), merge with existing
            // Merge by ASIN and combine error fields (a product's errors may span multiple pages)
            if (append && existing?.data?.length > 0) {
                const inventoryMap = new Map();
                existing.data.forEach(item => {
                    inventoryMap.set(item.asin, JSON.parse(JSON.stringify(item)));
                });
                (result.data || []).forEach(item => {
                    if (inventoryMap.has(item.asin)) {
                        // Merge error fields into existing product
                        const existingItem = inventoryMap.get(item.asin);
                        const merged = { ...existingItem };
                        
                        // Merge inventoryPlanningErrorData
                        if (item.inventoryPlanningErrorData) {
                            merged.inventoryPlanningErrorData = {
                                ...(merged.inventoryPlanningErrorData || {}),
                                ...item.inventoryPlanningErrorData
                            };
                        }
                        // Merge stranded
                        if (item.strandedInventoryErrorData) {
                            merged.strandedInventoryErrorData = item.strandedInventoryErrorData;
                        }
                        // Merge compliance
                        if (item.inboundNonComplianceErrorData) {
                            merged.inboundNonComplianceErrorData = item.inboundNonComplianceErrorData;
                        }
                        // Merge replenishment (combine arrays)
                        if (item.replenishmentErrorData) {
                            const existingRep = merged.replenishmentErrorData || [];
                            const newRep = Array.isArray(item.replenishmentErrorData) ? item.replenishmentErrorData : [item.replenishmentErrorData];
                            merged.replenishmentErrorData = [...existingRep, ...newRep];
                        }
                        
                        inventoryMap.set(item.asin, merged);
                    } else {
                        inventoryMap.set(item.asin, JSON.parse(JSON.stringify(item)));
                    }
                });
                const mergedData = Array.from(inventoryMap.values());

                return {
                    data: mergedData,
                    pagination: {
                        ...result.pagination,
                        page,
                        hasMore: result.pagination?.hasMore ?? false
                    },
                    fromCache: false,
                    append: true
                };
            }

            return { ...result, fromCache: false, append: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory issues');
        }
    }
);

/**
 * Fetch Account Issues (no pagination - small data set)
 */
export const fetchAccountIssues = createAsyncThunk(
    'pageData/fetchAccountIssues',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const lastFetched = state.pageData?.issuesPaginated?.account?.lastFetched;
            if (lastFetched && (Date.now() - lastFetched) < CACHE_TTL_MS) {
                return { fromCache: true, data: state.pageData.issuesPaginated.account.data };
            }
            
            const response = await axiosInstance.get('/api/pagewise/issues/account');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch account issues');
        }
    }
);

/**
 * Fetch Products with Issues (paginated with sorting/filtering)
 * For Issues by Product page
 * 
 * @param {Object} options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 6)
 * @param {string} options.sort - Sort field (issues, sessions, conversion, sales, acos, name, asin, price)
 * @param {string} options.sortOrder - Sort order (asc, desc)
 * @param {string} options.priority - Priority filter (high, medium, low)
 * @param {string} options.search - Search term
 * @param {boolean} options.append - Append to existing data (for Load More)
 */
export const fetchProductsWithIssues = createAsyncThunk(
    'pageData/fetchProductsWithIssues',
    async (options = {}, { getState, rejectWithValue }) => {
        try {
            const {
                page = 1,
                limit = 6,
                sort = 'issues',
                sortOrder = 'desc',
                priority = null,
                search = null,
                append = false
            } = options;
            
            const state = getState();
            const existing = state.pageData?.issuesByProductPaginated;
            
            // For page 1 with no filters, check cache
            const isDefaultFilters = sort === 'issues' && sortOrder === 'desc' && !priority && !search;
            if (page === 1 && !append && isDefaultFilters && existing?.lastFetched && (Date.now() - existing.lastFetched) < CACHE_TTL_MS && existing.data?.length > 0) {
                return { fromCache: true };
            }
            
            // Build query params
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', limit.toString());
            params.set('sort', sort);
            params.set('sortOrder', sortOrder);
            if (priority) params.set('priority', priority);
            if (search) params.set('search', search);
            
            const response = await axiosInstance.get(`/api/pagewise/issues/products?${params.toString()}`);
            const result = response.data.data;
            
            // If appending (Load More), merge with existing
            if (append && existing?.data?.length > 0) {
                const existingAsins = new Set(existing.data.map(item => item.asin));
                const uniqueNewItems = (result.data || []).filter(item => !existingAsins.has(item.asin));
                const mergedData = [...existing.data, ...uniqueNewItems];
                
                return {
                    data: mergedData,
                    pagination: {
                        ...result.pagination,
                        page,
                        hasMore: mergedData.length < (result.pagination?.total || 0)
                    },
                    filters: result.filters,
                    fromCache: false,
                    append: true
                };
            }
            
            return { ...result, fromCache: false, append: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch products with issues');
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

// Cache key for your-products by status (Active, Inactive, Incomplete, or All)
const yourProductsCacheKey = (status) => (status === undefined || status === null ? 'All' : status);

export const fetchYourProductsData = createAsyncThunk(
    'pageData/fetchYourProducts',
    async ({ page = 1, limit = 20, summaryOnly = false, append = false, status = undefined, reset = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existingData = state.pageData?.yourProducts?.data;
            const cacheByStatus = state.pageData?.yourProducts?.cacheByStatus || {};
            const lastFetched = state.pageData?.yourProducts?.lastFetched;
            
            // If reset is true, always fetch fresh data (bypass cache)
            if (reset) {
                console.log('[Redux] Reset flag set - fetching fresh data from database');
                const response = await axiosInstance.get('/api/pagewise/your-products', {
                    params: { page, limit, summaryOnly, status }
                });
                return { ...response.data.data, currentStatus: status, fromCache: false };
            }
            
            // For page 1 (initial load or tab switch), check per-status cache first
            if (page === 1 && !append) {
                const cacheKey = yourProductsCacheKey(status);
                const cached = cacheByStatus[cacheKey];
                const hasCached = cached?.products && Array.isArray(cached.products);
                const cacheRecent = cached?.lastFetched && (Date.now() - cached.lastFetched) < CACHE_TTL_MS;
                
                if (hasCached && cacheRecent && cached.issuesData !== undefined) {
                    console.log('[Redux] Using per-status cached data (no database call):', {
                        status,
                        cacheKey,
                        productsCount: cached.products.length,
                        ageMinutes: ((Date.now() - cached.lastFetched) / 1000 / 60).toFixed(2)
                    });
                    return { ...cached, fromCache: true };
                }
                
                console.log('[Redux] Cache miss for status - fetching from database:', {
                    requestedStatus: status,
                    cacheKey,
                    hasCached: !!cached,
                    cacheRecent: !!cacheRecent
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

// =====================================================================
// YOUR PRODUCTS V2 (OPTIMIZED) - Single initial call + lazy load tabs
// =====================================================================

/**
 * Fetch Your Products Initial V2 (Optimized - SINGLE CALL)
 * Returns EVERYTHING needed for first render:
 * - Summary counts (totalProducts, activeProducts, inactiveProducts, incompleteProducts, etc.)
 * - First 20 Active products (paginated, enriched)
 * - Uses pre-calculated issueCount from Seller model
 * 
 * This is the ONLY call needed on first page load.
 */
export const fetchYourProductsInitialV2 = createAsyncThunk(
    'pageData/fetchYourProductsInitialV2',
    async ({ limit = 20 } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existingData = state.pageData?.yourProductsV2;
            const lastFetched = existingData?.initialLastFetched;
            
            // Use cached data if fresh (15 min TTL)
            if (lastFetched && (Date.now() - lastFetched) < 15 * 60 * 1000) {
                console.log('[v2 Redux] Using cached initial data');
                return { fromCache: true };
            }
            
            console.log('[v2 Redux] Fetching initial data (summary + first 20 Active)');
            const response = await axiosInstance.get('/api/pagewise/your-products-v2/initial', {
                params: { limit }
            });
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch your products initial');
        }
    }
);

/**
 * Fetch Your Products by Status V2 (Optimized)
 * Uses MongoDB aggregation to filter and paginate at DB level
 * 
 * @param {Object} options
 * @param {string} options.status - 'Active' | 'Inactive' | 'Incomplete' (required)
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 20)
 * @param {boolean} options.append - If true, append to existing products (for Load More)
 */
export const fetchYourProductsByStatusV2 = createAsyncThunk(
    'pageData/fetchYourProductsByStatusV2',
    async ({ status, page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            if (!status || !['Active', 'Inactive', 'Incomplete'].includes(status)) {
                return rejectWithValue('status is required and must be Active, Inactive, or Incomplete');
            }
            
            const state = getState();
            const statusData = state.pageData?.yourProductsV2?.byStatus?.[status];
            
            // For page 1 (not append), check cache
            if (page === 1 && !append) {
                const lastFetched = statusData?.lastFetched;
                if (lastFetched && (Date.now() - lastFetched) < 15 * 60 * 1000 && statusData?.products?.length > 0) {
                    console.log(`[v2 Redux] Using cached ${status} products`);
                    return { ...statusData, status, fromCache: true };
                }
            }
            
            console.log(`[v2 Redux] Fetching ${status} products page ${page}`);
            
            const response = await axiosInstance.get('/api/pagewise/your-products-v2/products', {
                params: { status, page, limit }
            });
            
            const newData = response.data.data;
            
            // If appending (Load More), merge with existing products
            if (append && statusData?.products?.length > 0) {
                const existingKeys = new Set(statusData.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                
                const mergedProducts = [...statusData.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    status,
                    fromCache: false
                };
            }
            
            return { ...newData, status, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch your products');
        }
    }
);

// =====================================================================
// YOUR PRODUCTS V3 (HIGHLY OPTIMIZED - separate endpoints, parallel calls)
// =====================================================================

const V3_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch V3 Summary (counts only)
 * Returns: totalProducts, activeProducts, inactiveProducts, incompleteProducts, productsWithoutAPlus, hasBrandStory
 */
export const fetchYourProductsSummaryV3 = createAsyncThunk(
    'pageData/fetchYourProductsSummaryV3',
    async (_, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.summary;
            
            if (existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.data) {
                console.log('[v3 Redux] Using cached summary');
                return { fromCache: true, data: existing.data };
            }
            
            console.log('[v3 Redux] Fetching summary');
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/summary');
            return response.data.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch summary');
        }
    }
);

/**
 * Fetch V3 Active Products (NO A+/Ads columns)
 * @param {Object} options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 20)
 * @param {boolean} options.append - If true, append to existing products (for Load More)
 */
export const fetchYourProductsActiveV3 = createAsyncThunk(
    'pageData/fetchYourProductsActiveV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.active;
            
            // For page 1, check cache
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Active products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Active products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/active', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            // If appending (Load More), merge with existing
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Active products');
        }
    }
);

/**
 * Fetch V3 Inactive Products
 */
export const fetchYourProductsInactiveV3 = createAsyncThunk(
    'pageData/fetchYourProductsInactiveV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.inactive;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Inactive products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Inactive products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/inactive', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Inactive products');
        }
    }
);

/**
 * Fetch V3 Incomplete Products
 */
export const fetchYourProductsIncompleteV3 = createAsyncThunk(
    'pageData/fetchYourProductsIncompleteV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.incomplete;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Incomplete products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Incomplete products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/incomplete', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Incomplete products');
        }
    }
);

/**
 * Fetch V3 Products Without A+ Content
 */
export const fetchYourProductsWithoutAPlusV3 = createAsyncThunk(
    'pageData/fetchYourProductsWithoutAPlusV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.withoutAPlus;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Without A+ products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Without A+ products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/without-aplus', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Without A+ products');
        }
    }
);

/**
 * Fetch V3 Products Not Targeted in Ads
 */
export const fetchYourProductsNotTargetedInAdsV3 = createAsyncThunk(
    'pageData/fetchYourProductsNotTargetedInAdsV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.notTargetedInAds;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Not Targeted in Ads products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Not Targeted in Ads products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/not-targeted-in-ads', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Not Targeted in Ads products');
        }
    }
);

/**
 * Fetch V3 Optimization Products (LIGHTWEIGHT)
 * Uses dedicated fast endpoint that skips full Analyse/analyseData
 * Only fetches: active products + performance data (BuyBox, Economics, SponsoredAds)
 * Frontend generates recommendations client-side
 */
export const fetchOptimizationProductsV3 = createAsyncThunk(
    'pageData/fetchOptimizationProductsV3',
    async ({ page = 1, limit = 20, append = false } = {}, { getState, rejectWithValue }) => {
        try {
            const state = getState();
            const existing = state.pageData?.yourProductsV3?.optimization;
            
            if (page === 1 && !append && existing?.lastFetched && (Date.now() - existing.lastFetched) < V3_CACHE_TTL_MS && existing.products?.length > 0) {
                console.log('[v3 Redux] Using cached Optimization products');
                return { fromCache: true };
            }
            
            console.log(`[v3 Redux] Fetching Optimization products page ${page}`);
            const response = await axiosInstance.get('/api/pagewise/your-products-v3/optimization', {
                params: { page, limit }
            });
            
            const newData = response.data.data;
            
            if (append && existing?.products?.length > 0) {
                const existingKeys = new Set(existing.products.map(p => `${p.asin}-${p.sku}`));
                const uniqueNewProducts = (newData.products || []).filter(
                    p => !existingKeys.has(`${p.asin}-${p.sku}`)
                );
                const mergedProducts = [...existing.products, ...uniqueNewProducts];
                
                return {
                    products: mergedProducts,
                    pagination: {
                        ...newData.pagination,
                        page,
                        hasMore: mergedProducts.length < (newData.pagination?.totalItems || 0)
                    },
                    fromCache: false
                };
            }
            
            return { ...newData, fromCache: false };
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch Optimization products');
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
                const base = { data: null, loading: false, error: null, lastFetched: null };
                state[page] = page === 'yourProducts' ? { ...base, cacheByStatus: {} } : base;
            }
        },
        // Force refresh - clear lastFetched to allow re-fetch
        forceRefresh: (state, action) => {
            const page = action.payload;
            if (state[page]) {
                state[page].lastFetched = null;
                // Also clear cached pages for profitabilityTable
                if (page === 'profitabilityTable' && state[page].cachedPages) {
                    state[page].cachedPages = {};
                }
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
        // Multi-phase Dashboard Loading
        builder
            // Phase 1: Instant
            .addCase(fetchDashboardPhase1.pending, (state) => {
                state.dashboardPhase1.loading = true;
                state.dashboardPhase1.error = null;
            })
            .addCase(fetchDashboardPhase1.fulfilled, (state, action) => {
                state.dashboardPhase1.loading = false;
                state.dashboardPhase1.data = action.payload;
                state.dashboardPhase1.lastFetched = Date.now();
            })
            .addCase(fetchDashboardPhase1.rejected, (state, action) => {
                state.dashboardPhase1.loading = false;
                state.dashboardPhase1.error = action.payload;
            })
            // Phase 2: Core
            .addCase(fetchDashboardPhase2.pending, (state) => {
                state.dashboardPhase2.loading = true;
                state.dashboardPhase2.error = null;
            })
            .addCase(fetchDashboardPhase2.fulfilled, (state, action) => {
                state.dashboardPhase2.loading = false;
                state.dashboardPhase2.data = action.payload;
                state.dashboardPhase2.lastFetched = Date.now();
            })
            .addCase(fetchDashboardPhase2.rejected, (state, action) => {
                state.dashboardPhase2.loading = false;
                state.dashboardPhase2.error = action.payload;
            })
            // Phase 3: Charts
            .addCase(fetchDashboardPhase3.pending, (state) => {
                state.dashboardPhase3.loading = true;
                state.dashboardPhase3.error = null;
            })
            .addCase(fetchDashboardPhase3.fulfilled, (state, action) => {
                state.dashboardPhase3.loading = false;
                state.dashboardPhase3.data = action.payload;
                state.dashboardPhase3.lastFetched = Date.now();
            })
            .addCase(fetchDashboardPhase3.rejected, (state, action) => {
                state.dashboardPhase3.loading = false;
                state.dashboardPhase3.error = action.payload;
            })

        // Dashboard Summary (LEGACY - kept for backward compatibility)
            .addCase(fetchDashboardSummary.pending, (state) => {
                state.dashboardSummary.loading = true;
                state.dashboardSummary.error = null;
            })
            .addCase(fetchDashboardSummary.fulfilled, (state, action) => {
                state.dashboardSummary.loading = false;
                state.dashboardSummary.data = action.payload;
                state.dashboardSummary.lastFetched = Date.now();
            })
            .addCase(fetchDashboardSummary.rejected, (state, action) => {
                state.dashboardSummary.loading = false;
                state.dashboardSummary.error = action.payload;
            })
        
        // Top 4 Products (Phase 2 - Optimized)
            .addCase(fetchTop4Products.pending, (state) => {
                state.top4Products.loading = true;
                state.top4Products.error = null;
            })
            .addCase(fetchTop4Products.fulfilled, (state, action) => {
                state.top4Products.loading = false;
                state.top4Products.data = action.payload;
                state.top4Products.lastFetched = Date.now();
            })
            .addCase(fetchTop4Products.rejected, (state, action) => {
                state.top4Products.loading = false;
                state.top4Products.error = action.payload;
            })

        // Product Checker (Full - for detailed pages)
            .addCase(fetchProductCheckerData.pending, (state) => {
                state.productChecker.loading = true;
                state.productChecker.error = null;
            })
            .addCase(fetchProductCheckerData.fulfilled, (state, action) => {
                state.productChecker.loading = false;
                state.productChecker.data = action.payload;
                state.productChecker.lastFetched = Date.now();
            })
            .addCase(fetchProductCheckerData.rejected, (state, action) => {
                state.productChecker.loading = false;
                state.productChecker.error = action.payload;
            })
        
        // Dashboard (legacy full)
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
        
        // Profitability Summary (Phase 1 - Fast)
            .addCase(fetchProfitabilitySummary.pending, (state) => {
                state.profitabilitySummary.loading = true;
                state.profitabilitySummary.error = null;
            })
            .addCase(fetchProfitabilitySummary.fulfilled, (state, action) => {
                state.profitabilitySummary.loading = false;
                state.profitabilitySummary.data = action.payload;
                state.profitabilitySummary.lastFetched = Date.now();
            })
            .addCase(fetchProfitabilitySummary.rejected, (state, action) => {
                state.profitabilitySummary.loading = false;
                state.profitabilitySummary.error = action.payload;
            })
        
        // Profitability Full (Optimized)
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
        
        // Phased Profitability: Metrics (Phase 1 - KPI boxes)
            .addCase(fetchProfitabilityMetrics.pending, (state) => {
                state.profitabilityMetrics.loading = true;
                state.profitabilityMetrics.error = null;
            })
            .addCase(fetchProfitabilityMetrics.fulfilled, (state, action) => {
                state.profitabilityMetrics.loading = false;
                state.profitabilityMetrics.data = action.payload;
                state.profitabilityMetrics.lastFetched = Date.now();
            })
            .addCase(fetchProfitabilityMetrics.rejected, (state, action) => {
                state.profitabilityMetrics.loading = false;
                state.profitabilityMetrics.error = action.payload;
            })
        
        // Phased Profitability: Chart (Phase 2 - Graph data)
            .addCase(fetchProfitabilityChart.pending, (state) => {
                state.profitabilityChart.loading = true;
                state.profitabilityChart.error = null;
            })
            .addCase(fetchProfitabilityChart.fulfilled, (state, action) => {
                state.profitabilityChart.loading = false;
                state.profitabilityChart.data = action.payload;
                state.profitabilityChart.lastFetched = Date.now();
            })
            .addCase(fetchProfitabilityChart.rejected, (state, action) => {
                state.profitabilityChart.loading = false;
                state.profitabilityChart.error = action.payload;
            })
        
        // Phased Profitability: Table (Phase 3 - Paginated table data)
            .addCase(fetchProfitabilityTable.pending, (state, action) => {
                state.profitabilityTable.loading = true;
                state.profitabilityTable.error = null;
                // Optimistic page update: show next page immediately and clear table so skeleton shows until data loads
                const requestedPage = action.meta?.arg?.page ?? 1;
                if (state.profitabilityTable.pagination) {
                    state.profitabilityTable.pagination = { ...state.profitabilityTable.pagination, page: requestedPage };
                }
                state.profitabilityTable.data = [];
            })
            .addCase(fetchProfitabilityTable.fulfilled, (state, action) => {
                state.profitabilityTable.loading = false;
                const currentPage = action.payload.pagination?.page || action.payload.page || 1;
                
                // Update current display data
                state.profitabilityTable.data = action.payload.data;
                state.profitabilityTable.pagination = action.payload.pagination;
                
                // Update total counts (these are across ALL data, not page-wise)
                if (action.payload.totalParents !== undefined) {
                    state.profitabilityTable.totalParents = action.payload.totalParents;
                }
                if (action.payload.totalChildren !== undefined) {
                    state.profitabilityTable.totalChildren = action.payload.totalChildren;
                }
                if (action.payload.totalProducts !== undefined) {
                    state.profitabilityTable.totalProducts = action.payload.totalProducts;
                }
                
                // Cache this page's data (only if not from cache)
                if (!action.payload.fromCache) {
                    if (!state.profitabilityTable.cachedPages) {
                        state.profitabilityTable.cachedPages = {};
                    }
                    state.profitabilityTable.cachedPages[currentPage] = {
                        data: action.payload.data,
                        pagination: action.payload.pagination,
                        totalProfitabilityErrors: action.payload.totalProfitabilityErrors,
                        profitabilityErrorDetails: action.payload.profitabilityErrorDetails,
                        totalParents: action.payload.totalParents,
                        totalChildren: action.payload.totalChildren,
                        totalProducts: action.payload.totalProducts,
                        fetchedAt: Date.now()
                    };
                }
                
                // Update lastFetched for page 1 (global TTL reference)
                if (currentPage === 1) {
                    state.profitabilityTable.lastFetched = Date.now();
                }
            })
            .addCase(fetchProfitabilityTable.rejected, (state, action) => {
                state.profitabilityTable.loading = false;
                state.profitabilityTable.error = action.payload;
            })
        
        // Phased Profitability: Issues (Phase 4 - Detailed issues with recommendations)
            .addCase(fetchProfitabilityIssues.pending, (state) => {
                state.profitabilityIssues.loading = true;
                state.profitabilityIssues.error = null;
            })
            .addCase(fetchProfitabilityIssues.fulfilled, (state, action) => {
                state.profitabilityIssues.loading = false;
                const currentPage = action.payload.pagination?.page || 1;
                
                // For page 1: replace data (fresh load or refresh)
                // For page > 1: append data (Load More pattern)
                if (currentPage === 1) {
                    state.profitabilityIssues.data = action.payload.data;
                    state.profitabilityIssues.lastFetched = Date.now();
                } else {
                    // Append new issues to existing data for "Load More"
                    const existingData = state.profitabilityIssues.data || [];
                    const newData = action.payload.data || [];
                    state.profitabilityIssues.data = [...existingData, ...newData];
                }
                
                state.profitabilityIssues.summary = action.payload.summary;
                state.profitabilityIssues.pagination = action.payload.pagination;
            })
            .addCase(fetchProfitabilityIssues.rejected, (state, action) => {
                state.profitabilityIssues.loading = false;
                state.profitabilityIssues.error = action.payload;
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
                // Extract comparison type from payload and store separately
                const { _comparison, ...data } = action.payload || {};
                state.issuesByProduct.data = data;
                state.issuesByProduct.comparison = _comparison || 'none';
                state.issuesByProduct.lastFetched = Date.now();
            })
            .addCase(fetchIssuesByProductData.rejected, (state, action) => {
                state.issuesByProduct.loading = false;
                state.issuesByProduct.error = action.payload;
            })
        
        // =====================================================================
        // Issues Paginated Reducers (NEW - OPTIMIZED)
        // =====================================================================
        
        // Issues Summary
            .addCase(fetchIssuesSummary.pending, (state) => {
                state.issuesPaginated.summary.loading = true;
                state.issuesPaginated.summary.error = null;
            })
            .addCase(fetchIssuesSummary.fulfilled, (state, action) => {
                state.issuesPaginated.summary.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesPaginated.summary.data = action.payload;
                    state.issuesPaginated.summary.lastFetched = Date.now();
                }
            })
            .addCase(fetchIssuesSummary.rejected, (state, action) => {
                state.issuesPaginated.summary.loading = false;
                state.issuesPaginated.summary.error = action.payload;
            })
        
        // Ranking Issues (paginated)
            .addCase(fetchRankingIssues.pending, (state) => {
                state.issuesPaginated.ranking.loading = true;
                state.issuesPaginated.ranking.error = null;
            })
            .addCase(fetchRankingIssues.fulfilled, (state, action) => {
                state.issuesPaginated.ranking.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesPaginated.ranking.data = action.payload.data || [];
                    state.issuesPaginated.ranking.pagination = action.payload.pagination;
                    if (!action.payload.append) {
                        state.issuesPaginated.ranking.lastFetched = Date.now();
                    }
                }
            })
            .addCase(fetchRankingIssues.rejected, (state, action) => {
                state.issuesPaginated.ranking.loading = false;
                state.issuesPaginated.ranking.error = action.payload;
            })
        
        // Conversion Issues (paginated + buy box)
            .addCase(fetchConversionIssues.pending, (state) => {
                state.issuesPaginated.conversion.loading = true;
                state.issuesPaginated.conversion.error = null;
            })
            .addCase(fetchConversionIssues.fulfilled, (state, action) => {
                state.issuesPaginated.conversion.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesPaginated.conversion.data = action.payload.data || [];
                    state.issuesPaginated.conversion.buyBoxData = action.payload.buyBoxData || [];
                    state.issuesPaginated.conversion.pagination = action.payload.pagination;
                    if (!action.payload.append) {
                        state.issuesPaginated.conversion.lastFetched = Date.now();
                    }
                }
            })
            .addCase(fetchConversionIssues.rejected, (state, action) => {
                state.issuesPaginated.conversion.loading = false;
                state.issuesPaginated.conversion.error = action.payload;
            })
        
        // Inventory Issues (paginated)
            .addCase(fetchInventoryIssues.pending, (state) => {
                state.issuesPaginated.inventory.loading = true;
                state.issuesPaginated.inventory.error = null;
            })
            .addCase(fetchInventoryIssues.fulfilled, (state, action) => {
                state.issuesPaginated.inventory.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesPaginated.inventory.data = action.payload.data || [];
                    state.issuesPaginated.inventory.pagination = action.payload.pagination;
                    if (!action.payload.append) {
                        state.issuesPaginated.inventory.lastFetched = Date.now();
                    }
                }
            })
            .addCase(fetchInventoryIssues.rejected, (state, action) => {
                state.issuesPaginated.inventory.loading = false;
                state.issuesPaginated.inventory.error = action.payload;
            })
        
        // Account Issues (no pagination)
            .addCase(fetchAccountIssues.pending, (state) => {
                state.issuesPaginated.account.loading = true;
                state.issuesPaginated.account.error = null;
            })
            .addCase(fetchAccountIssues.fulfilled, (state, action) => {
                state.issuesPaginated.account.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesPaginated.account.data = action.payload;
                    state.issuesPaginated.account.lastFetched = Date.now();
                }
            })
            .addCase(fetchAccountIssues.rejected, (state, action) => {
                state.issuesPaginated.account.loading = false;
                state.issuesPaginated.account.error = action.payload;
            })
        
        // Products with Issues (paginated with sorting/filtering)
            .addCase(fetchProductsWithIssues.pending, (state) => {
                state.issuesByProductPaginated.loading = true;
                state.issuesByProductPaginated.error = null;
            })
            .addCase(fetchProductsWithIssues.fulfilled, (state, action) => {
                state.issuesByProductPaginated.loading = false;
                if (!action.payload?.fromCache) {
                    state.issuesByProductPaginated.data = action.payload.data || [];
                    state.issuesByProductPaginated.pagination = action.payload.pagination;
                    state.issuesByProductPaginated.filters = action.payload.filters || state.issuesByProductPaginated.filters;
                    if (!action.payload.append) {
                        state.issuesByProductPaginated.lastFetched = Date.now();
                    }
                }
            })
            .addCase(fetchProductsWithIssues.rejected, (state, action) => {
                state.issuesByProductPaginated.loading = false;
                state.issuesByProductPaginated.error = action.payload;
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
                const payload = action.payload;
                state.yourProducts.loading = false;
                state.yourProducts.data = payload;
                state.yourProducts.lastFetched = Date.now();
                // Store in per-status cache so switching back to Inactive/Inactive/etc. uses cache
                const cacheKey = yourProductsCacheKey(payload?.currentStatus);
                state.yourProducts.cacheByStatus[cacheKey] = {
                    ...payload,
                    lastFetched: Date.now()
                };
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
            })
        
        // Your Products V2 - Initial (single call for first render)
            .addCase(fetchYourProductsInitialV2.pending, (state) => {
                state.yourProductsV2.initialLoading = true;
                state.yourProductsV2.initialError = null;
            })
            .addCase(fetchYourProductsInitialV2.fulfilled, (state, action) => {
                state.yourProductsV2.initialLoading = false;
                
                // If from cache, don't update anything
                if (action.payload?.fromCache) {
                    return;
                }
                
                // Store summary
                state.yourProductsV2.summary = action.payload?.summary || null;
                state.yourProductsV2.initialLastFetched = Date.now();
                
                // Store Active products in byStatus cache
                if (action.payload?.products) {
                    state.yourProductsV2.byStatus['Active'] = {
                        products: action.payload.products,
                        pagination: action.payload.pagination || {},
                        loading: false,
                        error: null,
                        lastFetched: Date.now()
                    };
                }
            })
            .addCase(fetchYourProductsInitialV2.rejected, (state, action) => {
                state.yourProductsV2.initialLoading = false;
                state.yourProductsV2.initialError = action.payload;
            })
        
        // Your Products V2 - Products by Status
            .addCase(fetchYourProductsByStatusV2.pending, (state, action) => {
                const status = action.meta?.arg?.status;
                if (status) {
                    if (!state.yourProductsV2.byStatus[status]) {
                        state.yourProductsV2.byStatus[status] = {
                            products: [],
                            pagination: {},
                            loading: false,
                            error: null,
                            lastFetched: null
                        };
                    }
                    state.yourProductsV2.byStatus[status].loading = true;
                    state.yourProductsV2.byStatus[status].error = null;
                }
            })
            .addCase(fetchYourProductsByStatusV2.fulfilled, (state, action) => {
                const status = action.payload?.status;
                if (status) {
                    if (!state.yourProductsV2.byStatus[status]) {
                        state.yourProductsV2.byStatus[status] = {};
                    }
                    state.yourProductsV2.byStatus[status].loading = false;
                    state.yourProductsV2.byStatus[status].products = action.payload.products || [];
                    state.yourProductsV2.byStatus[status].pagination = action.payload.pagination || {};
                    state.yourProductsV2.byStatus[status].lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsByStatusV2.rejected, (state, action) => {
                const status = action.meta?.arg?.status;
                if (status && state.yourProductsV2.byStatus[status]) {
                    state.yourProductsV2.byStatus[status].loading = false;
                    state.yourProductsV2.byStatus[status].error = action.payload;
                }
            })
        
        // =====================================================================
        // Your Products V3 Reducers
        // =====================================================================
        
        // V3 Summary
            .addCase(fetchYourProductsSummaryV3.pending, (state) => {
                state.yourProductsV3.summary.loading = true;
                state.yourProductsV3.summary.error = null;
            })
            .addCase(fetchYourProductsSummaryV3.fulfilled, (state, action) => {
                state.yourProductsV3.summary.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.summary.data = action.payload?.summary || action.payload;
                    state.yourProductsV3.summary.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsSummaryV3.rejected, (state, action) => {
                state.yourProductsV3.summary.loading = false;
                state.yourProductsV3.summary.error = action.payload;
            })
        
        // V3 Active
            .addCase(fetchYourProductsActiveV3.pending, (state) => {
                state.yourProductsV3.active.loading = true;
                state.yourProductsV3.active.error = null;
            })
            .addCase(fetchYourProductsActiveV3.fulfilled, (state, action) => {
                state.yourProductsV3.active.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.active.products = action.payload.products || [];
                    state.yourProductsV3.active.pagination = action.payload.pagination || {};
                    state.yourProductsV3.active.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsActiveV3.rejected, (state, action) => {
                state.yourProductsV3.active.loading = false;
                state.yourProductsV3.active.error = action.payload;
            })
        
        // V3 Inactive
            .addCase(fetchYourProductsInactiveV3.pending, (state) => {
                state.yourProductsV3.inactive.loading = true;
                state.yourProductsV3.inactive.error = null;
            })
            .addCase(fetchYourProductsInactiveV3.fulfilled, (state, action) => {
                state.yourProductsV3.inactive.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.inactive.products = action.payload.products || [];
                    state.yourProductsV3.inactive.pagination = action.payload.pagination || {};
                    state.yourProductsV3.inactive.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsInactiveV3.rejected, (state, action) => {
                state.yourProductsV3.inactive.loading = false;
                state.yourProductsV3.inactive.error = action.payload;
            })
        
        // V3 Incomplete
            .addCase(fetchYourProductsIncompleteV3.pending, (state) => {
                state.yourProductsV3.incomplete.loading = true;
                state.yourProductsV3.incomplete.error = null;
            })
            .addCase(fetchYourProductsIncompleteV3.fulfilled, (state, action) => {
                state.yourProductsV3.incomplete.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.incomplete.products = action.payload.products || [];
                    state.yourProductsV3.incomplete.pagination = action.payload.pagination || {};
                    state.yourProductsV3.incomplete.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsIncompleteV3.rejected, (state, action) => {
                state.yourProductsV3.incomplete.loading = false;
                state.yourProductsV3.incomplete.error = action.payload;
            })
        
        // V3 Without A+
            .addCase(fetchYourProductsWithoutAPlusV3.pending, (state) => {
                state.yourProductsV3.withoutAPlus.loading = true;
                state.yourProductsV3.withoutAPlus.error = null;
            })
            .addCase(fetchYourProductsWithoutAPlusV3.fulfilled, (state, action) => {
                state.yourProductsV3.withoutAPlus.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.withoutAPlus.products = action.payload.products || [];
                    state.yourProductsV3.withoutAPlus.pagination = action.payload.pagination || {};
                    state.yourProductsV3.withoutAPlus.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsWithoutAPlusV3.rejected, (state, action) => {
                state.yourProductsV3.withoutAPlus.loading = false;
                state.yourProductsV3.withoutAPlus.error = action.payload;
            })
        
        // V3 Not Targeted in Ads
            .addCase(fetchYourProductsNotTargetedInAdsV3.pending, (state) => {
                state.yourProductsV3.notTargetedInAds.loading = true;
                state.yourProductsV3.notTargetedInAds.error = null;
            })
            .addCase(fetchYourProductsNotTargetedInAdsV3.fulfilled, (state, action) => {
                state.yourProductsV3.notTargetedInAds.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.notTargetedInAds.products = action.payload.products || [];
                    state.yourProductsV3.notTargetedInAds.pagination = action.payload.pagination || {};
                    state.yourProductsV3.notTargetedInAds.lastFetched = Date.now();
                }
            })
            .addCase(fetchYourProductsNotTargetedInAdsV3.rejected, (state, action) => {
                state.yourProductsV3.notTargetedInAds.loading = false;
                state.yourProductsV3.notTargetedInAds.error = action.payload;
            })
        
        // V3 Optimization (LIGHTWEIGHT)
            .addCase(fetchOptimizationProductsV3.pending, (state) => {
                state.yourProductsV3.optimization.loading = true;
                state.yourProductsV3.optimization.error = null;
            })
            .addCase(fetchOptimizationProductsV3.fulfilled, (state, action) => {
                state.yourProductsV3.optimization.loading = false;
                if (!action.payload?.fromCache) {
                    state.yourProductsV3.optimization.products = action.payload.products || [];
                    state.yourProductsV3.optimization.pagination = action.payload.pagination || {};
                    state.yourProductsV3.optimization.lastFetched = Date.now();
                }
            })
            .addCase(fetchOptimizationProductsV3.rejected, (state, action) => {
                state.yourProductsV3.optimization.loading = false;
                state.yourProductsV3.optimization.error = action.payload;
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

