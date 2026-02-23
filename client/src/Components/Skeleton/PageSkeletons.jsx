import React from 'react';
import { SkeletonBar, SkeletonStatCard, SkeletonCard, SkeletonContent } from './Skeleton.jsx';

/**
 * Content-only skeletons (no headings). Use these inside real page structure
 * so only the data-loading areas show placeholders.
 */

/** Single stat value placeholder - use inside a stat card that already has icon + label */
export const SkeletonStatValue = () => (
  <div className="rounded bg-border-dark animate-pulse h-6 w-20" aria-hidden />
);

/** Card body placeholder - use inside a card that already has a real title */
export const SkeletonCardBody = ({ rows = 4, showChart = false }) => (
  <div className="p-1.5" aria-hidden>
    <SkeletonContent rows={rows} />
    {showChart && <div className="mt-1.5 h-44 bg-surface-elevated rounded animate-pulse" />}
  </div>
);

/** Table body only - rows of skeleton bars (no card header) */
export const SkeletonTableBody = ({ rows = 8 }) => (
  <div className="divide-y divide-border-dark" aria-hidden>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="px-1.5 py-1.5 flex gap-1.5 items-center">
        <SkeletonBar height="1rem" width="15%" />
        <SkeletonBar height="1rem" width="25%" />
        <SkeletonBar height="1rem" width="20%" />
        <SkeletonBar height="1rem" width="15%" />
      </div>
    ))}
  </div>
);

/** Chart area only */
export const SkeletonChart = ({ height = 256 }) => (
  <div className="rounded-lg bg-surface-elevated animate-pulse" style={{ height }} aria-hidden />
);

/**
 * Campaign Analysis section skeleton - title, tab row, and table.
 * Matches PPCDashboard Campaign Analysis card layout (dark theme).
 */
export const CampaignAnalysisSkeleton = () => (
  <div className="bg-[#161b22] rounded border border-[#30363d] transition-all duration-300 overflow-hidden mb-2" aria-hidden>
    <div className="p-2 border-b border-[#30363d]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <SkeletonBar height="0.875rem" width="10rem" className="mb-1.5" />
          <SkeletonBar height="0.75rem" width="14rem" />
        </div>
      </div>
      {/* Tab row */}
      <div className="flex gap-6 mt-2">
        {[1, 2, 3, 4].map((i) => (
          <SkeletonBar key={i} height="0.75rem" width={i === 1 ? '6rem' : '5rem'} />
        ))}
      </div>
    </div>
    <div className="p-2" style={{ minHeight: '300px' }}>
      <div className="mb-2 flex gap-2">
        <SkeletonBar height="0.875rem" width="35%" />
        <SkeletonBar height="0.875rem" width="15%" />
        <SkeletonBar height="0.875rem" width="15%" />
        <SkeletonBar height="0.875rem" width="12%" />
      </div>
      <div className="divide-y divide-[#30363d]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="py-2 flex gap-2 items-center">
            <SkeletonBar height="0.75rem" width="40%" />
            <SkeletonBar height="0.75rem" width="12%" />
            <SkeletonBar height="0.75rem" width="12%" />
            <SkeletonBar height="0.75rem" width="10%" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Dashboard CONTENT ONLY - no headings. Use when page already rendered header + section titles.
 * Renders: 4 stat value placeholders, 3 card bodies, 1 table body.
 */
export const DashboardContentSkeleton = () => (
  <div className="animate-in fade-in duration-300">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-xl p-6 border border-border-dark bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-border-dark animate-pulse" />
            <SkeletonBar height="0.875rem" width="6rem" />
          </div>
          <SkeletonStatValue />
        </div>
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <SkeletonCard>
        <SkeletonCardBody rows={5} />
      </SkeletonCard>
      <div className="lg:col-span-2">
        <SkeletonCard>
          <div className="p-6">
            <SkeletonChart height={256} />
          </div>
        </SkeletonCard>
      </div>
    </div>
    <SkeletonCard>
      <div className="p-6">
        <SkeletonTableBody rows={4} />
      </div>
    </SkeletonCard>
  </div>
);

/**
 * Dashboard page skeleton - full layout (kept for backward compat). Prefer DashboardContentSkeleton
 * when page already shows real headers.
 */
export const DashboardSkeleton = () => <DashboardContentSkeleton />;

/**
 * Generic page skeleton - header + 2 card sections
 */
export const PageSkeleton = ({ statCards = 0, sections = 2 }) => (
  <div className="animate-in fade-in duration-300">
    {statCards > 0 && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: statCards }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
    )}
    <div className="space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <SkeletonCard key={i}>
          <div className="p-6">
            <SkeletonBar height="1.25rem" width="40%" className="mb-4" />
            <SkeletonContent rows={4} />
            {i === 0 && <div className="mt-4 h-48 bg-surface-elevated rounded-lg animate-pulse" />}
          </div>
        </SkeletonCard>
      ))}
    </div>
  </div>
);

