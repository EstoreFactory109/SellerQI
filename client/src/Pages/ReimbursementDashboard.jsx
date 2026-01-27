import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  DollarSign, AlertCircle, Package, 
  Download, Filter, Search, ChevronDown, ChevronRight,
  FileText, CheckCircle, XCircle, HelpCircle, ExternalLink
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useReimbursementData } from '../hooks/usePageData';

const ReimbursementDashboard = () => {
  const currency = useSelector(state => state.currency?.currency) || '$';
  
  // Use Redux hook to fetch and get reimbursement data
  const { data, loading, error } = useReimbursementData(true);
  
  // Extract summary and reimbursements from Redux data
  const summary = data?.summary || null;
  const reimbursements = Array.isArray(data?.reimbursements) ? data.reimbursements : [];
  
  // Filter state
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [showFilters, setShowFilters] = useState(false);
  const [showUnderpaidOnly, setShowUnderpaidOnly] = useState(false);

  // Tab state for reimbursement types
  const [activeTab, setActiveTab] = useState('shipment');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Scroll to top when component mounts to prevent content going under nav bar
  useEffect(() => {
    // Find the scrollable container (MainPagesLayout's overflow-y-auto div)
    const scrollContainer = document.querySelector('section.flex-1.overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
    // Also try the scrollbar-hide class as fallback
    const altContainer = document.querySelector('.scrollbar-hide');
    if (altContainer) {
      altContainer.scrollTop = 0;
    }
    // Fallback: scroll window to top
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Format currency
  const formatCurrency = (value) => {
    if (!value) return `${currency}0.00`;
    return `${currency}${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Format MM/YYYY date as month name (e.g., "12/2025" -> "December 2025")
  const formatMonthName = (dateValue) => {
    if (!dateValue || dateValue === 'N/A' || dateValue === '') {
      return 'N/A';
    }

    // Check if it's MM/YYYY format (e.g., "12/2025" or "01/2026")
    const mmYYYYMatch = dateValue.match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYYYYMatch) {
      const month = parseInt(mmYYYYMatch[1], 10);
      const year = parseInt(mmYYYYMatch[2], 10);
      
      // Create a date object for the first day of that month
      const date = new Date(year, month - 1, 1);
      
      // Format as "Month Year" (e.g., "December 2025")
      return date.toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
      });
    }

    // For other date formats, try to parse and format as month name
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) {
        return dateValue; // Return original if parsing fails
      }
      return date.toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
      });
    } catch {
      return dateValue; // Return original if error
    }
  };

  /**
   * Check if a date is within the last 30 days
   * Handles multiple date formats:
   * - MM/YYYY format (e.g., "12/2025") - checks if month is within last 30 days
   * - YYYY-MM-DD format (e.g., "2025-12-15")
   * - ISO format (e.g., "2025-12-15T00:00:00.000Z")
   * - Empty/null dates - returns true (include items without dates)
   */
  const isWithinLast30Days = (dateValue) => {
    if (!dateValue || dateValue === 'N/A' || dateValue === '') {
      // If no date, include the item (don't filter out)
      return true;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Check if it's MM/YYYY format (e.g., "12/2025" or "01/2026")
    const mmYYYYMatch = dateValue.match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYYYYMatch) {
      const month = parseInt(mmYYYYMatch[1], 10);
      const year = parseInt(mmYYYYMatch[2], 10);
      
      // Create date for the first day of that month
      const itemDate = new Date(year, month - 1, 1);
      // Create date for the last day of that month
      const lastDayOfMonth = new Date(year, month, 0);
      
      // Check if the month overlaps with the last 30 days
      // The month is within range if its last day is >= thirtyDaysAgo AND first day is <= now
      return lastDayOfMonth >= thirtyDaysAgo && itemDate <= now;
    }

    // For other date formats (YYYY-MM-DD, ISO, etc.), try to parse directly
    try {
      const itemDate = new Date(dateValue);
      if (isNaN(itemDate.getTime())) {
        // Invalid date, include the item
        return true;
      }
      return itemDate >= thirtyDaysAgo && itemDate <= now;
    } catch {
      // If parsing fails, include the item
      return true;
    }
  };

  /**
   * Filter data array to only include items from the last 30 days
   * @param {Array} data - Array of items with date field
   * @param {string} dateField - Name of the date field (default: 'date')
   * @returns {Array} Filtered array
   */
  const filterLast30Days = (data, dateField = 'date') => {
    if (!Array.isArray(data)) return [];
    return data.filter(item => isWithinLast30Days(item[dateField]));
  };

  // Export to CSV - includes summary totals and all table data
  const exportToCSV = () => {
    const csvRows = [];

    // Calculate totals for summary boxes
    const shipmentTotal = summary?.feeProtector?.backendShipmentItems?.totalExpectedAmount || 0;
    const lostInventoryTotal = summary?.backendLostInventory?.totalExpectedAmount || 0;
    const damagedInventoryTotal = summary?.backendDamagedInventory?.totalExpectedAmount || 0;
    const disposedInventoryTotal = summary?.backendDisposedInventory?.totalExpectedAmount || 0;
    const totalReimbursement = shipmentTotal + lostInventoryTotal + damagedInventoryTotal + disposedInventoryTotal;

    // Add Summary Section
    csvRows.push('REIMBURSEMENT SUMMARY');
    csvRows.push('');
    csvRows.push('Category,Total Amount');
    csvRows.push(`Total Reimbursement,${totalReimbursement.toFixed(2)}`);
    csvRows.push(`Shipment Discrepancy,${shipmentTotal.toFixed(2)}`);
    csvRows.push(`Lost Inventory,${lostInventoryTotal.toFixed(2)}`);
    csvRows.push(`Damaged Inventory,${damagedInventoryTotal.toFixed(2)}`);
    csvRows.push(`Disposed Inventory,${disposedInventoryTotal.toFixed(2)}`);
    csvRows.push('');
    csvRows.push('');

    // Shipment Discrepancy Data
    const shipmentData = summary?.feeProtector?.backendShipmentItems?.data || [];
    if (shipmentData.length > 0) {
      csvRows.push('SHIPMENT DISCREPANCY DETAILS');
      csvRows.push('Date,Shipment ID,Shipment Name,ASIN,SKU,Shipped,Received,Discrepancy,Expected Amount');
      shipmentData.forEach(item => {
        csvRows.push([
          formatDate(item.date),
          `"${(item.shipmentId || '').replace(/"/g, '""')}"`,
          `"${(item.shipmentName || '').replace(/"/g, '""')}"`,
          item.asin || '',
          `"${(item.sku || '').replace(/"/g, '""')}"`,
          item.quantityShipped || 0,
          item.quantityReceived || 0,
          item.discrepancyUnits || 0,
          (item.expectedAmount || 0).toFixed(2)
        ].join(','));
      });
      csvRows.push('');
      csvRows.push('');
    }

    // Lost Inventory Data
    const lostData = summary?.backendLostInventory?.data || [];
    if (lostData.length > 0) {
      csvRows.push('LOST INVENTORY DETAILS');
      csvRows.push('Month,ASIN,SKU,FNSKU,Lost Units,Found Units,Reimbursed Units,Discrepancy Units,Expected Amount,Underpaid Amount,Status');
      lostData.forEach(item => {
        csvRows.push([
          formatMonthName(item.date),
          item.asin || '',
          `"${(item.sku || '').replace(/"/g, '""')}"`,
          item.fnsku || '',
          item.lostUnits || 0,
          item.foundUnits || 0,
          item.reimbursedUnits || 0,
          item.discrepancyUnits || 0,
          (item.expectedAmount || 0).toFixed(2),
          (item.underpaidExpectedAmount || 0).toFixed(2),
          item.isUnderpaid ? 'Underpaid' : 'Normal'
        ].join(','));
      });
      csvRows.push('');
      csvRows.push('');
    }

    // Damaged Inventory Data
    const damagedData = summary?.backendDamagedInventory?.data || [];
    if (damagedData.length > 0) {
      csvRows.push('DAMAGED INVENTORY DETAILS');
      csvRows.push('Date,ASIN,SKU,FNSKU,Damaged Units,Sales Price,Fees,Reimbursement Per Unit,Expected Amount');
      damagedData.forEach(item => {
        csvRows.push([
          formatDate(item.date),
          item.asin || '',
          `"${(item.sku || '').replace(/"/g, '""')}"`,
          item.fnsku || '',
          item.damagedUnits || 0,
          (item.salesPrice || 0).toFixed(2),
          (item.fees || 0).toFixed(2),
          (item.reimbursementPerUnit || 0).toFixed(2),
          (item.expectedAmount || 0).toFixed(2)
        ].join(','));
      });
      csvRows.push('');
      csvRows.push('');
    }

    // Disposed Inventory Data
    const disposedData = summary?.backendDisposedInventory?.data || [];
    if (disposedData.length > 0) {
      csvRows.push('DISPOSED INVENTORY DETAILS');
      csvRows.push('Date,ASIN,SKU,FNSKU,Disposed Units,Sales Price,Fees,Reimbursement Per Unit,Expected Amount');
      disposedData.forEach(item => {
        csvRows.push([
          formatDate(item.date),
          item.asin || '',
          `"${(item.sku || '').replace(/"/g, '""')}"`,
          item.fnsku || '',
          item.disposedUnits || 0,
          (item.salesPrice || 0).toFixed(2),
          (item.fees || 0).toFixed(2),
          (item.reimbursementPerUnit || 0).toFixed(2),
          (item.expectedAmount || 0).toFixed(2)
        ].join(','));
      });
      csvRows.push('');
      csvRows.push('');
    }

    // Check if there's any data to export
    if (csvRows.length <= 10) { // Only summary headers and empty rows
      alert('No data available to export');
      return;
    }

    // Create CSV content
    const csvContent = csvRows.join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `reimbursement-dashboard-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter and sort reimbursements
  const filteredReimbursements = useMemo(() => {
    let filtered = [...reimbursements];

    // Filter by status
    if (filterStatus !== 'all') {
      filtered = filtered.filter(r => r.status === filterStatus.toUpperCase());
    }

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter(r => r.reimbursementType === filterType.toUpperCase());
    }

    // Search
    if (searchTerm) {
      filtered = filtered.filter(r => 
        r.asin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.reimbursementId?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.reimbursementDate || b.discoveryDate) - new Date(a.reimbursementDate || a.discoveryDate);
        case 'amount':
          return (b.amount || 0) - (a.amount || 0);
        case 'status':
          return (a.status || '').localeCompare(b.status || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [reimbursements, filterStatus, filterType, searchTerm, sortBy]);

  // Paginate
  const paginatedReimbursements = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredReimbursements.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredReimbursements, currentPage]);

  const totalPages = Math.ceil(filteredReimbursements.length / itemsPerPage);

  // Filter inventory data to last 30 days for display in tables
  // Also exclude negative expected amounts (as per Refunds system)
  // Note: Shipment data is NOT filtered (as requested)
  const filteredLostInventoryData = useMemo(() => {
    const rawData = summary?.backendLostInventory?.data || [];
    const dateFiltered = filterLast30Days(rawData, 'date');
    // Exclude negative or zero expected amounts (matching Refunds system behavior)
    return dateFiltered.filter(item => (item.expectedAmount || 0) > 0);
  }, [summary?.backendLostInventory?.data]);

  const filteredDamagedInventoryData = useMemo(() => {
    const rawData = summary?.backendDamagedInventory?.data || [];
    const dateFiltered = filterLast30Days(rawData, 'date');
    // Exclude negative or zero expected amounts (matching Refunds system behavior)
    return dateFiltered.filter(item => (item.expectedAmount || 0) > 0);
  }, [summary?.backendDamagedInventory?.data]);

  const filteredDisposedInventoryData = useMemo(() => {
    const rawData = summary?.backendDisposedInventory?.data || [];
    const dateFiltered = filterLast30Days(rawData, 'date');
    // Exclude negative or zero expected amounts (matching Refunds system behavior)
    return dateFiltered.filter(item => (item.expectedAmount || 0) > 0);
  }, [summary?.backendDisposedInventory?.data]);


  // Calculate totals for each reimbursement type
  // Shipment: Use backend all-time total (no filtering)
  const shipmentTotal = summary?.feeProtector?.backendShipmentItems?.totalExpectedAmount || 0;
  
  // Lost, Damaged, Disposed: Calculate from filtered data (last 30 days only)
  const lostInventoryTotal = useMemo(() => {
    return filteredLostInventoryData.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
  }, [filteredLostInventoryData]);

  const damagedInventoryTotal = useMemo(() => {
    return filteredDamagedInventoryData.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
  }, [filteredDamagedInventoryData]);

  const disposedInventoryTotal = useMemo(() => {
    return filteredDisposedInventoryData.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
  }, [filteredDisposedInventoryData]);
  
  // Calculate total reimbursement (sum of all types)
  const totalReimbursement = shipmentTotal + lostInventoryTotal + damagedInventoryTotal + disposedInventoryTotal;

  // Summary boxes data - One for total and one for each type
  const summaryBoxes = [
    {
      label: 'Total Reimbursement',
      value: formatCurrency(totalReimbursement),
      icon: DollarSign,
      color: 'emerald',
      subtitle: 'Sum of all types'
    },
    {
      label: 'Shipment Discrepancy',
      value: formatCurrency(shipmentTotal),
      icon: Package,
      color: 'blue',
      subtitle: 'Shipment items'
    },
    {
      label: 'Lost Inventory',
      value: formatCurrency(lostInventoryTotal),
      icon: AlertCircle,
      color: 'orange',
      subtitle: 'Lost items'
    },
    {
      label: 'Damaged Inventory',
      value: formatCurrency(damagedInventoryTotal),
      icon: AlertCircle,
      color: 'red',
      subtitle: 'Damaged items'
    },
    {
      label: 'Disposed Inventory',
      value: formatCurrency(disposedInventoryTotal),
      icon: Package,
      color: 'purple',
      subtitle: 'Disposed items'
    }
  ];


  // Status badge component
  const StatusBadge = ({ status }) => {
    const configs = {
      APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Approved' },
      PENDING: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Pending' },
      POTENTIAL: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Potential' },
      DENIED: { bg: 'bg-red-100', text: 'text-red-800', label: 'Denied' },
      EXPIRED: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Expired' }
    };

    const config = configs[status] || configs.POTENTIAL;

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading reimbursement data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-900 font-semibold mb-2">Error loading reimbursement data</p>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-100">
      <div className="w-full">
        <div className="p-6 lg:p-8 pt-6 lg:pt-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                    <DollarSign className="w-5 h-5 text-white" />
                  </div>
                  <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
                    Reimbursement Dashboard
                  </h1>
                </div>
                <p className="text-sm text-gray-600 ml-13">
                  Track Amazon FBA reimbursements and potential claims
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:border-gray-400 rounded-lg transition-all text-sm font-medium"
                >
                  <Filter className="w-4 h-4" />
                  <span>Filters</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Filters Panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-4 bg-white rounded-lg border border-gray-200"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      >
                        <option value="all">All Statuses</option>
                        <option value="approved">Approved</option>
                        <option value="pending">Pending</option>
                        <option value="potential">Potential</option>
                        <option value="denied">Denied</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                      <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      >
                        <option value="all">All Types</option>
                        <option value="lost">Lost</option>
                        <option value="damaged">Damaged</option>
                        <option value="customer_return">Customer Return</option>
                        <option value="inbound_shipment">Inbound Shipment</option>
                        <option value="fee_correction">Fee Correction</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      >
                        <option value="date">Date (Newest)</option>
                        <option value="amount">Amount (Highest)</option>
                        <option value="status">Status</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Summary Boxes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
            {summaryBoxes.map((box, index) => {
              const Icon = box.icon;
              const colorClasses = {
                emerald: 'from-emerald-500 to-emerald-600',
                blue: 'from-blue-500 to-blue-600',
                orange: 'from-orange-500 to-orange-600',
                red: 'from-red-500 to-red-600',
                purple: 'from-purple-500 to-purple-600',
                indigo: 'from-indigo-500 to-indigo-600'
              };

              return (
                <motion.div
                  key={box.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-lg transition-all w-full"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 bg-gradient-to-br ${colorClasses[box.color]} rounded-lg flex items-center justify-center`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mb-1">
                    {box.value}
                  </div>
                  <div className="text-sm text-gray-600">{box.label}</div>
                  {box.subtitle && (
                    <div className="text-xs text-gray-500 mt-1">{box.subtitle}</div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Reimbursement Types Tabs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8"
            >
            {/* Tabs Navigation */}
            <div className="border-b border-gray-200 bg-gray-50">
              <div className="flex overflow-x-auto">
                <button
                  onClick={() => setActiveTab('shipment')}
                  className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'shipment'
                      ? 'border-blue-500 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Shipment Discrepancy
                  {summary?.feeProtector?.backendShipmentItems?.data?.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-600 rounded-full">
                      {summary.feeProtector.backendShipmentItems.data.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('lost')}
                  className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'lost'
                      ? 'border-orange-500 text-orange-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Lost Inventory
                  {filteredLostInventoryData.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-orange-100 text-orange-600 rounded-full">
                      {filteredLostInventoryData.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('damaged')}
                  className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'damaged'
                      ? 'border-red-500 text-red-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Damaged Inventory
                  {filteredDamagedInventoryData.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">
                      {filteredDamagedInventoryData.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('disposed')}
                  className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'disposed'
                      ? 'border-purple-500 text-purple-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Disposed Inventory
                  {filteredDisposedInventoryData.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-purple-100 text-purple-600 rounded-full">
                      {filteredDisposedInventoryData.length}
                    </span>
                  )}
                </button>
                </div>
              </div>

            {/* Tab Content */}
              <div className="p-6">
              {/* Shipment Discrepancy Tab */}
              {activeTab === 'shipment' && (
                      <div>
                  {summary?.feeProtector?.backendShipmentItems?.data?.length > 0 ? (
                    <>
                      <div className="mb-4">
                        <p className="text-sm text-gray-600">
                          {summary.feeProtector.backendShipmentItems.count || summary.feeProtector.backendShipmentItems.data.length} items • {formatCurrency(summary.feeProtector.backendShipmentItems.totalExpectedAmount)} total
                        </p>
                    </div>
                    <div className="w-full overflow-x-auto">
                      <table className="w-full table-fixed" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '15%' }} />
                          <col style={{ width: '15%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '12%' }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shipment ID</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shipment Name</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ASIN</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shipped</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Received</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Discrepancy</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {summary.feeProtector.backendShipmentItems.data.map((item, index) => (
                            <tr key={index} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatDate(item.date)}</td>
                              <td className="px-4 py-3 text-sm font-mono text-gray-900 break-words align-top">{item.shipmentId || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.shipmentName || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm font-mono text-gray-900 break-words align-top">{item.asin || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.sku || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 align-top">{item.quantityShipped || 0}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 align-top">{item.quantityReceived || 0}</td>
                              <td className="px-4 py-3 text-sm font-semibold text-red-600 align-top">{item.discrepancyUnits || 0}</td>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-900 align-top">{formatCurrency(item.expectedAmount || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      No shipment discrepancy data found
                    </div>
                  )}
                  </div>
                )}

              {/* Lost Inventory Tab */}
              {activeTab === 'lost' && (
                  <div>
                  {filteredLostInventoryData.length > 0 ? (
                    <>
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-gray-600">
                          {filteredLostInventoryData.length} items (last 30 days) • {formatCurrency(lostInventoryTotal)} total
                          {filteredLostInventoryData.filter(item => item.isUnderpaid).length > 0 && (
                            <span className="ml-2 text-orange-600 font-medium">
                              • {filteredLostInventoryData.filter(item => item.isUnderpaid).length} underpaid
                            </span>
                          )}
                        </p>
                        <button
                          onClick={() => setShowUnderpaidOnly(!showUnderpaidOnly)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                            showUnderpaidOnly
                              ? 'bg-orange-100 border-orange-300 text-orange-700'
                              : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {showUnderpaidOnly ? 'Show All' : 'Show Underpaid Only'}
                        </button>
                    </div>
                    <div className="w-full overflow-x-auto">
                      <table className="w-full table-fixed" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '13%' }} />
                          <col style={{ width: '15%' }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Month</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ASIN</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lost</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Found</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reimbursed</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Discrepancy</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Amount</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredLostInventoryData
                              .filter(item => !showUnderpaidOnly || item.isUnderpaid)
                              .map((item, index) => (
                              <tr key={index} className={`hover:bg-gray-50 transition-colors ${item.isUnderpaid ? 'bg-orange-50' : ''}`}>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatMonthName(item.date)}</td>
                                <td className="px-4 py-3 text-sm font-mono text-gray-900 break-words align-top">{item.asin || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.sku || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{item.lostUnits || 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{item.foundUnits || 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{item.reimbursedUnits || 0}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-red-600 align-top">{item.discrepancyUnits || 0}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 align-top">
                                  {item.isUnderpaid && item.underpaidExpectedAmount ? (
                                    <div>
                                      <div className="text-gray-900">{formatCurrency(item.expectedAmount || 0)}</div>
                                      <div className="text-xs text-orange-600 font-medium">Underpaid: {formatCurrency(item.underpaidExpectedAmount)}</div>
                                    </div>
                                  ) : (
                                    formatCurrency(item.expectedAmount || 0)
                                  )}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  {item.isUnderpaid ? (
                                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                      Underpaid
                                    </span>
                                  ) : (
                                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                      Normal
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      No lost inventory data found
                    </div>
                  )}
                </div>
              )}

              {/* Damaged Inventory Tab */}
              {activeTab === 'damaged' && (
                  <div>
                  {filteredDamagedInventoryData.length > 0 ? (
                    <>
                      <div className="mb-4">
                        <p className="text-sm text-gray-600">
                          {filteredDamagedInventoryData.length} items (last 30 days) • {formatCurrency(damagedInventoryTotal)} total
                        </p>
                    </div>
                    <div className="w-full overflow-x-auto">
                      <table className="w-full table-fixed" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '11%' }} />
                          <col style={{ width: '11%' }} />
                          <col style={{ width: '11%' }} />
                          <col style={{ width: '11%' }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ASIN</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FNSKU</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Damaged Units</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales Price</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fees</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reimbursement/Unit</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredDamagedInventoryData.map((item, index) => (
                              <tr key={index} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatDate(item.date)}</td>
                                <td className="px-4 py-3 text-sm font-mono text-gray-900 break-words align-top">{item.asin || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.sku || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.fnsku || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-red-600 align-top">{item.damagedUnits || 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.fees || 0)}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 align-top">{formatCurrency(item.expectedAmount || 0)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      No damaged inventory data found
                    </div>
                  )}
                </div>
              )}

              {/* Disposed Inventory Tab */}
              {activeTab === 'disposed' && (
                <div>
                  {filteredDisposedInventoryData.length > 0 ? (
                    <>
                      <div className="mb-4">
                        <p className="text-sm text-gray-600">
                          {filteredDisposedInventoryData.length} items (last 30 days) • {formatCurrency(disposedInventoryTotal)} total
                        </p>
            </div>
            <div className="w-full overflow-x-auto">
              <table className="w-full table-fixed" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ASIN</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FNSKU</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Disposed Units</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales Price</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fees</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reimbursement/Unit</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                            {filteredDisposedInventoryData.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatDate(item.date)}</td>
                                <td className="px-4 py-3 text-sm font-mono text-gray-900 break-words align-top">{item.asin || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.sku || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 break-words align-top">{item.fnsku || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-red-600 align-top">{item.disposedUnits || 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.fees || 0)}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 align-top">{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 align-top">{formatCurrency(item.expectedAmount || 0)}</td>
                      </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      No disposed inventory data found
                    </div>
                  )}
                </div>
              )}

            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ReimbursementDashboard;

