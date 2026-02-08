import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Database,
  ChevronDown,
  ChevronRight,
  Timer,
  BarChart3,
  AlertTriangle,
  Info,
  ArrowLeft,
  User,
  Eye,
  EyeOff,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const AdminUserLogDetails = () => {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userInfo, setUserInfo] = useState(null);

  // Data states
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [errorLogs, setErrorLogs] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);

  // Filters
  const [activeTab, setActiveTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  // Calculate stats from sessions
  const calculateOverallStats = (sessionsData) => {
    if (!sessionsData || !Array.isArray(sessionsData) || sessionsData.length === 0) {
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

    sessionsData.forEach((session) => {
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

      if (session.sessionStartTime && session.sessionEndTime) {
        const duration = new Date(session.sessionEndTime) - new Date(session.sessionStartTime);
        if (duration > 0) {
          totalDuration += duration;
          sessionsWithDuration++;
        }
      }

      if (session.overallSummary?.failedFunctions) {
        totalErrors += session.overallSummary.failedFunctions;
      }

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
    let successRate = 0;
    if (sessionsWithFunctionData > 0) {
      successRate = Math.round(totalFunctionSuccessRate / sessionsWithFunctionData);
    } else if (totalSessions > 0) {
      successRate = Math.round((successfulSessions / totalSessions) * 100);
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

    return {
      totalSessions,
      successfulSessions,
      failedSessions,
      partialSessions,
      successRate,
      avgDuration,
      avgDurationFormatted: formatDuration(avgDuration),
      totalErrors
    };
  };

  const calculateSessionSuccessRate = (session) => {
    if (!session) return 0;
    if (session.overallSummary?.successRate !== undefined && session.overallSummary?.successRate !== null) {
      return session.overallSummary.successRate;
    }
    if (!session.overallSummary) return 0;
    const { successfulFunctions = 0, totalFunctions = 0 } = session.overallSummary;
    if (totalFunctions === 0) return 0;
    return Math.round((successfulFunctions / totalFunctions) * 100);
  };

  // Fetch data
  useEffect(() => {
    fetchData();
  }, [activeTab, userId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      if (activeTab === 'overview' || activeTab === 'sessions') {
        const sessionsRes = await axiosInstance.get(`/app/auth/admin/user-logs/${userId}/sessions?limit=50`);
        const sessionsData = sessionsRes?.data?.data?.sessions || [];
        setSessions(sessionsData);
        setUserInfo(sessionsRes?.data?.data?.userInfo || null);
        const calculatedStats = calculateOverallStats(sessionsData);
        setStats(calculatedStats);
      }

      if (activeTab === 'overview' || activeTab === 'errors') {
        const errorRes = await axiosInstance.get(`/app/auth/admin/user-logs/${userId}/errors?limit=100`);
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
      const response = await axiosInstance.get(`/app/auth/admin/user-logs/${userId}/session/${sessionId}`);
      setSessionDetails(response.data.data);
      setSelectedSession(sessionId);
    } catch (err) {
      console.error('Error fetching session details:', err);
      setError('Failed to fetch session details.');
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
    const matchesSearch = session.sessionId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      session.region?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      session.country?.toLowerCase().includes(searchTerm.toLowerCase());
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
      <div
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
      </div>
    );
  };

  if (loading && !stats && !sessions.length) {
    return (
      <div className="min-h-[400px] flex items-center justify-center" style={{ background: '#111' }}>
        <div className="text-center">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: '#3b82f6' }} />
          <p className="text-xs" style={{ color: '#9ca3af' }}>Loading user logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6" style={{ background: '#111', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => navigate('/manage-accounts/logs/user')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: '#21262d', border: '1px solid #30363d', color: '#9ca3af' }}
            onMouseEnter={(e) => { e.target.style.background = '#30363d'; e.target.style.color = '#f3f4f6'; }}
            onMouseLeave={(e) => { e.target.style.background = '#21262d'; e.target.style.color = '#9ca3af'; }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Users
          </button>

          {userInfo && (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-100">{userInfo.firstName} {userInfo.lastName}</p>
                <p className="text-xs text-gray-500">{userInfo.email}</p>
              </div>
            </div>
          )}
        </div>

        {/* Main Header */}
        <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', marginBottom: '10px' }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: '#60a5fa' }} />
              <div>
                <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>User Activity Logs</h1>
              </div>
            </div>

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
                    if (activeTab !== tab.id) e.target.style.color = '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== tab.id) e.target.style.color = '#9ca3af';
                  }}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-2 rounded-lg p-2" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" style={{ color: '#f87171' }} />
              <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-2">
              {/* Statistics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                <StatCard
                  title="Total Sessions"
                  value={stats?.totalSessions || 0}
                  subtitle="All time"
                  icon={Database}
                  color="blue"
                />
                <StatCard
                  title="Success Rate"
                  value={`${stats?.successRate || 0}%`}
                  subtitle={`${stats?.successfulSessions || 0} successful`}
                  icon={CheckCircle}
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
                          <tr key={index} className="transition-colors cursor-pointer" style={{ borderColor: '#30363d' }}
                            onClick={() => fetchSessionDetails(session.sessionId)}
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
                              <p className="text-[10px]" style={{ color: '#6b7280' }}>Sessions will appear here after the user runs data analysis</p>
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
                      <input
                        type="text"
                        placeholder="Search by session ID, region, or country..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-3 pr-3 py-1.5 w-full rounded-lg text-xs transition-all"
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
                                {session.sessionId?.split('_').slice(-2).join('_')}
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

              {/* Session Details Modal */}
              {selectedSession && sessionDetails && (
                <div
                  className="fixed inset-0 flex items-center justify-center p-4 z-50"
                  style={{ background: 'rgba(0, 0, 0, 0.7)' }}
                  onClick={() => setSelectedSession(null)}
                >
                  <div
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
                  </div>
                </div>
              )}
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
                  {errorLogs.length > 0 ? (
                    errorLogs.map((error, index) => (
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
                              <span>Session: {error.sessionId?.split('_').slice(-2).join('_')}</span>
                              <span>Region: {error.contextData?.region}</span>
                              <span>Country: {error.contextData?.country}</span>
                            </div>

                            {expandedErrors.has(index) && (
                              <div
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
                              </div>
                            )}
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
        </div>
      </div>
    </div>
  );
};

export default AdminUserLogDetails;