/**
 * Table page skeleton - header + table with rows
 */
export const TablePageSkeleton = ({ rows = 8 }) => (
  <div className="animate-in fade-in duration-300">
    <div className="bg-surface rounded-2xl border border-border-dark overflow-hidden">
      <div className="p-6 border-b border-border-dark">
        <SkeletonBar height="1.25rem" width="35%" className="mb-2" />
        <SkeletonBar height="0.875rem" width="55%" />
      </div>
      <div className="p-6">
        <div className="overflow-hidden rounded-lg border border-border-dark">
          <div className="bg-surface-elevated px-4 py-3 flex gap-4">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonBar key={i} height="0.875rem" width="20%" />
            ))}
          </div>
          <div className="divide-y divide-border-dark">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="px-4 py-4 flex gap-4 items-center">
                <SkeletonBar height="1rem" width="15%" />
                <SkeletonBar height="1rem" width="25%" />
                <SkeletonBar height="1rem" width="20%" />
                <SkeletonBar height="1rem" width="15%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Chart + table page (e.g. Account History, Profitability)
 */
export const ChartAndTableSkeleton = () => (
  <div className="animate-in fade-in duration-300 space-y-8">
    <div className="bg-surface rounded-2xl border border-border-dark overflow-hidden">
      <div className="p-6 pb-0">
        <SkeletonBar height="1.25rem" width="45%" className="mb-2" />
        <SkeletonBar height="0.875rem" width="65%" className="mb-6" />
      </div>
      <div className="px-6 pb-6">
        <div className="h-64 bg-surface-elevated rounded-lg animate-pulse" />
      </div>
    </div>
    <TablePageSkeleton rows={6} />
  </div>
);

/**
 * Issues table skeleton rows - for Category page tables (4 columns: ASIN/SKU, Title, Issue Details, Solution)
 * Use inside <tbody> when loading.
 */
export const IssuesTableRowsSkeleton = ({ rows = 5 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} className="animate-pulse">
        <td className="py-2 px-2"><div className="h-4 bg-[#30363d] rounded w-24" aria-hidden /></td>
        <td className="py-2 px-2"><div className="h-4 bg-[#30363d] rounded w-32" aria-hidden /></td>
        <td className="py-2 px-2"><div className="h-4 bg-[#30363d] rounded w-48" aria-hidden /></td>
        <td className="py-2 px-2"><div className="h-4 bg-[#30363d] rounded w-40" aria-hidden /></td>
      </tr>
    ))}
  </>
);

/**
 * Tasks page skeleton (dark theme) - header, filters, table with 7 columns
 */
