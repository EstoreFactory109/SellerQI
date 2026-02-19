import React from 'react';
import { useState } from 'react';
import { AlertTriangle, TrendingUp, Lightbulb, ChevronDown, ChevronUp, Target, Zap, Shield, AlertCircle, Loader2, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SuggestionList - Displays profitability issues and suggestions
 * 
 * @param {Array} suggestionsData - Legacy client-side suggestions (strings)
 * @param {Array} issuesData - NEW: Backend-calculated profitability issues with recommendations
 * @param {Object} issuesSummary - NEW: Summary counts (totalIssues, byType, bySeverity)
 * @param {boolean} issuesLoading - NEW: Loading state for issues
 * @param {Function} onLoadMore - NEW: Callback to load more issues
 * @param {boolean} hasMore - NEW: Whether more issues can be loaded
 */
const SuggestionList = ({ 
  suggestionsData = [], 
  issuesData = [], 
  issuesSummary = null,
  issuesLoading = false,
  onLoadMore,
  hasMore = false
}) => {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  
  // Prefer backend issues if available, otherwise use client-side suggestions
  const useBackendIssues = issuesData && issuesData.length > 0;
  
  // Convert backend issues to display format
  const convertBackendIssue = (issue) => {
    let priority = 'medium';
    let icon = Lightbulb;
    let category = 'General';
    
    // Map severity to priority
    if (issue.severity === 'critical') {
      priority = 'critical';
      icon = AlertTriangle;
      category = 'Critical Issue';
    } else if (issue.severity === 'high') {
      priority = 'high';
      icon = TrendingUp;
      category = 'High Priority';
    } else {
      priority = 'medium';
      icon = Target;
      category = 'Optimization';
    }
    
    // Map issue type to category
    if (issue.issueType === 'negative_profit') {
      category = 'Negative Profit';
      icon = AlertTriangle;
    } else if (issue.issueType === 'low_margin') {
      category = 'Low Margin';
      icon = TrendingUp;
    }
    
    // Build message from backend data
    const productName = issue.productName ? ` (${issue.productName.substring(0, 40)}${issue.productName.length > 40 ? '...' : ''})` : '';
    let message = `ASIN ${issue.asin}${productName}: `;
    
    if (issue.recommendation) {
      message += issue.recommendation.description || issue.recommendation.title;
    } else if (issue.issueType === 'negative_profit') {
      message += `Net profit is $${Math.abs(issue.netProfit).toFixed(2)} negative (${issue.profitMargin.toFixed(1)}% margin). Sales: $${issue.sales.toFixed(2)}, Ads: $${issue.adsSpend.toFixed(2)}, Fees: $${issue.amazonFees.toFixed(2)}.`;
    } else {
      message += `Profit margin is only ${issue.profitMargin.toFixed(1)}% (below 10% threshold). Net profit: $${issue.netProfit.toFixed(2)} on $${issue.sales.toFixed(2)} sales.`;
    }
    
    return {
      message,
      priority,
      type: 'profitability',
      icon,
      category,
      asin: issue.asin,
      action: issue.recommendation?.action,
      details: {
        sales: issue.sales,
        adsSpend: issue.adsSpend,
        amazonFees: issue.amazonFees,
        netProfit: issue.netProfit,
        profitMargin: issue.profitMargin,
        unitsSold: issue.unitsSold
      }
    };
  };
  
  // Convert legacy client-side suggestions
  const convertLegacySuggestion = (suggestion) => {
    if (typeof suggestion === 'string') {
      let priority = 'medium';
      let icon = Lightbulb;
      let category = 'General';
      
      if (suggestion.toLowerCase().includes('negative profit') || 
          suggestion.toLowerCase().includes('losing money') ||
          suggestion.toLowerCase().includes('unprofitable') ||
          suggestion.toLowerCase().includes('incurring a loss')) {
        priority = 'critical';
        icon = AlertTriangle;
        category = 'Critical Issue';
      } else if (suggestion.toLowerCase().includes('very low margin') ||
                 suggestion.toLowerCase().includes('low margin') ||
                 suggestion.toLowerCase().includes('below 10%')) {
        priority = 'high';
        icon = TrendingUp;
        category = 'Margin Optimization';
      } else if (suggestion.toLowerCase().includes('optimize') || 
                 suggestion.toLowerCase().includes('consider') ||
                 suggestion.toLowerCase().includes('review')) {
        priority = 'medium';
        icon = Target;
        category = 'Optimization';
      } else if (suggestion.toLowerCase().includes('ppc') ||
                 suggestion.toLowerCase().includes('ad spend') ||
                 suggestion.toLowerCase().includes('campaigns')) {
        priority = 'medium';
        icon = Zap;
        category = 'PPC Optimization';
      }
      
      return {
        message: suggestion,
        priority,
        type: 'profitability',
        icon,
        category
      };
    }
    return suggestion;
  };
  
  // Build suggestions array from appropriate source
  const suggestions = useBackendIssues
    ? issuesData.map(convertBackendIssue)
    : suggestionsData.map(convertLegacySuggestion);

  // Show skeleton when loading backend issues and no data yet (initial load)
  const showIssuesSkeleton = issuesLoading && !(issuesData?.length > 0);
  
  // Get suggestions to display based on showAllSuggestions state
  // For backend issues, show all fetched issues (pagination is handled via "Load More")
  // For legacy suggestions, show first 5 unless expanded
  const suggestionsToDisplay = useBackendIssues 
    ? suggestions  // Show all fetched backend issues
    : (showAllSuggestions ? suggestions : suggestions.slice(0, 5));
  
  // Calculate potential impact summary (use backend summary if available)
  const criticalSuggestions = useBackendIssues && issuesSummary?.bySeverity
    ? Array(issuesSummary.bySeverity.critical || 0).fill({ priority: 'critical' })
    : suggestions.filter(s => s.priority === 'critical');
  const highPrioritySuggestions = useBackendIssues && issuesSummary?.bySeverity
    ? Array(issuesSummary.bySeverity.high || 0).fill({ priority: 'high' })
    : suggestions.filter(s => s.priority === 'high');
  const mediumPrioritySuggestions = useBackendIssues && issuesSummary?.bySeverity
    ? Array(issuesSummary.bySeverity.medium || 0).fill({ priority: 'medium' })
    : suggestions.filter(s => s.priority === 'medium');
    
  // Total issues count (from backend if available)
  const totalIssuesCount = useBackendIssues && issuesSummary 
    ? issuesSummary.totalIssues 
    : suggestions.length;

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'from-red-500 to-red-600';
      case 'high': return 'from-amber-500 to-orange-600';
      case 'medium': return 'from-blue-500 to-blue-600';
      default: return 'from-gray-400 to-gray-500';
    }
  };

  const getPriorityBg = (priority) => {
    switch (priority) {
      case 'critical': return 'border-red-500/30';
      case 'high': return 'border-amber-500/30';
      case 'medium': return 'border-blue-500/30';
      default: return 'border-gray-500/30';
    }
  };

  const getPriorityText = (priority) => {
    switch (priority) {
      case 'critical': return '#f87171';
      case 'high': return '#fb923c';
      case 'medium': return '#60a5fa';
      default: return '#9ca3af';
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'critical': return { background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' };
      case 'high': return { background: 'rgba(251, 146, 60, 0.2)', color: '#fb923c', borderColor: 'rgba(251, 146, 60, 0.3)' };
      case 'medium': return { background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' };
      default: return { background: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af', borderColor: 'rgba(156, 163, 175, 0.3)' };
    }
  };
  
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: '#161b22', border: '1px solid #30363d' }}>
      {/* Enhanced Header */}
      <div className="p-3 border-b" style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" style={{ color: '#f3f4f6' }} />
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>AI-Powered Suggestions</h3>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: '#9ca3af' }}>Total Issues</div>
            <div className="text-base font-bold" style={{ color: totalIssuesCount > 0 ? '#f87171' : '#22c55e' }}>
              {issuesLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : totalIssuesCount}
            </div>
          </div>
        </div>

        {/* Priority Summary Cards */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            {criticalSuggestions.length > 0 && (
              <div className="p-2 rounded border" style={{ background: '#161b22', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <AlertTriangle className="w-3 h-3" style={{ color: '#f87171' }} />
                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#f87171' }}>Critical</span>
                </div>
                <div className="text-sm font-bold" style={{ color: '#f87171' }}>{criticalSuggestions.length}</div>
              </div>
            )}
            
            {highPrioritySuggestions.length > 0 && (
              <div className="p-2 rounded border" style={{ background: '#161b22', borderColor: 'rgba(251, 146, 60, 0.3)' }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <TrendingUp className="w-3 h-3" style={{ color: '#fb923c' }} />
                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#fb923c' }}>High</span>
                </div>
                <div className="text-sm font-bold" style={{ color: '#fb923c' }}>{highPrioritySuggestions.length}</div>
              </div>
            )}
            
            {mediumPrioritySuggestions.length > 0 && (
              <div className="p-2 rounded border" style={{ background: '#161b22', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Target className="w-3 h-3" style={{ color: '#60a5fa' }} />
                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#60a5fa' }}>Medium</span>
                </div>
                <div className="text-sm font-bold" style={{ color: '#60a5fa' }}>{mediumPrioritySuggestions.length}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggestions Content */}
      <div className="p-3">
        {showIssuesSkeleton ? (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="p-2 rounded border flex items-start gap-2"
                style={{ background: '#161b22', borderColor: '#30363d' }}
              >
                <div className="flex-shrink-0 w-3.5 h-3.5 rounded bg-[#30363d] animate-pulse mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-4 w-16 rounded bg-[#30363d] animate-pulse" />
                    <div className="h-4 w-20 rounded bg-[#30363d] animate-pulse" />
                  </div>
                  <div className="rounded animate-pulse" style={{ height: '0.75rem', width: i === 0 ? '95%' : `${85 - i * 5}%`, background: '#30363d' }} />
                </div>
              </div>
            ))}
          </div>
        ) : suggestionsToDisplay.length > 0 ? (
          <div className="space-y-2">
            <AnimatePresence>
              {suggestionsToDisplay.map((suggestion, index) => {
                const IconComponent = suggestion.icon || Lightbulb;
                const badgeStyle = getPriorityBadge(suggestion.priority);
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`p-2 rounded border transition-all duration-200`}
                    style={{ background: '#161b22', borderColor: badgeStyle.borderColor }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#161b22'}
                  >
                    <div className="flex items-start gap-2">
                      {/* Priority Indicator & Icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        <IconComponent className="w-3.5 h-3.5" style={{ color: getPriorityText(suggestion.priority) }} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border" style={{ background: badgeStyle.background, color: badgeStyle.color, borderColor: badgeStyle.borderColor }}>
                            {suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af' }}>
                            {suggestion.category}
                          </span>
                        </div>
                        
                        <p className="text-[11px] leading-relaxed" style={{ color: getPriorityText(suggestion.priority) }}>
                          {suggestion.message}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Show More/Less Button - for local pagination */}
            {suggestions.length > 5 && !useBackendIssues && (
              <div className="flex justify-center pt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-medium rounded border transition-all duration-200"
                  style={{ background: '#1a1a1a', borderColor: '#30363d', color: '#60a5fa', fontSize: '11px' }}
                  onMouseEnter={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.background = '#161b22'; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = '#30363d'; e.target.style.background = '#1a1a1a'; }}
                >
                  {showAllSuggestions ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      <span>Show Less</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      <span>Show {suggestions.length - 5} More</span>
                    </>
                  )}
                </motion.button>
              </div>
            )}
            
            {/* Load More Button - for backend pagination */}
            {useBackendIssues && hasMore && onLoadMore && (
              <div className="flex justify-center pt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onLoadMore}
                  disabled={issuesLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-medium rounded border transition-all duration-200"
                  style={{ 
                    background: '#1a1a1a', 
                    borderColor: '#30363d', 
                    color: issuesLoading ? '#6b7280' : '#60a5fa', 
                    fontSize: '11px',
                    opacity: issuesLoading ? 0.7 : 1,
                    cursor: issuesLoading ? 'not-allowed' : 'pointer'
                  }}
                  onMouseEnter={(e) => { if (!issuesLoading) { e.target.style.borderColor = '#3b82f6'; e.target.style.background = '#161b22'; }}}
                  onMouseLeave={(e) => { e.target.style.borderColor = '#30363d'; e.target.style.background = '#1a1a1a'; }}
                >
                  {issuesLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      <span>Load More Issues ({totalIssuesCount - suggestions.length} remaining)</span>
                    </>
                  )}
                </motion.button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="flex flex-col items-center gap-2">
              <Shield className="w-5 h-5" style={{ color: '#22c55e' }} />
              <div>
                <h3 className="text-sm font-medium mb-1" style={{ color: '#f3f4f6' }}>All Good! 🎉</h3>
                <p className="text-xs" style={{ color: '#9ca3af' }}>No critical optimization suggestions at this time.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuggestionList;