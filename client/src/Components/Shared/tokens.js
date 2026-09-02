// Redesign design tokens (SellerQI Redesign — Design Documentation, section 1.3/1.4).
// Kept as plain JS (not Tailwind config) so this library stays self-contained
// and doesn't require touching the app's existing tailwind.config.js / index.css.

export const COLORS = {
  bgBase: '#0B0E14',
  surface: '#151A23',
  surfaceElevated: '#1C2230',
  border: '#252C3A',
  borderStrong: '#3B4658',
  textPrimary: '#F5F7FA',
  textSecondary: '#A5AEC0',
  textMuted: '#6B7486',
  good: '#22C55E',
  watch: '#F5A623',
  fix: '#EF4444',
  setup: '#3B82F6',
  accent: '#3B82F6',
};

export const STATUS = {
  GOOD: 'good',
  WATCH: 'watch',
  FIX: 'fix',
  SETUP: 'setup',
};

// Word label always pairs with color + icon (never color alone) per the
// three-tier status rule — keeps this accessible to color-blind users.
const STATUS_CONFIG = {
  [STATUS.GOOD]: { label: 'Good', color: COLORS.good, bg: 'rgba(34,197,94,0.14)', icon: '●' },
  [STATUS.WATCH]: { label: 'Watch', color: COLORS.watch, bg: 'rgba(245,166,35,0.14)', icon: '⚑' },
  [STATUS.FIX]: { label: 'Fix', color: COLORS.fix, bg: 'rgba(239,68,68,0.14)', icon: '▲' },
  [STATUS.SETUP]: { label: 'Set up', color: COLORS.setup, bg: 'rgba(59,130,246,0.14)', icon: '◆' },
};

export const getStatusConfig = (status) => STATUS_CONFIG[status] || STATUS_CONFIG[STATUS.SETUP];

export const TYPOGRAPHY = {
  pageTitle: 'text-2xl font-semibold leading-8 tracking-tight',
  sectionTitle: 'text-lg font-semibold leading-6 tracking-tight',
  kpiValue: 'text-[30px] leading-9 font-bold tracking-tight tabular-nums',
  cardLabel: 'text-xs font-semibold uppercase tracking-wide',
  body: 'text-sm leading-5',
  caption: 'text-xs leading-4',
};
