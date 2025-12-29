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
  Mail,
  Send,
  XCircle
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
  const [emailLogs, setEmailLogs] = useState([]);
  const [emailStats, setEmailStats] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  
  // Filters and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7');
  
  // Email filters
  const [emailTypeFilter, setEmailTypeFilter] = useState('all');
  const [emailStatusFilter, setEmailStatusFilter] = useState('all');
  const [expandedErrors, setExpandedErrors] = useState(new Set());

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
  }, [activeTab, dateFilter, emailTypeFilter, emailStatusFilter]);

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
        
        if (activeTab === 'overview' || activeTab === 'emails') {
          // Fetch email logs
          const emailParams = new URLSearchParams({
            limit: '50'
          });
          
          if (emailTypeFilter !== 'all') {
            emailParams.append('type', emailTypeFilter);
          }
          
          if (emailStatusFilter !== 'all') {
            emailParams.append('status', emailStatusFilter);
          }
          
          const emailRes = await axiosInstance.get(`/app/analyse/logging/emails?${emailParams.toString()}`);
          console.log("emailRes: ", emailRes);
          setEmailLogs(emailRes?.data?.data?.emailLogs || []);
          setEmailStats(emailRes?.data?.data?.stats || []);
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

  const createSampleData = async () => {
    setLoading(true);
    try {
      await axiosInstance.post('/app/analyse/logging/create-sample');
      // Refresh data after creating sample
      await fetchData();
      setError(null);
    } catch (err) {
      console.error('Error creating sample data:', err);
      setError('Failed to create sample data.');
    } finally {
      setLoading(false);
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
      case 'completed': return 'text-green-600 bg-green-50 border-green-200';
      case 'failed': return 'text-red-600 bg-red-50 border-red-200';
      case 'partial': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'in_progress': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
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

  const StatCard = ({ title, value, subtitle, icon: Icon, color = "blue" }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-lg bg-${color}-50`}>
          <Icon className={`w-6 h-6 text-${color}-600`} />
        </div>
      </div>
    </motion.div>
  );

  if (loading && !stats && !sessions.length) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading logging data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                  <Activity className="w-7 h-7 text-blue-600" />
                  User Activity Logging
                </h1>
                <p className="text-gray-600 mt-1">Monitor and analyze user session logs and system performance</p>
              </div>
              
              <div className="flex items-center gap-4">
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                
                <button
                  onClick={fetchData}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                
                <button
                  onClick={createSampleData}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  Create Sample Data
                </button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="mt-6 border-b border-gray-200">
              <nav className="flex space-x-8">
                {[
                  { id: 'overview', label: 'Overview', icon: BarChart3 },
                  { id: 'sessions', label: 'Sessions', icon: Database },
                  { id: 'errors', label: 'Error Logs', icon: AlertCircle },
                  { id: 'emails', label: 'Email Logs', icon: Mail }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Recent Sessions</h3>
                <p className="text-gray-600 text-sm mt-1">Latest user activity sessions</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Session</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Success Rate</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sessions && sessions.length > 0 ? (
                      sessions.slice(0, 5).map((session, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {session.sessionId?.split('_').slice(-2).join('_') || 'Unknown'}
                            </div>
                            <div className="text-sm text-gray-500">
                              {session.region || 'N/A'} • {session.country || 'N/A'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(session.sessionStatus)}`}>
                              {session.sessionStatus || 'unknown'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDuration(session.sessionEndTime ? new Date(session.sessionEndTime) - new Date(session.sessionStartTime) : null)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {calculateSessionSuccessRate(session)}%
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(session.sessionStartTime)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                          <div className="flex flex-col items-center">
                            <Database className="w-8 h-8 text-gray-300 mb-2" />
                            <p>No sessions found</p>
                            <p className="text-sm">Sessions will appear here after users run data analysis</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Errors */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Recent Errors</h3>
                <p className="text-gray-600 text-sm mt-1">Latest system errors and issues</p>
              </div>
              <div className="divide-y divide-gray-200">
                {errorLogs && errorLogs.length > 0 ? (
                  errorLogs.slice(0, 5).map((error, index) => (
                    <div key={index} className="p-6">
                      <div className="flex items-start gap-3">
                        {getLogTypeIcon('error')}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-gray-900">{error.functionName || 'Unknown Function'}</p>
                            <span className="text-xs text-gray-500">{formatDate(error.timestamp)}</span>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">{error.message || 'No error message'}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Session: {error.sessionId?.split('_').slice(-2).join('_') || 'Unknown'}</span>
                            <span>Region: {error.contextData?.region || 'N/A'}</span>
                            <span>Country: {error.contextData?.country || 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <div className="flex flex-col items-center">
                      <AlertCircle className="w-8 h-8 text-gray-300 mb-2" />
                      <p>No error logs found</p>
                      <p className="text-sm">Error logs will appear here when system errors occur</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search by session ID, region, or country..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="partial">Partial</option>
                  <option value="in_progress">In Progress</option>
                </select>
              </div>
            </div>

            {/* Sessions List */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Session Details</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSessions.map((session, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {session.sessionId.split('_').slice(-2).join('_')}
                            </div>
                            <div className="text-sm text-gray-500">
                              {session.region} • {session.country}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              {formatDate(session.sessionStartTime)}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(session.sessionStatus)}`}>
                            {session.sessionStatus}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {calculateSessionSuccessRate(session)}% success
                          </div>
                          <div className="text-xs text-gray-500">
                            {session.overallSummary?.successfulFunctions || 0}/{session.overallSummary?.totalFunctions || 0} functions
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDuration(session.sessionEndTime ? new Date(session.sessionEndTime) - new Date(session.sessionStartTime) : null)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => fetchSessionDetails(session.sessionId)}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
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
                  className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
                  onClick={() => setSelectedSession(null)}
                >
                  <motion.div
                    initial={{ y: 20 }}
                    animate={{ y: 0 }}
                    exit={{ y: 20 }}
                    className="bg-white rounded-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">Session Details</h3>
                        <button
                          onClick={() => setSelectedSession(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <EyeOff className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="p-6">
                      {/* Session Summary */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                        <div className="text-center p-4 bg-blue-50 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">{sessionDetails.overallSummary?.totalFunctions || 0}</div>
                          <div className="text-sm text-blue-600">Total Functions</div>
                        </div>
                        <div className="text-center p-4 bg-green-50 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">{sessionDetails.overallSummary?.successfulFunctions || 0}</div>
                          <div className="text-sm text-green-600">Successful</div>
                        </div>
                        <div className="text-center p-4 bg-red-50 rounded-lg">
                          <div className="text-2xl font-bold text-red-600">{sessionDetails.overallSummary?.failedFunctions || 0}</div>
                          <div className="text-sm text-red-600">Failed</div>
                        </div>
                        <div className="text-center p-4 bg-yellow-50 rounded-lg">
                          <div className="text-2xl font-bold text-yellow-600">{calculateSessionSuccessRate(sessionDetails)}%</div>
                          <div className="text-sm text-yellow-600">Success Rate</div>
                        </div>
                        <div className="text-center p-4 bg-purple-50 rounded-lg">
                          <div className="text-2xl font-bold text-purple-600">{sessionDetails.sessionDurationFormatted}</div>
                          <div className="text-sm text-purple-600">Duration</div>
                        </div>
                      </div>

                      {/* Logs */}
                      <div className="space-y-4">
                        <h4 className="text-md font-semibold text-gray-900">Function Logs</h4>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {sessionDetails.logs?.map((log, index) => (
                            <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                              {getLogTypeIcon(log.logType)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-900">{log.functionName}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(log.status)}`}>
                                    {log.status}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">{log.message}</p>
                                <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
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
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Error Logs</h3>
                <p className="text-gray-600 text-sm mt-1">Detailed error information and stack traces</p>
              </div>
              
              <div className="divide-y divide-gray-200">
                {errorLogs.map((error, index) => (
                  <div key={index} className="p-6">
                    <div className="flex items-start gap-3">
                      {getLogTypeIcon('error')}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{error.functionName}</p>
                            <span className="text-xs text-gray-500">{formatDate(error.timestamp)}</span>
                          </div>
                          <button
                            onClick={() => toggleErrorExpansion(index)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
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
                        
                        <p className="text-sm text-gray-600 mb-2">{error.message}</p>
                        
                        <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
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
                              className="mt-4 p-4 bg-gray-50 rounded-lg"
                            >
                              {error.errorDetails && (
                                <div className="space-y-2">
                                  {error.errorDetails.errorMessage && (
                                    <div>
                                      <span className="text-xs font-medium text-gray-700">Error Message:</span>
                                      <p className="text-xs text-gray-600 mt-1">{error.errorDetails.errorMessage}</p>
                                    </div>
                                  )}
                                  
                                  {error.errorDetails.httpStatus && (
                                    <div>
                                      <span className="text-xs font-medium text-gray-700">HTTP Status:</span>
                                      <p className="text-xs text-gray-600 mt-1">{error.errorDetails.httpStatus}</p>
                                    </div>
                                  )}
                                  
                                  {error.errorDetails.stackTrace && (
                                    <div>
                                      <span className="text-xs font-medium text-gray-700">Stack Trace:</span>
                                      <pre className="text-xs text-gray-600 mt-1 whitespace-pre-wrap bg-white p-2 rounded border max-h-40 overflow-y-auto">
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

        {/* Email Logs Tab */}
        {activeTab === 'emails' && (
          <div className="space-y-6">
            {/* Email Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {emailStats.map((stat, index) => (
                <div key={stat._id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">{stat._id.replace('_', ' ')}</p>
                      <p className="text-2xl font-bold text-gray-900">{stat.totalCount}</p>
                    </div>
                    <Mail className="w-8 h-8 text-blue-600" />
                  </div>
                  <div className="mt-4 space-y-1">
                    {stat.statuses.map(status => (
                      <div key={status.status} className="flex items-center justify-between text-xs">
                        <span className={`flex items-center gap-1 ${
                          status.status === 'SENT' ? 'text-green-600' : 
                          status.status === 'FAILED' ? 'text-red-600' : 'text-yellow-600'
                        }`}>
                          {status.status === 'SENT' ? <Send className="w-3 h-3" /> : 
                           status.status === 'FAILED' ? <XCircle className="w-3 h-3" /> : 
                           <Clock className="w-3 h-3" />}
                          {status.status}
                        </span>
                        <span className="font-medium">{status.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Email Filters */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email Type</label>
                  <select
                    value={emailTypeFilter}
                    onChange={(e) => setEmailTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Types</option>
                    <option value="OTP">OTP</option>
                    <option value="WELCOME_LITE">Welcome Lite</option>
                    <option value="PASSWORD_RESET">Password Reset</option>
                    <option value="ANALYSIS_READY">Analysis Ready</option>
                    <option value="WEEKLY_REPORT">Weekly Report</option>
                    <option value="UPGRADE_REMINDER">Upgrade Reminder</option>
                    <option value="CONNECTION_REMINDER">Connection Reminder</option>
                    <option value="SUPPORT_MESSAGE">Support Message</option>
                    <option value="USER_REGISTERED">User Registered</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={emailStatusFilter}
                    onChange={(e) => setEmailStatusFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Status</option>
                    <option value="SENT">Sent</option>
                    <option value="FAILED">Failed</option>
                    <option value="PENDING">Pending</option>
                    <option value="DELIVERED">Delivered</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Email Logs Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Email Logs</h3>
                <p className="text-gray-600 text-sm mt-1">Recent email delivery logs and status</p>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type & Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Recipient
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Subject
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Sent Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Provider
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {emailLogs.map((email, index) => (
                      <tr key={email.id || index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">
                              {email.emailType.replace('_', ' ')}
                            </span>
                            <div className="flex items-center gap-1 mt-1">
                              {email.status === 'SENT' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  <Send className="w-3 h-3" />
                                  Sent
                                </span>
                              ) : email.status === 'FAILED' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  <XCircle className="w-3 h-3" />
                                  Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                  <Clock className="w-3 h-3" />
                                  {email.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-900">{email.receiverEmail}</span>
                            {email.receiverName && email.receiverName !== 'Unknown User' && (
                              <span className="text-xs text-gray-500">{email.receiverName}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-900 line-clamp-2">
                            {email.subject || 'No subject'}
                          </span>
                          {email.errorMessage && (
                            <p className="text-xs text-red-600 mt-1 line-clamp-1">
                              Error: {email.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            {email.sentDate ? (
                              <>
                                <span className="text-sm text-gray-900">
                                  {new Date(email.sentDate).toLocaleDateString()}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {email.sentTime}
                                </span>
                              </>
                            ) : (
                              <span className="text-sm text-gray-500">
                                {new Date(email.createdAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-900">{email.emailProvider}</span>
                            {email.retryCount > 0 && (
                              <span className="text-xs text-orange-600">
                                Retries: {email.retryCount}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {emailLogs.length === 0 && (
                  <div className="text-center py-12">
                    <Mail className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No email logs found</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      No email logs match the current filters.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserLogging;
