import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { PALETTE } from '../../Components/ESF/estoreFactoryTheme.js';

/**
 * "Overview" — the landing page of the Estore Factory section on a client's own
 * account (nav: Estore Factory > Overview). Recreates the layout and copy of
 * deploy/index.html, but recolored to the app's own blue-accented dark theme
 * (Components/ESF/estoreFactoryTheme.js, sourced from Shared/tokens.js) rather
 * than the mock's original near-black/orange scheme, so this section reads as
 * part of SellerQI. Shared with the rest of the Estore Factory section
 * (Status, Untapped, Reports, Messages, Billing) so the palette lives in one place.
 *
 * Data reality check: only the header (brand name, connected marketplaces) has a
 * real backend source today — both already ship on state.Auth.user via
 * getUserById (server/Services/User/userServices.js). Everything below the
 * header (tasks in progress, tickets, next report, "what we're working on",
 * account manager, recent activity, the opportunity callout) describes an
 * ESF-staff-driven account-management workflow that has no backend yet — no
 * assigned-manager model, no client activity log, no staff task queue distinct
 * from the seller's own Tasks page. Those sections render the mock's own sample
 * content verbatim so the page matches the design exactly; wiring them to real
 * data needs that backend built first.
 */
/** Country code -> Amazon storefront domain. Matches the codes used at connect
 * time in Pages/Onboarding/ConnectToAmazon.jsx (UK, not GB). Extend as more
 * marketplaces are onboarded; unlisted codes fall back to a generic label. */
const MARKETPLACE_DOMAIN = {
    US: 'Amazon.com', CA: 'Amazon.ca', MX: 'Amazon.com.mx', BR: 'Amazon.com.br',
    UK: 'Amazon.co.uk', DE: 'Amazon.de', FR: 'Amazon.fr', IT: 'Amazon.it',
    ES: 'Amazon.es', NL: 'Amazon.nl', SE: 'Amazon.se', PL: 'Amazon.pl',
    IN: 'Amazon.in', JP: 'Amazon.co.jp', AU: 'Amazon.com.au', SG: 'Amazon.sg', AE: 'Amazon.ae',
};

const StatCard = ({ label, value, valueColor, sub, subColor, tone, href }) => (
    <a
        href={href}
        onClick={(e) => e.preventDefault()}
        className="flex flex-col gap-3 rounded-lg p-5 pb-[18px] transition-colors"
        style={{
            background: tone === 'alert' ? PALETTE.amberBg : PALETTE.surface,
            border: `1px solid ${tone === 'alert' ? PALETTE.amberBorder : PALETTE.border}`,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = tone === 'alert' ? 'rgba(245,166,35,.5)' : PALETTE.borderHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = tone === 'alert' ? PALETTE.amberBorder : PALETTE.border; }}
    >
        <span className="text-[12.5px]" style={{ color: tone === 'alert' ? PALETTE.amberLabel : PALETTE.textSecondary }}>{label}</span>
        <span className="text-[34px] font-semibold leading-none tracking-[-0.02em]" style={{ color: valueColor }}>{value}</span>
        <span className="text-xs" style={{ color: subColor || PALETTE.textMuted }}>{sub}</span>
    </a>
);

