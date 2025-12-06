/**
 * usePageData Hook
 * 
 * Custom hook for fetching page-wise data from the backend.
 * Handles loading states, caching, and error handling.
 * 
 * Usage:
 * const { data, loading, error, refetch } = usePageData('dashboard');
 */

import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    fetchDashboardData,
    fetchProfitabilityData,
    fetchPPCData,
    fetchIssuesData,
    fetchIssuesByProductData,
    fetchKeywordAnalysisData,
    fetchReimbursementData,
    fetchTasksData,
    fetchInventoryData,
    forceRefresh
} from '../redux/slices/PageDataSlice';

// Map page names to their fetch actions
const fetchActions = {
    dashboard: fetchDashboardData,
    profitability: fetchProfitabilityData,
    ppc: fetchPPCData,
    issues: fetchIssuesData,
    issuesByProduct: fetchIssuesByProductData,
    keywordAnalysis: fetchKeywordAnalysisData,
    reimbursement: fetchReimbursementData,
    tasks: fetchTasksData,
    inventory: fetchInventoryData
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
        fetchData();
    }, [dispatch, pageName, fetchData]);

    // Auto fetch on mount if enabled and data is not cached
    useEffect(() => {
        if (autoFetch && !data && !loading) {
            fetchData();
        }
    }, [autoFetch, data, loading, fetchData]);

    return {
        data,
        loading,
        error,
        lastFetched,
        refetch: fetchData,
        forceRefresh: forceRefreshData,
        // Additional helper - check if data is stale (older than 5 minutes)
        isStale: lastFetched ? (Date.now() - lastFetched) > 5 * 60 * 1000 : true
    };
};

/**
 * Hook specifically for dashboard data
 * Provides additional computed properties specific to dashboard
 */
export const useDashboardData = (autoFetch = true) => {
    const pageData = usePageData('dashboard', autoFetch);
    
    // Also maintain backward compatibility with old DashboardSlice
    const legacyDashboardInfo = useSelector(state => state.Dashboard?.DashBoardInfo);
    
    // Use page data if available, fall back to legacy data
    const effectiveData = pageData.data?.dashboardData || legacyDashboardInfo;
    
    return {
        ...pageData,
        // Override data with effective data for smooth migration
        data: effectiveData,
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
 * Hook specifically for profitability data
 */
export const useProfitabilityData = (autoFetch = true) => {
    return usePageData('profitability', autoFetch);
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

    // Fetch data function
    const fetchData = useCallback(() => {
        dispatch(fetchReimbursementData());
    }, [dispatch]);

    // Force refresh function
    const forceRefreshData = useCallback(() => {
        dispatch(forceRefresh('reimbursement'));
        fetchData();
    }, [dispatch, fetchData]);

    // Auto fetch on mount if enabled and data is not cached
    useEffect(() => {
        if (autoFetch && !hasData && !loading) {
            fetchData();
        }
    }, [autoFetch, hasData, loading, fetchData]);

    return {
        data: { summary, reimbursements },
        loading,
        error,
        lastFetched,
        refetch: fetchData,
        forceRefresh: forceRefreshData,
        isStale: lastFetched ? (Date.now() - lastFetched) > 5 * 60 * 1000 : true
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

export default usePageData;

