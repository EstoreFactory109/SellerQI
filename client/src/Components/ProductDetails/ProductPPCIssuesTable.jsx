import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { AlertTriangle, TrendingUp, Info, CheckCircle, DollarSign, Search, Loader2, Pause, Ban, MoreVertical } from 'lucide-react';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';
import axiosInstance from '../../config/axios.config.js';
import {
    fetchProductPPCKeywordTabCounts,
    fetchProductWastedSpendKeywords,
    fetchProductTopPerformingKeywords,
    fetchProductSearchTermsZeroSales
} from '../../redux/slices/PageDataSlice.js';

const SeverityBadge = ({ severity }) => {
    if (severity === 'critical') {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30">
                Critical
            </span>
        );
    }
    if (severity === 'warning') {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-300 border border-yellow-500/30">
                Warning
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-300 border border-gray-500/30">
            Info
        </span>
    );
};

const TableSkeleton = ({ rows = 5 }) => (
    <div className="animate-pulse">
        {Array.from({ length: rows }).map((_, idx) => (
            <div key={idx} className="flex gap-4 py-3 px-4 border-b border-[#30363d]">
                <div className="h-3 bg-[#30363d] rounded w-1/4"></div>
                <div className="h-3 bg-[#30363d] rounded w-1/6"></div>
                <div className="h-3 bg-[#30363d] rounded w-1/4"></div>
                <div className="h-3 bg-[#30363d] rounded w-1/6"></div>
                <div className="h-3 bg-[#30363d] rounded w-1/6"></div>
            </div>
        ))}
    </div>
);

