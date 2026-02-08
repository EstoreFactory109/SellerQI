import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  DollarSign, AlertCircle, Package, 
  Download, Filter, Search, ChevronDown, ChevronRight,
  FileText, CheckCircle, XCircle, HelpCircle, ExternalLink
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useReimbursementData } from '../hooks/usePageData';
import { PageSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';

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

  // Error state
  if (error) {
    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a1a1a' }}>
          <div className="text-center">
          <AlertCircle className="w-6 h-6 mx-auto mb-2" style={{ color: '#f87171' }} />
          <p className="font-semibold mb-2 text-sm" style={{ color: '#f3f4f6' }}>Error loading reimbursement data</p>
          <p className="text-xs" style={{ color: '#9ca3af' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="w-full" style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: '10px' }}
          >
            <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" style={{ color: '#60a5fa' }} />
                <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>
                  Reimbursement Dashboard
                </h1>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
                  style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                  onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
                  onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filters</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
                  style={{ background: '#10b981', color: 'white' }}
                  onMouseEnter={(e) => e.target.style.background = '#059669'}
                  onMouseLeave={(e) => e.target.style.background = '#10b981'}
                >
                  <Download className="w-3.5 h-3.5" />
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
                  className="mt-2 p-3 rounded-lg"
                  style={{ background: '#161b22', border: '1px solid #30363d' }}
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>Status</label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#30363d'}
                      >
                        <option value="all" style={{ background: '#21262d' }}>All Statuses</option>
                        <option value="approved" style={{ background: '#21262d' }}>Approved</option>
                        <option value="pending" style={{ background: '#21262d' }}>Pending</option>
                        <option value="potential" style={{ background: '#21262d' }}>Potential</option>
                        <option value="denied" style={{ background: '#21262d' }}>Denied</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>Type</label>
                      <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#30363d'}
                      >
                        <option value="all" style={{ background: '#21262d' }}>All Types</option>
                        <option value="lost" style={{ background: '#21262d' }}>Lost</option>
                        <option value="damaged" style={{ background: '#21262d' }}>Damaged</option>
                        <option value="customer_return" style={{ background: '#21262d' }}>Customer Return</option>
                        <option value="inbound_shipment" style={{ background: '#21262d' }}>Inbound Shipment</option>
                        <option value="fee_correction" style={{ background: '#21262d' }}>Fee Correction</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: '#9ca3af' }}>Sort By</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#30363d'}
                      >
                        <option value="date" style={{ background: '#21262d' }}>Date (Newest)</option>
                        <option value="amount" style={{ background: '#21262d' }}>Amount (Highest)</option>
                        <option value="status" style={{ background: '#21262d' }}>Status</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Only data area is skeleton when loading; header above is always real */}
          {loading ? (
            <PageSkeleton statCards={4} sections={2} />
          ) : (
          <>
          {/* Summary Boxes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" style={{ gap: '8px', marginBottom: '10px' }}>
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
                  className="rounded-lg transition-all w-full flex flex-col"
                  style={{ background: '#161b22', border: '1px solid #30363d', padding: '10px' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = '#30363d'}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: '#60a5fa' }} />
                    <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#ffffff' }}>
                      {box.label}
                    </div>
                  </div>
                  <div className="text-[18px] font-bold transition-colors duration-200 truncate" style={{ color: '#ffffff' }}>
                    {box.value}
                  </div>
                  {box.subtitle && (
                    <div className="text-[10px] mt-0.5" style={{ color: '#6b7280' }}>{box.subtitle}</div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Reimbursement Types Tabs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg overflow-hidden"
              style={{ background: '#161b22', border: '1px solid #30363d', marginBottom: '10px' }}
            >
            {/* Tabs Navigation */}
            <div style={{ borderBottom: '1px solid #30363d', background: '#21262d' }}>
              <div className="flex overflow-x-auto">
                <button
                  onClick={() => setActiveTab('shipment')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'shipment'
                      ? 'border-blue-500 bg-[#161b22]'
                      : 'border-transparent'
                  }`}
                  style={activeTab === 'shipment' ? { color: '#60a5fa' } : { color: '#9ca3af' }}
                  onMouseEnter={(e) => {
                    if (activeTab !== 'shipment') {
                      e.target.style.color = '#d1d5db';
                      e.target.style.borderBottomColor = '#30363d';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== 'shipment') {
                      e.target.style.color = '#9ca3af';
                      e.target.style.borderBottomColor = 'transparent';
                    }
                  }}
                >
                  Shipment Discrepancy
                  {summary?.feeProtector?.backendShipmentItems?.data?.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                      {summary.feeProtector.backendShipmentItems.data.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('lost')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'lost'
                      ? 'border-orange-500 bg-[#161b22]'
                      : 'border-transparent'
                  }`}
                  style={activeTab === 'lost' ? { color: '#fb923c' } : { color: '#9ca3af' }}
                  onMouseEnter={(e) => {
                    if (activeTab !== 'lost') {
                      e.target.style.color = '#d1d5db';
                      e.target.style.borderBottomColor = '#30363d';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== 'lost') {
                      e.target.style.color = '#9ca3af';
                      e.target.style.borderBottomColor = 'transparent';
                    }
                  }}
                >
                  Lost Inventory
                  {filteredLostInventoryData.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'rgba(251, 146, 60, 0.2)', color: '#fb923c' }}>
                      {filteredLostInventoryData.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('damaged')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'damaged'
                      ? 'border-red-500 bg-[#161b22]'
                      : 'border-transparent'
                  }`}
                  style={activeTab === 'damaged' ? { color: '#f87171' } : { color: '#9ca3af' }}
                  onMouseEnter={(e) => {
                    if (activeTab !== 'damaged') {
                      e.target.style.color = '#d1d5db';
                      e.target.style.borderBottomColor = '#30363d';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== 'damaged') {
                      e.target.style.color = '#9ca3af';
                      e.target.style.borderBottomColor = 'transparent';
                    }
                  }}
                >
                  Damaged Inventory
                  {filteredDamagedInventoryData.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'rgba(248, 113, 113, 0.2)', color: '#f87171' }}>
                      {filteredDamagedInventoryData.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('disposed')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'disposed'
                      ? 'border-purple-500 bg-[#161b22]'
                      : 'border-transparent'
                  }`}
                  style={activeTab === 'disposed' ? { color: '#c084fc' } : { color: '#9ca3af' }}
                  onMouseEnter={(e) => {
                    if (activeTab !== 'disposed') {
                      e.target.style.color = '#d1d5db';
                      e.target.style.borderBottomColor = '#30363d';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== 'disposed') {
                      e.target.style.color = '#9ca3af';
                      e.target.style.borderBottomColor = 'transparent';
                    }
                  }}
                >
                  Disposed Inventory
                  {filteredDisposedInventoryData.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'rgba(192, 132, 252, 0.2)', color: '#c084fc' }}>
                      {filteredDisposedInventoryData.length}
                    </span>
                  )}
                </button>
                </div>
              </div>

            {/* Tab Content */}
              <div className="p-3">
              {/* Shipment Discrepancy Tab */}
              {activeTab === 'shipment' && (
                      <div>
                  {summary?.feeProtector?.backendShipmentItems?.data?.length > 0 ? (
                    <>
                      <div className="mb-2">
                        <p className="text-xs" style={{ color: '#9ca3af' }}>
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
                        <thead style={{ background: '#21262d' }}>
                          <tr>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Date</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Shipment ID</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Shipment Name</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>ASIN</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>SKU</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Shipped</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Received</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Discrepancy</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.feeProtector.backendShipmentItems.data.map((item, index) => (
                            <tr key={index} className="transition-colors" style={{ borderBottom: '1px solid #30363d' }} onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatDate(item.date)}</td>
                              <td className="px-2 py-2 text-[11px] font-mono break-words align-top" style={{ color: '#f3f4f6' }}>{item.shipmentId || 'N/A'}</td>
                              <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.shipmentName || 'N/A'}</td>
                              <td className="px-2 py-2 text-[11px] font-mono break-words align-top" style={{ color: '#f3f4f6' }}>{item.asin || 'N/A'}</td>
                              <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.sku || 'N/A'}</td>
                              <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{item.quantityShipped || 0}</td>
                              <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{item.quantityReceived || 0}</td>
                              <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f87171' }}>{item.discrepancyUnits || 0}</td>
                              <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.expectedAmount || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  ) : (
                    <div className="text-center py-8" style={{ color: '#9ca3af', fontSize: '12px' }}>
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
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs" style={{ color: '#9ca3af' }}>
                          {filteredLostInventoryData.length} items (last 30 days) • {formatCurrency(lostInventoryTotal)} total
                          {filteredLostInventoryData.filter(item => item.isUnderpaid).length > 0 && (
                            <span className="ml-2 font-medium" style={{ color: '#fb923c' }}>
                              • {filteredLostInventoryData.filter(item => item.isUnderpaid).length} underpaid
                            </span>
                          )}
                        </p>
                        <button
                          onClick={() => setShowUnderpaidOnly(!showUnderpaidOnly)}
                          className="px-2 py-1 text-[10px] font-medium rounded border transition-all"
                          style={showUnderpaidOnly ? { background: 'rgba(251, 146, 60, 0.2)', borderColor: 'rgba(251, 146, 60, 0.3)', color: '#fb923c' } : { background: '#1a1a1a', borderColor: '#30363d', color: '#f3f4f6' }}
                          onMouseEnter={(e) => !showUnderpaidOnly && (e.target.style.borderColor = '#3b82f6')}
                          onMouseLeave={(e) => !showUnderpaidOnly && (e.target.style.borderColor = '#30363d')}
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
                        <thead style={{ background: '#21262d' }}>
                          <tr>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Month</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>ASIN</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>SKU</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Lost</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Found</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Reimbursed</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Discrepancy</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Expected Amount</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                            {filteredLostInventoryData
                              .filter(item => !showUnderpaidOnly || item.isUnderpaid)
                              .map((item, index) => (
                              <tr key={index} className="transition-colors" style={{ borderBottom: '1px solid #30363d', background: item.isUnderpaid ? 'rgba(251, 146, 60, 0.1)' : 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = item.isUnderpaid ? 'rgba(251, 146, 60, 0.15)' : '#21262d'} onMouseLeave={(e) => e.currentTarget.style.background = item.isUnderpaid ? 'rgba(251, 146, 60, 0.1)' : 'transparent'}>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatMonthName(item.date)}</td>
                                <td className="px-2 py-2 text-[11px] font-mono break-words align-top" style={{ color: '#f3f4f6' }}>{item.asin || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.sku || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{item.lostUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{item.foundUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{item.reimbursedUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f87171' }}>{item.discrepancyUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f3f4f6' }}>
                                  {item.isUnderpaid && item.underpaidExpectedAmount ? (
                                    <div>
                                      <div>{formatCurrency(item.expectedAmount || 0)}</div>
                                      <div className="text-[10px] font-medium" style={{ color: '#fb923c' }}>Underpaid: {formatCurrency(item.underpaidExpectedAmount)}</div>
                                    </div>
                                  ) : (
                                    formatCurrency(item.expectedAmount || 0)
                                  )}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  {item.isUnderpaid ? (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(251, 146, 60, 0.2)', color: '#fb923c' }}>
                                      Underpaid
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af' }}>
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
                    <div className="text-center py-8" style={{ color: '#9ca3af', fontSize: '12px' }}>
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
                      <div className="mb-2">
                        <p className="text-xs" style={{ color: '#9ca3af' }}>
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
                        <thead style={{ background: '#21262d' }}>
                          <tr>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Date</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>ASIN</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>SKU</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>FNSKU</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Damaged Units</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Sales Price</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Fees</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Reimbursement/Unit</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                            {filteredDamagedInventoryData.map((item, index) => (
                              <tr key={index} className="transition-colors" style={{ borderBottom: '1px solid #30363d' }} onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatDate(item.date)}</td>
                                <td className="px-2 py-2 text-[11px] font-mono break-words align-top" style={{ color: '#f3f4f6' }}>{item.asin || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.sku || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.fnsku || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f87171' }}>{item.damagedUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.fees || 0)}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.expectedAmount || 0)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8" style={{ color: '#9ca3af', fontSize: '12px' }}>
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
                      <div className="mb-2">
                        <p className="text-xs" style={{ color: '#9ca3af' }}>
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
                <thead style={{ background: '#21262d' }}>
                  <tr>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Date</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>ASIN</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>SKU</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>FNSKU</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Disposed Units</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Sales Price</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Fees</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Reimbursement/Unit</th>
                              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Expected Amount</th>
                  </tr>
                </thead>
                <tbody>
                            {filteredDisposedInventoryData.map((item, index) => (
                      <tr key={index} className="transition-colors" style={{ borderBottom: '1px solid #30363d' }} onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatDate(item.date)}</td>
                                <td className="px-2 py-2 text-[11px] font-mono break-words align-top" style={{ color: '#f3f4f6' }}>{item.asin || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.sku || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] break-words align-top" style={{ color: '#f3f4f6' }}>{item.fnsku || 'N/A'}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f87171' }}>{item.disposedUnits || 0}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.fees || 0)}</td>
                                <td className="px-2 py-2 text-[11px] align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-2 py-2 text-[11px] font-semibold align-top" style={{ color: '#f3f4f6' }}>{formatCurrency(item.expectedAmount || 0)}</td>
                      </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8" style={{ color: '#9ca3af', fontSize: '12px' }}>
                      No disposed inventory data found
                    </div>
                  )}
                </div>
              )}

            </div>
          </motion.div>
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReimbursementDashboard;

