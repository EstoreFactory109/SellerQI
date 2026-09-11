import { useState } from 'react';
import { PALETTE, dividerStyle } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Untapped — recreates deploy/untapped.html exactly.
 *
 * Every "Discuss this" / "Not interested" interaction here is local UI state
 * only, exactly matching the mock's own Component class (a plain in-memory
 * `cards` dictionary, no API calls) — there is no untapped-opportunity model
 * on the backend, so "Send to Priya" only flips this card's own local state
 * to "sent"; nothing is actually delivered anywhere yet.
 */
const OPPORTUNITIES = [
    {
        id: 'a1', eyebrow: 'From your account data',
        title: 'Nine of your listings have no A+ content',
        amount: '$2,100', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'These nine ASINs get 31,000 views a month between them and convert about 3 points below your listings that do have A+ modules. It is usually the last thing added when a catalogue grows quickly.',
        meta: ['Medium effort', 'About 3 weeks', '9 listings'],
        sendTo: 'Priya', hiddenLabel: 'Nine of your listings have no A+ content — hidden',
    },
    {
        id: 'a2', eyebrow: 'From your account data',
        title: 'None of your top five products have video',
        amount: '$1,450', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'Kitchen products with a short demo video hold shoppers on the page noticeably longer. Your kettle and frother are the two where a 20-second clip would answer the questions your reviews keep raising.',
        meta: ['Medium effort', 'About 4 weeks', 'Kettle + frother first'],
        sendTo: 'Priya', hiddenLabel: 'No video on your top five products — hidden',
    },
    {
        id: 'a3', eyebrow: 'From your account data',
        title: 'Reimbursements from 2024 are still unclaimed',
        amount: '$4,380', amountLabel: 'recoverable, one-off',
        body: 'Sixty-two units were damaged or lost in fulfilment centres before we started working together. Amazon’s claim window closes 18 months after the event, so the oldest of these expire in November.',
        meta: ['Light effort', 'Filed within a week', 'Oldest expire in November'],
        sendTo: 'Priya', hiddenLabel: 'Unclaimed 2024 reimbursements — hidden',
    },
    {
        id: 'a4', eyebrow: 'From your account data',
        title: 'Your brand store has never been built',
        amount: '$3,800', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'Shoppers who land on a brand store browse more of the catalogue than they do from a single listing, and it is the only place your range reads as one brand. Brand Registry is already in place, so the store is available to build whenever you want it.',
        meta: ['Larger project', '4 to 5 weeks', 'Brand Registry in place'],
        sendTo: 'Priya', hiddenLabel: 'Brand store not built — hidden',
    },
];

const OFF_AMAZON = [
    {
        id: 't1', eyebrow: 'Noted by your team',
        title: 'You have no website of your own',
        amount: '$3,600', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'People search "Kessler kitchen scale" about 2,900 times a month and land on retailers reselling you. A simple brand site that pushes those searches to your Amazon listings would keep that demand yours, and it makes Brand Referral Bonus credits available.',
        meta: ['Larger project', '6 to 8 weeks', 'Unlocks referral credits'],
        sendTo: 'Priya', hiddenLabel: 'No brand website — hidden',
    },
    {
        id: 't2', eyebrow: 'Noted by your team',
        title: 'Nothing is driving outside traffic to your listings',
        amount: '$2,400', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'Every sale you make right now comes from inside Amazon. Your unboxing photos do well on Pinterest for competitors in this category, and off-Amazon traffic also improves how your listings rank organically.',
        meta: ['Light to start', 'Ongoing', 'Pinterest and email first'],
        sendTo: 'Marcus', hiddenLabel: 'No external traffic — hidden',
    },
    {
        id: 't3', eyebrow: 'Noted by your team',
        title: 'The brand has no social presence at all',
        amount: '$1,100', amountSuffix: '/mo', amountLabel: 'estimated upside',
        body: 'Kitchen gear does well in short-form video, and right now there is nowhere for a curious shopper to look you up. A modest, consistent account gives the external traffic work somewhere to send people back from.',
        meta: ['Light to start', 'Ongoing', 'Instagram first'],
        sendTo: 'Priya', hiddenLabel: 'No social presence — hidden',
    },
];

const SMALLER = [
    { id: 'x2', text: 'Twelve listings are missing backend search terms entirely', tag: 'WITHIN AMAZON', amount: '$980', amountSuffix: '/mo' },
    { id: 'x3', text: 'The frother range is not enrolled in Subscribe & Save', tag: 'WITHIN AMAZON', amount: '$1,240', amountSuffix: '/mo' },
    { id: 'x4', text: 'No email list to launch new products into', tag: 'OFF AMAZON', amount: '$740', amountSuffix: '/mo' },
];

