import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Estore Factory > Reports > Report History.
 *
 * Every edition of ONE report type, read from
 * GET /api/pagewise/esf/reports/:reportKey/history. The report is chosen by the
 * route (:reportKey), so each card on the Reports page now opens its own
 * history rather than all of them landing on one page.
 *
 * WHAT AN "EDITION" IS HERE
 * There is still no recurring-report model, so nothing stores a published
 * edition. What exists is the snapshot trail — every fetcher appends a document
 * per run and none of those collections is pruned — so one capture is one
 * edition. The page says that in as many words rather than printing a
 * publication time it cannot know; the backend sends that sentence, and it is
 * rendered verbatim.
 *
 * The date filter is applied client-side over the editions already fetched,
 * which is the whole set the API returns (capped at 40, newest first).
 */

const TONE_COLOR = {
    good: PALETTE.good,
    watch: PALETTE.amberValue,
    neutral: PALETTE.textTertiary,
};

const REPORTS_PAGE = '/seller-central-checker/estore-factory/reports';

const formatStat = (stat) => {
    if (stat.value === null || stat.value === undefined) return '—';
    if (typeof stat.value !== 'number') return stat.value;
    if (stat.format === 'percent') return `${stat.value}%`;
    if (stat.format === 'currency') return stat.value.toLocaleString();
    return stat.value.toLocaleString();
};

const StatCard = ({ stat }) => {
    const alert = stat.tone === 'watch' && Number(stat.value) > 0;
    const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;

    return (
        <div
            className="rounded-lg flex flex-col gap-[11px] p-5"
            style={{
                background: alert ? PALETTE.amberBg : PALETTE.surface,
                border: `1px solid ${alert ? PALETTE.amberBorder : PALETTE.border}`,
            }}
        >
            <span className="text-[12.5px]" style={{ color: alert ? PALETTE.amberLabel : PALETTE.textSecondary }}>
                {stat.label}
            </span>
            <span
                className="text-[32px] font-semibold tracking-[-0.02em] leading-none tabular-nums"
                style={{ color: alert ? PALETTE.amberValue : PALETTE.textPrimary }}
            >
                {formatStat(stat)}
                {stat.suffix && <span className="text-[15px] font-medium" style={{ color: PALETTE.textSecondary }}> {stat.suffix}</span>}
            </span>
            <span className="text-xs" style={{ color: alert ? PALETTE.amberSub : PALETTE.textMuted }}>
                {stat.delta === null || stat.delta === undefined
                    ? ' '
                    : stat.delta === 0
                        ? 'Unchanged since the previous edition'
                        : `${stat.delta > 0 ? '▲' : '▼'} ${Math.abs(stat.delta)} vs previous edition`}
            </span>
            {stat.delta !== null && stat.delta !== undefined && stat.delta !== 0 && (
                <span className="sr-only">{improved ? 'improved' : 'worsened'}</span>
            )}
        </div>
    );
};

