import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle, XCircle, Download, ChevronDown, Activity, Search, Filter } from 'lucide-react';
import { useSelector } from 'react-redux';
import DownloadReport from '../DownloadReport/DownloadReport.jsx';

export default function AccountHealthDashboard() {
    const info = useSelector(state => state.Dashboard.DashBoardInfo)
    console.log("info",info)
    const [showExportDropdown, setShowExportDropdown] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedFilter, setSelectedFilter] = useState('all')
    const exportRef = useRef(null)

    const AccountErrors = info?.AccountErrors;

    console.log("AccountErrors",AccountErrors)

    // Check if we have any data
    const hasData = info && AccountErrors && Object.keys(AccountErrors).length > 0;
    const hasHealthData = info?.accountHealthPercentage?.Percentage !== undefined;

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (exportRef.current && !exportRef.current.contains(event.target)) {
                setShowExportDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

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
    const healthPercentage = info?.accountHealthPercentage?.Percentage || 0;

    // Filter metrics based on search and filter
    const filteredMetrics = accountMetrics.filter(metric => {
        const matchesSearch = metric.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             metric.data?.Message?.toLowerCase().includes(searchQuery.toLowerCase());
        
        let matchesFilter = true;
        if (selectedFilter === 'errors') {
            matchesFilter = metric.data?.status === "Error";
        } else if (selectedFilter === 'good') {
            matchesFilter = metric.data?.status !== "Error";
        }
        
        return matchesSearch && matchesFilter;
    });

    // Prepare data for CSV/Excel export
    const prepareAccountData = () => {
        return accountMetrics.map(metric => ({
            Category: metric.name,
            Issue: metric.data?.Message || 'N/A',
            Status: metric.data?.status || 'Unknown',
            Solution: metric.data?.HowTOSolve?.length > 0 ? metric.data.HowTOSolve : 'N/A'
        }));
    };

    // If no data is available, show the no data found message
    if (!hasData || !hasHealthData) {
        return (
            <div className="min-h-screen bg-[#1a1a1a] p-2 md:p-3 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto">
                    <div className="w-16 h-16 bg-[#21262d] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#30363d]">
                        <Shield className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-100 mb-1">No Data Found</h3>
                    <p className="text-gray-400 mb-4 text-sm">
                        Account health data is not available at the moment. Please check back later or contact support if this issue persists.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-all font-medium"
                        >
                            Refresh Page
                        </button>
                        <button 
                            onClick={() => window.history.back()}
                            className="px-4 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-gray-300 rounded text-xs transition-all font-medium border border-[#30363d]"
                        >
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#1a1a1a] p-2 md:p-3 space-y-2">
            {/* Header Section */}
            <div className="bg-[#161b22] border border-[#30363d] rounded p-2 relative overflow-hidden">
                <div className="relative z-10">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 mb-1">
                                <Shield className="w-4 h-4 text-blue-400" />
                                <h1 className="text-lg font-bold text-gray-100">
                                    Account Health Dashboard
                                </h1>
                            </div>
                            <p className="text-xs text-gray-400">Monitor your Amazon seller account health and performance metrics</p>
                            <div className="flex items-center gap-3 mt-2">
                                <div className="flex items-center gap-1 text-xs text-gray-400">
                                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                                    <span>Real-time monitoring</span>
                                </div>
                                {totalIssues > 0 && (
                                    <div className="flex items-center gap-1 text-xs text-orange-400">
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>{totalIssues} issues detected</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-right">
                                <div className="text-xl font-bold text-green-400 mb-0.5">
                                    {healthPercentage}%
                                </div>
                                <div className="text-xs text-gray-400 font-medium uppercase">Account Health</div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                    {totalIssues > 0 ? `${totalIssues} issues detected` : 'All systems healthy'}
                                </div>
                            </div>
                            <div className="w-10 h-10 bg-green-500/20 rounded flex items-center justify-center border border-green-500/30">
                                <Shield className="w-5 h-5 text-green-400" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Search and Filter Controls */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="bg-[#161b22] rounded border border-[#30363d] p-2"
            >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-100 mb-0.5">Account Health Metrics</h3>
                        <p className="text-xs text-gray-400">Detailed breakdown of your account health indicators</p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search metrics..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 pr-2 py-1 border border-[#30363d] rounded bg-[#1a1a1a] text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder-gray-500"
                            />
                        </div>
                        
                                                 {/* Filter */}
                         <select
                             value={selectedFilter}
                             onChange={(e) => setSelectedFilter(e.target.value)}
                             className="px-2 py-1 border border-[#30363d] rounded bg-[#1a1a1a] text-gray-100 text-xs focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                         >
                             <option value="all">All Metrics</option>
                             <option value="errors">Issues Only</option>
                             <option value="good">Healthy Only</option>
                         </select>
                        
                        {/* Export */}
                        <div className="relative" ref={exportRef}>
                            <button 
                                onClick={() => setShowExportDropdown(!showExportDropdown)}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-all font-medium"
                            >
                                <Download className="w-3 h-3" />
                                Export
                                <ChevronDown className="w-3 h-3" />
                            </button>
                            
                            <AnimatePresence>
                                {showExportDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                        transition={{ duration: 0.2 }}
                                        className="absolute top-full right-0 mt-1 z-50 bg-[#21262d] shadow-xl rounded border border-[#30363d] overflow-hidden min-w-[160px]"
                                    >
                                        <DownloadReport
                                            prepareDataFunc={prepareAccountData}
                                            filename="Account_Health_Report"
                                            buttonText="Download CSV"
                                            buttonClass="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-[#161b22] transition-colors duration-200 text-xs"
                                            showIcon={true}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Results Summary */}
                {(searchQuery || selectedFilter !== 'all') && (
                    <div className="mb-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded">
                        <div className="flex items-center gap-1.5 text-xs">
                            <Filter className="w-3 h-3 text-blue-400" />
                            <span className="text-blue-400 font-medium">
                                Showing {filteredMetrics.length} of {accountMetrics.length} metrics
                            </span>
                            {(searchQuery || selectedFilter !== 'all') && (
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSelectedFilter('all');
                                    }}
                                    className="ml-auto text-blue-400 hover:text-blue-300 text-xs underline"
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Issues Table */}
                <div className="overflow-hidden rounded border border-[#30363d]">
                    <div className="overflow-x-auto">
                        <table className="w-full table-fixed min-w-[768px]">
                            <thead>
                                <tr className="border-b-2 border-[#30363d]">
                                    <th className="w-1/4 text-left py-2 px-2 font-semibold text-gray-400 bg-[#21262d] text-xs">Category</th>
                                    <th className="w-1/6 text-left py-2 px-2 font-semibold text-gray-400 bg-[#21262d] text-xs">Status</th>
                                    <th className="w-2/5 text-left py-2 px-2 font-semibold text-gray-400 bg-[#21262d] text-xs">Issue Details</th>
                                    <th className="w-1/4 text-left py-2 px-2 font-semibold text-gray-400 bg-[#21262d] text-xs">Solution</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#30363d] bg-[#161b22]">
                                {filteredMetrics.map((metric, index) => {
                                    const Icon = metric.icon;
                                    const isError = metric.data?.status === "Error";
                                    
                                    return (
                                        <motion.tr
                                            key={metric.key}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.3, delay: index * 0.05 }}
                                            className="border-b border-[#30363d]"
                                        >
                                            <td className="w-1/4 py-2 px-2">
                                                <div className="flex items-center gap-1.5">
                                                    <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                                                        isError ? 'bg-red-500/20 border border-red-500/30' : 'bg-green-500/20 border border-green-500/30'
                                                    }`}>
                                                        <Icon className={`w-3 h-3 ${
                                                            isError ? 'text-red-400' : 'text-green-400'
                                                        }`} />
                                                    </div>
                                                    <span className="font-medium text-gray-100 text-xs truncate">{metric.name}</span>
                                                </div>
                                            </td>
                                            <td className="w-1/6 py-2 px-2">
                                                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                                    isError 
                                                        ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                                                        : 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                }`}>
                                                    {isError ? (
                                                        <XCircle className="w-3 h-3" />
                                                    ) : (
                                                        <CheckCircle className="w-3 h-3" />
                                                    )}
                                                    <span className="hidden sm:inline">
                                                        {isError ? 'Issue' : 'Healthy'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="w-2/5 py-2 px-2">
                                                <p className={`text-xs leading-relaxed ${isError ? 'text-red-400 font-medium' : 'text-green-400'}`}>
                                                    {metric.data?.Message || 'No issues detected'}
                                                </p>
                                            </td>
                                            <td className="w-1/4 py-2 px-2">
                                                <p className="text-xs text-gray-300 leading-relaxed">
                                                    {metric.data?.HowTOSolve?.length > 0 ? metric.data.HowTOSolve : (isError ? 'Contact support for assistance' : 'N/A')}
                                                </p>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {filteredMetrics.length === 0 && (
                        <div className="text-center py-8 bg-[#161b22]">
                            <div className="w-12 h-12 bg-[#21262d] rounded-full flex items-center justify-center mx-auto mb-3 border border-[#30363d]">
                                <Search className="w-6 h-6 text-gray-400" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-100 mb-1">No metrics found</h3>
                            <p className="text-gray-400 text-xs">Try adjusting your search or filter criteria</p>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

