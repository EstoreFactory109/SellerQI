/**
 * usePageData Hook
 * 
 * Custom hook for fetching page-wise data from the backend.
 * Handles loading states, caching, and error handling.
 * 
 * Usage:
 * const { data, loading, error, refetch } = usePageData('dashboard');
 */

import { useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    fetchDashboardData,
    fetchDashboardSummary,
    fetchDashboardPhase1,
    fetchDashboardPhase2,
    fetchDashboardPhase3,
    fetchTop4Products,
    fetchProductCheckerData,
    fetchProfitabilityData,
    fetchProfitabilitySummary,
    // Phased profitability (parallel loading)
    fetchProfitabilityMetrics,
    fetchProfitabilityChart,
    fetchProfitabilityTable,
    fetchProfitabilityIssues,
    fetchPPCData,
    fetchIssuesData,
    fetchIssuesByProductData,
    fetchKeywordAnalysisData,
    fetchReimbursementData,
    fetchTasksData,
    fetchInventoryData,
    fetchAccountHistoryData,
    forceRefresh
} from '../redux/slices/PageDataSlice';

// Cache TTL: 1 hour (aligned with backend cache)
const CACHE_TTL_MS = 60 * 60 * 1000;

// Map page names to their fetch actions
const fetchActions = {
    dashboard: fetchDashboardData,
    dashboardSummary: fetchDashboardSummary,
    top4Products: fetchTop4Products,        // Phase 2 - Optimized (main dashboard)
    productChecker: fetchProductCheckerData, // Full product checker (detailed pages)
    profitability: fetchProfitabilityData,
    profitabilitySummary: fetchProfitabilitySummary, // Phase 1 - Fast (metrics only)
    ppc: fetchPPCData,
    issues: fetchIssuesData,
    issuesByProduct: fetchIssuesByProductData,
    keywordAnalysis: fetchKeywordAnalysisData,
    reimbursement: fetchReimbursementData,
    tasks: fetchTasksData,
    inventory: fetchInventoryData,
    accountHistory: fetchAccountHistoryData
};

/**
 * Hook for fetching and caching page-specific data
 * @param {string} pageName - Name of the page ('dashboard', 'profitability', 'ppc', etc.)
 * @param {boolean} autoFetch - Whether to automatically fetch on mount (default: true)
 * @returns {Object} { data, loading, error, refetch, forceRefreshData }
 */
const usePageData = (pageName, autoFetch = true) => {
    const dispatch = useDispatch();
    
    // Select page-specific state from Redux
    const pageState = useSelector(state => state.pageData?.[pageName] || {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    });

    const { data, loading, error, lastFetched } = pageState;

    // Get the appropriate fetch action
    const fetchAction = fetchActions[pageName];
    
    // Use ref to track if we've already initiated a fetch to prevent infinite loops
    const hasFetchedRef = useRef(false);

    // Fetch data function
    const fetchData = useCallback(() => {
        if (fetchAction) {
            dispatch(fetchAction());
        } else {
            console.warn(`No fetch action found for page: ${pageName}`);
        }
    }, [dispatch, fetchAction, pageName]);

    // Force refresh function - clears cache and refetches
    const forceRefreshData = useCallback(() => {
        dispatch(forceRefresh(pageName));
        hasFetchedRef.current = false; // Reset the ref when forcing refresh
        fetchData();
    }, [dispatch, pageName, fetchData]);

    // Auto fetch on mount if enabled and data is not cached
    // Remove fetchData from dependencies to prevent infinite loops
    useEffect(() => {
        if (autoFetch && !data && !loading && !hasFetchedRef.current) {
            hasFetchedRef.current = true;
            if (fetchAction) {
                dispatch(fetchAction());
            }
        }
        // Reset ref when data is loaded or when component unmounts
        if (data) {
            hasFetchedRef.current = false;
        }
    }, [autoFetch, data, loading, dispatch, fetchAction]);

    return {
        data,
        loading,
        error,
        lastFetched,
        refetch: fetchData,
        forceRefresh: forceRefreshData,
        // Additional helper - check if data is stale (older than cache TTL)
        isStale: lastFetched ? (Date.now() - lastFetched) > CACHE_TTL_MS : true
    };
};

/**
 * Hook for dashboard summary (Phase 1 - fast, lightweight)
 * Use this for initial dashboard load to show quick stats fast
 */
