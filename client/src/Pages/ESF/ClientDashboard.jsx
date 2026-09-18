import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, Link } from 'react-router-dom';
import { PALETTE } from '../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../config/axios.config.js';
// Read from the pages these cards summarise, so Overview can never show a number
// that page disagrees with.
import { INITIAL_THREADS, openThreadCount } from './EstoreFactory/Messages.jsx';
import { NEXT_REPORT } from './EstoreFactory/Reports.jsx';

/**
 * "Overview" — the landing page of the Estore Factory section on a client's own
 * account (nav: Estore Factory > Overview). Recreates the layout and copy of
 * deploy/index.html, but recolored to the app's own blue-accented dark theme
 * (Components/ESF/estoreFactoryTheme.js, sourced from Shared/tokens.js) rather
 * than the mock's original near-black/orange scheme, so this section reads as
 * part of SellerQI. Shared with the rest of the Estore Factory section
 * (Status, Untapped, Reports, Messages, Billing) so the palette lives in one place.
 *
 * Everything here is real now. The counts, the work list, the teams engaged, the
 * recent activity and the opportunity callout all come from the same nightly Zoho
 * sync the Status page reads (GET /api/pagewise/esf/project-status), so this page
 * is a SUMMARY of that one and the two can never disagree.
 *
 * It calls the Status endpoint rather than growing its own: that response is already
 * cached server-side for 300s, and a second endpoint returning a subset of the same
 * rows is how two surfaces drift apart.
 *
 * The one rule this page inherits and must keep: no individual is ever named. The
 * work is attributed to a TEAM (see ZohoProjectTaskModel.team), and the summaries
 * are redacted at sync time. The mock this page was built from named an account
 * manager and quoted staff by first name in the activity feed; both are gone.
 *
 * Sections with no backend at all — open support tickets, the next report date —
 * were dropped rather than left showing invented numbers.
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

/** Each card is a doorway to the section it summarises — the mock's cards looked
 *  clickable but swallowed the click, so they now actually navigate. */
const StatCard = ({ label, value, valueColor, sub, subColor, tone, href }) => (
    <Link
        to={href}
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
    </Link>
);