export const TasksPageSkeleton = ({ rows = 10 }) => (
  <div className="min-h-screen overflow-x-hidden w-full animate-in fade-in duration-300" style={{ background: '#1a1a1a', padding: '10px' }} aria-hidden>
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div className="rounded-lg mb-2.5 p-2.5 border border-[#30363d] bg-[#161b22]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-[#30363d] animate-pulse" />
            <div className="h-4 bg-[#30363d] rounded w-16 animate-pulse" />
            <div className="hidden sm:block h-5 bg-[#30363d] rounded w-32 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 bg-[#30363d] rounded-lg animate-pulse" />
            <div className="h-8 w-20 bg-[#30363d] rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
      {/* Filters */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-2 mb-2.5">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 h-8 bg-[#30363d] rounded-lg animate-pulse" />
          <div className="sm:w-40 h-8 bg-[#30363d] rounded-lg animate-pulse" />
          <div className="sm:w-36 h-8 bg-[#30363d] rounded-lg animate-pulse" />
        </div>
      </div>
      {/* Table */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
        <table className="w-full">
          <thead style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
            <tr>
              <th className="px-2 py-2 w-[60px]"><div className="h-3 bg-[#30363d] rounded w-10 animate-pulse" /></th>
              <th className="px-2 py-2 min-w-[200px]"><div className="h-3 bg-[#30363d] rounded w-24 animate-pulse" /></th>
              <th className="px-2 py-2 min-w-[130px]"><div className="h-3 bg-[#30363d] rounded w-20 animate-pulse" /></th>
              <th className="px-2 py-2 w-[110px]"><div className="h-3 bg-[#30363d] rounded w-24 animate-pulse" /></th>
              <th className="px-2 py-2"><div className="h-3 bg-[#30363d] rounded w-16 animate-pulse" /></th>
              <th className="px-2 py-2"><div className="h-3 bg-[#30363d] rounded w-24 animate-pulse" /></th>
              <th className="px-2 py-2 w-[100px]"><div className="h-3 bg-[#30363d] rounded w-14 animate-pulse" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #30363d' }}>
                <td className="px-2 py-2"><div className="h-4 bg-[#30363d] rounded w-8 animate-pulse" /></td>
                <td className="px-2 py-2"><div className="h-4 bg-[#30363d] rounded w-3/4 max-w-[200px] animate-pulse" /></td>
                <td className="px-2 py-2"><div className="h-4 bg-[#30363d] rounded w-24 animate-pulse" /></td>
                <td className="px-2 py-2"><div className="h-5 bg-[#30363d] rounded w-20 animate-pulse" /></td>
                <td className="px-2 py-2"><div className="h-4 bg-[#30363d] rounded w-full max-w-[180px] animate-pulse" /></td>
                <td className="px-2 py-2"><div className="h-4 bg-[#30363d] rounded w-full max-w-[160px] animate-pulse" /></td>
                <td className="px-2 py-2"><div className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 rounded bg-[#30363d] animate-pulse" /><div className="h-4 bg-[#30363d] rounded w-16 animate-pulse" /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#30363d] bg-[#21262d]">
          <div className="h-4 bg-[#30363d] rounded w-48 animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 bg-[#30363d] rounded-lg animate-pulse" />
            <div className="h-8 w-16 bg-[#30363d] rounded animate-pulse" />
            <div className="h-8 w-14 bg-[#30363d] rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Full Issues by Category page skeleton (dark theme)
 */
export const IssuesCategoryPageSkeleton = () => (
  <div className="min-h-screen bg-[#1a1a1a] animate-in fade-in duration-300" aria-hidden>
    <div className="bg-[#161b22] border border-[#30363d] rounded mb-2">
      <div className="px-2 py-2">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div>
            <div className="h-5 bg-[#30363d] rounded w-32 mb-1.5 animate-pulse" />
            <div className="h-3 bg-[#30363d] rounded w-48 animate-pulse" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-6 w-12 bg-[#30363d] rounded animate-pulse" />
            <div className="w-10 h-10 bg-[#30363d] rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
    <div className="px-2 py-2">
      <div className="bg-[#161b22] rounded border border-[#30363d] p-2 mb-2">
        <div className="h-4 bg-[#30363d] rounded w-24 mb-1 animate-pulse" />
        <div className="h-3 bg-[#30363d] rounded w-40 animate-pulse" />
        <div className="mt-2 h-8 bg-[#30363d] rounded w-[140px] animate-pulse" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden mb-2">
          <div className="bg-[#21262d] px-2 py-2 border-b border-[#30363d]">
            <div className="h-4 bg-[#30363d] rounded w-40 mb-1 animate-pulse" />
            <div className="h-3 bg-[#30363d] rounded w-56 animate-pulse" />
          </div>
          <div className="p-2">
            <div className="flex gap-2 mb-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-3 bg-[#30363d] rounded flex-1 animate-pulse" />
              ))}
            </div>
            <div className="divide-y divide-[#30363d]">
              {Array.from({ length: 4 }).map((_, k) => (
                <div key={k} className="py-2 flex gap-2">
                  <div className="h-4 bg-[#30363d] rounded w-24 animate-pulse" />
                  <div className="h-4 bg-[#30363d] rounded w-32 animate-pulse" />
                  <div className="h-4 bg-[#30363d] rounded flex-1 animate-pulse" />
                  <div className="h-4 bg-[#30363d] rounded w-40 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Single product card skeleton for Issues by Product page (dark theme)
 */
export const IssuesProductCardSkeleton = () => (
  <div className="bg-[#161b22] rounded border border-[#30363d] p-2 animate-pulse" aria-hidden>
    <div className="flex items-center justify-between border-b border-[#30363d] pb-2">
      <div className="flex space-x-2">
        <div className="w-12 h-12 rounded bg-[#30363d]" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-4 bg-[#30363d] rounded w-3/4" />
          <div className="flex gap-2">
            <div className="h-3 bg-[#30363d] rounded w-20" />
            <div className="h-3 bg-[#30363d] rounded w-16" />
          </div>
          <div className="h-5 bg-[#30363d] rounded w-24 mt-1.5" />
        </div>
      </div>
    </div>
    <div className="pt-2 flex gap-2 flex-wrap">
      <div className="h-6 bg-[#30363d] rounded w-16" />
      <div className="h-6 bg-[#30363d] rounded w-20" />
      <div className="h-6 bg-[#30363d] rounded w-14" />
    </div>
  </div>
);

/**
 * Full Issues by Product page skeleton (dark theme)
 */
export const IssuesByProductPageSkeleton = () => (
  <div className="space-y-2 animate-in fade-in duration-300" aria-hidden>
    <div className="bg-[#161b22] border border-[#30363d] rounded p-2">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div className="space-y-1">
          <div className="h-5 bg-[#30363d] rounded w-36 mb-1 animate-pulse" />
          <div className="h-3 bg-[#30363d] rounded w-52 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#21262d] border border-[#30363d] rounded p-2 h-14 animate-pulse" />
          <div className="bg-[#21262d] border border-[#30363d] rounded p-2 h-14 animate-pulse" />
        </div>
      </div>
    </div>
    <div className="bg-[#161b22] border border-[#30363d] rounded p-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="h-8 bg-[#30363d] rounded w-40 animate-pulse" />
        <div className="h-8 bg-[#30363d] rounded w-28 animate-pulse" />
        <div className="h-8 bg-[#30363d] rounded w-24 animate-pulse" />
      </div>
    </div>
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <IssuesProductCardSkeleton key={i} />
      ))}
    </div>
  </div>
);

/**
 * Product Details page skeleton (dark theme)
 * Matches layout: header, product card (image + details grid), performance card, issues section placeholders
 */
export const ProductDetailsPageSkeleton = () => (
  <div className="product-details-page bg-[#1a1a1a] lg:mt-0 mt-[10vh] h-screen overflow-y-auto animate-in fade-in duration-300" aria-hidden>
    <div className="p-2">
      {/* Page header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded mb-2">
        <div className="px-2 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-[#30363d] shrink-0 animate-pulse" />
            <div>
              <div className="h-5 bg-[#30363d] rounded w-32 mb-1 animate-pulse" />
              <div className="h-3 bg-[#30363d] rounded w-48 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 bg-[#30363d] rounded w-10 animate-pulse" />
            <div className="h-7 bg-[#30363d] rounded w-24 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="space-y-3 pb-1">
        {/* Section 1: Product details card */}
        <div className="bg-[#161b22] border border-[#30363d] rounded">
          <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-[#30363d] animate-pulse" />
              <div className="h-4 bg-[#30363d] rounded w-28 animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 bg-[#30363d] rounded w-20 animate-pulse" />
              <div className="h-8 bg-[#30363d] rounded w-24 animate-pulse" />
            </div>
          </div>
          <div className="p-3">
            <div className="flex flex-col md:flex-row md:items-start gap-4">
              <div className="w-20 h-20 bg-[#30363d] rounded shrink-0 animate-pulse" />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <div className="h-3 bg-[#30363d] rounded w-12 mb-1.5 animate-pulse" />
                  <div className="h-4 bg-[#30363d] rounded w-full max-w-md animate-pulse" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i}>
                      <div className="h-3 bg-[#30363d] rounded w-10 mb-1 animate-pulse" />
                      <div className="h-7 bg-[#30363d] rounded w-20 animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Performance card */}
        <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
          <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-[#30363d] animate-pulse" />
              <div className="h-4 bg-[#30363d] rounded w-24 animate-pulse" />
            </div>
            <div className="h-8 bg-[#30363d] rounded w-32 animate-pulse" />
          </div>
          <div className="p-3 border-b border-[#30363d]">
            <div className="h-3 bg-[#30363d] rounded w-36 mb-2 animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-[#21262d] rounded border border-[#30363d] p-2 h-16 animate-pulse" />
              ))}
            </div>
          </div>
          <div className="p-3">
            <div className="h-3 bg-[#30363d] rounded w-28 mb-2 animate-pulse" />
            <div className="h-56 bg-[#21262d] rounded border border-[#30363d] animate-pulse" />
          </div>
        </div>

        {/* Section 3 & 4: Issue sections placeholders */}
        {[1, 2].map((i) => (
          <div key={i} className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
            <div className="bg-[#21262d] border-b border-[#30363d] px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-[#30363d] animate-pulse" />
                <div className="h-4 bg-[#30363d] rounded w-32 animate-pulse" />
              </div>
            </div>
            <div className="p-3 space-y-2">
              <div className="h-4 bg-[#30363d] rounded w-full animate-pulse" />
              <div className="h-4 bg-[#30363d] rounded w-4/5 animate-pulse" />
              <div className="h-4 bg-[#30363d] rounded w-3/4 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default DashboardSkeleton;
