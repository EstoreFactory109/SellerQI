import React from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { COLORS, InfoTooltip } from '../../Shared/index.js';

const BAR_COLOR = '#3B82F6';
const FLAG_COLOR = '#EF4444';

// "Issue mix" — where the open issues sit, by category. Same 6 category counts
// this component always used (donut chart before); now a plain bar list per
// the redesign, with the product-level "Top Products to Fix" panel dropped —
// that job now belongs to the real, $-ranked "Top Things to Fix" section.
const ProductChecker = ({ loading = false }) => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const navigate = useNavigate();

  const categories = [
    { key: 'Rankings', count: info?.TotalRankingerrors || 0, onView: () => navigate('/seller-central-checker/issues?tab=category&filter=Ranking') },
    { key: 'Conversion', count: info?.totalErrorInConversion || 0, onView: () => navigate('/seller-central-checker/issues?tab=category&filter=Conversion') },
    { key: 'Sponsored Ads', count: info?.totalSponsoredAdsErrors || 0, onView: () => navigate('/seller-central-checker/ppc-dashboard') },
    { key: 'Profitability', count: info?.totalProfitabilityErrors || 0, onView: () => navigate('/seller-central-checker/profitibility-dashboard') },
    { key: 'Inventory', count: info?.totalInventoryErrors || 0, onView: () => navigate('/seller-central-checker/issues?tab=category&filter=Inventory') },
    { key: 'Account & Policy', count: info?.totalErrorInAccount || 0, onView: () => navigate('/seller-central-checker/issues?tab=account') },
  ];

  const totalIssues = categories.reduce((sum, c) => sum + c.count, 0);
  const maxCount = Math.max(1, ...categories.map((c) => c.count));

  return (
    <div className="p-5 h-full flex flex-col">
      <div className="flex items-start gap-1.5 mb-1">
        <h2 className="m-0 text-lg font-semibold" style={{ color: COLORS.textPrimary }}>Issue mix</h2>
        <InfoTooltip text="Quick overview of product issues categorized by ranking, conversion, and account impact to help you prioritize fixes." />
      </div>
      <p className="m-0 mb-4 text-sm" style={{ color: COLORS.textSecondary }}>
        Where the {totalIssues.toLocaleString()} open issues sit. Counts, not urgency.
      </p>

      {loading ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 rounded animate-pulse" style={{ background: COLORS.border }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 flex-1 justify-center">
          {categories.map((cat) => {
            const widthPct = cat.count > 0 ? Math.max(2, (cat.count / maxCount) * 100) : 0;
            const isFlag = cat.key === 'Account & Policy' && cat.count > 0;
            return (
              <div key={cat.key}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-sm flex-1" style={{ color: COLORS.textPrimary }}>{cat.key}</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: COLORS.textPrimary }}>
                    {cat.count.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={cat.onView}
                    className="text-xs font-medium"
                    style={{ color: COLORS.accent }}
                  >
                    view
                  </button>
                </div>
                <div className="h-[5px] rounded-full overflow-hidden" style={{ background: COLORS.border }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${widthPct}%`, background: isFlag ? FLAG_COLOR : BAR_COLOR }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProductChecker;