const STATUS_BADGE = {
    'In progress': { bg: 'rgba(34,197,94,.11)', color: PALETTE.good },
    'Waiting on you': { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
    'Starting soon': { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
};

const STATUS_PAGE = '/seller-central-checker/estore-factory/status';
const MESSAGES_PAGE = '/seller-central-checker/estore-factory/messages';
const REPORTS_PAGE = '/seller-central-checker/estore-factory/reports';

const EmptyLine = ({ children }) => (
    <div className="py-[15px] text-[13px]" style={{ borderTop: `1px solid ${PALETTE.divider}`, color: PALETTE.textMuted }}>
        {children}
    </div>
);

/** "2 hours ago" / "Yesterday" / "Aug 24" — same scale as the Status page. */
const relativeTime = (value) => {
    if (!value) return '';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    if (mins < 2880) return 'Yesterday';
    if (mins < 10080) return `${Math.round(mins / 1440)}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const money = (amount, currencyCode = 'USD') => {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency', currency: currencyCode || 'USD', maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        return `${Math.round(amount).toLocaleString('en-US')}`;
    }
};

/** Clamp to two lines without depending on a Tailwind plugin being enabled. */
const CLAMP_2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * One line of "What we're working on".
 *
 * Carries the AI progress summary, which is the whole point of this section — the
 * task NAME alone ("Details", "Progress update") tells a client nothing, and the
 * summary is what turns it into an update they can actually read.
 */
const WorkItemRow = ({ task, status }) => (
    <div className="flex items-start gap-4 py-[15px]" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
            <span className="text-[13.5px]" style={{ color: PALETTE.textBody }}>{task.name}</span>
            {task.summary && (
                <span className="text-[12.5px] leading-[1.55]" style={{ color: PALETTE.textTertiary, ...CLAMP_2 }}>
                    {task.summary}
                </span>
            )}
            {task.team && (
                <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{task.team}</span>
            )}
        </div>
        <span
            className="flex-none text-[11.5px] font-semibold px-2.5 py-1 rounded-md"
            style={{ background: STATUS_BADGE[status]?.bg, color: STATUS_BADGE[status]?.color }}
        >
            {status}
        </span>
        <span className="flex-none w-[88px] text-right text-xs" style={{ color: PALETTE.textMuted }}>
            {relativeTime(task.lastUpdateAt || task.updatedAt)}
        </span>
    </div>
);

/** Small icon glyph for a Recent Activity row. */
/** Every activity row is a completion, so there is one glyph rather than the mock's
 *  assortment of shapes for event types that do not exist here. */
const ActivityGlyph = () => (
    <span className="flex-none w-[26px] h-[26px] rounded-md flex items-center justify-center" style={{ background: 'rgba(34,197,94,.1)' }}>
        <span className="w-[9px] h-[9px] rounded-full" style={{ background: PALETTE.good }} />
    </span>
);

const ActivityRow = ({ text, time }) => (
    <div className="flex items-center gap-3.5 py-[13px]" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
        <ActivityGlyph />
        <span className="flex-1 min-w-0 text-[13.5px] truncate" style={{ color: PALETTE.textBody }}>{text}</span>
        <span className="flex-none text-xs" style={{ color: PALETTE.textMuted }}>{time}</span>
    </div>
);

const ClientDashboard = () => {
    const user = useSelector((state) => state.Auth?.user);

    // The same payload the Status page renders. Read once here and summarised below,
    // so the two pages cannot report different numbers for the same work.
    const [board, setBoard] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadBoard = useCallback(async () => {
        try {
            const res = await axiosInstance.get('/api/pagewise/esf/project-status');
            setBoard(res.data?.data || null);
        } catch {
            // Fails quiet: the header above still renders, and every section below
            // degrades to its own empty state rather than the page erroring out.
            setBoard(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadBoard(); }, [loadBoard]);

    // Same admission rule as the backend's esfClientOnly middleware (server/middlewares/
    // Auth/esfClientOnly.js): isEsfClient, or a superAdmin servicing the account.
    // user is null only for an instant on first load (ProtectedRouteWrapper populates
    // it); undefined here means "not decided yet", not "denied" — only redirect once
    // we actually know.
    if (user && user.isEsfClient !== true && user.accessType !== 'superAdmin') {
        return <Navigate to="/seller-central-checker/dashboard" replace />;
    }

    const marketplaces = (user?.sellerCentral?.sellerAccount || []).filter((acc) => acc.country);

    const openTickets = openThreadCount(INITIAL_THREADS);

    const linked = Boolean(board?.linked);
    const inProgress = board?.inProgress || [];
    const waitingOnYou = board?.waitingOnYou || [];
    const completed = board?.completed || [];
    const comingUp = board?.comingUp || [];

    // Tasks the client is blocking, first — that is the only part of this page that
    // asks something of them. The rest is newest-activity-first.
    const blockedIds = new Set(waitingOnYou.map((w) => w.taskId));
    const workItems = [...inProgress]
        .sort((a, b) => {
            const blocked = Number(blockedIds.has(b.id)) - Number(blockedIds.has(a.id));
            if (blocked !== 0) return blocked;
            return new Date(b.lastUpdateAt || b.updatedAt || 0) - new Date(a.lastUpdateAt || a.updatedAt || 0);
        })
        .slice(0, 4);

    // Distinct teams actually engaged, replacing the named account manager the mock
    // had here. Never an individual.
    const teams = [...new Set(inProgress.map((t) => t.team).filter(Boolean))];

    // Recently finished work, newest first — a real activity feed in place of the
    // invented one.
    const activity = [...completed]
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        .slice(0, 6)
        .map((t) => ({ text: `${t.name} — completed`, time: relativeTime(t.updatedAt) }));

    // The biggest thing nobody has picked up yet, straight from the audit. Already
    // filtered against open Zoho tasks at sync time, so it is never something the
    // team is quietly already doing.
    const topFinding = comingUp.find((t) => t.source === 'suggested' && t.amount > 0)
        || comingUp.find((t) => t.source === 'suggested');

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
                {/* This page summarises the whole Estore Factory section, not just Status,
                    so the row spans it: two counts from Status, one from Messages, one from
                    Reports. The last two have no backend yet and are read from those pages'
                    own data rather than hardcoded again here — a summary that contradicts
                    the page it links to is worse than no summary. */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="Tasks in progress"
                        value={loading ? '—' : String(inProgress.length)}
                        valueColor={PALETTE.good}
                        sub="Your team is handling this"
                        href={STATUS_PAGE}
                    />
                    <StatCard
                        label="Waiting on you"
                        value={loading ? '—' : String(waitingOnYou.length)}
                        valueColor={waitingOnYou.length > 0 ? PALETTE.amberValue : PALETTE.textPrimary}
                        sub={waitingOnYou.length === 0
                            ? 'Nothing needs your reply'
                            : `${waitingOnYou.length} item${waitingOnYou.length === 1 ? '' : 's'} need${waitingOnYou.length === 1 ? 's' : ''} your reply`}
                        subColor={waitingOnYou.length > 0 ? PALETTE.amberSub : undefined}
                        // Amber only when something is actually outstanding — a permanent
                        // warning colour over a zero trains people to ignore it.
                        tone={waitingOnYou.length > 0 ? 'alert' : undefined}
                        href={STATUS_PAGE}
                    />
                    <StatCard
                        label="Open tickets"
                        value={String(openTickets)}
                        valueColor={PALETTE.textPrimary}
                        sub={openTickets === 0 ? 'Nothing open' : `${openTickets} conversation${openTickets === 1 ? '' : 's'} in progress`}
                        href={MESSAGES_PAGE}
                    />
                    <StatCard
                        label="Next report"
                        value={NEXT_REPORT.due}
                        valueColor={PALETTE.textPrimary}
                        sub={NEXT_REPORT.name}
                        href={REPORTS_PAGE}
                    />
                </section>

                {/* What we're working on | Your team */}
                <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5 items-start">

                    <div className="rounded-lg flex flex-col gap-1" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 16px' }}>
                        <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-[-0.01em]">What we&rsquo;re working on</h2>

                        {loading && <EmptyLine>Loading…</EmptyLine>}
                        {!loading && !linked && <EmptyLine>No project is connected to your account yet.</EmptyLine>}
                        {!loading && linked && workItems.length === 0 && <EmptyLine>Nothing is in progress right now.</EmptyLine>}

                        {workItems.map((task) => (
                            <WorkItemRow
                                key={task.id}
                                task={task}
                                status={blockedIds.has(task.id) ? 'Waiting on you' : 'In progress'}
                            />
                        ))}

                        {inProgress.length > 0 && (
                            <div className="pt-3.5 pb-1.5" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                                <Link to={STATUS_PAGE} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                                    View all {inProgress.length} task{inProgress.length === 1 ? '' : 's'} →
                                </Link>
                            </div>
                        )}
                    </div>

                    {/* Was a named account manager with a photo placeholder. Individuals
                        are never identified to a client, so this shows which teams are
                        actually engaged on the account instead — real, and useful in a way
                        a single name was not. */}
                    <div className="rounded-lg flex flex-col gap-[18px]" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 24px' }}>
                        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Your team</h2>

                        {teams.length === 0 ? (
                            <span className="text-[13px]" style={{ color: PALETTE.textMuted }}>
                                {loading ? 'Loading…' : 'No work is assigned right now.'}
                            </span>
                        ) : (
                            <div className="flex flex-col gap-2.5">
                                <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                                    {teams.length} team{teams.length === 1 ? '' : 's'} working on your account
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {teams.map((team) => (
                                        <span
                                            key={team}
                                            className="text-[12.5px] px-[11px] py-[5px] rounded-md"
                                            style={{ background: 'rgba(255,255,255,.06)', border: `1px solid ${PALETTE.border}`, color: PALETTE.textTertiary }}
                                        >
                                            {team}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col gap-[9px]">
                            <Link
                                to={STATUS_PAGE}
                                className="text-center text-[13.5px] font-semibold py-3 rounded-lg transition-colors"
                                style={{ background: PALETTE.accent, color: PALETTE.onAccentText }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = PALETTE.accentHover; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = PALETTE.accent; }}
                            >
                                {waitingOnYou.length > 0
                                    ? `Respond to ${waitingOnYou.length} item${waitingOnYou.length === 1 ? '' : 's'}`
                                    : 'See what we\u2019re working on'}
                            </Link>
                            <span className="text-center text-xs" style={{ color: PALETTE.textMuted }}>
                                {board?.syncedAt ? `Updated ${relativeTime(board.syncedAt)}` : 'Updated daily'}
                            </span>
                        </div>
                    </div>
                </section>

                {/* Recent activity */}
                <section className="rounded-lg flex flex-col" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 24px 12px' }}>
                    <h2 className="m-0 mb-2 text-[15px] font-semibold tracking-[-0.01em]">Recent activity</h2>

                    {/* Real completions from the nightly sync. The mock's version quoted
                        staff by first name ("<name> replied to your question…"); this names
                        only the work. */}
                    {activity.length === 0 ? (
                        <EmptyLine>{loading ? 'Loading…' : 'Nothing completed in the last 30 days.'}</EmptyLine>
                    ) : (
                        activity.map((item, i) => <ActivityRow key={`${item.text}-${i}`} {...item} />)
                    )}

                    {completed.length > activity.length && (
                        <div className="py-3.5" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                            <Link to={STATUS_PAGE} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                                See all {completed.length} completed →
                            </Link>
                        </div>
                    )}
                </section>

                {/* One thing worth looking at — the top unaddressed audit finding, with
                    the figure the Dashboard already reports. Hidden entirely when the team
                    has everything covered, rather than padded with a filler suggestion. */}
                {topFinding && (
                    <section className="rounded-lg flex flex-col gap-[18px]" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '24px 26px 26px' }}>
                        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">One thing worth looking at</h2>
                        <div className="flex flex-col md:flex-row items-start gap-8 md:gap-12">
                            <div className="flex-1 flex flex-col gap-2.5 max-w-[640px]">
                                <span className="text-[10.5px]" style={{ color: PALETTE.textFaint }}>
                                    From your account data · Nobody is working on this yet
                                </span>
                                <span className="text-[17px] font-semibold tracking-[-0.015em]" style={{ color: PALETTE.textPrimary }}>
                                    {topFinding.name}
                                </span>
                                {topFinding.action && (
                                    <p className="m-0 text-[13.5px] leading-[1.65]" style={{ color: PALETTE.textTertiary }}>
                                        {topFinding.action}
                                    </p>
                                )}
                            </div>
                            {topFinding.amount > 0 && (
                                <div className="flex-none flex flex-col gap-3.5 items-start min-w-[190px]">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>ESTIMATED UPSIDE</span>
                                        <span className="text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
                                            {money(topFinding.amount, topFinding.currencyCode)}
                                        </span>
                                    </div>
                                    <Link
                                        to={STATUS_PAGE}
                                        className="text-[13px] font-medium px-[18px] py-2.5 rounded-lg transition-colors"
                                        style={{ border: '1px solid rgba(255,255,255,.16)', color: '#E8EAED' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = PALETTE.accent; e.currentTarget.style.color = PALETTE.accentHover; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.16)'; e.currentTarget.style.color = '#E8EAED'; }}
                                    >
                                        Discuss this
                                    </Link>
                                </div>
                            )}
                        </div>
                    </section>
                )}

            </div>
        </div>
    );
};

export default ClientDashboard;
