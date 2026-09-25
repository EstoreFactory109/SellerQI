import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../../config/axios.config.js';
import { PALETTE, dividerStyle } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Untapped — upside the agency has spotted but nobody has started.
 *
 * Real data since this replaced the mock. The agency writes each opportunity as a
 * subtask under "Within Amazon" or "Off Amazon" in the Zoho tasklist "Untapped", with
 * the money and the explanation in its description; the nightly sync parses those and
 * this page renders them. So the page is only ever as current as the last sync, which
 * is why the header says when that was — on something refreshed once a day, "empty"
 * and "broken" look identical without it.
 *
 * ── NOTHING ON THIS PAGE IS INVENTED ANY MORE ──
 * It used to open with a hardcoded "$14,450/mo" over a hand-computed six-segment bar,
 * none of which came from anywhere. The total is now summed server-side from the same
 * rows the cards render, so the headline and the cards cannot disagree. The old "show 3
 * more opportunities" table is gone entirely: Zoho has no notion of a lesser
 * opportunity, so it could only ever have stayed empty or gone back to being fiction.
 *
 * "Discuss this" books time on the existing consultation link rather than posting
 * anywhere — a conversation about scoping work is a conversation, and we already have
 * a calendar for it. "Not interested" stays local to the card, as it always was: it is
 * a way to quieten the page while reading it, not a preference worth storing.
 */

/** Longest first, so the bar reads big-to-small like the cards do. */
const BAR_COLORS = [PALETTE.accent, '#2F5FCB', '#6B7684', '#4A525C', '#3B424B', '#31373F'];

/** Where "Discuss this" goes — the same Calendly consultation the rest of the app uses. */
const CONSULTATION_PATH = '/seller-central-checker/consultation';

const SECTIONS = {
    within: {
        heading: 'Within Amazon',
        blurb: 'Upside available on the marketplace itself, using tools your account already has.',
        eyebrow: 'From your account data',
    },
    off: {
        heading: 'Off Amazon',
        blurb: 'Ways to bring demand in from outside the marketplace and point it at your listings.',
        eyebrow: 'Noted by your team',
    },
};

const money = (amount, currencyCode = 'USD') => {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode || 'USD',
            maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        // An unrecognised currency code must not blank the figure.
        return `${Math.round(amount).toLocaleString('en-US')}`;
    }
};

/** `month` -> `/mo`. Null for a one-off, which reads as a plain figure. */
const periodSuffix = (period) => {
    if (!period || period === 'once') return null;
    return { month: '/mo', year: '/yr', week: '/wk' }[period] || `/${period}`;
};

const relativeTime = (value) => {
    if (!value) return '—';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '—';
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const SectionEmpty = ({ children }) => (
    <div className="py-8 text-center text-[13px]" style={{ color: PALETTE.textMuted }}>{children}</div>
);

const CardShell = ({ children, background, borderColor }) => (
    <div
        className="rounded-lg flex flex-col gap-4 transition-all"
        style={{ background, border: `1px solid ${borderColor}`, padding: '22px 22px 18px' }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,.35)'; e.currentTarget.style.borderColor = PALETTE.borderHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = borderColor; }}
    >
        {children}
    </div>
);

const OpportunityCard = ({ opp, eyebrow, raised, onDiscuss }) => {
    const [hidden, setHidden] = useState(false);
    const background = raised ? PALETTE.surfaceRaised : PALETTE.surface;
    const borderColor = raised ? PALETTE.borderRaised : PALETTE.border;
    const suffix = periodSuffix(opp.period);

    if (hidden) {
        return (
            <CardShell background={background} borderColor={borderColor}>
                <div className="flex items-center gap-3">
                    <span className="flex-1 text-[13px]" style={{ color: PALETTE.textMuted }}>
                        {opp.title} — hidden
                    </span>
                    <button type="button" onClick={() => setHidden(false)} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Undo</button>
                </div>
            </CardShell>
        );
    }

    return (
        <CardShell background={background} borderColor={borderColor}>
            <div className="flex-1 min-h-0 flex flex-col gap-3.5">
                <span className="self-start text-[10.5px]" style={{ color: PALETTE.textFaint }}>{eyebrow}</span>
                <span className="text-[16.5px] font-semibold leading-[1.35] tracking-[-0.01em]" style={{ color: PALETTE.textPrimary }}>{opp.title}</span>

                {/*
                    A card with no figure still earns its place. The agency wrote the
                    explanation; only the price line failed to parse, and showing the
                    words without a number beats dropping the opportunity entirely.
                */}
                {opp.amount !== null && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[31px] font-semibold tracking-[-0.025em] leading-none" style={{ color: '#FFFFFF' }}>
                            {money(opp.amount, opp.currencyCode)}
                            {suffix && <span className="text-[15px] font-medium" style={{ color: PALETTE.textSecondary }}>{suffix}</span>}
                        </span>
                        {opp.amountLabel && (
                            <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{opp.amountLabel}</span>
                        )}
                    </div>
                )}

                <p className="m-0 text-[13px] leading-[1.65] whitespace-pre-wrap" style={{ color: PALETTE.textTertiary }}>{opp.body}</p>
            </div>

            <div className="flex items-center gap-4 pt-3.5" style={dividerStyle()}>
                <button
                    type="button"
                    onClick={onDiscuss}
                    className="text-[12.5px] font-medium px-4 py-[9px] rounded-lg"
                    style={{ color: PALETTE.textBody, border: `1px solid ${PALETTE.borderHover}` }}
                >
                    Discuss this
                </button>
                <button type="button" onClick={() => setHidden(true)} className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Not interested</button>
            </div>
        </CardShell>
    );
};

