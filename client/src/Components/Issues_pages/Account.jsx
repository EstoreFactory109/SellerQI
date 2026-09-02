import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, XCircle, Download, ChevronDown, Search, ExternalLink, Activity } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchAccountIssues } from '../../redux/slices/PageDataSlice';
import { COLORS, STATUS, getStatusConfig, HealthGauge, VerdictBanner, StatusPill } from '../Shared/index.js';

// Generic, real Amazon Seller Central destination for account health metrics
// (not a per-issue deep link - we don't have one - but a genuine working page).
const SELLER_CENTRAL_HEALTH_URL = 'https://sellercentral.amazon.com/performance/dashboard';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export default function AccountHealthDashboard() {
    const dispatch = useDispatch();

    // Legacy dashboard data (backward compatibility)
    const legacyInfo = useSelector(state => state.Dashboard.DashBoardInfo);

    // New paginated issues data from dedicated endpoint
    const accountIssuesState = useSelector(state => state.pageData?.issuesPaginated?.account || {
        data: null,
        loading: false,
        error: null,
        lastFetched: null
    });

    // Prefer dedicated account-issues endpoint; fall back to legacy dashboard data
    const info = accountIssuesState.data || legacyInfo;

    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('needs'); // needs | all | healthy
    const [healthyOpen, setHealthyOpen] = useState(false);
    const exportRef = useRef(null);

    const AccountErrors = info?.AccountErrors;

    // On first mount, if we don't have account issues in Redux, fetch from dedicated endpoint.
    // This fixes the "first load works, reload empty" issue without breaking legacy behavior.
    useEffect(() => {
        if (!accountIssuesState.data && !accountIssuesState.loading) {
            dispatch(fetchAccountIssues());
        }
    }, [accountIssuesState.data, accountIssuesState.loading, dispatch]);

    // Check if we have any data
    const hasData = info && AccountErrors && Object.keys(AccountErrors).length > 0;
    const hasHealthData = info?.accountHealthPercentage?.Percentage !== undefined;

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (exportRef.current && !exportRef.current.contains(event.target)) {
                setShowExportDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Account health metrics
    const accountMetrics = [
        {
            key: 'accountStatus',
            name: 'Account Status',
            data: AccountErrors?.accountStatus,
            icon: Shield,
            priority: 'high'
        },
        {
            key: 'negativeFeedbacks',
            name: 'Negative Seller Feedback',
            data: AccountErrors?.negativeFeedbacks,
            icon: AlertTriangle,
            priority: 'medium'
        },
        {
            key: 'NCX',
            name: 'NCX - Negative Customer Experience',
            data: AccountErrors?.NCX,
            icon: XCircle,
            priority: 'high'
        },
        {
            key: 'PolicyViolations',
            name: 'Policy Violations',
            data: AccountErrors?.PolicyViolations,
            icon: AlertTriangle,
            priority: 'high'
        },
        {
            key: 'validTrackingRateStatus',
            name: 'Valid Tracking Rate',
            data: AccountErrors?.validTrackingRateStatus,
            icon: Activity,
            priority: 'medium'
        },
        {
            key: 'orderWithDefectsStatus',
            name: 'Order Defect Rate',
            data: AccountErrors?.orderWithDefectsStatus,
            icon: XCircle,
            priority: 'medium'
        },
        {
            key: 'lateShipmentRateStatus',
            name: 'Late Shipment Rate',
            data: AccountErrors?.lateShipmentRateStatus,
            icon: Activity,
            priority: 'medium'
        },
        {
            key: 'a_z_claims',
            name: 'A-Z Guarantee Claim',
            data: AccountErrors?.a_z_claims,
            icon: Shield,
            priority: 'high'
        },
        {
            key: 'CancellationRate',
            name: 'Cancellation Rate (CR)',
            data: AccountErrors?.CancellationRate,
            icon: XCircle,
            priority: 'medium'
        },
        {
            key: 'responseUnder24HoursCount',
            name: 'Customer Response Time (More than 24 Hours)',
            data: AccountErrors?.responseUnder24HoursCount,
            icon: Activity,
            priority: 'low'
        }
    ];

    // Calculate health overview
    const totalIssues = accountMetrics.filter(metric => metric.data?.status === "Error").length;
    const totalMetrics = accountMetrics.length;
    const totalHealthy = totalMetrics - totalIssues;
    const healthPercentage = info?.accountHealthPercentage?.Percentage || 0;
    // Same real status field + tier mapping Dashboard.jsx uses - no invented thresholds.
    const healthStatusRaw = info?.accountHealthPercentage?.status || 'POOR';
    const healthPillStatus = (healthStatusRaw === 'GOOD' || healthStatusRaw === 'Healthy')
        ? STATUS.GOOD
        : (healthStatusRaw === 'FAIR' || healthStatusRaw === 'At Risk')
            ? STATUS.WATCH
            : STATUS.FIX;

    const matchesSearch = (metric) => {
        const q = searchQuery.toLowerCase();
        if (!q) return true;
        return metric.name.toLowerCase().includes(q) || (metric.data?.Message || '').toLowerCase().includes(q);
    };

    // Worst-priority-first, same spirit as the mock's "sorted worst first" - using the
    // real (previously unused) priority field already on each metric.
    const issueMetrics = accountMetrics
        .filter(m => m.data?.status === "Error" && matchesSearch(m))
        .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3));
    const healthyMetrics = accountMetrics.filter(m => m.data?.status !== "Error" && matchesSearch(m));

    const showIssueCards = activeTab !== 'healthy';
    const showHealthyList = activeTab !== 'needs' || healthyOpen;

    const tabs = [
        { id: 'needs', label: 'Needs attention', count: totalIssues },
        { id: 'all', label: 'All metrics', count: totalMetrics },
        { id: 'healthy', label: 'Healthy', count: totalHealthy }
    ];

    // Prepare data for CSV/Excel export
    const prepareAccountData = () => {
        return accountMetrics.map(metric => ({
            Category: metric.name,
            Issue: metric.data?.Message || 'N/A',
            Status: metric.data?.status || 'Unknown',
            Solution: metric.data?.HowTOSolve?.length > 0 ? metric.data.HowTOSolve : 'N/A'
        }));
    };

    const handleDownloadCSV = () => {
        const rows = prepareAccountData();
        if (!rows.length) return;
        const headers = Object.keys(rows[0]);
        const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Account_Health_Report_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // If no data is available, show the no data found message
    if (!hasData || !hasHealthData) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bgBase }}>
                <div className="text-center max-w-md mx-auto">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border" style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border }}>
                        <Shield className="w-8 h-8" style={{ color: COLORS.textMuted }} />
                    </div>
                    <h3 className="text-lg font-semibold mb-1" style={{ color: COLORS.textPrimary }}>No Data Found</h3>
                    <p className="mb-4 text-sm" style={{ color: COLORS.textSecondary }}>
                        Account health data is not available at the moment. Please check back later or contact support if this issue persists.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-1.5 rounded text-xs transition-all font-medium"
                            style={{ background: COLORS.accent, color: '#061021' }}
                        >
                            Refresh Page
                        </button>
                        <button
                            onClick={() => window.history.back()}
                            className="px-4 py-1.5 rounded text-xs transition-all font-medium border"
                            style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border, color: COLORS.textSecondary }}
                        >
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Verdict + health gauge */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-5">
                <div className="flex-1 min-w-0">
                    <VerdictBanner status={healthPillStatus}>
                        Your account is{' '}
                        <span style={{ color: getStatusConfig(healthPillStatus).color, fontWeight: 600 }}>
                            {getStatusConfig(healthPillStatus).label.toLowerCase()} ({healthPercentage}%)
                        </span>
                        .{' '}
                        {totalIssues > 0 ? (
                            <span style={{ color: getStatusConfig(STATUS.FIX).color, fontWeight: 600 }}>
                                {totalIssues} metric{totalIssues === 1 ? '' : 's'} need{totalIssues === 1 ? 's' : ''} attention
                            </span>
                        ) : (
                            'All tracked metrics are healthy.'
                        )}
                    </VerdictBanner>
                </div>
                <div className="flex-none flex flex-col items-center gap-2 self-center">
                    <HealthGauge percentage={healthPercentage} status={healthPillStatus} />
                    <div className="text-xs" style={{ color: COLORS.textMuted }}>Health score</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 overflow-x-auto" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className="flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors"
                        style={{
                            borderBottom: `2px solid ${activeTab === tab.id ? COLORS.accent : 'transparent'}`,
                            color: activeTab === tab.id ? COLORS.textPrimary : COLORS.textSecondary,
                        }}
                    >
                        {tab.label}
                        <span className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: COLORS.surfaceElevated, color: COLORS.textSecondary }}>
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Search + Export toolbar */}
            <div className="rounded-2xl border p-2.5 flex items-center gap-2" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2" size={15} style={{ color: COLORS.textMuted }} />
                    <input
                        type="text"
                        placeholder="Search metrics..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] focus:outline-none transition-colors"
                        style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
                        onFocus={(e) => { e.target.style.borderColor = COLORS.accent; }}
                        onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
                    />
                </div>
                <div className="relative flex-shrink-0" ref={exportRef}>
                    <button
                        onClick={() => setShowExportDropdown(prev => !prev)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors"
                        style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
                    >
                        <Download size={15} />
                        Export
                        <ChevronDown size={14} className={`transition-transform ${showExportDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                        {showExportDropdown && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                transition={{ duration: 0.2 }}
                                className="absolute top-full right-0 mt-1.5 z-50 min-w-[180px] rounded-xl shadow-lg py-1 overflow-hidden"
                                style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.border}` }}
                            >
                                <button
                                    onClick={handleDownloadCSV}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                                    style={{ color: COLORS.textSecondary }}
                                >
                                    <Download size={14} />
                                    Download CSV
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Issue cards */}
            {showIssueCards && (
                issueMetrics.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {issueMetrics.map((metric, index) => {
                            const Icon = metric.icon;
                            const fixColor = getStatusConfig(STATUS.FIX).color;
                            return (
                                <motion.div
                                    key={metric.key}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.25, delay: index * 0.03 }}
                                    className="relative overflow-hidden rounded-2xl border"
                                    style={{ borderColor: COLORS.border, background: COLORS.surface }}
                                >
                                    <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: fixColor }} />
                                    <div className="pl-5 pr-5 py-4">
                                        <div className="flex items-start gap-3 flex-wrap">
                                            <Icon size={18} style={{ color: fixColor }} className="flex-shrink-0 mt-0.5" />
                                            <div className="flex-1 min-w-[220px]">
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <span className="text-base font-semibold" style={{ color: COLORS.textPrimary }}>{metric.name}</span>
                                                    <StatusPill status={STATUS.FIX} label="Issue" compact />
                                                </div>
                                                <div className="text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
                                                    {metric.data?.Message || 'No details available.'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3.5 pt-3.5 flex items-center gap-4 flex-wrap" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                                            <div className="flex-1 min-w-0 text-sm" style={{ color: COLORS.textPrimary }}>
                                                <span style={{ color: COLORS.textMuted }}>Next step — </span>
                                                {metric.data?.HowTOSolve?.length > 0 ? metric.data.HowTOSolve : 'Contact support for assistance.'}
                                            </div>
                                            <a
                                                href={SELLER_CENTRAL_HEALTH_URL}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
                                                style={{ background: COLORS.accent, color: '#061021' }}
                                            >
                                                Open Seller Central
                                                <ExternalLink size={12} />
                                            </a>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-2xl border py-10 text-center" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                        {searchQuery ? (
                            <>
                                <div className="text-[15px] font-semibold mb-1" style={{ color: COLORS.textPrimary }}>No metrics match your search.</div>
                                <div className="text-sm" style={{ color: COLORS.textSecondary }}>Try a different search term.</div>
                            </>
                        ) : (
                            <>
                                <div className="text-2xl mb-2" style={{ color: getStatusConfig(STATUS.GOOD).color }}>✓</div>
                                <div className="text-[15px] font-semibold" style={{ color: COLORS.textPrimary }}>No metrics need attention — nice.</div>
                            </>
                        )}
                    </div>
                )
            )}

            {/* Healthy metrics - collapsed summary or full list */}
            {activeTab === 'needs' && !showHealthyList && totalHealthy > 0 && (
                <button
                    onClick={() => setHealthyOpen(true)}
                    className="w-full flex items-center gap-2.5 text-left px-5 py-3.5 rounded-2xl border transition-colors"
                    style={{ borderColor: COLORS.border, background: COLORS.bgBase, color: COLORS.textSecondary }}
                >
                    <span style={{ color: getStatusConfig(STATUS.GOOD).color }}>✓</span>
                    <span className="flex-1 text-[13px]">
                        {totalHealthy} metric{totalHealthy === 1 ? '' : 's'} {totalHealthy === 1 ? 'is' : 'are'} healthy — nothing to do there.
                    </span>
                    <span className="text-xs" style={{ color: COLORS.textMuted }}>Show ▾</span>
                </button>
            )}

            {showHealthyList && totalHealthy > 0 && (
                <div className="rounded-2xl border px-5 py-4" style={{ borderColor: COLORS.border, background: COLORS.bgBase }}>
                    <div className="flex items-center gap-2.5 mb-3">
                        <span style={{ color: getStatusConfig(STATUS.GOOD).color }}>✓</span>
                        <span className="text-[13px] font-semibold" style={{ color: COLORS.textPrimary }}>
                            {totalHealthy} healthy metric{totalHealthy === 1 ? '' : 's'}
                        </span>
                        {activeTab === 'needs' && (
                            <button onClick={() => setHealthyOpen(false)} className="ml-auto text-xs" style={{ color: COLORS.textMuted }}>
                                Hide ▴
                            </button>
                        )}
                    </div>
                    {healthyMetrics.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                            {healthyMetrics.map(metric => (
                                <div
                                    key={metric.key}
                                    className="flex items-center gap-2.5 py-1.5 text-[13px]"
                                    style={{ borderBottom: `1px solid ${COLORS.surfaceElevated}`, color: COLORS.textSecondary }}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: getStatusConfig(STATUS.GOOD).color }} />
                                    {metric.name}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-sm" style={{ color: COLORS.textMuted }}>No healthy metrics match your search.</div>
                    )}
                </div>
            )}
        </div>
    );
}