export const useDashboardSummary = (autoFetch = true) => {
    const dispatch = useDispatch();
    const pageData = usePageData('dashboardSummary', autoFetch);
    
    // Also maintain backward compatibility with old DashboardSlice
    const legacyDashboardInfo = useSelector(state => state.Dashboard?.DashBoardInfo);
    
    // Use page data if available, fall back to legacy data
    const effectiveData = pageData.data?.dashboardData || legacyDashboardInfo;
    
    // Fetch product checker data after summary is loaded (Phase 2)
    const fetchProductChecker = useCallback(() => {
        dispatch(fetchProductCheckerData());
    }, [dispatch]);
    
    return {
        ...pageData,
        data: effectiveData,
        // Flag indicating this is lightweight summary (Phase 1)
        isLightweightSummary: effectiveData?.isLightweightSummary || false,
        // Function to load Phase 2 data
        fetchProductChecker,
        // Dashboard-specific computed values
        totalIssues: effectiveData ? (
            (effectiveData.totalProfitabilityErrors || 0) +
            (effectiveData.totalSponsoredAdsErrors || 0) +
            (effectiveData.totalInventoryErrors || 0) +
            (effectiveData.TotalRankingerrors || 0) +
            (effectiveData.totalErrorInConversion || 0) +
            (effectiveData.totalErrorInAccount || 0)
        ) : 0,
        activeProductsCount: effectiveData?.ActiveProducts?.length || 0,
        totalProductsCount: effectiveData?.TotalProduct?.length || 0
    };
};

/**
 * Hook for product checker data (Phase 2)
 * Call after dashboard summary for progressive loading
 */
export const useProductCheckerData = (autoFetch = false) => {
    const pageData = usePageData('productChecker', autoFetch);
    
    return {
        ...pageData,
        data: pageData.data,
        // Error counts
        totalProfitabilityErrors: pageData.data?.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: pageData.data?.totalSponsoredAdsErrors || 0,
        totalInventoryErrors: pageData.data?.totalInventoryErrors || 0,
        totalRankingErrors: pageData.data?.TotalRankingerrors || 0,
        totalConversionErrors: pageData.data?.totalErrorInConversion || 0,
        totalAccountErrors: pageData.data?.totalErrorInAccount || 0
    };
};

/**
 * Hook specifically for dashboard data
 * Provides additional computed properties specific to dashboard
 * 
 * PARALLEL LOADING STRATEGY:
 * All 4 phases are fetched simultaneously on mount. Each component renders
 * as soon as its data arrives - no waiting for other phases.
 * 
 * - Phase 1: Instant (~50ms) - precomputed error counts, product counts, date range
 * - Phase 2: Core (~150ms) - sales totals, account health, finance summary, PPC summary
 * - Phase 3: Charts (~200ms) - datewiseSales, ppcDateWiseMetrics, orders, products
 * - Phase 4: Top Products (~50ms) - top 4 products by issues
 */