export const ProductPPCIssuesTable = ({ data, currency = '$', asin }) => {
    const dispatch = useDispatch();
    const [activeTab, setActiveTab] = useState('wastedSpend');
    const [prevTab, setPrevTab] = useState('wastedSpend');

    // Get keyword tables from Redux
    const keywordTables = useSelector(state => state.pageData?.productDetails?.keywordTables?.[asin?.toUpperCase()]);
    const loading = useSelector(state => state.pageData?.productDetails?.loading);

    // Refs for infinite scroll
    const wastedSpendSentinelRef = useRef(null);
    const topPerformingSentinelRef = useRef(null);
    const searchTermsSentinelRef = useRef(null);
    const tabsContainerRef = useRef(null);

    // Wasted spend action states
    const [openActionIdx, setOpenActionIdx] = useState(null);
    const [pausingId, setPausingId] = useState(null);
    const [addingNegId, setAddingNegId] = useState(null);
    const [pauseAndNegId, setPauseAndNegId] = useState(null);
    const [feedbackPopup, setFeedbackPopup] = useState({ show: false, type: 'success', message: '' });

    // Close action menu on outside click
    useEffect(() => {
        if (openActionIdx === null) return;
        const handler = (e) => {
            if (!e.target.closest('[data-wasted-action-cell]')) {
                setOpenActionIdx(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [openActionIdx]);

    // Auto-dismiss feedback popup
    useEffect(() => {
        if (!feedbackPopup.show) return;
        const t = setTimeout(() => setFeedbackPopup(p => ({ ...p, show: false })), 4000);
        return () => clearTimeout(t);
    }, [feedbackPopup.show]);

    const refreshWastedSpend = () => {
        if (!asin) return;
        const normalizedAsin = asin.trim().toUpperCase();
        dispatch(fetchProductWastedSpendKeywords({ asin: normalizedAsin, page: 1, limit: 10 }));
        dispatch(fetchProductPPCKeywordTabCounts(normalizedAsin));
    };

    const handlePauseKeyword = async (kw) => {
        const id = kw.keywordId;
        if (id == null || id === '') return;
        setPausingId(id);
        try {
            await axiosInstance.post('/api/pagewise/ads/pause-keyword', { keywordId: String(id), adType: 'SP' });
            refreshWastedSpend();
            setFeedbackPopup({ show: true, type: 'success', message: 'Keyword paused successfully.' });
        } catch (err) {
            setFeedbackPopup({ show: true, type: 'error', message: err.response?.data?.message || err.message || 'Failed to pause keyword' });
        } finally {
            setPausingId(null);
            setOpenActionIdx(null);
        }
    };

    const handleAddToNegative = async (kw) => {
        if (!kw.campaignId || !kw.adGroupId || !kw.keyword) return;
        setAddingNegId(kw.keywordId);
        const matchType = (kw.matchType || '').toUpperCase() === 'EXACT' ? 'negativeExact' : 'negativePhrase';
        try {
            await axiosInstance.post('/api/pagewise/ads/add-to-negative', {
                keywords: [{ campaignId: String(kw.campaignId), adGroupId: String(kw.adGroupId), keywordText: kw.keyword, matchType }],
                level: 'adGroup'
            });
            refreshWastedSpend();
            setFeedbackPopup({ show: true, type: 'success', message: 'Keyword added to negative keywords.' });
        } catch (err) {
            setFeedbackPopup({ show: true, type: 'error', message: err.response?.data?.message || err.message || 'Failed to add to negative.' });
        } finally {
            setAddingNegId(null);
            setOpenActionIdx(null);
        }
    };

    const handlePauseAndAddToNegative = async (kw) => {
        if (kw.keywordId == null || kw.keywordId === '' || !kw.campaignId || !kw.adGroupId || !kw.keyword) return;
        setPauseAndNegId(kw.keywordId);
        const matchType = (kw.matchType || '').toUpperCase() === 'EXACT' ? 'negativeExact' : 'negativePhrase';
        try {
            await axiosInstance.post('/api/pagewise/ads/pause-and-add-to-negative', {
                keywordId: String(kw.keywordId), campaignId: String(kw.campaignId), adGroupId: String(kw.adGroupId),
                keywordText: kw.keyword, matchType, adType: 'SP'
            });
            refreshWastedSpend();
            setFeedbackPopup({ show: true, type: 'success', message: 'Keyword paused and added to negative.' });
        } catch (err) {
            setFeedbackPopup({ show: true, type: 'error', message: err.response?.data?.message || err.message || 'Failed to pause and add to negative.' });
        } finally {
            setPauseAndNegId(null);
            setOpenActionIdx(null);
        }
    };

    // Tab metadata for animation & labels
    const tabsMeta = useMemo(
        () => ([
            {
                id: 'wastedSpend',
                label: 'Wasted Spend Keywords',
                count: tabCountsRef()?.wastedSpendCount ?? 0
            },
            {
                id: 'topPerforming',
                label: 'Top Performing Keywords',
                count: tabCountsRef()?.topPerformingCount ?? 0
            },
            {
                id: 'searchTerms',
                label: 'Search Terms with Zero Sales',
                count: tabCountsRef()?.searchTermsCount ?? 0
            }
        ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // Helper to read tab counts without causing re-creation of tabsMeta
    function tabCountsRef() {
        return {
            wastedSpendCount: keywordTables?.tabCounts?.wastedSpend?.total || keywordTables?.wastedSpend?.pagination?.totalItems || 0,
            topPerformingCount: keywordTables?.tabCounts?.topPerforming?.total || keywordTables?.topPerforming?.pagination?.totalItems || 0,
            searchTermsCount: keywordTables?.tabCounts?.searchTermsZeroSales?.total || keywordTables?.searchTermsZeroSales?.pagination?.totalItems || 0
        };
    }

    // Animation variants (same behavior as Campaign Audit)
    const pageVariants = {
        enter: (direction) => ({
            x: direction > 0 ? '100%' : '-100%',
            opacity: 0,
            position: 'absolute',
            width: '100%'
        }),
        center: {
            x: 0,
            opacity: 1,
            position: 'relative',
            width: '100%',
            transition: { duration: 0.4, ease: 'easeInOut' }
        },
        exit: (direction) => ({
            x: direction > 0 ? '-100%' : '100%',
            opacity: 0,
            position: 'absolute',
            width: '100%',
            transition: { duration: 0.4, ease: 'easeInOut' }
        })
    };

    const activeIndex = useMemo(
        () => tabsMeta.findIndex(t => t.id === activeTab),
        [tabsMeta, activeTab]
    );
    const prevIndex = useMemo(
        () => tabsMeta.findIndex(t => t.id === prevTab),
        [tabsMeta, prevTab]
    );
    const direction = activeIndex > prevIndex ? 1 : -1;

    // Underline position (only slide horizontally, no width morph jump)
    const [underline, setUnderline] = useState({ x: 0, width: 0 });

    useEffect(() => {
        if (!tabsContainerRef.current) return;
        const tabEls = tabsContainerRef.current.querySelectorAll('[data-ppc-tab]');
        const idx = activeIndex >= 0 ? activeIndex : 0;
        const el = tabEls[idx];
        if (!el) return;
        const containerRect = tabsContainerRef.current.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        setUnderline({
            x: rect.left - containerRect.left,
            width: rect.width
        });
    }, [activeIndex, tabsMeta.length]);

    const handleTabClick = (id) => {
        if (id === activeTab) return;
        setPrevTab(activeTab);
        setActiveTab(id);
    };

    // Fetch tab counts and initial data on mount
    useEffect(() => {
        if (asin && data?.hasAds) {
            const normalizedAsin = asin.trim().toUpperCase();
            dispatch(fetchProductPPCKeywordTabCounts(normalizedAsin));
            dispatch(fetchProductWastedSpendKeywords({ asin: normalizedAsin, page: 1, limit: 10 }));
        }
    }, [asin, data?.hasAds, dispatch]);

    // Fetch initial data when switching tabs
    useEffect(() => {
        if (!asin || !data?.hasAds) return;
        const normalizedAsin = asin.trim().toUpperCase();

        if (activeTab === 'wastedSpend' && !keywordTables?.wastedSpend?.data?.length) {
            dispatch(fetchProductWastedSpendKeywords({ asin: normalizedAsin, page: 1, limit: 10 }));
        } else if (activeTab === 'topPerforming' && !keywordTables?.topPerforming?.data?.length) {
            dispatch(fetchProductTopPerformingKeywords({ asin: normalizedAsin, page: 1, limit: 10 }));
        } else if (activeTab === 'searchTerms' && !keywordTables?.searchTermsZeroSales?.data?.length) {
            dispatch(fetchProductSearchTermsZeroSales({ asin: normalizedAsin, page: 1, limit: 10 }));
        }
    }, [activeTab, asin, data?.hasAds, keywordTables, dispatch]);

    // Infinite scroll for Wasted Spend
    useEffect(() => {
        if (activeTab !== 'wastedSpend') return;
        const sentinel = wastedSpendSentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !loading?.wastedSpendKeywords) {
                const pagination = keywordTables?.wastedSpend?.pagination;
                if (pagination?.hasMore) {
                    dispatch(fetchProductWastedSpendKeywords({ asin: asin.trim().toUpperCase(), page: pagination.page + 1, limit: 10, append: true }));
                }
            }
        }, { threshold: 0.1 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, keywordTables?.wastedSpend?.pagination, loading?.wastedSpendKeywords, asin, dispatch]);

    // Infinite scroll for Top Performing
    useEffect(() => {
        if (activeTab !== 'topPerforming') return;
        const sentinel = topPerformingSentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !loading?.topPerformingKeywords) {
                const pagination = keywordTables?.topPerforming?.pagination;
                if (pagination?.hasMore) {
                    dispatch(fetchProductTopPerformingKeywords({ asin: asin.trim().toUpperCase(), page: pagination.page + 1, limit: 10, append: true }));
                }
            }
        }, { threshold: 0.1 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, keywordTables?.topPerforming?.pagination, loading?.topPerformingKeywords, asin, dispatch]);

    // Infinite scroll for Search Terms
    useEffect(() => {
        if (activeTab !== 'searchTerms') return;
        const sentinel = searchTermsSentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !loading?.searchTermsZeroSales) {
                const pagination = keywordTables?.searchTermsZeroSales?.pagination;
                if (pagination?.hasMore) {
                    dispatch(fetchProductSearchTermsZeroSales({ asin: asin.trim().toUpperCase(), page: pagination.page + 1, limit: 10, append: true }));
                }
            }
        }, { threshold: 0.1 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, keywordTables?.searchTermsZeroSales?.pagination, loading?.searchTermsZeroSales, asin, dispatch]);

    if (!data) return null;

    const { ppcMetrics, issues } = data;

    const formatPercent = (value) => {
        if (value === null || value === undefined) return '—';
        return `${value.toFixed(1)}%`;
    };

    const formatNumber = (value) => {
        if (value === null || value === undefined) return '—';
        return value.toLocaleString();
    };

    const formatCurrency = (value) => {
        if (value === null || value === undefined) return '—';
        return formatCurrencyWithLocale(value, currency);
    };

    const tabCounts = keywordTables?.tabCounts || {};
    const wastedSpend = keywordTables?.wastedSpend || { data: [], pagination: null, totalWastedSpend: 0 };
    const topPerforming = keywordTables?.topPerforming || { data: [], pagination: null };
    const searchTermsZeroSales = keywordTables?.searchTermsZeroSales || { data: [], pagination: null, totalWastedSpend: 0 };

    const renderWastedSpendTable = () => (
        <div className="w-full overflow-hidden">
            {loading?.wastedSpendKeywords && wastedSpend.data.length === 0 ? (
                <TableSkeleton />
            ) : wastedSpend.data.length === 0 ? (
                <table className="w-full table-fixed">
                    <tbody>
                        <tr>
                            <td className="text-center py-6 text-gray-400 text-xs">
                                <div className="flex flex-col items-center space-y-2">
                                    <div>No wasted keywords found</div>
                                    <div className="text-xs">No keywords with cost &gt; $0 and sales = $0</div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            ) : (
                <>
                    <div className="px-3 py-2 bg-red-500/5 border border-[#30363d] text-xs text-red-300 rounded-md mb-2">
                        Total wasted: {formatCurrency(wastedSpend.totalWastedSpend)} across {wastedSpend.pagination?.totalItems || wastedSpend.data.length} keywords with no sales
                    </div>
                    <div className="w-full overflow-hidden">
                        <table className="w-full table-fixed">
                            <thead>
                                <tr className="border-b border-[#30363d]">
                                    <th className="w-[18%] text-left py-2 px-2 text-xs font-medium text-gray-400">Keyword</th>
                                    <th className="w-[22%] text-left py-2 px-2 text-xs font-medium text-gray-400">Campaign</th>
                                    <th className="w-[22%] text-left py-2 px-2 text-xs font-medium text-gray-400">Ad Group</th>
                                    <th className="w-[14%] text-center py-2 px-2 text-xs font-medium text-gray-400">Sales</th>
                                    <th className="w-[14%] text-center py-2 px-2 text-xs font-medium text-gray-400">Spend</th>
                                    <th className="w-[10%] text-center py-2 px-2 text-xs font-medium text-gray-400">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {wastedSpend.data.map((kw, idx) => (
                                    <tr key={`${kw.keywordId || kw.keyword}-${idx}`} className="border-b border-[#30363d]">
                                        <td className="w-[18%] py-2 px-2 text-xs text-gray-100 break-words">{kw.keyword}</td>
                                        <td className="w-[22%] py-2 px-2 text-xs text-gray-300 break-words">{kw.campaignName}</td>
                                        <td className="w-[22%] py-2 px-2 text-xs text-gray-300 break-words">{kw.adGroupName || 'N/A'}</td>
                                        <td className="w-[14%] py-2 px-2 text-xs text-center whitespace-nowrap text-gray-300">{formatCurrency(kw.sales)}</td>
                                        <td className="w-[14%] py-2 px-2 text-xs text-center font-medium text-red-400 whitespace-nowrap">{formatCurrency(kw.spend)}</td>
                                        <td className="w-[10%] py-2 px-2 relative" data-wasted-action-cell>
                                            <div className="flex items-center justify-center">
                                                {(kw.keywordId != null && kw.keywordId !== '') || (kw.campaignId && kw.adGroupId && kw.keyword) ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => setOpenActionIdx(openActionIdx === idx ? null : idx)}
                                                            className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent hover:border-[#30363d]"
                                                            title="Actions"
                                                        >
                                                            <MoreVertical className="w-4 h-4" />
                                                        </button>
                                                        {openActionIdx === idx && (
                                                            <div className={`absolute right-0 z-20 min-w-[180px] py-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-lg ${idx <= 1 ? 'top-full mt-0.5' : 'bottom-full mb-0.5'}`}>
                                                                {kw.keywordId != null && kw.keywordId !== '' && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePauseKeyword(kw)}
                                                                        disabled={pausingId === kw.keywordId}
                                                                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        {pausingId === kw.keywordId
                                                                            ? <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
                                                                            : <Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                                                                        {pausingId === kw.keywordId ? 'Pausing…' : 'Pause keyword'}
                                                                    </button>
                                                                )}
                                                                {kw.campaignId && kw.adGroupId && kw.keyword && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleAddToNegative(kw)}
                                                                        disabled={addingNegId === kw.keywordId}
                                                                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        {addingNegId === kw.keywordId
                                                                            ? <Loader2 className="w-3.5 h-3.5 text-slate-400 shrink-0 animate-spin" />
                                                                            : <Ban className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                                                        {addingNegId === kw.keywordId ? 'Adding…' : 'Add to negative'}
                                                                    </button>
                                                                )}
                                                                {kw.keywordId != null && kw.keywordId !== '' && kw.campaignId && kw.adGroupId && kw.keyword && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePauseAndAddToNegative(kw)}
                                                                        disabled={pauseAndNegId === kw.keywordId}
                                                                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border-t border-[#30363d]"
                                                                    >
                                                                        {pauseAndNegId === kw.keywordId
                                                                            ? <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
                                                                            : <><Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" /><Ban className="w-3.5 h-3.5 text-slate-400 shrink-0" /></>}
                                                                        {pauseAndNegId === kw.keywordId ? 'Processing…' : 'Pause & add to negative'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="text-gray-500 text-xs">—</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div ref={wastedSpendSentinelRef} className="h-10" />
                    {loading?.wastedSpendKeywords && wastedSpend.data.length > 0 && (
                        <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>
                    )}
                    {wastedSpend.pagination?.hasMore && !loading?.wastedSpendKeywords && (
                        <div className="text-center py-2 text-xs text-gray-500">Scroll down to load more...</div>
                    )}
                </>
            )}
        </div>
    );

    const renderTopPerformingTable = () => (
        <div className="w-full overflow-hidden">
            {loading?.topPerformingKeywords && topPerforming.data.length === 0 ? (
                <TableSkeleton />
            ) : topPerforming.data.length === 0 ? (
                <table className="w-full table-fixed">
                    <tbody>
                        <tr>
                            <td className="text-center py-6 text-gray-400 text-xs">
                                <div className="flex flex-col items-center space-y-2">
                                    <div>No top performing keywords found</div>
                                    <div className="text-xs">No keywords with ACOS &lt; 30%, sales &gt; $5, and impressions &gt; 50</div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            ) : (
                <>
                    <div className="mb-2 mt-1 text-xs text-gray-400">Best performing keywords for this product</div>
                    <table className="w-full table-fixed">
                        <thead>
                            <tr className="border-b border-[#30363d]">
                                <th className="w-[26%] text-left py-2 px-2 text-xs font-medium text-gray-400">Keyword</th>
                                <th className="w-[14%] text-left py-2 px-2 text-xs font-medium text-gray-400">Ad Group</th>
                                <th className="w-[22%] text-left py-2 px-2 text-xs font-medium text-gray-400">Campaign</th>
                                <th className="w-[12%] text-center py-2 px-2 text-xs font-medium text-gray-400">Sales</th>
                                <th className="w-[12%] text-center py-2 px-2 text-xs font-medium text-gray-400">Spend</th>
                                <th className="w-[14%] text-center py-2 px-2 text-xs font-medium text-gray-400">ACOS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topPerforming.data.map((kw, idx) => (
                                <tr key={`${kw.keywordId || kw.keyword}-${idx}`} className="border-b border-[#30363d]">
                                    <td className="w-[26%] py-2 px-2 text-xs text-gray-100 break-words" title={kw.keyword}>{kw.keyword}</td>
                                    <td className="w-[14%] py-2 px-2 text-xs text-gray-300 break-words">{kw.adGroupName || 'N/A'}</td>
                                    <td className="w-[22%] py-2 px-2 text-xs text-gray-300 break-words" title={kw.campaignName}>{kw.campaignName}</td>
                                    <td className="w-[12%] py-2 px-2 text-xs text-center text-emerald-400 whitespace-nowrap">{formatCurrency(kw.sales)}</td>
                                    <td className="w-[12%] py-2 px-2 text-xs text-center text-gray-300 whitespace-nowrap">{formatCurrency(kw.spend)}</td>
                                    <td className="w-[14%] py-2 px-2 text-xs text-center text-emerald-300 whitespace-nowrap">{formatPercent(kw.acos)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div ref={topPerformingSentinelRef} className="h-10" />
                    {loading?.topPerformingKeywords && topPerforming.data.length > 0 && (
                        <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>
                    )}
                    {topPerforming.pagination?.hasMore && !loading?.topPerformingKeywords && (
                        <div className="text-center py-2 text-xs text-gray-500">Scroll down to load more...</div>
                    )}
                </>
            )}
        </div>
    );

    const renderSearchTermsTable = () => (
        <div className="w-full overflow-hidden">
            {loading?.searchTermsZeroSales && searchTermsZeroSales.data.length === 0 ? (
                <TableSkeleton />
            ) : searchTermsZeroSales.data.length === 0 ? (
                <table className="w-full table-fixed">
                    <tbody>
                        <tr>
                            <td className="text-center py-6 text-gray-400 text-xs">
                                <div className="flex flex-col items-center space-y-2">
                                    <div>No search terms with zero sales</div>
                                    <div className="text-xs">No terms with clicks &gt;= 5 and sales = $0</div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            ) : (
                <>
                    <div className="px-3 py-2 bg-yellow-500/5 border border-[#30363d] text-xs text-yellow-300 rounded-md mb-2">
                        Total wasted: {formatCurrency(searchTermsZeroSales.totalWastedSpend)} across {searchTermsZeroSales.pagination?.totalItems || searchTermsZeroSales.data.length} search terms with no sales
                    </div>
                    <table className="w-full table-fixed">
                        <thead>
                            <tr className="border-b border-[#30363d]">
                                <th className="w-[30%] text-left py-2 px-2 text-xs font-medium text-gray-400">Search Term</th>
                                <th className="w-[22%] text-left py-2 px-2 text-xs font-medium text-gray-400">Keyword</th>
                                <th className="w-[22%] text-left py-2 px-2 text-xs font-medium text-gray-400">Campaign</th>
                                <th className="w-[12%] text-center py-2 px-2 text-xs font-medium text-gray-400">Clicks</th>
                                <th className="w-[14%] text-center py-2 px-2 text-xs font-medium text-gray-400">Spend</th>
                            </tr>
                        </thead>
                        <tbody>
                            {searchTermsZeroSales.data.map((st, idx) => (
                                <tr key={`${st.searchTerm}-${st.campaignId}-${idx}`} className="border-b border-[#30363d]">
                                    <td className="w-[30%] py-2 px-2 text-xs text-gray-100 break-words" title={st.searchTerm}>{st.searchTerm}</td>
                                    <td className="w-[22%] py-2 px-2 text-xs text-gray-300 break-words" title={st.keyword}>{st.keyword}</td>
                                    <td className="w-[22%] py-2 px-2 text-xs text-gray-300 break-words" title={st.campaignName}>{st.campaignName}</td>
                                    <td className="w-[12%] py-2 px-2 text-xs text-center text-gray-300">{formatNumber(st.clicks)}</td>
                                    <td className="w-[14%] py-2 px-2 text-xs text-center text-yellow-400 whitespace-nowrap">{formatCurrency(st.spend)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div ref={searchTermsSentinelRef} className="h-10" />
                    {loading?.searchTermsZeroSales && searchTermsZeroSales.data.length > 0 && (
                        <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>
                    )}
                    {searchTermsZeroSales.pagination?.hasMore && !loading?.searchTermsZeroSales && (
                        <div className="text-center py-2 text-xs text-gray-500">Scroll down to load more...</div>
                    )}
                </>
            )}
        </div>
    );

    return (
        <div className="mt-6 space-y-6">
            {/* Feedback popup */}
            {feedbackPopup.show && (
                <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg border shadow-lg text-sm ${
                    feedbackPopup.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                    {feedbackPopup.message}
                </div>
            )}

            {/* Keyword tables (Campaign Audit style with pagination) */}
            {data?.hasAds && (
                <div className="bg-[#0d1117] border border-[#30363d] rounded-lg overflow-hidden">
                    <div className="px-4 pt-3 border-b border-[#30363d]">
                        <div className="relative">
                            <div
                                className="flex gap-6 overflow-x-auto pb-2 no-scrollbar"
                                ref={tabsContainerRef}
                            >
                                {tabsMeta.map((tab) => (
                                    <div
                                        key={tab.id}
                                        className="relative pb-3 cursor-pointer whitespace-nowrap flex-shrink-0"
                                        data-ppc-tab
                                        onClick={() => handleTabClick(tab.id)}
                                    >
                                        <p
                                            className={`text-xs font-medium transition-colors ${
                                                activeTab === tab.id
                                                    ? 'text-blue-400 font-semibold'
                                                    : 'text-gray-400 hover:text-gray-300'
                                            }`}
                                        >
                                            {tab.label}
                                        </p>
                                        {/* underline handled by shared motion.div below */}
                                    </div>
                                ))}
                            </div>
                            <motion.div
                                className="absolute bottom-0 h-[2px] bg-blue-500 rounded-full"
                                style={{ left: 0 }}
                                animate={{ x: underline.x, width: underline.width }}
                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            />
                        </div>
                    </div>
                    <div className="px-2 pb-2 pt-1 relative overflow-hidden" style={{ minHeight: '260px' }}>
                        <motion.div
                            key={activeTab}
                            custom={direction}
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            className="w-full"
                        >
                            {activeTab === 'wastedSpend' && renderWastedSpendTable()}
                            {activeTab === 'topPerforming' && renderTopPerformingTable()}
                            {activeTab === 'searchTerms' && renderSearchTermsTable()}
                        </motion.div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductPPCIssuesTable;
