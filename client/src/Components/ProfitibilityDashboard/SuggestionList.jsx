import React from 'react';
import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronUp, Loader2, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { COLORS } from '../Shared/index.js';

/**
 * SuggestionList - Displays profitability issues as one card per issue (loss figure + product + fix sentence)
 *
 * @param {Array} suggestionsData - Legacy client-side suggestions (strings)
 * @param {Array} issuesData - Backend-calculated profitability issues with recommendations
 * @param {Object} issuesSummary - Summary counts (totalIssues)
 * @param {boolean} issuesLoading - Loading state for issues
 * @param {Function} onLoadMore - Callback to load more issues
 * @param {boolean} hasMore - Whether more issues can be loaded
 * @param {Function} onFixNow - Callback invoked when a card's "Fix now" CTA is clicked
 */
const SuggestionList = ({
  suggestionsData = [],
  issuesData = [],
  issuesSummary = null,
  issuesLoading = false,
  onLoadMore,
  hasMore = false,
  onFixNow,
}) => {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const useBackendIssues = issuesData && issuesData.length > 0;

  // Convert backend issues to cards: { asin, productName, lossAmount, issue, suggestion }
  const convertBackendIssue = (issue) => {
    const netProfit = issue.netProfit || 0;
    let issueText = '';
    if (issue.issueType === 'negative_profit') {
      issueText = `Losing $${Math.abs(netProfit).toFixed(2)} on this product (${(issue.profitMargin || 0).toFixed(1)}% margin). Sales: $${(issue.sales || 0).toFixed(2)}, Ads: $${(issue.adsSpend || 0).toFixed(2)}, Fees: $${(issue.amazonFees || 0).toFixed(2)}.`;
    } else {
      issueText = `Profit margin is only ${(issue.profitMargin || 0).toFixed(1)}% (below 10% threshold). Net profit: $${netProfit.toFixed(2)} on $${(issue.sales || 0).toFixed(2)} sales.`;
    }
    const suggestionText = issue.recommendation
      ? (issue.recommendation.description || issue.recommendation.title || issue.recommendation.action || '')
      : 'Review pricing, PPC spend, and fees to improve profitability.';
    return {
      asin: issue.asin,
      productName: issue.productName || '—',
      lossAmount: netProfit < 0 ? netProfit : null,
      issue: issueText,
      suggestion: suggestionText,
    };
  };

  // Convert legacy client-side suggestions (string) to cards
  const convertLegacySuggestion = (suggestion) => {
    if (typeof suggestion === 'string') {
      return {
        asin: '—',
        productName: '—',
        lossAmount: null,
        issue: suggestion,
        suggestion: 'Review and optimize this product’s profitability.',
      };
    }
    return {
      asin: suggestion.asin || '—',
      productName: suggestion.productName || '—',
      lossAmount: null,
      issue: suggestion.message || suggestion.issue || '—',
      suggestion: suggestion.action || suggestion.suggestion || '—',
    };
  };

  const rows = useBackendIssues
    ? issuesData.map(convertBackendIssue)
    : suggestionsData.map((s) => convertLegacySuggestion(s));

  const showIssuesSkeleton = issuesLoading && !(issuesData?.length > 0);

  const totalIssuesCount = useBackendIssues && issuesSummary ? issuesSummary.totalIssues : rows.length;

  const rowsToDisplay = useBackendIssues
    ? rows
    : (showAllSuggestions ? rows : rows.slice(0, 10));

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
      <div className="p-3 border-b" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" style={{ color: COLORS.textPrimary }} />
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.textPrimary }}>Issues & suggestions</h3>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: COLORS.textSecondary }}>Total Issues</div>
            <div className="text-base font-bold" style={{ color: totalIssuesCount > 0 ? '#F87171' : COLORS.good }}>
              {issuesLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : totalIssuesCount}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3">
        {showIssuesSkeleton ? (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded border"
                style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border }}
              >
                <div className="animate-pulse h-full rounded" style={{ background: COLORS.border, width: `${100 - i * 5}%` }} />
              </div>
            ))}
          </div>
        ) : rowsToDisplay.length > 0 ? (
          <>
            <div className="flex flex-col gap-2">
              {rowsToDisplay.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-lg p-3"
                  style={{ background: COLORS.surfaceElevated, borderLeft: '3px solid #EF4444', border: `1px solid ${COLORS.border}`, borderLeftWidth: '3px' }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {row.lossAmount != null && (
                          <span className="text-sm font-bold" style={{ color: '#F87171' }}>
                            Losing ${Math.abs(row.lossAmount).toFixed(2)}
                          </span>
                        )}
                        <span className="text-xs font-medium truncate" style={{ color: COLORS.textPrimary }}>{row.productName}</span>
                        {row.asin !== '—' && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: '#60a5fa', background: 'rgba(59,130,246,0.15)' }}>{row.asin}</span>
                        )}
                      </div>
                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: COLORS.textSecondary }}>{row.suggestion || row.issue}</p>
                    </div>
                    {onFixNow && (
                      <button
                        type="button"
                        onClick={() => onFixNow(row.asin)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        style={{ background: COLORS.accent, color: '#061021' }}
                      >
                        Fix now
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!useBackendIssues && rows.length > 10 && (
              <div className="flex justify-center py-2 mt-1 border-t" style={{ borderColor: COLORS.border }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border"
                  style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border, color: '#60a5fa' }}
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
              <div className="flex justify-center py-2 mt-1 border-t" style={{ borderColor: COLORS.border }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onLoadMore}
                  disabled={issuesLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: COLORS.surfaceElevated, borderColor: COLORS.border, color: issuesLoading ? COLORS.textMuted : '#60a5fa' }}
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
              <Shield className="w-5 h-5" style={{ color: COLORS.good }} />
              <h3 className="text-sm font-medium" style={{ color: COLORS.textPrimary }}>All Good!</h3>
              <p className="text-xs" style={{ color: COLORS.textSecondary }}>No profitability issues at this time.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuggestionList;