export const useDashboardData = (autoFetch = true) => {
    const dispatch = useDispatch();
    
    // Get all 4 phase states
    const phase1State = useSelector(state => state.pageData?.dashboardPhase1 || {
        data: null, loading: false, error: null, lastFetched: null
    });
    const phase2State = useSelector(state => state.pageData?.dashboardPhase2 || {
        data: null, loading: false, error: null, lastFetched: null
    });
    const phase3State = useSelector(state => state.pageData?.dashboardPhase3 || {
        data: null, loading: false, error: null, lastFetched: null
    });
    const phase4State = useSelector(state => state.pageData?.top4Products || {
        data: null, loading: false, error: null, lastFetched: null
    });
    
    // Backward compatibility with old DashboardSlice
    const legacyDashboardInfo = useSelector(state => state.Dashboard?.DashBoardInfo);
    
    // Track if we've initiated the parallel fetch
    const hasFetchedRef = useRef(false);
    
    // PARALLEL FETCH: All 4 phases simultaneously on mount
    useEffect(() => {
        if (autoFetch && !hasFetchedRef.current) {
            const needsPhase1 = !phase1State.data && !phase1State.loading;
            const needsPhase2 = !phase2State.data && !phase2State.loading;
            const needsPhase3 = !phase3State.data && !phase3State.loading;
            const needsPhase4 = !phase4State.data && !phase4State.loading;
            
            if (needsPhase1 || needsPhase2 || needsPhase3 || needsPhase4) {
                hasFetchedRef.current = true;
                
                // Fire all requests simultaneously - each renders when ready
                if (needsPhase1) dispatch(fetchDashboardPhase1());
                if (needsPhase2) dispatch(fetchDashboardPhase2());
                if (needsPhase3) dispatch(fetchDashboardPhase3());
                if (needsPhase4) dispatch(fetchTop4Products());
            }
        }
        
        // Reset ref when all data is loaded (for refresh scenarios)
        if (phase1State.data && phase2State.data && phase3State.data && phase4State.data) {
            hasFetchedRef.current = false;
        }
    }, [autoFetch, phase1State.data, phase1State.loading, phase2State.data, phase2State.loading, 
        phase3State.data, phase3State.loading, phase4State.data, phase4State.loading, dispatch]);
    
    // Merge all phase data
    const p1 = phase1State.data || {};
    const p2 = phase2State.data || {};
    const p3 = phase3State.data || {};
    const p4 = phase4State.data || {};
    
    const effectiveData = {
        // Phase 1: Instant (error counts, product counts, date range)
        totalProfitabilityErrors: p1.totalProfitabilityErrors ?? 0,
        totalSponsoredAdsErrors: p1.totalSponsoredAdsErrors ?? 0,
        totalInventoryErrors: p1.totalInventoryErrors ?? 0,
        TotalRankingerrors: p1.TotalRankingerrors ?? 0,
        totalErrorInConversion: p1.totalErrorInConversion ?? 0,
        totalErrorInAccount: p1.totalErrorInAccount ?? 0,
        totalIssues: p1.totalIssues ?? 0,
        numberOfProductsWithIssues: p1.numberOfProductsWithIssues ?? 0,
        totalProductCount: p1.totalProductCount ?? 0,
        activeProductCount: p1.activeProductCount ?? 0,
        calendarMode: p1.calendarMode || 'default',
        startDate: p1.startDate || null,
        endDate: p1.endDate || null,
        Country: p1.Country || null,
        hasPrecomputedIssues: p1.hasPrecomputedIssues ?? false,
        
        // Phase 2: Core (sales, health, finance, PPC summary)
        accountHealthPercentage: p2.accountHealthPercentage || {},
        AccountErrors: p2.AccountErrors || {},
        TotalWeeklySale: p2.TotalWeeklySale ?? 0,
        accountFinance: p2.accountFinance || {},
        ppcSummary: p2.ppcSummary || {},
        sponsoredAdsMetrics: p2.sponsoredAdsMetrics || {},
        buyBoxSummary: p2.buyBoxSummary || {},
        
        // Phase 3: Charts and arrays
        TotalSales: p3.TotalSales || [],
        TotalProduct: p3.TotalProduct || [],
        ActiveProducts: p3.ActiveProducts || [],
        GetOrderData: p3.GetOrderData || [],
        totalOrdersCount: p3.totalOrdersCount ?? 0,
        ppcDateWiseMetrics: p3.ppcDateWiseMetrics || [],
        dateWiseTotalCosts: p3.dateWiseTotalCosts || [],
        adsKeywordsPerformanceData: p3.adsKeywordsPerformanceData || [],
        moneyWastedInAds: p3.moneyWastedInAds ?? 0,
        
        // Phase 4: Top 4 products
        first: p4.first || null,
        second: p4.second || null,
        third: p4.third || null,
        fourth: p4.fourth || null
    };
    
    // Fall back to legacy if no phase data
    const hasAnyPhaseData = phase1State.data || phase2State.data || phase3State.data || phase4State.data;
    const finalData = hasAnyPhaseData ? effectiveData : legacyDashboardInfo;
    
    // Force refresh - clears all phases and re-fetches all in parallel
    const forceRefreshData = useCallback(() => {
        dispatch(forceRefresh('dashboardPhase1'));
        dispatch(forceRefresh('dashboardPhase2'));
        dispatch(forceRefresh('dashboardPhase3'));
        dispatch(forceRefresh('top4Products'));
        hasFetchedRef.current = false;
        
        // Fire all requests simultaneously for parallel loading
        dispatch(fetchDashboardPhase1());
        dispatch(fetchDashboardPhase2());
        dispatch(fetchDashboardPhase3());
        dispatch(fetchTop4Products());
    }, [dispatch]);
    
    // Manual refetch
    const refetch = useCallback(() => {
        dispatch(fetchDashboardPhase1());
    }, [dispatch]);
    
    return {
        data: finalData,
        // Loading states for each phase
        loading: phase1State.loading,
        loadingPhase1: phase1State.loading,
        loadingPhase2: phase2State.loading,
        loadingPhase3: phase3State.loading,
        loadingTop4: phase4State.loading,
        error: phase1State.error || phase2State.error || phase3State.error || phase4State.error,
        lastFetched: phase1State.lastFetched,
        refetch,
        forceRefresh: forceRefreshData,
        // Phase indicators
        isPhase1Complete: !!phase1State.data,
        isPhase2Complete: !!phase2State.data,
        isPhase3Complete: !!phase3State.data,
        isPhase4Complete: !!phase4State.data,
        isFullyLoaded: !!phase1State.data && !!phase2State.data && !!phase3State.data && !!phase4State.data,
        // Helper for checking if data is stale
        isStale: phase1State.lastFetched ? (Date.now() - phase1State.lastFetched) > CACHE_TTL_MS : true,
        // Dashboard-specific computed values
        totalIssues: finalData ? (
            (finalData.totalProfitabilityErrors || 0) +
            (finalData.totalSponsoredAdsErrors || 0) +
            (finalData.totalInventoryErrors || 0) +
            (finalData.TotalRankingerrors || 0) +
            (finalData.totalErrorInConversion || 0) +
            (finalData.totalErrorInAccount || 0)
        ) : 0,
        activeProductsCount: finalData?.ActiveProducts?.length || finalData?.activeProductCount || 0,
        totalProductsCount: finalData?.TotalProduct?.length || finalData?.totalProductCount || 0
    };
};

