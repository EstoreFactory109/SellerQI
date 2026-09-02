import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  DollarSign, AlertCircle, Package, 
  Download, Filter, Search, ChevronDown, ChevronRight,
  FileText, CheckCircle, XCircle, HelpCircle, ExternalLink
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useReimbursementData } from '../../hooks/usePageData';
import { PageSkeleton } from '../../Components/Skeleton/PageSkeletons.jsx';
import { COLORS } from '../../Components/Shared/index.js';

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
  const tabsSectionRef = useRef(null);

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

  // Real case/unit counts for KPI captions (no fabricated numbers)
  const shipmentCount = summary?.feeProtector?.backendShipmentItems?.data?.length || 0;
  const lostCount = filteredLostInventoryData.length;
  const damagedCount = filteredDamagedInventoryData.length;
  const disposedCount = filteredDisposedInventoryData.length;
  const totalCases = shipmentCount + lostCount + damagedCount + disposedCount;
  const lostUnitsTotal = useMemo(() => filteredLostInventoryData.reduce((sum, item) => sum + (item.lostUnits || 0), 0), [filteredLostInventoryData]);
  const damagedUnitsTotal = useMemo(() => filteredDamagedInventoryData.reduce((sum, item) => sum + (item.damagedUnits || 0), 0), [filteredDamagedInventoryData]);
  const disposedUnitsTotal = useMemo(() => filteredDisposedInventoryData.reduce((sum, item) => sum + (item.disposedUnits || 0), 0), [filteredDisposedInventoryData]);

  // Summary boxes data - One hero total + one per type
  const summaryBoxes = [
    {
      label: 'Total Reimbursement',
      value: formatCurrency(totalReimbursement),
      icon: DollarSign,
      hero: true,
      subtitle: `${totalCases} case${totalCases === 1 ? '' : 's'} · estimated until Amazon confirms`
    },
    {
      label: 'Shipment Discrepancy',
      value: formatCurrency(shipmentTotal),
      icon: Package,
      subtitle: `${shipmentCount} shipment${shipmentCount === 1 ? '' : 's'}`
    },
    {
      label: 'Lost Inventory',
      value: formatCurrency(lostInventoryTotal),
      icon: AlertCircle,
      subtitle: `${lostUnitsTotal} unit${lostUnitsTotal === 1 ? '' : 's'}`
    },
    {
      label: 'Damaged Inventory',
      value: formatCurrency(damagedInventoryTotal),
      icon: AlertCircle,
      subtitle: `${damagedUnitsTotal} unit${damagedUnitsTotal === 1 ? '' : 's'}`
    },
    {
      label: 'Disposed Inventory',
      value: formatCurrency(disposedInventoryTotal),
      icon: Package,
      subtitle: `${disposedUnitsTotal} unit${disposedUnitsTotal === 1 ? '' : 's'}`
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
    <div className="min-h-screen" style={{ background: COLORS.bgBase, padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="w-full" style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: '10px' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div className="flex items-center gap-2.5">
                <DollarSign className="w-5 h-5" style={{ color: COLORS.good }} />
                <div>
                  <h1 style={{ margin: '0 0 4px', fontSize: '24px', lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.02em', color: COLORS.textPrimary }}>
                    Reimbursement
                  </h1>
                  <p style={{ margin: 0, fontSize: '14px', color: COLORS.textSecondary }}>Money Amazon may owe you from the last 18 months. You still have to file each claim.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
                  style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
                  onMouseEnter={(e) => e.target.style.borderColor = COLORS.accent}
                  onMouseLeave={(e) => e.target.style.borderColor = COLORS.border}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filters</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
                  style={{ background: COLORS.accent, color: '#061021' }}
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
                  style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: COLORS.textSecondary }}>Status</label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
                        onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                        onBlur={(e) => e.target.style.borderColor = COLORS.border}
                      >
                        <option value="all" style={{ background: COLORS.surfaceElevated }}>All Statuses</option>
                        <option value="approved" style={{ background: COLORS.surfaceElevated }}>Approved</option>
                        <option value="pending" style={{ background: COLORS.surfaceElevated }}>Pending</option>
                        <option value="potential" style={{ background: COLORS.surfaceElevated }}>Potential</option>
                        <option value="denied" style={{ background: COLORS.surfaceElevated }}>Denied</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: COLORS.textSecondary }}>Type</label>
                      <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
                        onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                        onBlur={(e) => e.target.style.borderColor = COLORS.border}
                      >
                        <option value="all" style={{ background: COLORS.surfaceElevated }}>All Types</option>
                        <option value="lost" style={{ background: COLORS.surfaceElevated }}>Lost</option>
                        <option value="damaged" style={{ background: COLORS.surfaceElevated }}>Damaged</option>
                        <option value="customer_return" style={{ background: COLORS.surfaceElevated }}>Customer Return</option>
                        <option value="inbound_shipment" style={{ background: COLORS.surfaceElevated }}>Inbound Shipment</option>
                        <option value="fee_correction" style={{ background: COLORS.surfaceElevated }}>Fee Correction</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: COLORS.textSecondary }}>Sort By</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
                        onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                        onBlur={(e) => e.target.style.borderColor = COLORS.border}
                      >
                        <option value="date" style={{ background: COLORS.surfaceElevated }}>Date (Newest)</option>
                        <option value="amount" style={{ background: COLORS.surfaceElevated }}>Amount (Highest)</option>
                        <option value="status" style={{ background: COLORS.surfaceElevated }}>Status</option>
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
          {/* Summary Boxes — hero "Total Reimbursement" card (wider, green-tinted) + 4 standard cards */}
          <div className="grid" style={{ gridTemplateColumns: '1.35fr repeat(4, minmax(0, 1fr))', gap: '12px', marginBottom: '10px' }}>
            {summaryBoxes.map((box, index) => {
              const Icon = box.icon;

              return (
                <motion.div
                  key={box.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="rounded-xl transition-all w-full flex flex-col"
                  style={box.hero ? {
                    background: `linear-gradient(140deg, rgba(34,197,94,.10), transparent 65%), ${COLORS.surface}`,
                    border: '1px solid rgba(34,197,94,.28)',
                    padding: '12px 16px',
                  } : {
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`, padding: '10px 14px',
                  }}
                  onMouseEnter={(e) => { if (!box.hero) e.currentTarget.style.borderColor = COLORS.accent; }}
                  onMouseLeave={(e) => { if (!box.hero) e.currentTarget.style.borderColor = COLORS.border; }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.textMuted }} />
                    <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textSecondary }}>
                      {box.label}
                    </div>
                  </div>
                  <div className={`font-bold transition-colors duration-200 truncate ${box.hero ? 'text-[28px]' : 'text-[19px]'}`} style={{ color: box.hero ? COLORS.good : COLORS.textPrimary }}>
                    {box.value}
                  </div>
                  {box.subtitle && (
                    <div className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>{box.subtitle}</div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Action banner — real total, only shown when there's something to file */}
          {totalReimbursement > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '10px' }}>
              <div className="relative overflow-hidden flex items-center gap-5 flex-wrap" style={{ border: '1px solid rgba(34,197,94,.25)', borderRadius: '13px', background: COLORS.surface, padding: '16px 20px 16px 22px' }}>
                <div className="absolute left-0 top-0 bottom-0" style={{ width: '3px', background: COLORS.good }} />
                <div style={{ flex: 1 }} className="min-w-0">
                  <div className="text-[15px] font-semibold" style={{ color: COLORS.textPrimary, marginBottom: '4px' }}>
                    You may be owed {formatCurrency(totalReimbursement)} — here&rsquo;s how to file
                  </div>
                  <p className="text-[13px]" style={{ color: COLORS.textSecondary, margin: 0, maxWidth: '86ch' }}>
                    Each case needs a separate case in Seller Central with the shipment or order ID. Cases older than 18 months are no longer eligible.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => tabsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex-shrink-0 rounded-lg text-[13px] font-semibold transition-colors"
                  style={{ padding: '10px 16px', background: COLORS.accent, color: '#061021' }}
                >
                  View cases
                </button>
              </div>
            </motion.div>
          )}

          {/* Reimbursement Types Tabs — sits directly on the page, no card wrapper (matches mock) */}
            <motion.div
              ref={tabsSectionRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ marginBottom: '10px' }}
            >
              <div className="flex overflow-x-auto" style={{ gap: '6px', borderBottom: `1px solid ${COLORS.border}` }}>
                {[
                  { id: 'shipment', label: 'Shipment Discrepancy', count: summary?.feeProtector?.backendShipmentItems?.data?.length || 0 },
                  { id: 'lost', label: 'Lost Inventory', count: filteredLostInventoryData.length },
                  { id: 'damaged', label: 'Damaged Inventory', count: filteredDamagedInventoryData.length },
                  { id: 'disposed', label: 'Disposed Inventory', count: filteredDisposedInventoryData.length },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5"
                      style={{
                        color: isActive ? COLORS.textPrimary : COLORS.textSecondary,
                        borderBottom: isActive ? `2px solid ${COLORS.accent}` : '2px solid transparent',
                        marginBottom: '-1px',
                        background: 'transparent',
                      }}
                    >
                      {tab.label}
                      {tab.count > 0 && (
                        <span className="px-1.5 py-0.5 text-[11px] rounded-full" style={{ background: 'rgba(59, 130, 246, 0.16)', color: '#7EA8F8' }}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* Reimbursement table box */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg overflow-hidden"
              style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
            >
              <div>
              {/* Shipment Discrepancy Tab */}
              {activeTab === 'shipment' && (
                      <div>
                  {summary?.feeProtector?.backendShipmentItems?.data?.length > 0 ? (
                    <>
                      <div className="flex items-baseline justify-between gap-4" style={{ padding: '13px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <span className="text-[13px]" style={{ color: COLORS.textSecondary }}>
                          {summary.feeProtector.backendShipmentItems.count || summary.feeProtector.backendShipmentItems.data.length} shipment discrepancies — all-time. All amounts are estimates until Amazon confirms.
                        </span>
                        <span className="text-[15px] font-bold flex-shrink-0" style={{ color: COLORS.good, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(summary.feeProtector.backendShipmentItems.totalExpectedAmount)}</span>
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
                        <thead style={{ background: COLORS.surfaceElevated }}>
                          <tr>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Date</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Shipment ID</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Shipment Name</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>ASIN</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>SKU</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Shipped</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Received</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Discrepancy</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.feeProtector.backendShipmentItems.data.map((item, index) => (
                            <tr key={index} className="transition-colors hover:bg-[#1A202B]" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                              <td className="px-3 py-4 text-sm font-semibold align-top" style={{ color: COLORS.textPrimary }}>{formatDate(item.date)}</td>
                              <td className="px-3 py-4 text-[13px] font-mono break-words align-top" style={{ color: COLORS.textPrimary }}>{item.shipmentId || 'N/A'}</td>
                              <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textPrimary }}>{item.shipmentName || 'N/A'}</td>
                              <td className="px-3 py-4 text-[13px] font-mono break-words align-top" style={{ color: COLORS.textSecondary }}>{item.asin || 'N/A'}</td>
                              <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.sku || 'N/A'}</td>
                              <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{item.quantityShipped || 0}</td>
                              <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{item.quantityReceived || 0}</td>
                              <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: '#F87171' }}>{item.discrepancyUnits || 0}</td>
                              <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: COLORS.good }}>{formatCurrency(item.expectedAmount || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  ) : (
                    <div className="text-center py-10 text-[13px]" style={{ color: COLORS.textSecondary }}>
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
                    <div className="flex items-center justify-between gap-4 flex-wrap" style={{ padding: '13px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <span className="text-[13px]" style={{ color: COLORS.textSecondary }}>
                          {filteredLostInventoryData.length} items — last 30 days, ordered by value. All amounts are estimates until Amazon confirms.
                          {filteredLostInventoryData.filter(item => item.isUnderpaid).length > 0 && (
                            <span className="ml-2 font-medium" style={{ color: COLORS.watch }}>
                              · {filteredLostInventoryData.filter(item => item.isUnderpaid).length} underpaid
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setShowUnderpaidOnly(!showUnderpaidOnly)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all"
                            style={showUnderpaidOnly ? { background: 'rgba(245,166,35,0.16)', borderColor: 'rgba(245,166,35,0.35)', color: COLORS.watch } : { background: COLORS.bgBase, borderColor: COLORS.border, color: COLORS.textPrimary }}
                            onMouseEnter={(e) => !showUnderpaidOnly && (e.target.style.borderColor = COLORS.accent)}
                            onMouseLeave={(e) => !showUnderpaidOnly && (e.target.style.borderColor = COLORS.border)}
                          >
                            {showUnderpaidOnly ? 'Show All' : 'Show Underpaid Only'}
                          </button>
                          <span className="text-[15px] font-bold flex-shrink-0" style={{ color: COLORS.good, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(lostInventoryTotal)}</span>
                        </div>
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
                        <thead style={{ background: COLORS.surfaceElevated }}>
                          <tr>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Month</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>ASIN</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>SKU</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Lost</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Found</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Reimbursed</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Discrepancy</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Expected Amount</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                            {filteredLostInventoryData
                              .filter(item => !showUnderpaidOnly || item.isUnderpaid)
                              .map((item, index) => (
                              <tr key={index} className="transition-colors hover:bg-[#1A202B]" style={{ borderBottom: `1px solid ${COLORS.border}`, background: item.isUnderpaid ? 'rgba(245,166,35,0.07)' : 'transparent' }}>
                                <td className="px-3 py-4 text-sm font-semibold align-top" style={{ color: COLORS.textPrimary }}>{formatMonthName(item.date)}</td>
                                <td className="px-3 py-4 text-[13px] font-mono break-words align-top" style={{ color: COLORS.textSecondary }}>{item.asin || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.sku || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{item.lostUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{item.foundUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{item.reimbursedUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: '#F87171' }}>{item.discrepancyUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: COLORS.good }}>
                                  {item.isUnderpaid && item.underpaidExpectedAmount ? (
                                    <div>
                                      <div>{formatCurrency(item.expectedAmount || 0)}</div>
                                      <div className="text-xs font-medium" style={{ color: COLORS.watch }}>Underpaid: {formatCurrency(item.underpaidExpectedAmount)}</div>
                                    </div>
                                  ) : (
                                    formatCurrency(item.expectedAmount || 0)
                                  )}
                                </td>
                                <td className="px-3 py-4align-top">
                                  {item.isUnderpaid ? (
                                    <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: 'rgba(245,166,35,0.16)', color: COLORS.watch }}>
                                      Underpaid
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: 'rgba(165,174,192,0.14)', color: COLORS.textSecondary }}>
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
                    <div className="text-center py-10 text-[13px]" style={{ color: COLORS.textSecondary }}>
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
                      <div className="flex items-baseline justify-between gap-4" style={{ padding: '13px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <span className="text-[13px]" style={{ color: COLORS.textSecondary }}>
                          {filteredDamagedInventoryData.length} items — last 30 days, ordered by value. All amounts are estimates until Amazon confirms.
                        </span>
                        <span className="text-[15px] font-bold flex-shrink-0" style={{ color: COLORS.good, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(damagedInventoryTotal)}</span>
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
                        <thead style={{ background: COLORS.surfaceElevated }}>
                          <tr>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Date</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>ASIN</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>SKU</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>FNSKU</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Damaged Units</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Sales Price</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Fees</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Reimbursement/Unit</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Expected Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                            {filteredDamagedInventoryData.map((item, index) => (
                              <tr key={index} className="transition-colors hover:bg-[#1A202B]" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                <td className="px-3 py-4 text-sm font-semibold align-top" style={{ color: COLORS.textPrimary }}>{formatDate(item.date)}</td>
                                <td className="px-3 py-4 text-[13px] font-mono break-words align-top" style={{ color: COLORS.textSecondary }}>{item.asin || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.sku || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.fnsku || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: '#F87171' }}>{item.damagedUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.fees || 0)}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: COLORS.good }}>{formatCurrency(item.expectedAmount || 0)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-10 text-[13px]" style={{ color: COLORS.textSecondary }}>
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
                      <div className="flex items-baseline justify-between gap-4" style={{ padding: '13px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <span className="text-[13px]" style={{ color: COLORS.textSecondary }}>
                          {filteredDisposedInventoryData.length} items — last 30 days, ordered by value. All amounts are estimates until Amazon confirms.
                        </span>
                        <span className="text-[15px] font-bold flex-shrink-0" style={{ color: COLORS.good, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(disposedInventoryTotal)}</span>
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
                <thead style={{ background: COLORS.surfaceElevated }}>
                  <tr>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Date</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>ASIN</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>SKU</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>FNSKU</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Disposed Units</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Sales Price</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Fees</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Reimbursement/Unit</th>
                              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLORS.textMuted }}>Expected Amount</th>
                  </tr>
                </thead>
                <tbody>
                            {filteredDisposedInventoryData.map((item, index) => (
                      <tr key={index} className="transition-colors hover:bg-[#1A202B]" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                <td className="px-3 py-4 text-sm font-semibold align-top" style={{ color: COLORS.textPrimary }}>{formatDate(item.date)}</td>
                                <td className="px-3 py-4 text-[13px] font-mono break-words align-top" style={{ color: COLORS.textSecondary }}>{item.asin || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.sku || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] break-words align-top" style={{ color: COLORS.textSecondary }}>{item.fnsku || 'N/A'}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: '#F87171' }}>{item.disposedUnits || 0}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.salesPrice || 0)}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.fees || 0)}</td>
                                <td className="px-3 py-4 text-[13px] align-top" style={{ color: COLORS.textSecondary }}>{formatCurrency(item.reimbursementPerUnit || 0)}</td>
                                <td className="px-3 py-4 text-[13px] font-semibold align-top" style={{ color: COLORS.good }}>{formatCurrency(item.expectedAmount || 0)}</td>
                      </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-10 text-[13px]" style={{ color: COLORS.textSecondary }}>
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

