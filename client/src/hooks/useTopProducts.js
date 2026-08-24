import { useEffect, useState } from 'react';
import axiosInstance from '../config/axios.config.js';

/**
 * Fetches the "top products to fix" ranking — the products carrying the most
 * recoverable money, derived from the same tasks the Tasks page and the
 * Dashboard's "Top things to fix" use (see TaskOpportunityGroupsService).
 *
 * Pre-computed server-side and cached for an hour, so this is a single cheap GET
 * with no LLM call on page load. Three surfaces render this (Dashboard,
 * Profitability, Your Products) and all read it through this hook so none of them
 * can drift from the others.
 *
 * Fails open: on any error the caller gets an empty list and simply renders
 * nothing, rather than breaking the page it sits on.
 *
 * @returns {{products: Array, currencyCode: string|null, totalRecoverableAmount: number, potentialProfitImpact: number, capitalTiedUp: number, unattributedAmount: number, loading: boolean, usedFallback: boolean}}
 */
export function useTopProducts() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        axiosInstance
            .get('/api/pagewise/top-products')
            .then((res) => {
                if (!cancelled) setData(res.data?.data ?? null);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return {
        products: Array.isArray(data?.products) ? data.products : [],
        currencyCode: data?.currencyCode ?? null,
        // Sum of the products SHOWN — a subset.
        totalRecoverableAmount: data?.totalRecoverableAmount ?? 0,
        // The account's whole potential PROFIT impact, de-duplicated per ASIN. Use
        // this for any headline — it is what the Dashboard reports too.
        potentialProfitImpact: data?.potentialProfitImpact ?? 0,
        // Capital locked in unsellable stock. A different quantity from profit, so it
        // is shown beside the profit figure and never added to it.
        capitalTiedUp: data?.capitalTiedUp ?? 0,
        // Ad waste whose campaign couldn't be matched to any product. Surfaced so a
        // page can be honest that the product view isn't the whole picture.
        unattributedAmount: data?.unattributedAmount ?? 0,
        usedFallback: !!data?.usedFallback,
        loading
    };
}

export default useTopProducts;
