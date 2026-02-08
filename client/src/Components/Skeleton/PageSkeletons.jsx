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

export default DashboardSkeleton;
