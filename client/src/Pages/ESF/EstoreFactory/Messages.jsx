import { useMemo, useState } from 'react';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Messages — recreates deploy/messages.html exactly.
 *
 * Thread list + detail + compose are all local UI state, exactly matching the
 * mock's own Component class (a plain in-memory array, no API calls) — there
 * is no support-ticket/messaging model for ESF accounts yet (see the
 * data-reality note in ClientDashboard.jsx), so replies and new messages only
 * ever live in this page's own state and vanish on refresh, same as the mock.
 */
const CLIENT_AVATAR = 'rgba(255,122,26,.16)';
const AGENCY_AVATAR = 'repeating-linear-gradient(135deg, #1E2228 0 4px, #252A31 4px 8px)';

const PILL = {
    'Awaiting your reply': { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
    Open: { bg: 'rgba(95,211,196,.11)', color: PALETTE.teal },
    Resolved: { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
};

const INITIAL_THREADS = [
    {
        id: 1, subject: 'Can we change the title on the kitchen scale?', ref: 'EF-1184', opened: '28 Aug',
        status: 'Awaiting your reply', time: '4h', unread: false, owner: 'Priya Raghavan', role: 'Senior Account Manager',
        preview: 'That title change is fine, but we’d lose the "11 lb" claim…',
        messages: [
            { who: 'You', side: 'client', time: '28 Aug, 9:14 am', body: 'Our supplier wants us to lead with "professional grade" in the title. Is that going to hurt anything?' },
            { who: 'Priya Raghavan', side: 'agency', time: '28 Aug, 11:02 am', body: 'It won’t hurt, but the title is capped at 200 characters and something has to come out. My suggestion is to drop the colour word rather than the capacity — "11 lb" is the term people search.' },
            { who: 'You', side: 'client', time: '29 Aug, 8:40 am', body: 'Makes sense. Can you show me both versions side by side before it goes live?' },
            { who: 'Priya Raghavan', side: 'agency', time: '29 Aug, 2:31 pm', body: 'Here they are. The second one keeps capacity and adds the phrase your supplier asked for.', file: { name: 'kitchen-scale-titles.pdf', size: '84 KB' } },
            { who: 'You', side: 'client', time: 'Yesterday, 5:12 pm', body: 'Version two looks right to me. One question — does changing the title reset any of the ranking we’ve built?' },
        ],
    },
    {
        id: 2, subject: 'Approving the Q4 ad budget', ref: 'EF-1179', opened: '26 Aug',
        status: 'Open', time: '1d', unread: true, owner: 'Marcus Oyelaran', role: 'Paid Media Lead',
        preview: 'The increase pays for itself at a 2.4 ROAS — happy to walk through it.',
        messages: [
            { who: 'Marcus Oyelaran', side: 'agency', time: '26 Aug, 10:05 am', body: 'Ahead of Q4 I’d like to take monthly spend from $7,200 to $9,500, concentrated on the three keyword groups already converting above 14%.' },
            { who: 'You', side: 'client', time: '27 Aug, 7:58 am', body: 'What happens if the season underperforms? I don’t want to be locked in.' },
            { who: 'Marcus Oyelaran', side: 'agency', time: '27 Aug, 12:22 pm', body: 'Nothing is locked. We review weekly and can pull spend back the same day. The increase pays for itself at a 2.4 ROAS and you’re currently at 3.1.' },
        ],
    },
    {
        id: 3, subject: 'When should we ship the next container?', ref: 'EF-1176', opened: '22 Aug',
        status: 'Open', time: '2d', unread: true, owner: 'Devika Shah', role: 'Inventory Analyst',
        preview: 'Aim to have units in the fulfilment centre by 20 October.',
        messages: [
            { who: 'You', side: 'client', time: '22 Aug, 4:41 pm', body: 'Our factory needs a production slot booked this week. When do you need the stock landed for Q4?' },
            { who: 'Devika Shah', side: 'agency', time: '23 Aug, 9:16 am', body: 'Aim for units checked in at the fulfilment centre by 20 October. Amazon’s cut-off is later, but check-in times slip badly in November.' },
        ],
    },
    {
        id: 4, subject: 'Invoice EF-2041 — what is the setup line?', ref: 'EF-1170', opened: '18 Aug',
        status: 'Resolved', time: '6d', unread: false, owner: 'Priya Raghavan', role: 'Senior Account Manager',
        preview: 'That was the one-off A+ content build — it won’t repeat next month.',
        messages: [
            { who: 'You', side: 'client', time: '18 Aug, 11:20 am', body: 'There’s a $400 setup line on this month’s invoice that I wasn’t expecting.' },
            { who: 'Priya Raghavan', side: 'agency', time: '18 Aug, 1:44 pm', body: 'That’s the one-off A+ content build for the kitchen scale, agreed in July. It won’t appear again next month.' },
            { who: 'You', side: 'client', time: '19 Aug, 8:02 am', body: 'Understood, thanks for clearing that up.' },
        ],
    },
    {
        id: 5, subject: 'Two reviews mention a broken lid', ref: 'EF-1166', opened: '14 Aug',
        status: 'Resolved', time: '12d', unread: false, owner: 'Priya Raghavan', role: 'Senior Account Manager',
        preview: 'Both were from the same batch — we’ve flagged it in the listing Q&A.',
        messages: [
            { who: 'Priya Raghavan', side: 'agency', time: '14 Aug, 3:12 pm', body: 'Two one-star reviews on the frother both mention the lid cracking. Worth checking with your factory — they look like the same batch.' },
            { who: 'You', side: 'client', time: '15 Aug, 9:31 am', body: 'Confirmed with the factory, it was a mould issue in June. Fixed now.' },
        ],
    },
    {
        id: 6, subject: 'Adding the espresso tamper to Subscribe & Save', ref: 'EF-1159', opened: '6 Aug',
        status: 'Resolved', time: '26 Aug', unread: false, owner: 'Devika Shah', role: 'Inventory Analyst',
        preview: 'Enrolled — first subscriptions should appear within two weeks.',
        messages: [
            { who: 'You', side: 'client', time: '6 Aug, 10:12 am', body: 'Can the tamper go into Subscribe & Save, or does that only make sense for consumables?' },
            { who: 'Devika Shah', side: 'agency', time: '6 Aug, 4:03 pm', body: 'It’s better suited to your cleaning refills, but there’s no downside to enrolling. I’ve done it — expect the first subscriptions within a fortnight.' },
        ],
    },
    {
        id: 7, subject: 'Trademark certificate for Brand Registry', ref: 'EF-1150', opened: '29 Jul',
        status: 'Resolved', time: '5 Aug', unread: false, owner: 'Priya Raghavan', role: 'Senior Account Manager',
        preview: 'Received — Brand Registry approved on 4 August.',
        messages: [
            { who: 'Priya Raghavan', side: 'agency', time: '29 Jul, 8:22 am', body: 'We need the trademark certificate PDF to finish the Brand Registry application.' },
            { who: 'You', side: 'client', time: '30 Jul, 7:15 pm', body: 'Attached.', file: { name: 'kessler-trademark.pdf', size: '1.2 MB' } },
            { who: 'Priya Raghavan', side: 'agency', time: '4 Aug, 10:41 am', body: 'Approved this morning. That unlocks A+ content and the brand store.' },
        ],
    },
    {
        id: 8, subject: 'Do we need a separate listing for the gift set?', ref: 'EF-1141', opened: '21 Jul',
        status: 'Resolved', time: '28 Jul', unread: false, owner: 'Priya Raghavan', role: 'Senior Account Manager',
        preview: 'Yes — a parent listing with variations is the cleaner route.',
        messages: [
            { who: 'You', side: 'client', time: '21 Jul, 2:03 pm', body: 'We’re bundling the frother and tamper for Christmas. New listing or a variation?' },
            { who: 'Priya Raghavan', side: 'agency', time: '22 Jul, 9:48 am', body: 'A variation under a parent listing. It inherits reviews, which matters more than anything else in Q4.' },
        ],
    },
];

const fileSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const Messages = () => {
    const [added, setAdded] = useState([]);
    const [openId, setOpenId] = useState(1);
    const [unread, setUnread] = useState({ 2: true, 3: true });
    const [extra, setExtra] = useState({});
    const [drafts, setDrafts] = useState({});
    const [composing, setComposing] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [newBody, setNewBody] = useState('');

    const all = useMemo(() => [...added, ...INITIAL_THREADS], [added]);
    const open = all.find((t) => t.id === openId) || all[0];
    const openMessages = [...open.messages, ...(extra[openId] || [])];
    const openPill = PILL[open.status];

    const selectThread = (id) => {
        setOpenId(id);
        setComposing(false);
        setUnread((u) => ({ ...u, [id]: false }));
    };

    const sendReply = () => {
        const t = (drafts[openId] || '').trim();
        if (!t) return;
        setExtra((e) => ({ ...e, [openId]: [...(e[openId] || []), { who: 'You', side: 'client', time: 'Just now', body: t }] }));
        setDrafts((d) => ({ ...d, [openId]: '' }));
    };

    const attachFile = (file) => {
        if (!file) return;
        setExtra((e) => ({
            ...e,
            [openId]: [...(e[openId] || []), { who: 'You', side: 'client', time: 'Just now', body: 'Attaching this for you.', file: { name: file.name, size: fileSize(file.size) } }],
        }));
    };

    const sendNew = () => {
        const subject = newSubject.trim() || 'New request';
        const body = newBody.trim();
        if (!body) return;
        const id = 900 + added.length;
        setAdded((a) => [{
            id, subject, ref: `EF-${1190 + a.length}`, opened: 'Just now', status: 'Open', time: 'now',
            owner: 'Priya Raghavan', role: 'Senior Account Manager', preview: body,
            messages: [{ who: 'You', side: 'client', time: 'Just now', body }],
        }, ...a]);
        setOpenId(id);
        setComposing(false);
        setNewSubject('');
        setNewBody('');
    };

    return (
        <div style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 p-6 md:p-8" style={{ height: 'calc(100vh - 64px)', minHeight: 560, boxSizing: 'border-box' }}>

                {/* Thread list */}
                <section className="rounded-lg flex flex-col overflow-hidden min-h-0" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}` }}>
                    <div className="flex flex-col gap-3.5" style={{ padding: '20px 20px 16px', borderBottom: `1px solid rgba(255,255,255,.06)` }}>
                        <div className="flex items-center gap-2.5">
                            <h2 className="m-0 flex-1 text-[15px] font-bold tracking-[-0.01em]">Conversations</h2>
                            <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>2 unread</span>
                        </div>
                        <button type="button" onClick={() => setComposing(true)} className="text-[13px] font-bold py-2.5 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>
                            New message
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto py-1.5">
                        {all.map((t) => {
                            const pill = PILL[t.status];
                            const selected = t.id === openId;
                            const un = !!unread[t.id];
                            return (
                                <div
                                    key={t.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => selectThread(t.id)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') selectThread(t.id); }}
                                    className="flex flex-col gap-1.5 cursor-pointer"
                                    style={{ padding: '14px 20px', borderLeft: `2px solid ${selected ? PALETTE.accent : 'transparent'}`, background: selected ? 'rgba(255,255,255,.055)' : 'transparent' }}
                                >
                                    <div className="flex items-baseline gap-2">
                                        <span className="flex-1 text-[13px] truncate" style={{ fontWeight: un ? 650 : 500, color: un || selected ? PALETTE.textPrimary : '#C6CBD2' }}>{t.subject}</span>
                                        <span className="flex-none text-[11.5px]" style={{ color: PALETTE.textMuted }}>{t.time}</span>
                                    </div>
                                    <span className="text-xs leading-[1.45] truncate" style={{ color: '#7C828C' }}>{t.preview}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10.5px] font-semibold rounded px-2 py-[3px]" style={{ background: pill.bg, color: pill.color }}>{t.status}</span>
                                        {t.unread && <span className="w-[7px] h-[7px] rounded-full" style={{ background: PALETTE.accent }} />}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Detail / compose */}
                <section className="rounded-lg flex flex-col overflow-hidden min-h-0" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}` }}>
                    {composing ? (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <div className="flex items-center gap-3.5" style={{ padding: '20px 26px', borderBottom: `1px solid rgba(255,255,255,.06)` }}>
                                <h2 className="m-0 flex-1 text-base font-bold tracking-[-0.01em]">New message</h2>
                                <button type="button" onClick={() => setComposing(false)} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Cancel</button>
                            </div>
                            <div className="flex-1 min-h-0 flex flex-col gap-4" style={{ padding: '24px 26px' }}>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>SUBJECT</span>
                                    <input
                                        value={newSubject}
                                        onChange={(e) => setNewSubject(e.target.value)}
                                        placeholder="What do you need help with?"
                                        className="rounded-lg px-3.5 py-2.5 text-[13px] outline-none"
                                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody }}
                                    />
                                </label>
                                <label className="flex-1 min-h-0 flex flex-col gap-1.5">
                                    <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>MESSAGE</span>
                                    <textarea
                                        value={newBody}
                                        onChange={(e) => setNewBody(e.target.value)}
                                        placeholder="Priya and the team see this straight away."
                                        className="flex-1 rounded-lg px-3.5 py-3 text-[13px] leading-[1.6] outline-none resize-none"
                                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody }}
                                    />
                                </label>
                            </div>
                            <div className="flex flex-col gap-2.5" style={{ padding: '14px 26px 20px', borderTop: `1px solid rgba(255,255,255,.06)` }}>
                                <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>A copy goes to hello@kesslerhome.com so you can follow up from your inbox.</span>
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={sendNew} className="text-[13px] font-bold px-[22px] py-3 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>Send message</button>
                                    <span className="text-xs" style={{ color: PALETTE.textMuted }}>Typical first reply: a few hours.</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <div className="flex items-center gap-4" style={{ padding: '20px 26px', borderBottom: `1px solid rgba(255,255,255,.06)` }}>
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                    <h2 className="m-0 text-base font-bold tracking-[-0.01em] truncate">{open.subject}</h2>
                                    <span className="text-xs" style={{ color: PALETTE.textMuted }}>Ticket {open.ref} · opened {open.opened}</span>
                                </div>
                                <span className="flex-none text-[11.5px] font-semibold rounded-md px-[11px] py-1.5" style={{ background: openPill.bg, color: openPill.color }}>{open.status}</span>
                                <span className="flex-none flex items-center gap-2.5 pl-1.5" style={{ borderLeft: `1px solid rgba(255,255,255,.08)` }}>
                                    <span className="w-[26px] h-[26px] flex-none rounded-full" style={{ background: AGENCY_AVATAR, border: '1px solid rgba(255,255,255,.1)' }} />
                                    <span className="flex flex-col">
                                        <span className="text-[12.5px]" style={{ color: PALETTE.textBody }}>{open.owner}</span>
                                        <span className="text-[11px]" style={{ color: PALETTE.textMuted }}>{open.role}</span>
                                    </span>
                                </span>
                            </div>

                            <div className="flex-1 overflow-y-auto flex flex-col gap-[22px]" style={{ padding: '24px 26px' }}>
                                {openMessages.map((m, i) => (
                                    <div key={i} className="flex gap-3.5 items-start">
                                        <span className="w-[30px] h-[30px] flex-none rounded-full" style={{ background: m.side === 'client' ? CLIENT_AVATAR : AGENCY_AVATAR, border: '1px solid rgba(255,255,255,.1)' }} />
                                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                            <div className="flex items-baseline gap-2.5">
                                                <span className="text-[13px] font-semibold" style={{ color: PALETTE.textBody }}>{m.who}</span>
                                                <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{m.time}</span>
                                            </div>
                                            <div
                                                className="rounded-lg px-4 py-3.5 text-[13px] leading-[1.65]"
                                                style={{
                                                    background: m.side === 'client' ? 'rgba(255,122,26,.05)' : 'rgba(255,255,255,.035)',
                                                    border: `1px solid ${m.side === 'client' ? 'rgba(255,122,26,.18)' : 'rgba(255,255,255,.07)'}`,
                                                    color: '#C6CBD2',
                                                }}
                                            >
                                                {m.body}
                                            </div>
                                            {m.file && (
                                                <span className="self-start flex items-center gap-2.5 rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)' }}>
                                                    <span className="w-3.5 h-4 rounded-sm" style={{ background: '#8FA0B8' }} />
                                                    <span className="text-[12.5px]" style={{ color: PALETTE.textBody }}>{m.file.name}</span>
                                                    <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{m.file.size}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-col gap-2.5" style={{ padding: '14px 26px 20px', borderTop: `1px solid rgba(255,255,255,.06)` }}>
                                <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>Replies are also sent to hello@kesslerhome.com — you can answer from your inbox instead.</span>
                                <div className="flex gap-3 items-end">
                                    <textarea
                                        value={drafts[openId] || ''}
                                        onChange={(e) => setDrafts((d) => ({ ...d, [openId]: e.target.value }))}
                                        placeholder="Write a reply…"
                                        className="flex-1 rounded-lg px-3.5 py-3 text-[13px] leading-[1.55] outline-none resize-y"
                                        style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, minHeight: 76 }}
                                    />
                                    <label className="flex-none w-10 h-10 rounded-lg flex items-center justify-center text-[15px] cursor-pointer" style={{ border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textTertiary }}>
                                        +
                                        <input type="file" className="hidden" onChange={(e) => attachFile((e.target.files || [])[0])} />
                                    </label>
                                    <button type="button" onClick={sendReply} className="flex-none text-[13px] font-bold px-[22px] py-3 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>Send reply</button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
};

export default Messages;