const LEGEND = [
    { label: 'Brand store', amount: '$3,800', color: PALETTE.accent, width: 26.3 },
    { label: 'Brand website', amount: '$3,600', color: '#2F5FCB', width: 24.9 },
    { label: 'External traffic', amount: '$2,400', color: '#6B7684', width: 16.6 },
    { label: 'A+ content', amount: '$2,100', color: '#4A525C', width: 14.5 },
    { label: 'Listing video', amount: '$1,450', color: '#3B424B', width: 10 },
    { label: 'Social', amount: '$1,100', color: '#31373F', width: 7.6 },
];

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

/** One opportunity card, cycling live -> composing -> sent, or live -> hidden -> restore. */
const OpportunityCard = ({ opp, raised }) => {
    const [mode, setMode] = useState('live');
    const [draft, setDraft] = useState('');
    const background = raised ? PALETTE.surfaceRaised : PALETTE.surface;
    const borderColor = raised ? PALETTE.borderRaised : PALETTE.border;

    if (mode === 'hidden') {
        return (
            <CardShell background={background} borderColor={borderColor}>
                <div className="flex items-center gap-3">
                    <span className="flex-1 text-[13px]" style={{ color: PALETTE.textMuted }}>{opp.hiddenLabel}</span>
                    <button type="button" onClick={() => setMode('live')} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Undo</button>
                </div>
            </CardShell>
        );
    }

    return (
        <CardShell background={background} borderColor={borderColor}>
            <div className="flex-1 min-h-0 flex flex-col gap-3.5">
                <span className="self-start text-[10.5px]" style={{ color: PALETTE.textFaint }}>{opp.eyebrow}</span>
                <span className="text-[16.5px] font-semibold leading-[1.35] tracking-[-0.01em]" style={{ color: PALETTE.textPrimary }}>{opp.title}</span>
                <div className="flex flex-col gap-1">
                    <span className="text-[31px] font-semibold tracking-[-0.025em] leading-none" style={{ color: '#FFFFFF' }}>
                        {opp.amount}{opp.amountSuffix && <span className="text-[15px] font-medium" style={{ color: PALETTE.textSecondary }}>{opp.amountSuffix}</span>}
                    </span>
                    <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{opp.amountLabel}</span>
                </div>
                <p className="m-0 text-[13px] leading-[1.65]" style={{ color: PALETTE.textTertiary }}>{opp.body}</p>
                <div className="flex items-center gap-2.5 flex-wrap text-[11.5px] mt-auto pt-3.5" style={{ color: PALETTE.textFaint, ...dividerStyle() }}>
                    {opp.meta.map((m, i) => (
                        <span key={m} className="flex items-center gap-2.5">
                            {i > 0 && <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#41474F' }} />}
                            {m}
                        </span>
                    ))}
                </div>
            </div>

            {mode === 'live' && (
                <div className="flex items-center gap-4">
                    <button type="button" onClick={() => setMode('composing')} className="text-[12.5px] font-medium px-4 py-[9px] rounded-lg" style={{ color: PALETTE.textBody, border: `1px solid ${PALETTE.borderHover}` }}>Discuss this</button>
                    <button type="button" onClick={() => setMode('hidden')} className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Not interested</button>
                </div>
            )}

            {mode === 'composing' && (
                <div className="flex flex-col gap-2.5 pt-3.5" style={dividerStyle('rgba(255,255,255,.06)')}>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Anything you want to ask before we scope this?"
                        className="rounded-lg px-3 py-2.5 text-[12.5px] leading-[1.5] outline-none resize-y"
                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, minHeight: 64 }}
                    />
                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={() => setMode('sent')}
                            className="text-[12.5px] font-bold px-[15px] py-2 rounded-lg"
                            style={{ background: PALETTE.accent, color: PALETTE.onAccentText }}
                        >
                            Send to {opp.sendTo}
                        </button>
                        <button type="button" onClick={() => setMode('live')} className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Cancel</button>
                    </div>
                </div>
            )}

            {mode === 'sent' && (
                <div className="flex items-center gap-2.5 pt-3.5" style={dividerStyle('rgba(255,255,255,.06)')}>
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: PALETTE.good }} />
                    <span className="text-[12.5px]" style={{ color: PALETTE.good }}>Sent — {opp.sendTo} will pick this up in your next check-in</span>
                </div>
            )}
        </CardShell>
    );
};

