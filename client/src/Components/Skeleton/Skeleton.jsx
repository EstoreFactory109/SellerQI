import React from 'react';

/**
 * Base skeleton bar - animated placeholder for text/lines
 */
export const SkeletonBar = ({ className = '', width = '100%', height = '1rem' }) => (
  <div
    className={`rounded bg-border-dark animate-pulse ${className}`}
    style={{ width, height }}
    aria-hidden
  />
);

/**
 * Skeleton card - placeholder for card content
 */
export const SkeletonCard = ({ className = '', children }) => (
  <div className={`rounded-xl border border-border-dark bg-surface overflow-hidden ${className}`} aria-hidden>
    {children || (
      <>
        <div className="p-6">
          <SkeletonBar height="1.25rem" width="60%" className="mb-4" />
          <SkeletonBar height="2rem" width="80%" className="mb-2" />
          <SkeletonBar height="1rem" width="40%" />
        </div>
      </>
    )}
  </div>
);

/**
 * Skeleton circle - for avatars or icons
 */
export const SkeletonCircle = ({ size = 12, className = '' }) => (
  <div
    className={`rounded-full bg-border-dark animate-pulse ${className}`}
    style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem` }}
    aria-hidden
  />
);

/**
 * Skeleton for stat/metric cards (Dashboard quick stats style)
 */
export const SkeletonStatCard = ({ className = '' }) => (
  <div
    className={`rounded-xl border border-border-dark p-6 bg-surface ${className}`}
    aria-hidden
  >
    <div className="flex items-center gap-3 mb-4">
      <div className="w-12 h-12 rounded-xl bg-border-dark animate-pulse" />
      <SkeletonBar height="0.875rem" width="8rem" />
    </div>
    <SkeletonBar height="2rem" width="70%" />
  </div>
);

/**
 * Generic content skeleton - rows of bars
 */
export const SkeletonContent = ({ rows = 4, className = '' }) => (
  <div className={`space-y-2 ${className}`} aria-hidden>
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonBar
        key={i}
        height={i === 0 ? '1rem' : '0.875rem'}
        width={i === 0 ? '40%' : `${90 - i * 10}%`}
      />
    ))}
  </div>
);

export default SkeletonBar;