/**
 * Hook specifically for profitability data
 * 
 * OPTIMIZED: The backend now uses ProfitabilityService which:
 * - Fetches only 5-8 collections instead of 24+ (3-4x faster)
 * - Returns the exact same data structure as before
 * 
 * Expected response time: ~300-500ms (previously 2-5s)
 */
export const useProfitabilityData = (autoFetch = true) => {
    return usePageData('profitability', autoFetch);
};

/**
 * Hook for profitability summary data (Phase 1 - FAST)
 * Returns only metrics and chart data for instant rendering (~100-200ms)
 * Use this for initial load, then fetch full data for table
 */
export const useProfitabilitySummary = (autoFetch = true) => {
    return usePageData('profitabilitySummary', autoFetch);
};

/**
 * ============================================================================
 * PHASED PROFITABILITY HOOK (NEW - Parallel loading architecture)
 * ============================================================================
 * 
 * This hook fetches all 4 profitability phases in parallel:
 * - Phase 1 (Metrics): KPI boxes - Total Sales, PPC Sales, Ad Spend, ACOS%, Amazon Fees, Gross Profit
 * - Phase 2 (Chart): Datewise gross profit and total sales for chart
 * - Phase 3 (Table): PAGINATED profitability table (10 items per page)
 * - Phase 4 (Issues): Detailed profitability issues with recommendations
 * 
 * All phases are fetched simultaneously on mount. Each component renders
 * as soon as its data arrives - no waiting for other phases.
 */