const OpportunitySection = ({ section, items, currencyCode, loading, error, linked, onDiscuss }) => {
    const meta = SECTIONS[section];
    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-[5px]">
                <h2 className="m-0 text-base font-bold tracking-[-0.01em]">{meta.heading}</h2>
                <span className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>{meta.blurb}</span>
            </div>

            {loading ? (
                <SectionEmpty>Loading your opportunities…</SectionEmpty>
            ) : error ? (
                <SectionEmpty>{error}</SectionEmpty>
            ) : !linked ? (
                <SectionEmpty>
                    No Zoho project is connected to your account yet — your account manager connects one from the portal.
                </SectionEmpty>
            ) : items.length === 0 ? (
                <SectionEmpty>Nothing here yet. Your team adds opportunities as they spot them.</SectionEmpty>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px] items-stretch">
                    {items.map((o) => (
                        <OpportunityCard
                            key={o.id}
                            opp={{ ...o, currencyCode }}
                            eyebrow={meta.eyebrow}
                            raised={section === 'off'}
                            onDiscuss={onDiscuss}
                        />
                    ))}
                </div>
            )}
        </section>
    );
};

const Untapped = () => {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError('');
            const res = await axiosInstance.get('/api/pagewise/esf/untapped');
            setData(res.data?.data || null);
        } catch (err) {
            setLoadError(err.response?.data?.message || 'Could not load your untapped opportunities');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const within = data?.within || [];
    const off = data?.off || [];
    const all = [...within, ...off];
    const currencyCode = data?.currencyCode || 'USD';
    const total = data?.totalAmount || 0;

    /**
     * The bar, built from the opportunities themselves.
     *
     * Only those with a figure can have a width, and a total of zero means no bar at
     * all rather than a division by zero — which is what a page full of unparsed
     * descriptions would otherwise produce.
     */
    const priced = all.filter((o) => o.amount > 0).sort((a, b) => b.amount - a.amount);
    const segments = total > 0
        ? priced.slice(0, BAR_COLORS.length).map((o, i) => ({
            id: o.id,
            label: o.title,
            amount: o.amount,
            color: BAR_COLORS[i],
            width: (o.amount / total) * 100,
        }))
        : [];

    // One period for the headline. They are in practice all monthly; if they ever are
    // not, showing no suffix is better than asserting the wrong one.
    const periods = new Set(priced.map((o) => o.period).filter(Boolean));
    const heroSuffix = periods.size === 1 ? periodSuffix([...periods][0]) : null;

    return (
        <div className="flex w-full flex-1 flex-col" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="w-full max-w-[1170px] mx-auto flex flex-col gap-[34px] px-4 sm:px-8 md:px-10 py-9 md:py-11">

                <header className="flex flex-col gap-2">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Untapped</h1>
                    <p className="m-0 text-[13.5px] leading-[1.6] max-w-[720px]" style={{ color: PALETTE.textSecondary }}>
                        Upside that is available on your account but not being worked on yet. Nothing here is urgent, and nothing here is behind.
                        {data?.syncedAt && (
                            <span style={{ color: PALETTE.textMuted }}> Updated {relativeTime(data.syncedAt)}.</span>
                        )}
                    </p>
                </header>

                {/* Hidden until there is something true to put in it. */}
                {!loading && !loadError && total > 0 && (
                    <section
                        className="rounded-lg flex flex-col md:flex-row md:items-end gap-[52px]"
                        style={{ background: `radial-gradient(120% 180% at 0% 0%, rgba(59,130,246,.08) 0%, rgba(20,22,26,0) 55%), ${PALETTE.surface}`, border: `1px solid ${PALETTE.borderHover}`, padding: '26px 28px 24px' }}
                    >
                        <div className="flex-none flex flex-col gap-[7px]">
                            <span className="text-[11.5px] tracking-[.06em]" style={{ color: PALETTE.textMuted }}>IDENTIFIED UPSIDE</span>
                            <span className="text-[46px] font-semibold tracking-[-0.03em] leading-none tabular-nums" style={{ color: '#FFFFFF' }}>
                                {money(total, currencyCode)}
                                {heroSuffix && <span className="text-[17px] font-medium" style={{ color: PALETTE.textSecondary }}>{heroSuffix}</span>}
                            </span>
                            <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                                Across {all.length} opportunit{all.length === 1 ? 'y' : 'ies'}
                            </span>
                        </div>
                        <div className="flex-1 flex flex-col gap-3 pb-1">
                            <div className="flex gap-[3px] h-2 rounded-full overflow-hidden">
                                {segments.map((s) => (
                                    <span key={s.id} style={{ width: `${s.width}%`, background: s.color, borderRadius: 99 }} />
                                ))}
                            </div>
                            <div className="flex flex-wrap gap-x-[22px] gap-y-2">
                                {segments.map((s) => (
                                    <span key={s.id} className="flex items-center gap-[7px] text-xs" style={{ color: PALETTE.textTertiary }}>
                                        <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: s.color }} />
                                        <span className="truncate max-w-[220px]">{s.label}</span>
                                        <span style={{ color: PALETTE.textMuted }}>{money(s.amount, currencyCode)}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                <OpportunitySection
                    section="within"
                    items={within}
                    currencyCode={currencyCode}
                    loading={loading}
                    error={loadError}
                    linked={Boolean(data?.linked)}
                    onDiscuss={() => navigate(CONSULTATION_PATH)}
                />

                <OpportunitySection
                    section="off"
                    items={off}
                    currencyCode={currencyCode}
                    loading={loading}
                    error={loadError}
                    linked={Boolean(data?.linked)}
                    onDiscuss={() => navigate(CONSULTATION_PATH)}
                />

            </div>
        </div>
    );
};

export default Untapped;
