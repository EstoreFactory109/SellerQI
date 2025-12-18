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
            <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto">
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Shield className="w-12 h-12 text-gray-400" />
                    </div>
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">No Data Found</h3>
                    <p className="text-gray-500 mb-6">
                        Account health data is not available at the moment. Please check back later or contact support if this issue persists.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow font-medium"
                        >
                            Refresh Page
                        </button>
                        <button 
                            onClick={() => window.history.back()}
                            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-all duration-200 font-medium"
                        >
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 space-y-8">
            {/* Header Section */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
                <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
                <div className="relative z-10">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                    Account Health Dashboard
                                </h1>
                            </div>
                            <p className="text-gray-300 text-lg">Monitor your Amazon seller account health and performance metrics</p>
                            <div className="flex items-center gap-4 mt-4">
                                <div className="flex items-center gap-2 text-sm text-gray-400">
                                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                    <span>Real-time monitoring</span>
                                </div>
                                {totalIssues > 0 && (
                                    <div className="flex items-center gap-2 text-sm text-orange-300">
                                        <AlertTriangle className="w-4 h-4" />
                                        <span>{totalIssues} issues detected</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="text-center lg:text-right">
                                <div className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent mb-1">
                                    {healthPercentage}%
                                </div>
                                <div className="text-sm text-gray-300 font-medium tracking-wide uppercase">Account Health</div>
                                <div className="text-xs text-gray-400 mt-1">
                                    {totalIssues > 0 ? `${totalIssues} issues detected` : 'All systems healthy'}
                                </div>
                            </div>
                            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                                <Shield className="w-8 h-8 text-white" />
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
                className="bg-white rounded-2xl shadow-lg border border-gray-200/80 p-6"
            >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-1">Account Health Metrics</h3>
                        <p className="text-sm text-gray-500">Detailed breakdown of your account health indicators</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search metrics..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            />
                        </div>
                        
                                                 {/* Filter */}
                         <select
                             value={selectedFilter}
                             onChange={(e) => setSelectedFilter(e.target.value)}
                             className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                         >
                             <option value="all">All Metrics</option>
                             <option value="errors">Issues Only</option>
                             <option value="good">Healthy Only</option>
                         </select>
                        
                        {/* Export */}
                        <div className="relative" ref={exportRef}>
                            <button 
                                onClick={() => setShowExportDropdown(!showExportDropdown)}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow text-sm font-medium"
                            >
                                <Download className="w-4 h-4" />
                                Export
                                <ChevronDown className="w-4 h-4" />
                            </button>
                            
                            <AnimatePresence>
                                {showExportDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                        transition={{ duration: 0.2 }}
                                        className="absolute top-full right-0 mt-2 z-50 bg-white shadow-xl rounded-xl border border-gray-200 overflow-hidden min-w-[180px]"
                                    >
                                        <DownloadReport
                                            prepareDataFunc={prepareAccountData}
                                            filename="Account_Health_Report"
                                            buttonText="Download CSV"
                                            buttonClass="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200 text-sm"
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
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2 text-sm">
                            <Filter className="w-4 h-4 text-blue-600" />
                            <span className="text-blue-700 font-medium">
                                Showing {filteredMetrics.length} of {accountMetrics.length} metrics
                            </span>
                            {(searchQuery || selectedFilter !== 'all') && (
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSelectedFilter('all');
                                    }}
                                    className="ml-auto text-blue-600 hover:text-blue-800 text-xs underline"
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Issues Table */}
                <div className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="w-full table-fixed min-w-[768px]">
                            <thead>
                                <tr className="border-b-2 border-gray-200">
                                    <th className="w-1/4 text-left py-4 px-3 font-semibold text-gray-900 bg-gray-50 text-sm">Category</th>
                                    <th className="w-1/6 text-left py-4 px-3 font-semibold text-gray-900 bg-gray-50 text-sm">Status</th>
                                    <th className="w-2/5 text-left py-4 px-3 font-semibold text-gray-900 bg-gray-50 text-sm">Issue Details</th>
                                    <th className="w-1/4 text-left py-4 px-3 font-semibold text-gray-900 bg-gray-50 text-sm">Solution</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {filteredMetrics.map((metric, index) => {
                                    const Icon = metric.icon;
                                    const isError = metric.data?.status === "Error";
                                    
                                    return (
                                        <motion.tr
                                            key={metric.key}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.3, delay: index * 0.05 }}
                                            className="hover:bg-gray-50 transition-colors duration-200"
                                        >
                                            <td className="w-1/4 py-4 px-3">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                                        isError ? 'bg-red-100' : 'bg-green-100'
                                                    }`}>
                                                        <Icon className={`w-3 h-3 ${
                                                            isError ? 'text-red-600' : 'text-green-600'
                                                        }`} />
                                                    </div>
                                                    <span className="font-medium text-gray-900 text-sm truncate">{metric.name}</span>
                                                </div>
                                            </td>
                                            <td className="w-1/6 py-4 px-3">
                                                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                                    isError 
                                                        ? 'bg-red-100 text-red-700' 
                                                        : 'bg-green-100 text-green-700'
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
                                            <td className="w-2/5 py-4 px-3">
                                                <p className={`text-sm leading-relaxed ${isError ? 'text-red-600 font-medium' : 'text-green-600'}`}>
                                                    {metric.data?.Message || 'No issues detected'}
                                                </p>
                                            </td>
                                            <td className="w-1/4 py-4 px-3">
                                                <p className="text-sm text-gray-600 leading-relaxed">
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
                        <div className="text-center py-12 bg-white">
                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Search className="w-8 h-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No metrics found</h3>
                            <p className="text-gray-500">Try adjusting your search or filter criteria</p>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