export const usePhasedProfitabilityData = (autoFetch = true) => {
    const dispatch = useDispatch();
    
    // Get all 4 phase states
    const metricsState = useSelector(state => state.pageData?.profitabilityMetrics || {
        data: null, loading: false, error: null, lastFetched: null
    });
    const chartState = useSelector(state => state.pageData?.profitabilityChart || {
        data: null, loading: false, error: null, lastFetched: null
    });
    const tableState = useSelector(state => state.pageData?.profitabilityTable || {
        data: null, pagination: null, loading: false, error: null, lastFetched: null
    });
    const issuesState = useSelector(state => state.pageData?.profitabilityIssues || {
        data: null, summary: null, pagination: null, loading: false, error: null, lastFetched: null
    });
    
    // Track if we've initiated the parallel fetch (persists across re-renders)
    const hasFetchedRef = useRef(false);
    
    // PARALLEL FETCH: All 4 phases simultaneously on mount
    // Only fetch if data is not already in Redux (respects cache)
    useEffect(() => {
        if (!autoFetch) return;
        
        // Check if data exists and is still fresh (within cache TTL)
        const isMetricsFresh = metricsState.data && metricsState.lastFetched && 
            (Date.now() - metricsState.lastFetched) < CACHE_TTL_MS;
        const isChartFresh = chartState.data && chartState.lastFetched && 
            (Date.now() - chartState.lastFetched) < CACHE_TTL_MS;
        const isTableFresh = tableState.data && tableState.lastFetched && 
            (Date.now() - tableState.lastFetched) < CACHE_TTL_MS;
        const isIssuesFresh = issuesState.data && issuesState.lastFetched && 
            (Date.now() - issuesState.lastFetched) < CACHE_TTL_MS;
        
        // Only fetch what's missing or stale (and not currently loading)
        const needsMetrics = !isMetricsFresh && !metricsState.loading;
        const needsChart = !isChartFresh && !chartState.loading;
        const needsTable = !isTableFresh && !tableState.loading;
        const needsIssues = !isIssuesFresh && !issuesState.loading;
        
        // Prevent duplicate fetches within same render cycle
        if (!hasFetchedRef.current && (needsMetrics || needsChart || needsTable || needsIssues)) {
            hasFetchedRef.current = true;
            
            // Fire all requests simultaneously - each renders when ready
            if (needsMetrics) dispatch(fetchProfitabilityMetrics());
            if (needsChart) dispatch(fetchProfitabilityChart());
            if (needsTable) dispatch(fetchProfitabilityTable({ page: 1, limit: 10 }));
            if (needsIssues) dispatch(fetchProfitabilityIssues({ page: 1, limit: 10 }));
        }
    }, [autoFetch, dispatch, 
        metricsState.data, metricsState.loading, metricsState.lastFetched,
        chartState.data, chartState.loading, chartState.lastFetched,
        tableState.data, tableState.loading, tableState.lastFetched,
        issuesState.data, issuesState.loading, issuesState.lastFetched]);
    
    // Reset hasFetchedRef when component unmounts and remounts
    useEffect(() => {
        return () => {
            hasFetchedRef.current = false;
        };
    }, []);
    
    // Force refresh - clears all phases and re-fetches all in parallel
    const forceRefreshData = useCallback(() => {
        dispatch(forceRefresh('profitabilityMetrics'));
        dispatch(forceRefresh('profitabilityChart'));
        dispatch(forceRefresh('profitabilityTable'));
        dispatch(forceRefresh('profitabilityIssues'));
        hasFetchedRef.current = false;
        
        // Fire all requests simultaneously for parallel loading
        dispatch(fetchProfitabilityMetrics());
        dispatch(fetchProfitabilityChart());
        dispatch(fetchProfitabilityTable({ page: 1, limit: 10 }));
        dispatch(fetchProfitabilityIssues({ page: 1, limit: 10 }));
    }, [dispatch]);
    
    // Fetch next page of table data
    const fetchNextPage = useCallback(() => {
        const currentPage = tableState.pagination?.page || 1;
        const hasMore = tableState.pagination?.hasMore ?? true;
        
        if (hasMore && !tableState.loading) {
            dispatch(fetchProfitabilityTable({ page: currentPage + 1, limit: 10 }));
        }
    }, [dispatch, tableState.pagination, tableState.loading]);
    
    // Fetch specific page
    const fetchPage = useCallback((page, limit = 10) => {
        if (!tableState.loading) {
            dispatch(fetchProfitabilityTable({ page, limit }));
        }
    }, [dispatch, tableState.loading]);
    
    // Fetch next page of issues data
    const fetchNextIssuesPage = useCallback(() => {
        const currentPage = issuesState.pagination?.page || 1;
        const hasMore = issuesState.pagination?.hasMore ?? true;
        
        if (hasMore && !issuesState.loading) {
            dispatch(fetchProfitabilityIssues({ page: currentPage + 1, limit: 10 }));
        }
    }, [dispatch, issuesState.pagination, issuesState.loading]);
    
    // Fetch specific issues page
    const fetchIssuesPage = useCallback((page, limit = 10) => {
        if (!issuesState.loading) {
            dispatch(fetchProfitabilityIssues({ page, limit }));
        }
    }, [dispatch, issuesState.loading]);
    
    return {
        // Metrics data (Phase 1 - KPI boxes)
        metrics: metricsState.data,
        metricsLoading: metricsState.loading,
        metricsError: metricsState.error,
        
        // Chart data (Phase 2 - Graph)
        chartData: chartState.data?.chartData || [],
        chartLoading: chartState.loading,
        chartError: chartState.error,
        
        // Table data (Phase 3 - Paginated table)
        tableData: tableState.data || [],
        tablePagination: tableState.pagination,
        tableLoading: tableState.loading,
        tableError: tableState.error,
        
        // Issues data (Phase 4 - Detailed profitability issues)
        issuesData: issuesState.data || [],
        issuesSummary: issuesState.summary,
        issuesPagination: issuesState.pagination,
        issuesLoading: issuesState.loading,
        issuesError: issuesState.error,
        
        // Overall loading state
        loading: metricsState.loading || chartState.loading || tableState.loading || issuesState.loading,
        error: metricsState.error || chartState.error || tableState.error || issuesState.error,
        
        // Phase completion flags
        isMetricsComplete: !!metricsState.data,
        isChartComplete: !!chartState.data,
        isTableComplete: !!tableState.data,
        isIssuesComplete: !!issuesState.data,
        isFullyLoaded: !!metricsState.data && !!chartState.data && !!tableState.data && !!issuesState.data,
        
        // Actions
        forceRefresh: forceRefreshData,
        fetchNextPage,
        fetchPage,
        fetchNextIssuesPage,
        fetchIssuesPage,
        
        // Pagination helpers (table)
        hasMore: tableState.pagination?.hasMore ?? false,
        currentPage: tableState.pagination?.page || 1,
        totalPages: tableState.pagination?.totalPages || 1,
        totalItems: tableState.pagination?.totalItems || 0,
        
        // Total counts across ALL data (not page-wise)
        totalParents: tableState.totalParents || 0,
        totalChildren: tableState.totalChildren || 0,
        totalProducts: tableState.totalProducts || 0,
        
        // Pagination helpers (issues)
        issuesHasMore: issuesState.pagination?.hasMore ?? false,
        issuesCurrentPage: issuesState.pagination?.page || 1,
        issuesTotalPages: issuesState.pagination?.totalPages || 1,
        issuesTotalItems: issuesState.pagination?.totalItems || issuesState.summary?.totalIssues || 0
    };
};

