import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Filter,
  RefreshCw,
  Search,
  TrendingUp,
  User,
  Calendar,
  Database,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Timer,
  BarChart3,
  AlertTriangle,
  Info,
  XCircle,
  Play,
  Loader2
} from 'lucide-react';
import axiosInstance from '../config/axios.config.js';

const UserLogging = () => {
  // Authentication check - using same logic as TopNav switch account button
  const user = useSelector((state) => state.Auth?.user);
  
  // Check for super admin access - server-side middleware will validate the actual token
  const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
  const adminAccessType = localStorage.getItem('adminAccessType');
  const isSuperAdmin = isAdminLoggedIn && adminAccessType === 'superAdmin';

  // Debug logging for UserLogging page access
  console.log('🔍 UserLogging Debug - User data:', {
    user: user,
    accessType: user?.accessType,
    packageType: user?.packageType,
    isAdminLoggedIn: isAdminLoggedIn,
    adminAccessType: adminAccessType,
    isSuperAdmin: isSuperAdmin,
    userKeys: user ? Object.keys(user) : 'No user object'
  });

  // If not super admin, redirect to dashboard or login
  if (!isSuperAdmin) {
    console.log('❌ Access denied - redirecting to dashboard');
    return <Navigate to="/seller-central-checker/dashboard" replace />;
  }

  console.log('✅ Access granted - rendering UserLogging page');

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Data states
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [errorLogs, setErrorLogs] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  
  // Filters and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7');
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  // Integration trigger (top button – runs for current user)
  const [triggerSubmitting, setTriggerSubmitting] = useState(false);
  const [integrationMessage, setIntegrationMessage] = useState(null); // Success/error toast

  // Success rate calculation functions
  const calculateSessionSuccessRate = (session) => {
    if (!session) {
      console.log('No session data provided');
      return 0;
    }
    
    console.log('Session data for success rate calculation:', {
      sessionId: session.sessionId,
      sessionStatus: session.sessionStatus,
      overallSummary: session.overallSummary
    });
    
    // First try to use the backend-calculated success rate
    if (session.overallSummary?.successRate !== undefined && session.overallSummary?.successRate !== null) {
      console.log('Using backend success rate:', session.overallSummary.successRate);
      return session.overallSummary.successRate;
    }
    
    // Fallback to frontend calculation
    if (!session.overallSummary) {
      console.log('No overallSummary found, returning 0');
      return 0;
    }
    
    const { successfulFunctions = 0, totalFunctions = 0 } = session.overallSummary;
    console.log('Calculating from functions:', { successfulFunctions, totalFunctions });
    
    if (totalFunctions === 0) return 0;
    
    const calculatedRate = Math.round((successfulFunctions / totalFunctions) * 100);
    console.log('Calculated success rate:', calculatedRate);
    return calculatedRate;
  };

  const calculateOverallStats = (sessionsData) => {
    console.log('Calculating overall stats for sessions:', sessionsData);
    
    if (!sessionsData || !Array.isArray(sessionsData) || sessionsData.length === 0) {
      console.log('No sessions data provided, returning default stats');
      return {
        totalSessions: 0,
        successfulSessions: 0,
        failedSessions: 0,
        partialSessions: 0,
        successRate: 0,
        avgDuration: 0,
        avgDurationFormatted: 'N/A',
        totalErrors: 0
      };
    }

    let successfulSessions = 0;
    let failedSessions = 0;
    let partialSessions = 0;
    let totalDuration = 0;
    let totalErrors = 0;
    let sessionsWithDuration = 0;
    let totalFunctionSuccessRate = 0;
    let sessionsWithFunctionData = 0;

    sessionsData.forEach((session, index) => {
      console.log(`Processing session ${index + 1}:`, {
        sessionId: session.sessionId,
        sessionStatus: session.sessionStatus,
        overallSummary: session.overallSummary
      });
      
      // Count session statuses
      switch (session.sessionStatus) {
        case 'completed':
          successfulSessions++;
          break;
        case 'failed':
          failedSessions++;
          break;
        case 'partial':
          partialSessions++;
          break;
      }

      // Calculate duration if both start and end times exist
      if (session.sessionStartTime && session.sessionEndTime) {
        const duration = new Date(session.sessionEndTime) - new Date(session.sessionStartTime);
        if (duration > 0) {
          totalDuration += duration;
          sessionsWithDuration++;
        }
      }

      // Count errors from overall summary
      if (session.overallSummary?.failedFunctions) {
        totalErrors += session.overallSummary.failedFunctions;
      }
      
      // Calculate average function success rate
      if (session.overallSummary?.successRate !== undefined && session.overallSummary?.successRate !== null) {
        totalFunctionSuccessRate += session.overallSummary.successRate;
        sessionsWithFunctionData++;
      } else if (session.overallSummary?.totalFunctions > 0) {
        const sessionSuccessRate = Math.round((session.overallSummary.successfulFunctions / session.overallSummary.totalFunctions) * 100);
        totalFunctionSuccessRate += sessionSuccessRate;
        sessionsWithFunctionData++;
      }
    });

    const totalSessions = sessionsData.length;
    
    // Calculate success rate - prefer function-based success rate over session status
    let successRate = 0;
    if (sessionsWithFunctionData > 0) {
      successRate = Math.round(totalFunctionSuccessRate / sessionsWithFunctionData);
      console.log('Using function-based success rate:', successRate);
    } else if (totalSessions > 0) {
      successRate = Math.round((successfulSessions / totalSessions) * 100);
      console.log('Using session-status-based success rate:', successRate);
    }
    
    const avgDuration = sessionsWithDuration > 0 ? Math.round(totalDuration / sessionsWithDuration) : 0;
    
    const formatDuration = (milliseconds) => {
      if (!milliseconds) return 'N/A';
      const seconds = Math.floor(milliseconds / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
      return `${seconds}s`;
    };

    const result = {
      totalSessions,
      successfulSessions,
      failedSessions,
      partialSessions,
      successRate,
      avgDuration,
      avgDurationFormatted: formatDuration(avgDuration),
      totalErrors,
      period: `Last ${dateFilter} days`
    };
    
    console.log('Final calculated stats:', result);
    return result;
  };

  // Fetch data based on active tab
  useEffect(() => {
    fetchData();
  }, [activeTab, dateFilter]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
              if (activeTab === 'overview' || activeTab === 'sessions') {
          // Fetch sessions only - we'll calculate stats in frontend
          const sessionsRes = await axiosInstance.get(`/app/analyse/logging/sessions?limit=20`);
          console.log("sessionsRes: ",sessionsRes)
          
          const sessionsData = sessionsRes?.data?.data?.sessions || [];
          setSessions(sessionsData);
          
          // Calculate stats from the sessions data
          const calculatedStats = calculateOverallStats(sessionsData);
          console.log("calculatedStats: ", calculatedStats);
          setStats(calculatedStats);
        }
        
        if (activeTab === 'overview' || activeTab === 'errors') {
          // Fetch error logs
          const errorRes = await axiosInstance.get(`/app/analyse/logging/errors?limit=50`);
          console.log("errorRes: ",errorRes)
          setErrorLogs(errorRes?.data?.data?.errorLogs || []);
        }
        
    } catch (err) {
      console.error('Error fetching logging data:', err);
      setError('Failed to fetch logging data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetails = async (sessionId) => {
    setLoading(true);
    try {
      const response = await axiosInstance.get(`/app/analyse/logging/session/${sessionId}`);
      setSessionDetails(response.data.data);
      setSelectedSession(sessionId);
    } catch (err) {
      console.error('Error fetching session details:', err);
      setError('Failed to fetch session details.');
    } finally {
      setLoading(false);
    }
  };

  // Run analysis for the current user (uses auth + location from cookies)
  const triggerIntegration = async () => {
    setTriggerSubmitting(true);
    setIntegrationMessage(null);

    try {
      const response = await axiosInstance.post('/api/integration/trigger');

      if (response.status === 200 || response.status === 202) {
        const data = response.data?.data;
        setIntegrationMessage({
          type: 'success',
          text: data?.isExisting
            ? `Integration job already in progress (Job ID: ${data.jobId})`
            : `Integration job queued successfully (Job ID: ${data.jobId})`
        });
      } else {
        throw new Error(response.data?.message || 'Failed to trigger integration');
      }
    } catch (err) {
      console.error('Error triggering integration:', err);
      setIntegrationMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to trigger integration. Ensure you have a location set.'
      });
    } finally {
      setTriggerSubmitting(false);
      setTimeout(() => setIntegrationMessage(null), 5000);
    }
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return 'N/A';
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    // Format as UTC to show exact server time
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} UTC`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return { color: '#22c55e', background: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.3)' };
      case 'failed': return { color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.3)' };
      case 'partial': return { color: '#fbbf24', background: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.3)' };
      case 'in_progress': return { color: '#60a5fa', background: 'rgba(96, 165, 250, 0.2)', border: 'rgba(96, 165, 250, 0.3)' };
      default: return { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  const getLogTypeIcon = (logType) => {
    switch (logType) {
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'info': return <Info className="w-4 h-4 text-blue-500" />;
      default: return <Info className="w-4 h-4 text-gray-500" />;
    }
  };

  const toggleErrorExpansion = (errorIndex) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(errorIndex)) {
      newExpanded.delete(errorIndex);
    } else {
      newExpanded.add(errorIndex);
    }
    setExpandedErrors(newExpanded);
  };

  const filteredSessions = sessions.filter(session => {
    const matchesSearch = session.sessionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.region.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.country.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || session.sessionStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const StatCard = ({ title, value, subtitle, icon: Icon, color = "blue" }) => {
    const colorMap = {
      blue: { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
      green: { bg: 'rgba(34, 197, 94, 0.2)', text: '#22c55e' },
      purple: { bg: 'rgba(192, 132, 252, 0.2)', text: '#c084fc' },
      red: { bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171' }
    };
    const colors = colorMap[color] || colorMap.blue;
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg p-3 transition-shadow"
        style={{ background: '#161b22', border: '1px solid #30363d' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium" style={{ color: '#9ca3af' }}>{title}</p>
            <p className="text-[18px] font-bold mt-0.5" style={{ color: '#f3f4f6' }}>{value}</p>
            {subtitle && <p className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>{subtitle}</p>}
          </div>
          <Icon className="w-4 h-4" style={{ color: colors.text }} />
        </div>
      </motion.div>
    );
  };

  if (loading && !stats && !sessions.length) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a1a1a' }}>
        <div className="text-center">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: '#3b82f6' }} />
          <p className="text-xs" style={{ color: '#9ca3af' }}>Loading logging data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden w-full" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', marginBottom: '10px' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <div>
              <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>User Activity Logging</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs transition-all"
              style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#30363d'}
            >
              <option value="7" style={{ background: '#21262d' }}>Last 7 days</option>
              <option value="30" style={{ background: '#21262d' }}>Last 30 days</option>
              <option value="90" style={{ background: '#21262d' }}>Last 90 days</option>
            </select>
            
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: '#3b82f6', color: 'white' }}
              onMouseEnter={(e) => e.target.style.background = '#2563eb'}
              onMouseLeave={(e) => e.target.style.background = '#3b82f6'}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            
            <button
              onClick={triggerIntegration}
              disabled={triggerSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#fb923c', color: 'white' }}
              onMouseEnter={(e) => !triggerSubmitting && (e.target.style.background = '#f97316')}
              onMouseLeave={(e) => e.target.style.background = '#fb923c'}
              title="Run analysis for the current user"
            >
              {triggerSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {triggerSubmitting ? 'Running...' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mt-3 border-t pt-2" style={{ borderColor: '#30363d' }}>
          <nav className="flex space-x-4 overflow-x-auto">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'sessions', label: 'Sessions', icon: Database },
              { id: 'errors', label: 'Error Logs', icon: AlertCircle }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 py-2 px-2 border-b-2 font-medium text-xs transition-colors"
                style={{
                  borderBottomColor: activeTab === tab.id ? '#3b82f6' : 'transparent',
                  color: activeTab === tab.id ? '#60a5fa' : '#9ca3af'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = '#d1d5db';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = '#9ca3af';
                  }
                }}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Integration success/error toast (page-level) */}
      <AnimatePresence>
        {integrationMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-4 right-4 z-[60] p-3 rounded-lg shadow-lg max-w-md text-xs"
            style={{
              background: integrationMessage.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              border: `1px solid ${integrationMessage.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}
          >
            <div className="flex items-center gap-2">
              {integrationMessage.type === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} />
              ) : (
                <XCircle className="w-4 h-4 shrink-0" style={{ color: '#f87171' }} />
              )}
              <p style={{ color: integrationMessage.type === 'success' ? '#22c55e' : '#f87171' }}>
                {integrationMessage.text}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div>
        {error && (
          <div className="mb-2 rounded-lg p-2" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" style={{ color: '#f87171' }} />
              <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
            </div>
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-2">
            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
              <StatCard
                title="Total Sessions"
                value={stats?.totalSessions || 0}
                subtitle={`${stats?.period || 'No data'}`}
                icon={Database}
                color="blue"
              />
              <StatCard
                title="Success Rate"
                value={`${stats?.successRate || 0}%`}
                subtitle={`${stats?.successfulSessions || 0} successful`}
                icon={TrendingUp}
                color="green"
              />
              <StatCard
                title="Avg Duration"
                value={stats?.avgDurationFormatted || 'N/A'}
                subtitle="Per session"
                icon={Timer}
                color="purple"
              />
              <StatCard
                title="Total Errors"
                value={stats?.totalErrors || 0}
                subtitle={`${stats?.failedSessions || 0} failed sessions`}
                icon={AlertCircle}
                color="red"
              />
            </div>

            {/* Recent Sessions */}
            <div className="rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="p-3 border-b" style={{ borderColor: '#30363d' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Recent Sessions</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ background: '#21262d' }}>
                    <tr>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Session</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Status</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Duration</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Success Rate</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Started</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: '#30363d' }}>
                    {sessions && sessions.length > 0 ? (
                      sessions.slice(0, 5).map((session, index) => (
                        <tr key={index} className="transition-colors" style={{ borderColor: '#30363d' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <div className="text-[11px] font-medium" style={{ color: '#f3f4f6' }}>
                              {session.sessionId?.split('_').slice(-2).join('_') || 'Unknown'}
                            </div>
                            <div className="text-[10px]" style={{ color: '#9ca3af' }}>
                              {session.region || 'N/A'} • {session.country || 'N/A'}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {(() => {
                              const statusStyle = getStatusColor(session.sessionStatus);
                              return (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border" style={statusStyle}>
                                  {session.sessionStatus || 'unknown'}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-[11px]" style={{ color: '#f3f4f6' }}>
                            {formatDuration(session.sessionEndTime ? new Date(session.sessionEndTime) - new Date(session.sessionStartTime) : null)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-[11px]" style={{ color: '#f3f4f6' }}>
                            {calculateSessionSuccessRate(session)}%
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-[11px]" style={{ color: '#9ca3af' }}>
                            {formatDate(session.sessionStartTime)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="px-4 py-6 text-center">
                          <div className="flex flex-col items-center">
                            <Database className="w-6 h-6 mb-2" style={{ color: '#6b7280' }} />
                            <p className="text-xs" style={{ color: '#9ca3af' }}>No sessions found</p>
                            <p className="text-[10px]" style={{ color: '#6b7280' }}>Sessions will appear here after users run data analysis</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Errors */}
            <div className="rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="p-3 border-b" style={{ borderColor: '#30363d' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Recent Errors</h3>
              </div>
              <div className="divide-y" style={{ borderColor: '#30363d' }}>
                {errorLogs && errorLogs.length > 0 ? (
                  errorLogs.slice(0, 5).map((error, index) => (
                    <div key={index} className="p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-[11px] font-medium" style={{ color: '#f3f4f6' }}>{error.functionName || 'Unknown Function'}</p>
                            <span className="text-[10px]" style={{ color: '#9ca3af' }}>{formatDate(error.timestamp)}</span>
                          </div>
                          <p className="text-[11px] mb-1.5" style={{ color: '#9ca3af' }}>{error.message || 'No error message'}</p>
                          <div className="flex items-center gap-3 text-[10px]" style={{ color: '#6b7280' }}>
                            <span>Session: {error.sessionId?.split('_').slice(-2).join('_') || 'Unknown'}</span>
                            <span>Region: {error.contextData?.region || 'N/A'}</span>
                            <span>Country: {error.contextData?.country || 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center">
                    <div className="flex flex-col items-center">
                      <AlertCircle className="w-6 h-6 mb-2" style={{ color: '#6b7280' }} />
                      <p className="text-xs" style={{ color: '#9ca3af' }}>No error logs found</p>
                      <p className="text-[10px]" style={{ color: '#6b7280' }}>Error logs will appear here when system errors occur</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-2">
            {/* Filters */}
            <div className="rounded-lg p-3" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#6b7280' }} />
                    <input
                      type="text"
                      placeholder="Search by session ID, region, or country..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 pr-3 py-1.5 w-full rounded-lg text-xs transition-all"
                      style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#30363d'}
                    />
                  </div>
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs transition-all"
                  style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#30363d'}
                >
                  <option value="all" style={{ background: '#21262d' }}>All Status</option>
                  <option value="completed" style={{ background: '#21262d' }}>Completed</option>
                  <option value="failed" style={{ background: '#21262d' }}>Failed</option>
                  <option value="partial" style={{ background: '#21262d' }}>Partial</option>
                  <option value="in_progress" style={{ background: '#21262d' }}>In Progress</option>
                </select>
              </div>
            </div>

            {/* Sessions List */}
            <div className="rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ background: '#21262d' }}>
                    <tr>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Session Details</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Status</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Performance</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Duration</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9ca3af' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: '#30363d' }}>
                    {filteredSessions.map((session, index) => (
                      <tr key={index} className="transition-colors" style={{ borderColor: '#30363d' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div>
                            <div className="text-[11px] font-medium" style={{ color: '#f3f4f6' }}>
                              {session.sessionId.split('_').slice(-2).join('_')}
                            </div>
                            <div className="text-[10px]" style={{ color: '#9ca3af' }}>
                              {session.region} • {session.country}
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: '#6b7280' }}>
                              {formatDate(session.sessionStartTime)}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {(() => {
                            const statusStyle = getStatusColor(session.sessionStatus);
                            return (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border" style={statusStyle}>
                                {session.sessionStatus}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className="text-[11px]" style={{ color: '#f3f4f6' }}>
                            {calculateSessionSuccessRate(session)}% success
                          </div>
                          <div className="text-[10px]" style={{ color: '#9ca3af' }}>
                            {session.overallSummary?.successfulFunctions || 0}/{session.overallSummary?.totalFunctions || 0} functions
                          </div>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-[11px]" style={{ color: '#f3f4f6' }}>
                          {formatDuration(session.sessionEndTime ? new Date(session.sessionEndTime) - new Date(session.sessionStartTime) : null)}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-[11px] font-medium">
                          <button
                            onClick={() => fetchSessionDetails(session.sessionId)}
                            className="flex items-center gap-1 transition-colors"
                            style={{ color: '#60a5fa' }}
                            onMouseEnter={(e) => e.target.style.color = '#3b82f6'}
                            onMouseLeave={(e) => e.target.style.color = '#60a5fa'}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Session Details Modal/Panel */}
            <AnimatePresence>
              {selectedSession && sessionDetails && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="fixed inset-0 flex items-center justify-center p-4 z-50"
                  style={{ background: 'rgba(0, 0, 0, 0.7)' }}
                  onClick={() => setSelectedSession(null)}
                >
                  <motion.div
                    initial={{ y: 20 }}
                    animate={{ y: 0 }}
                    exit={{ y: 20 }}
                    className="rounded-lg max-w-4xl w-full max-h-[80vh] overflow-y-auto"
                    style={{ background: '#161b22', border: '1px solid #30363d' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-3 border-b" style={{ borderColor: '#30363d' }}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Session Details</h3>
                        <button
                          onClick={() => setSelectedSession(null)}
                          style={{ color: '#9ca3af' }}
                          onMouseEnter={(e) => e.target.style.color = '#f3f4f6'}
                          onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="p-3">
                      {/* Session Summary */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                          <div className="text-base font-bold" style={{ color: '#60a5fa' }}>{sessionDetails.overallSummary?.totalFunctions || 0}</div>
                          <div className="text-[10px]" style={{ color: '#60a5fa' }}>Total Functions</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                          <div className="text-base font-bold" style={{ color: '#22c55e' }}>{sessionDetails.overallSummary?.successfulFunctions || 0}</div>
                          <div className="text-[10px]" style={{ color: '#22c55e' }}>Successful</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                          <div className="text-base font-bold" style={{ color: '#f87171' }}>{sessionDetails.overallSummary?.failedFunctions || 0}</div>
                          <div className="text-[10px]" style={{ color: '#f87171' }}>Failed</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(251, 191, 36, 0.2)', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                          <div className="text-base font-bold" style={{ color: '#fbbf24' }}>{calculateSessionSuccessRate(sessionDetails)}%</div>
                          <div className="text-[10px]" style={{ color: '#fbbf24' }}>Success Rate</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(192, 132, 252, 0.2)', border: '1px solid rgba(192, 132, 252, 0.3)' }}>
                          <div className="text-base font-bold" style={{ color: '#c084fc' }}>{sessionDetails.sessionDurationFormatted}</div>
                          <div className="text-[10px]" style={{ color: '#c084fc' }}>Duration</div>
                        </div>
                      </div>

                      {/* Logs */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Function Logs</h4>
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                          {sessionDetails.logs?.map((log, index) => (
                            <div key={index} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: '#21262d', border: '1px solid #30363d' }}>
                              {getLogTypeIcon(log.logType)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[11px] font-medium" style={{ color: '#f3f4f6' }}>{log.functionName}</span>
                                  {(() => {
                                    const statusStyle = getStatusColor(log.status);
                                    return (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] border" style={statusStyle}>
                                        {log.status}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <p className="text-[11px]" style={{ color: '#9ca3af' }}>{log.message}</p>
                                <div className="flex items-center gap-3 text-[10px] mt-1" style={{ color: '#6b7280' }}>
                                  <span>{formatDate(log.timestamp)}</span>
                                  {log.executionTime?.duration && (
                                    <span>Duration: {formatDuration(log.executionTime.duration)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Errors Tab */}
        {activeTab === 'errors' && (
          <div className="space-y-2">
            <div className="rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="p-3 border-b" style={{ borderColor: '#30363d' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Error Logs</h3>
              </div>
              
              <div className="divide-y" style={{ borderColor: '#30363d' }}>
                {errorLogs.map((error, index) => (
                  <div key={index} className="p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <p className="text-[11px] font-medium" style={{ color: '#f3f4f6' }}>{error.functionName}</p>
                            <span className="text-[10px]" style={{ color: '#9ca3af' }}>{formatDate(error.timestamp)}</span>
                          </div>
                          <button
                            onClick={() => toggleErrorExpansion(index)}
                            className="flex items-center gap-1 text-[10px] transition-colors"
                            style={{ color: '#60a5fa' }}
                            onMouseEnter={(e) => e.target.style.color = '#3b82f6'}
                            onMouseLeave={(e) => e.target.style.color = '#60a5fa'}
                          >
                            {expandedErrors.has(index) ? (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                Less
                              </>
                            ) : (
                              <>
                                <ChevronRight className="w-3 h-3" />
                                More
                              </>
                            )}
                          </button>
                        </div>
                        
                        <p className="text-[11px] mb-1.5" style={{ color: '#9ca3af' }}>{error.message}</p>
                        
                        <div className="flex items-center gap-3 text-[10px] mb-1.5" style={{ color: '#6b7280' }}>
                          <span>Session: {error.sessionId.split('_').slice(-2).join('_')}</span>
                          <span>Region: {error.contextData?.region}</span>
                          <span>Country: {error.contextData?.country}</span>
                        </div>

                        <AnimatePresence>
                          {expandedErrors.has(index) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-2 p-2 rounded-lg"
                              style={{ background: '#21262d', border: '1px solid #30363d' }}
                            >
                              {error.errorDetails && (
                                <div className="space-y-1.5">
                                  {error.errorDetails.errorMessage && (
                                    <div>
                                      <span className="text-[10px] font-medium" style={{ color: '#f3f4f6' }}>Error Message:</span>
                                      <p className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>{error.errorDetails.errorMessage}</p>
                                    </div>
                                  )}
                                  
                                  {error.errorDetails.httpStatus && (
                                    <div>
                                      <span className="text-[10px] font-medium" style={{ color: '#f3f4f6' }}>HTTP Status:</span>
                                      <p className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>{error.errorDetails.httpStatus}</p>
                                    </div>
                                  )}
                                  
                                  {error.errorDetails.stackTrace && (
                                    <div>
                                      <span className="text-[10px] font-medium" style={{ color: '#f3f4f6' }}>Stack Trace:</span>
                                      <pre className="text-[10px] mt-0.5 whitespace-pre-wrap p-2 rounded border max-h-32 overflow-y-auto" style={{ background: '#1a1a1a', borderColor: '#30363d', color: '#9ca3af' }}>
                                        {error.errorDetails.stackTrace}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
      </div>
    </div>
  );
};

export default UserLogging;
