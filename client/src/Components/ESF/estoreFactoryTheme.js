/**
 * Shared color tokens for the "Estore Factory" client-facing section
 * (Overview, Status, Untapped, Reports, Report History, Messages, Billing —
 * client/src/Pages/ESF/EstoreFactory/*.jsx plus ClientDashboard.jsx).
 *
 * Deliberately its own near-black/orange palette, distinct from
 * Components/Shared/tokens.js's blue-accented redesign tokens — this section
 * is recreating a separate design (deploy/*.html) with its own visual
 * language. Kept local so a change to one palette can't drift the other.
 */
export const PALETTE = {
    bg: '#0B0C0E',
    surface: '#14161A',
    surfaceHover: '#171A1F',
    surfaceRaised: '#131720', // "Off Amazon" opportunity cards in Untapped
    border: 'rgba(255,255,255,.07)',
    borderHover: 'rgba(255,255,255,.16)',
    borderRaised: 'rgba(143,160,184,.16)',
    divider: 'rgba(255,255,255,.05)',
    dividerFaint: 'rgba(255,255,255,.04)',
    textPrimary: '#F2F4F7',
    textBody: '#DCE0E6',
    textSecondary: '#8A9099',
    textTertiary: '#9BA1AB',
    textMuted: '#6E747E',
    textFaint: '#787E88',
    textDim: '#565C66',
    textInputBody: '#B7BDC6',
    accent: '#FF7A1A',
    accentHover: '#FF8A2B',
    accentLight: '#FF9A4D',
    teal: '#5FD3C4',
    amberBg: 'rgba(245,166,35,.07)',
    amberBorder: 'rgba(245,166,35,.34)',
    amberLabel: '#E8B457',
    amberValue: '#F7B750',
    amberSub: '#C99B48',
    input: '#0F1114',
};

/** Row/card border-top divider used throughout every list in this section. */
export const dividerStyle = (color = PALETTE.divider) => ({ borderTop: `1px solid ${color}` });
