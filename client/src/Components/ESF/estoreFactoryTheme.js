import { COLORS } from '../Shared/tokens.js';

/**
 * Color tokens for the "Estore Factory" client-facing section
 * (Overview, Status, Untapped, Reports, Report History, Messages, Billing —
 * client/src/Pages/ESF/EstoreFactory/*.jsx plus ClientDashboard.jsx).
 *
 * Sourced from Components/Shared/tokens.js — the same blue-accented dark
 * palette as the rest of the app (Dashboard.jsx, LeftNavSection.jsx) — rather
 * than the near-black/orange scheme the deploy/*.html mocks shipped with, so
 * this section reads as part of SellerQI rather than a bolted-on prototype.
 * `accentHover`/`accentLight`/`onAccentText` are the exact hex values already
 * used everywhere else a blue CTA appears (see Dashboard.jsx's "Ask QMate"
 * button and its `Q` badges) — kept as literals here (not COLORS-exported)
 * only because tokens.js doesn't export them.
 */
export const PALETTE = {
    bg: COLORS.bgBase,
    surface: COLORS.surface,
    surfaceHover: COLORS.surfaceElevated,
    surfaceRaised: COLORS.surfaceElevated, // "Off Amazon" opportunity cards in Untapped
    border: COLORS.border,
    borderHover: COLORS.borderStrong,
    borderRaised: COLORS.borderStrong,
    divider: COLORS.border,
    dividerFaint: COLORS.border,
    textPrimary: COLORS.textPrimary,
    textBody: COLORS.textPrimary,
    textSecondary: COLORS.textSecondary,
    textTertiary: COLORS.textSecondary,
    textMuted: COLORS.textMuted,
    textFaint: COLORS.textMuted,
    textDim: COLORS.textMuted,
    textInputBody: COLORS.textSecondary,
    accent: COLORS.accent,       // #3B82F6 — same brand blue as every other primary CTA
    accentHover: '#5A97F8',
    accentLight: '#7EA8F8',
    onAccentText: '#061021',    // text/icon color on a solid-accent button, matching Dashboard.jsx
    good: COLORS.good,          // #22C55E — "in progress" / positive markers (was teal in the mock)
    amberBg: 'rgba(245,166,35,.07)',
    amberBorder: 'rgba(245,166,35,.34)',
    amberLabel: COLORS.watch,
    amberValue: COLORS.watch,
    amberSub: COLORS.watch,
    input: COLORS.surfaceElevated,
};

/** Row/card border-top divider used throughout every list in this section. */
export const dividerStyle = (color = PALETTE.divider) => ({ borderTop: `1px solid ${color}` });
