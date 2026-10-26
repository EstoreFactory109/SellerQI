import { useEffect, useState } from "react";
import { CalendarCheck, Clock, Video, LineChart, Wrench, Megaphone, MessageCircleQuestion, LifeBuoy } from "lucide-react";
import { COLORS } from "../../Components/Shared/index.js";

// The calendar itself is Calendly's. Setting its colours through the URL needs a paid Calendly plan
// (those settings were ignored here), so the page darkens the frame itself with a CSS colour filter:
// invert, then rotate the hues back so blues stay blue. It is an approximation of the SellerQI
// palette, not exact brand colours. The call's length and details come from the Calendly event, so
// this page doesn't state them.
const CALENDLY_DARK_CSS = `
  .sqi-calendly .calendly-inline-widget { background: ${COLORS.surface}; }
  .sqi-calendly .calendly-inline-widget iframe { filter: invert(0.92) hue-rotate(180deg); color-scheme: dark; }
`;
// hide_event_type_details hides Calendly's header block (profile logo, host name, event title and
// description); the page's own heading and "what we'll cover" panel say it instead.
const CALENDLY_URL = "https://calendly.com/sellerqi-support/30min?hide_gdpr_banner=1&hide_event_type_details=1";

const FACTS = [
  { icon: Clock, label: "Quick call" },
  { icon: Video, label: "Online meeting" },
];

const AGENDA = [
  { icon: LineChart, title: "Your numbers, explained", text: "Sales, profit and ad spend, and what they say about your business." },
  { icon: Wrench, title: "What to fix first", text: "The issues worth the most to your profit, in the order to tackle them." },
  { icon: Megaphone, title: "Ads and product costs", text: "Where ad spend is going to waste and which costs are missing from your profit." },
  { icon: MessageCircleQuestion, title: "Your questions", text: "Anything about SellerQI or your Amazon account." },
];

const STEPS = [
  "Pick a day and time on the calendar",
  "You get a calendar invite by email",
  "Join the call at your chosen time",
];

// Shown until Calendly reports its real content height. Tall enough for a month view.
const MIN_CALENDAR_HEIGHT = 760;

export default function CalendlyWidget() {
  // Calendly posts its content height to the host page ("calendly.page_height"). Sizing the box to it
  // means the calendar never scrolls inside its own frame — the page scrolls instead.
  const [calendarHeight, setCalendarHeight] = useState(MIN_CALENDAR_HEIGHT);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== "https://calendly.com" || event.data?.event !== "calendly.page_height") return;
      const height = parseInt(event.data?.payload?.height, 10);
      if (Number.isFinite(height) && height > 0) setCalendarHeight(Math.max(height, MIN_CALENDAR_HEIGHT));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div
      className="w-full min-h-full"
      style={{ background: `radial-gradient(900px 380px at 12% -8%, rgba(59,130,246,.16), transparent 60%), ${COLORS.bgBase}`, color: COLORS.textPrimary }}
    >
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-7 py-7 grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-7 items-start">
        {/* Left: heading, what to expect, how it works. Stays in view while the (tall) calendar scrolls. */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-6">
          {/* Header */}
          <header className="flex flex-col gap-3">
            <span
              className="self-start inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: "rgba(59,130,246,.14)", color: "#7EA8F8", border: "1px solid rgba(59,130,246,.3)" }}
            >
              <CalendarCheck className="w-3.5 h-3.5" /> Book a call
            </span>
            <h1 className="m-0 text-[30px] leading-[38px] sm:text-[36px] sm:leading-[44px] font-bold tracking-[-0.02em]">
              Talk to a SellerQI expert
            </h1>
            <p className="m-0 text-[15px] leading-6" style={{ color: COLORS.textSecondary }}>
              Pick a time that suits you. We&apos;ll go through your account together and show you where to focus first.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {FACTS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium"
                  style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: COLORS.accent }} /> {label}
                </span>
              ))}
            </div>
          </header>
            <section className="rounded-2xl border p-5" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <h2 className="m-0 mb-4 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.textMuted }}>
                What we&apos;ll cover
              </h2>
              <ul className="m-0 p-0 list-none flex flex-col gap-4">
                {AGENDA.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <span
                      className="flex-none w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: "rgba(59,130,246,.14)", border: "1px solid rgba(59,130,246,.25)" }}
                    >
                      <Icon className="w-4 h-4" style={{ color: "#7EA8F8" }} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold" style={{ color: COLORS.textPrimary }}>{title}</div>
                      <div className="text-[13px] leading-[19px]" style={{ color: COLORS.textSecondary }}>{text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border p-5" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <h2 className="m-0 mb-4 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.textMuted }}>
                How it works
              </h2>
              <ol className="m-0 p-0 list-none flex flex-col gap-3">
                {STEPS.map((step, i) => (
                  <li key={step} className="flex items-center gap-3">
                    <span
                      className="flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: COLORS.accent, color: "#061021" }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[13px]" style={{ color: COLORS.textSecondary }}>{step}</span>
                  </li>
                ))}
              </ol>
            </section>

          <p className="m-0 flex items-start gap-2 text-xs leading-[18px] px-1" style={{ color: COLORS.textMuted }}>
            <LifeBuoy className="w-4 h-4 flex-none mt-px" />
            <span>Prefer to write to us instead? Use <b style={{ color: COLORS.textSecondary }}>Support</b> in the Account &amp; Settings menu.</span>
          </p>
        </div>

        {/* Right: the booking calendar, starting level with the heading */}
        {/* Booking calendar */}
        <section
          className="sqi-calendly rounded-2xl border overflow-hidden"
          style={{ background: COLORS.surface, borderColor: COLORS.border, boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}
        >
          <style>{CALENDLY_DARK_CSS}</style>
          <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
            <CalendarCheck className="w-4 h-4" style={{ color: COLORS.accent }} />
            <span className="text-sm font-semibold">Choose a time</span>
            <span className="ml-auto text-xs" style={{ color: COLORS.textMuted }}>Times are shown in your local timezone</span>
          </div>
          <div
            className="calendly-inline-widget"
            data-url={CALENDLY_URL}
            style={{ minWidth: "320px", height: `${calendarHeight}px` }}
          />
        </section>
      </div>
    </div>
  );
}