const ReportHistory = () => {
    const navigate = useNavigate();
    // Older links land here with no key; the Buy Box report is the one the
    // original mock showed, so it stays the default rather than erroring.
    const { reportKey = 'buybox' } = useParams();

    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axiosInstance.get(`/api/pagewise/esf/reports/${reportKey}/history`);
            setHistory(res.data?.data || null);
            setFailed(false);
        } catch {
            setHistory(null);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [reportKey]);

    useEffect(() => { load(); }, [load]);

    // Changing report must not keep the previous one's date filter.
    useEffect(() => { setFrom(''); setTo(''); }, [reportKey]);

    const allEditions = useMemo(() => history?.editions || [], [history]);
    const editions = useMemo(
        () => allEditions.filter((e) => (!from || e.iso >= from) && (!to || e.iso <= to)),
        [allEditions, from, to]
    );

    const filtered = Boolean(from || to);
    const shownLabel = filtered
        ? `Showing ${editions.length} of ${allEditions.length}`
        : `${allEditions.length} ${allEditions.length === 1 ? 'edition' : 'editions'} on file`;

    const latest = allEditions[0] || null;

    return (
        <div
            className="flex w-full flex-1 flex-col"
            style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}
        >
            <div className="w-full max-w-[1170px] mx-auto flex flex-col gap-[26px] px-8 md:px-10 py-8 md:py-10">

                <div className="flex items-center gap-[9px] text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                    <button type="button" onClick={() => navigate(REPORTS_PAGE)} style={{ color: PALETTE.textTertiary }}>Reports</button>
                    <span>/</span>
                    <span style={{ color: PALETTE.textInputBody }}>{history?.name || 'Report history'}</span>
                </div>

                <header className="flex flex-col gap-2">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">
                        {loading ? 'Loading…' : history?.name || 'Report history'}
                    </h1>
                    <div className="flex items-center gap-[9px] text-[13.5px] flex-wrap" style={{ color: PALETTE.textSecondary }}>
                        {history?.cadence && (
                            <>
                                <span>{history.cadence.charAt(0) + history.cadence.slice(1).toLowerCase()}</span>
                                <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#4A5058' }} />
                            </>
                        )}
                        {history?.marketplace?.country && (
                            <>
                                <span style={{ color: PALETTE.textInputBody }}>Amazon {history.marketplace.country}</span>
                                <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#4A5058' }} />
                            </>
                        )}
                        <span>{loading ? '…' : shownLabel}</span>
                    </div>
                </header>

                {loading && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="rounded-lg animate-pulse" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, height: 116 }} />
                        ))}
                    </div>
                )}

                {!loading && (failed || !history?.available) && (
                    <section
                        className="rounded-lg flex flex-col gap-2"
                        style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: 24 }}
                    >
                        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textBody }}>
                            {failed ? 'History is unavailable right now' : 'No editions yet'}
                        </h2>
                        <p className="m-0 text-[13px] leading-[1.6] max-w-[640px]" style={{ color: PALETTE.textMuted }}>
                            {failed
                                ? 'We could not reach this report’s history. Refresh the page to try again.'
                                : history?.reason || 'Nothing has been captured for this report on this marketplace yet.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate(REPORTS_PAGE)}
                            className="self-start text-[12.5px] mt-1"
                            style={{ color: PALETTE.textSecondary }}
                        >
                            ← Back to reports
                        </button>
                    </section>
                )}

                {!loading && history?.available && (
                    <>
                        {history.stats?.length > 0 && (
                            <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {history.stats.map((stat) => <StatCard key={stat.label} stat={stat} />)}
                            </section>
                        )}

                        {latest && (
                            <section
                                className="rounded-lg flex flex-col gap-2"
                                style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.borderHover}`, padding: '20px 24px' }}
                            >
                                <div className="flex items-baseline gap-[10px] flex-wrap">
                                    <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Latest edition, {latest.date}</h2>
                                    <span className="flex-1 text-xs" style={{ color: PALETTE.textMuted }}>
                                        {latest.showCapturedTime
                                            ? `Captured ${new Date(latest.capturedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                                            : 'Covers the whole period'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => navigate(REPORTS_PAGE)}
                                        className="flex-none text-[12.5px]"
                                        style={{ color: PALETTE.textSecondary }}
                                    >
                                        Open full report →
                                    </button>
                                </div>
                                <p className="m-0 text-[15px] font-medium" style={{ color: TONE_COLOR[latest.tone] || PALETTE.textBody }}>
                                    {latest.summary}
                                </p>
                            </section>
                        )}

                        <section className="flex flex-col gap-[14px]">
                            <div className="flex items-center gap-3 flex-wrap">
                                <h2 className="m-0 text-[14.5px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textTertiary }}>
                                    Earlier editions
                                </h2>
                                <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textDim }}>{shownLabel}</span>
                                <span className="flex-none flex items-center gap-2">
                                    <input
                                        type="date"
                                        aria-label="Editions from"
                                        value={from}
                                        onChange={(e) => setFrom(e.target.value)}
                                        className="rounded-lg px-[10px] py-2 text-[12.5px] outline-none"
                                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, colorScheme: 'dark' }}
                                    />
                                    <span className="text-xs" style={{ color: PALETTE.textMuted }}>to</span>
                                    <input
                                        type="date"
                                        aria-label="Editions to"
                                        value={to}
                                        onChange={(e) => setTo(e.target.value)}
                                        className="rounded-lg px-[10px] py-2 text-[12.5px] outline-none"
                                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, colorScheme: 'dark' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setFrom(''); setTo(''); }}
                                        className="text-[12.5px] py-2 px-0.5"
                                        style={{ color: PALETTE.textSecondary }}
                                    >
                                        Reset
                                    </button>
                                </span>
                            </div>

                            <div
                                className="rounded-lg"
                                style={{ border: `1px solid ${PALETTE.dividerFaint}`, background: 'rgba(255,255,255,.012)', padding: '2px 22px 4px' }}
                            >
                                {editions.map((e, index) => (
                                    <div
                                        key={`${e.capturedAt || e.iso}-${index}`}
                                        className="flex items-center gap-5 py-[14px] flex-wrap sm:flex-nowrap"
                                        style={{ borderTop: `1px solid ${PALETTE.dividerFaint}` }}
                                    >
                                        <span className="flex-none w-[104px] text-[12.5px] tabular-nums" style={{ color: PALETTE.textInputBody }}>
                                            {e.date}
                                        </span>
                                        <span className="flex-1 min-w-0 text-[13px]" style={{ color: TONE_COLOR[e.tone] || PALETTE.textTertiary }}>
                                            {e.summary}
                                        </span>
                                        {e.showCapturedTime && (
                                            <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>
                                                Captured {new Date(e.capturedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {editions.length === 0 && (
                                    <div className="py-[26px] text-center text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                                        No editions captured in that range.
                                    </div>
                                )}
                            </div>

                            {/* Rendered verbatim from the API: what an edition actually is. */}
                            {history.capturedNote && (
                                <p className="m-0 text-[12px] leading-[1.6]" style={{ color: PALETTE.textDim }}>
                                    {history.capturedNote}
                                </p>
                            )}
                            {history.note && (
                                <p className="m-0 text-[12px] leading-[1.6]" style={{ color: PALETTE.textDim }}>
                                    {history.note}
                                </p>
                            )}
                        </section>
                    </>
                )}

            </div>
        </div>
    );
};

export default ReportHistory;