const STATUS_BADGE = {
    'In progress': { bg: 'rgba(34,197,94,.11)', color: PALETTE.good },
    'In review': { bg: 'rgba(34,197,94,.11)', color: PALETTE.good },
    'Waiting on Amazon': { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
    'Waiting on you': { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
};

const WorkItemRow = ({ text, status, time }) => (
    <div className="flex items-center gap-4 py-[15px]" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
        <span className="flex-1 text-[13.5px]" style={{ color: PALETTE.textBody }}>{text}</span>
        <span
            className="flex-none text-[11.5px] font-semibold px-2.5 py-1 rounded-md"
            style={{ background: STATUS_BADGE[status]?.bg, color: STATUS_BADGE[status]?.color }}
        >
            {status}
        </span>
        <span className="flex-none w-[88px] text-right text-xs" style={{ color: PALETTE.textMuted }}>{time}</span>
    </div>
);

/** Small icon glyph for a Recent Activity row. `kind` picks a shape + color to
 * match the mock's mix of dots, diamonds and bars — not meant to be a full icon
 * system, just enough variety to distinguish activity types at a glance. */
const ActivityGlyph = ({ kind }) => {
    const glyphs = {
        dot: <span className="w-[9px] h-[9px] rounded-full" style={{ background: PALETTE.good }} />,
        reply: <span className="w-2 h-2 rotate-45" style={{ background: PALETTE.textTertiary }} />,
        square: <span className="w-2 h-2 rounded-[1px]" style={{ background: '#8FA0B8' }} />,
        bar: <span className="w-[11px] h-1 rounded-[1px]" style={{ background: PALETTE.textTertiary }} />,
    };
    const bg = kind === 'dot' ? 'rgba(34,197,94,.1)' : 'rgba(255,255,255,.05)';
    return (
        <span className="flex-none w-[26px] h-[26px] rounded-md flex items-center justify-center" style={{ background: bg }}>
            {glyphs[kind]}
        </span>
    );
};

const ActivityRow = ({ kind, text, time }) => (
    <div className="flex items-center gap-3.5 py-[13px]" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
        <ActivityGlyph kind={kind} />
        <span className="flex-1 text-[13.5px]" style={{ color: PALETTE.textBody }}>{text}</span>
        <span className="flex-none text-xs" style={{ color: PALETTE.textMuted }}>{time}</span>
    </div>
);

// Sample content — see the file header note. Kept verbatim from deploy/index.html
// so the page matches the design; replace once a real work-item / activity-log
// backend exists.
const SAMPLE_WORK_ITEMS = [
    { text: 'Rewriting the bullet points on your digital kitchen scale listing', status: 'In progress', time: '2 hours ago' },
    { text: 'Restructuring your Sponsored Products campaigns around top converting keywords', status: 'In review', time: 'Yesterday' },
    { text: 'Filing reimbursement claims for 214 units lost in Amazon’s warehouses', status: 'Waiting on Amazon', time: '3 days ago' },
    { text: 'Building A+ content for the espresso tamper — we need your product photos', status: 'Waiting on you', time: '5 days ago' },
];

const SAMPLE_ACTIVITY = [
    { kind: 'dot', text: 'Keyword research finished for your milk frother line — 41 new terms added', time: '2h ago' },
    { kind: 'reply', text: 'Priya replied to your question about raising the PPC budget for Q4', time: '4h ago' },
    { kind: 'dot', text: 'Backend search terms updated across 12 ASINs', time: 'Yesterday' },
    { kind: 'square', text: 'August performance report published', time: '2d ago' },
    { kind: 'bar', text: 'Invoice EF-2041 paid — $2,400.00', time: '4d ago' },
    { kind: 'dot', text: 'Negative keywords added to 6 campaigns to cut wasted ad spend', time: '5d ago' },
    { kind: 'reply', text: 'Marcus answered your question about restock timing before Prime Day', time: '6d ago' },
    { kind: 'dot', text: 'Main image on the stainless steel kettle replaced with the new hero shot', time: 'Aug 24' },
];

const ClientDashboard = () => {
    const user = useSelector((state) => state.Auth?.user);

    // Same admission rule as the backend's esfClientOnly middleware (server/middlewares/
    // Auth/esfClientOnly.js): isEsfClient, or a superAdmin servicing the account.
    // user is null only for an instant on first load (ProtectedRouteWrapper populates
    // it); undefined here means "not decided yet", not "denied" — only redirect once
    // we actually know.
    if (user && user.isEsfClient !== true && user.accessType !== 'superAdmin') {
        return <Navigate to="/seller-central-checker/dashboard" replace />;
    }

    const marketplaces = (user?.sellerCentral?.sellerAccount || []).filter((acc) => acc.country);

    return (
        <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="max-w-[1170px] mx-auto flex flex-col gap-7 px-8 md:px-10 py-9 md:py-11">

                {/* Header */}
                <header className="flex flex-col gap-[7px]">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Overview</h1>
                    <div className="flex items-center gap-[9px] text-[13.5px]" style={{ color: PALETTE.textSecondary }}>
                        <span style={{ color: '#B7BDC6' }}>{user?.brand || 'Your Brand'}</span>
                        <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#4A5058' }} />
                        <span>Managed by eStore Factory</span>
                    </div>
                    {marketplaces.length > 0 && (
                        <div className="flex items-center gap-2.5 flex-wrap mt-[9px]">
                            <span className="text-[11.5px] tracking-[.04em] mr-0.5" style={{ color: PALETTE.textMuted }}>MARKETPLACES</span>
                            {marketplaces.map((acc, i) => {
                                const domain = MARKETPLACE_DOMAIN[acc.country] || `Amazon · ${acc.country}`;
                                const connected = Boolean(acc.spiRefreshToken);
                                return (
                                    <span
                                        key={`${acc.country}-${acc.region}-${i}`}
                                        className="flex items-center gap-[7px] text-[12.5px] px-[11px] py-[5px] rounded-md"
                                        style={{
                                            fontWeight: connected ? 600 : 400,
                                            color: connected ? PALETTE.textPrimary : PALETTE.textTertiary,
                                            background: connected ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.04)',
                                            border: `1px solid ${connected ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.08)'}`,
                                        }}
                                    >
                                        <span className="w-[5px] h-[5px] rounded-full" style={{ background: connected ? PALETTE.good : PALETTE.textMuted }} />
                                        {domain}{acc.country ? ` · ${acc.country}` : ''}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </header>

                {/* Stat row */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Tasks in progress" value="7" valueColor={PALETTE.good} sub="Your team is handling this" />
                    <StatCard label="Waiting on you" value="1" valueColor={PALETTE.amberValue} sub="1 item needs your reply" subColor={PALETTE.amberSub} tone="alert" />
                    <StatCard label="Open tickets" value="1" valueColor={PALETTE.textPrimary} sub="Last reply 4 hours ago" />
                    <StatCard label="Next report" value="Oct 3" valueColor={PALETTE.textPrimary} sub="September performance" />
                </section>

                {/* What we're working on | Your team */}
                <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5 items-start">

                    <div className="rounded-lg flex flex-col gap-1" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 16px' }}>
                        <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-[-0.01em]">What we&rsquo;re working on</h2>
                        {SAMPLE_WORK_ITEMS.map((item) => (
                            <WorkItemRow key={item.text} {...item} />
                        ))}
                        <div className="pt-3.5 pb-1.5" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                            <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                                View all 7 tasks →
                            </a>
                        </div>
                    </div>

                    <div className="rounded-lg flex flex-col gap-[18px]" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 24px' }}>
                        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Your team</h2>
                        <div className="flex items-center gap-3.5">
                            <div
                                className="w-14 h-14 rounded-full flex-none flex items-center justify-center text-[8px] font-medium"
                                style={{
                                    background: 'repeating-linear-gradient(135deg, #1E2228 0 6px, #252A31 6px 12px)',
                                    border: '1px solid rgba(255,255,255,.09)',
                                    color: '#7A8189',
                                    fontFamily: 'ui-monospace, Menlo, monospace',
                                }}
                            >
                                photo
                            </div>
                            <div className="flex flex-col gap-[5px]">
                                <span className="text-[15px] font-semibold">Priya Raghavan</span>
                                <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Your account manager</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-[9px]">
                            <a
                                href="#"
                                onClick={(e) => e.preventDefault()}
                                className="text-center text-[13.5px] font-semibold py-3 rounded-lg transition-colors"
                                style={{ background: PALETTE.accent, color: PALETTE.onAccentText }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = PALETTE.accentHover; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = PALETTE.accent; }}
                            >
                                Start a conversation
                            </a>
                            <span className="text-center text-xs" style={{ color: PALETTE.textMuted }}>Usually replies within a few hours</span>
                        </div>
                    </div>
                </section>

                {/* Recent activity */}
                <section className="rounded-lg flex flex-col" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 12px' }}>
                    <h2 className="m-0 mb-2 text-[15px] font-semibold tracking-[-0.01em]">Recent activity</h2>
                    {SAMPLE_ACTIVITY.map((item) => (
                        <ActivityRow key={item.text} {...item} />
                    ))}
                    <div className="py-3.5" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                        <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                            See full activity history →
                        </a>
                    </div>
                </section>

                {/* One thing worth looking at */}
                <section className="rounded-lg flex flex-col gap-[18px]" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '24px 26px 26px' }}>
                    <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">One thing worth looking at</h2>
                    <div className="flex flex-col md:flex-row items-start gap-8 md:gap-12">
                        <div className="flex-1 flex flex-col gap-2.5 max-w-[640px]">
                            <span className="text-[10.5px]" style={{ color: PALETTE.textFaint }}>From your account data · Within Amazon</span>
                            <span className="text-[17px] font-semibold tracking-[-0.015em]" style={{ color: PALETTE.textPrimary }}>Your brand store has never been built</span>
                            <p className="m-0 text-[13.5px] leading-[1.65]" style={{ color: PALETTE.textTertiary }}>
                                Shoppers who click your brand name from a listing land on a generic search page instead of a store.
                                That traffic already exists — roughly 6,400 clicks last month — and it converts about 18% better
                                when it reaches a proper store.
                            </p>
                        </div>
                        <div className="flex-none flex flex-col gap-3.5 items-start min-w-[190px]">
                            <div className="flex flex-col gap-1">
                                <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>ESTIMATED UPSIDE</span>
                                <span className="text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
                                    $3,800<span className="text-sm font-medium" style={{ color: PALETTE.textSecondary }}>/mo</span>
                                </span>
                            </div>
                            <a
                                href="#"
                                onClick={(e) => e.preventDefault()}
                                className="text-[13px] font-medium px-[18px] py-2.5 rounded-lg transition-colors"
                                style={{ border: '1px solid rgba(255,255,255,.16)', color: '#E8EAED' }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = PALETTE.accent; e.currentTarget.style.color = PALETTE.accentHover; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.16)'; e.currentTarget.style.color = '#E8EAED'; }}
                            >
                                Discuss this
                            </a>
                        </div>
                    </div>
                </section>

            </div>
        </div>
    );
};

export default ClientDashboard;