/**
 * Hook specifically for PPC/Sponsored Ads data
 */
export const usePPCData = (autoFetch = true) => {
    return usePageData('ppc', autoFetch);
};

/**
 * Hook specifically for issues data
 */
export const useIssuesData = (autoFetch = true) => {
    return usePageData('issues', autoFetch);
};

/**
 * Hook specifically for issues by product data
 */
export const useIssuesByProductData = (autoFetch = true) => {
    return usePageData('issuesByProduct', autoFetch);
};

/**
 * Hook specifically for keyword analysis data
 */
export const useKeywordAnalysisData = (autoFetch = true) => {
    return usePageData('keywordAnalysis', autoFetch);
};

/**
 * Hook specifically for reimbursement data
 * Note: Reimbursement has a different state structure (summary, reimbursements) instead of data
 */
export const useReimbursementData = (autoFetch = true) => {
    const dispatch = useDispatch();
    
    // Select reimbursement-specific state from Redux
    const reimbursementState = useSelector(state => state.pageData?.reimbursement || {
        summary: null,
        reimbursements: [],
        loading: false,
        error: null,
        lastFetched: null
    });

    const { summary, reimbursements, loading, error, lastFetched } = reimbursementState;
    
    // Check if data exists (summary is the primary indicator)
    const hasData = summary !== null || (reimbursements && reimbursements.length > 0);
    
    // Use ref to track if we've already initiated a fetch to prevent infinite loops
    const hasFetchedRef = useRef(false);

    // Fetch data function
    const fetchData = useCallback(() => {
        dispatch(fetchReimbursementData());
    }, [dispatch]);

    // Force refresh function
    const forceRefreshData = useCallback(() => {
        dispatch(forceRefresh('reimbursement'));
        hasFetchedRef.current = false; // Reset the ref when forcing refresh
        fetchData();
    }, [dispatch, fetchData]);

    // Auto fetch on mount if enabled and data is not cached
    // Remove fetchData from dependencies to prevent infinite loops
    useEffect(() => {
        if (autoFetch && !hasData && !loading && !hasFetchedRef.current) {
            hasFetchedRef.current = true;
            dispatch(fetchReimbursementData());
        }
        // Reset ref when data is loaded
        if (hasData) {
            hasFetchedRef.current = false;
        }
    }, [autoFetch, hasData, loading, dispatch]);

    return {
        data: { summary, reimbursements },
        loading,
        error,
        lastFetched,
        refetch: fetchData,
        forceRefresh: forceRefreshData,
        isStale: lastFetched ? (Date.now() - lastFetched) > CACHE_TTL_MS : true
    };
};

/**
 * Hook specifically for tasks data
 */
export const useTasksData = (autoFetch = true) => {
    return usePageData('tasks', autoFetch);
};

/**
 * Hook specifically for inventory data
 */
export const useInventoryData = (autoFetch = true) => {
    return usePageData('inventory', autoFetch);
};

export const useAccountHistoryData = (autoFetch = true) => {
    return usePageData('accountHistory', autoFetch);
};

export default usePageData;

