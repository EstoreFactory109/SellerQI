import React from 'react';
import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronUp, Loader2, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * SuggestionList - Displays profitability issues and suggestions in a table (same style as Issues pages)
 *
 * @param {Array} suggestionsData - Legacy client-side suggestions (strings)
 * @param {Array} issuesData - Backend-calculated profitability issues with recommendations
 * @param {Object} issuesSummary - Summary counts (totalIssues)
 * @param {boolean} issuesLoading - Loading state for issues
 * @param {Function} onLoadMore - Callback to load more issues
 * @param {boolean} hasMore - Whether more issues can be loaded
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

  const useBackendIssues = issuesData && issuesData.length > 0;

  // Convert backend issues to table rows: { asin, productName, issue, suggestion }
  const convertBackendIssue = (issue) => {
    let issueText = '';
    if (issue.issueType === 'negative_profit') {
      issueText = `Net profit is $${Math.abs(issue.netProfit || 0).toFixed(2)} negative (${(issue.profitMargin || 0).toFixed(1)}% margin). Sales: $${(issue.sales || 0).toFixed(2)}, Ads: $${(issue.adsSpend || 0).toFixed(2)}, Fees: $${(issue.amazonFees || 0).toFixed(2)}.`;
    } else {
      issueText = `Profit margin is only ${(issue.profitMargin || 0).toFixed(1)}% (below 10% threshold). Net profit: $${(issue.netProfit || 0).toFixed(2)} on $${(issue.sales || 0).toFixed(2)} sales.`;
    }
    const suggestionText = issue.recommendation
      ? (issue.recommendation.description || issue.recommendation.title || issue.recommendation.action || '')
      : 'Review pricing, PPC spend, and fees to improve profitability.';
    return {
      asin: issue.asin,
      productName: issue.productName || '—',
      issue: issueText,
      suggestion: suggestionText
    };
  };

  // Convert legacy client-side suggestions (string) to table rows
  const convertLegacySuggestion = (suggestion, index) => {
    if (typeof suggestion === 'string') {
      return {
        asin: `—`,
        productName: '—',
        issue: suggestion,
        suggestion: 'Review and optimize this product’s profitability.'
      };
    }
    return {
      asin: suggestion.asin || '—',
      productName: suggestion.productName || '—',
      issue: suggestion.message || suggestion.issue || '—',
      suggestion: suggestion.action || suggestion.suggestion || '—'
    };
  };

  const rows = useBackendIssues
    ? issuesData.map(convertBackendIssue)
    : suggestionsData.map((s, i) => convertLegacySuggestion(s, i));

  const showIssuesSkeleton = issuesLoading && !(issuesData?.length > 0);

  const totalIssuesCount = useBackendIssues && issuesSummary ? issuesSummary.totalIssues : rows.length;

  const rowsToDisplay = useBackendIssues
    ? rows
    : (showAllSuggestions ? rows : rows.slice(0, 10));

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: '#161b22', border: '1px solid #30363d' }}>
      <div className="p-3 border-b" style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" style={{ color: '#f3f4f6' }} />
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>AI-Powered Suggestions</h3>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: '#9ca3af' }}>Total Issues</div>
            <div className="text-base font-bold" style={{ color: totalIssuesCount > 0 ? '#f87171' : '#22c55e' }}>
              {issuesLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : totalIssuesCount}
            </div>
          </div>
        </div>
      </div>

      <div className="p-0">
        {showIssuesSkeleton ? (
          <div className="p-3 space-y-2" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 rounded border"
                style={{ background: '#21262d', borderColor: '#30363d' }}
              >
                <div className="animate-pulse h-full rounded" style={{ background: '#30363d', width: `${100 - i * 5}%` }} />
              </div>
            ))}
          </div>
        ) : rowsToDisplay.length > 0 ? (
          <>
            <div className="w-full overflow-x-auto">
              <table className="w-full table-fixed min-w-[600px]">
                <thead>
                  <tr className="bg-[#21262d]">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-28">ASIN</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/5">Product</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-2/5">Issue</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">Suggestion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {rowsToDisplay.map((row, idx) => (
                    <tr
                      key={idx}
                      className="text-sm text-gray-200 border-b border-[#30363d] hover:bg-[#21262d]/50"
                    >
                      <td className="py-2 px-2 align-top">
                        <span className="font-mono text-xs bg-[#21262d] px-1.5 py-0.5 rounded block break-words text-gray-100">{row.asin}</span>
                      </td>
                      <td className="py-2 px-2 align-top">
                        <span className="text-xs text-gray-300 leading-relaxed break-words line-clamp-2">{row.productName}</span>
                      </td>
                      <td className="py-2 px-2 align-top">
                        <p className="text-xs text-gray-300 leading-relaxed break-words">{row.issue}</p>
                      </td>
                      <td className="py-2 px-2 align-top">
                        <p className="text-xs text-green-400/90 bg-green-500/10 p-2 rounded border border-green-500/20 leading-relaxed break-words">{row.suggestion}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!useBackendIssues && rows.length > 10 && (
              <div className="flex justify-center py-2 border-t border-[#30363d]">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border"
                  style={{ background: '#21262d', borderColor: '#30363d', color: '#60a5fa' }}
                >
                  {showAllSuggestions ? (
                    <><ChevronUp className="w-3 h-3" /> Show Less</>
                  ) : (
                    <><ChevronDown className="w-3 h-3" /> Show {rows.length - 10} More</>
                  )}
                </motion.button>
              </div>
            )}

            {useBackendIssues && hasMore && onLoadMore && (
              <div className="flex justify-center py-2 border-t border-[#30363d]">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onLoadMore}
                  disabled={issuesLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: '#21262d', borderColor: '#30363d', color: issuesLoading ? '#6b7280' : '#60a5fa' }}
                >
                  {issuesLoading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Loading...</>
                  ) : (
                    <><ChevronDown className="w-3 h-3" /> Load More ({totalIssuesCount - rows.length} remaining)</>
                  )}
                </motion.button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <div className="flex flex-col items-center gap-2">
              <Shield className="w-5 h-5" style={{ color: '#22c55e' }} />
              <h3 className="text-sm font-medium" style={{ color: '#f3f4f6' }}>All Good!</h3>
              <p className="text-xs" style={{ color: '#9ca3af' }}>No profitability issues at this time.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuggestionList;