const SmallerOpportunityRow = ({ item, withDivider }) => {
    const [sent, setSent] = useState(false);
    return (
        <div className="flex items-center gap-[22px] py-[18px]" style={withDivider ? dividerStyle() : undefined}>
            <span className="flex-1 text-[13.5px]" style={{ color: PALETTE.textBody }}>{item.text}</span>
            <span className="flex-none text-[11px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>{item.tag}</span>
            <span className="flex-none text-[15px] font-semibold" style={{ color: PALETTE.textPrimary }}>
                {item.amount}<span className="text-xs font-medium" style={{ color: PALETTE.textSecondary }}>{item.amountSuffix}</span>
            </span>
            <button
                type="button"
                onClick={() => setSent(true)}
                disabled={sent}
                className="flex-none text-xs px-3.5 py-2 rounded-lg"
                style={{ color: PALETTE.textBody, border: `1px solid ${PALETTE.border}` }}
            >
                {sent ? 'Sent to Priya' : 'Discuss this'}
            </button>
        </div>
    );
};

const Untapped = () => {
    const [moreOpen, setMoreOpen] = useState(false);

    return (
        <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="max-w-[1170px] mx-auto flex flex-col gap-[34px] px-8 md:px-10 py-9 md:py-11">

                <header className="flex flex-col gap-2">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Untapped</h1>
                    <p className="m-0 text-[13.5px] leading-[1.6] max-w-[720px]" style={{ color: PALETTE.textSecondary }}>
                        Upside that is available on your account but not being worked on yet. Nothing here is urgent, and nothing here is behind.
                    </p>
                </header>

                <section
                    className="rounded-lg flex flex-col md:flex-row md:items-end gap-[52px]"
                    style={{ background: `radial-gradient(120% 180% at 0% 0%, rgba(59,130,246,.08) 0%, rgba(20,22,26,0) 55%), ${PALETTE.surface}`, border: `1px solid ${PALETTE.borderHover}`, padding: '26px 28px 24px' }}
                >
                    <div className="flex-none flex flex-col gap-[7px]">
                        <span className="text-[11.5px] tracking-[.06em]" style={{ color: PALETTE.textMuted }}>IDENTIFIED UPSIDE</span>
                        <span className="text-[46px] font-semibold tracking-[-0.03em] leading-none tabular-nums" style={{ color: '#FFFFFF' }}>
                            $14,450<span className="text-[17px] font-medium" style={{ color: PALETTE.textSecondary }}>/mo</span>
                        </span>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                            Across 6 opportunities, plus <span style={{ color: PALETTE.textInputBody }}>$4,380</span> recoverable one-off
                        </span>
                    </div>
                    <div className="flex-1 flex flex-col gap-3 pb-1">
                        <div className="flex gap-[3px] h-2 rounded-full overflow-hidden">
                            {LEGEND.map((l) => (
                                <span key={l.label} style={{ width: `${l.width}%`, background: l.color, borderRadius: 99 }} />
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-x-[22px] gap-y-2">
                            {LEGEND.map((l) => (
                                <span key={l.label} className="flex items-center gap-[7px] text-xs" style={{ color: PALETTE.textTertiary }}>
                                    <span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: l.color }} />
                                    {l.label}<span style={{ color: PALETTE.textMuted }}>{l.amount}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="flex flex-col gap-[5px]">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">Within Amazon</h2>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Upside available on the marketplace itself, using tools your account already has.</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px] items-stretch">
                        {OPPORTUNITIES.map((o) => <OpportunityCard key={o.id} opp={o} />)}
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="flex flex-col gap-[5px]">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">Off Amazon</h2>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Ways to bring demand in from outside the marketplace and point it at your listings.</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px] items-stretch">
                        {OFF_AMAZON.map((o) => <OpportunityCard key={o.id} opp={o} raised />)}
                    </div>
                </section>

                {moreOpen && (
                    <section>
                        <div className="rounded-lg" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '4px 24px 6px' }}>
                            {SMALLER.map((item, i) => (
                                <SmallerOpportunityRow key={item.id} item={item} withDivider={i > 0} />
                            ))}
                        </div>
                    </section>
                )}

                <div>
                    <button type="button" onClick={() => setMoreOpen((v) => !v)} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                        {moreOpen ? 'Hide the smaller opportunities' : 'Show 3 more opportunities'}
                    </button>
                </div>

            </div>
        </div>
    );
};

export default Untapped;
