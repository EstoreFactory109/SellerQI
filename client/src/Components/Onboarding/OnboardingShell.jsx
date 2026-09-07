import React, { useEffect } from 'react';
import { COLORS } from '../Shared/index.js';

// Onboarding-specific surface shades (between bgBase and surface) used by the
// wizard chrome. Not part of the shared token set since only this flow uses them.
const SIDEBAR_BG = '#0E121A';
const PANEL_BG = '#10141C';

/**
 * The 4 steps of the real onboarding flow.
 *
 * These map onto the real pages/routes as follows:
 *  1. Create your account      → /sign-up
 *  2. Connect Seller Central   → /connect-to-amazon (marketplace) + /connect-accounts (SP-API OAuth)
 *  3. Connect Amazon Ads       → /connect-accounts (Ads OAuth) + /profile-selection (Ads profile)
 *  4. See your findings        → /analyse-account
 *
 * The old step 4, "Choose a plan" (Stripe checkout / trial), was removed when
 * payments were disabled - see the commented entry in buildSteps below to restore.
 */
const buildSteps = (trialDays) => [
  { label: 'Create your account', short: 'Account', sub: 'Name, email, password', time: '30s' },
  { label: 'Connect Seller Central', short: 'Seller Central', sub: 'One click on Amazon, read-only', time: '60s', tag: 'Required', tagTone: 'req' },
  { label: 'Connect Amazon Ads', short: 'Amazon Ads', sub: 'Where the wasted spend hides', time: '40s', tag: 'Recommended', tagTone: 'rec' },
  // ===== PAYMENT DISABLED - 'Choose a plan' step removed from onboarding =====
  // { label: 'Choose a plan', short: 'Plan', sub: `Free for ${trialDays} days, cancel anytime`, time: '60s' },
  { label: 'See your findings', short: 'Findings', sub: 'Scan runs while you finish', time: 'auto' },
];

/**
 * Horizontal step indicator shown above the content on every onboarding screen.
 * Mirrors the sidebar tracker, and is the only progress cue on narrow screens
 * where the sidebar is hidden.
 */
const ProgressStepper = ({ steps, currentStep, doneSteps, skippedSteps }) => (
  <div className="flex items-start" style={{ marginBottom: 34 }}>
    {steps.map((s, i) => {
      const stepNo = i + 1;
      const done = doneSteps.includes(stepNo);
      const skipped = !done && skippedSteps.includes(stepNo);
      const current = stepNo === currentStep;

      const circleStyle = done
        ? { background: COLORS.good, borderColor: COLORS.good, color: '#061021' }
        : current
          ? { background: COLORS.accent, borderColor: COLORS.accent, color: '#061021' }
          : { background: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMuted };

      return (
        <React.Fragment key={s.label}>
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className="flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '2px solid',
                fontSize: 12,
                fontWeight: 600,
                transition: 'background .3s, border-color .3s, color .3s',
                ...circleStyle,
              }}
            >
              {done ? '✓' : skipped ? '–' : stepNo}
            </div>
            <div
              className="whitespace-nowrap"
              style={{
                fontSize: 10,
                marginTop: 7,
                fontWeight: current || done ? 600 : 500,
                color: done ? COLORS.good : current ? COLORS.textPrimary : COLORS.textMuted,
              }}
            >
              {s.short}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div
              className="flex-1"
              style={{ height: 2, borderRadius: 2, background: COLORS.border, margin: '15px 6px 0', overflow: 'hidden' }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: COLORS.good,
                  transform: done ? 'scaleX(1)' : 'scaleX(0)',
                  transformOrigin: 'left',
                  transition: 'transform .5s ease .1s',
                }}
              />
            </div>
          )}
        </React.Fragment>
      );
    })}
  </div>
);

const TIME_LEFT_LABELS = [
  'about 4 minutes left',
  'about 3 minutes left',
  'about 2 minutes left',
  'about a minute left',
  'nearly done',
];

/**
 * Shared onboarding wizard shell: fixed left step-tracker sidebar + centred content area.
 *
 * @param {number} currentStep  1-based index of the active step (1-4).
 * @param {number[]} doneSteps  step numbers already completed (shown with a checkmark).
 * @param {number[]} skippedSteps step numbers the user chose to skip (shown with a dash).
 * @param {number} trialDays    unused while payments are disabled; kept for the
 *                              commented-out "Choose a plan" sub-label.
 * @param {string} maxWidth     content column max width (mock uses 620px for most steps).
 */
const OnboardingShell = ({
  currentStep = 1,
  doneSteps = [],
  skippedSteps = [],
  trialDays = 7,
  maxWidth = '620px',
  children,
}) => {
  const steps = buildSteps(trialDays);
  const idx = Math.min(Math.max(currentStep - 1, 0), steps.length - 1);
  const progressWidth = `${Math.round(((idx + 1) / steps.length) * 100)}%`;

  // Onboarding is forward-only. Going back would let a user re-enter a step they
  // already cleared and re-trigger an Amazon connection, so Back is neutralised
  // here for every route that renders through this shell.
  //
  // How it works: we seed a duplicate history entry for the current URL, then
  // re-seed it on every popstate. Because the sentinel carries the *same* URL, a
  // Back press lands on an identical location — React Router sees no route change
  // and renders nothing new, so there's no flash. This covers the Back button,
  // Alt/Cmd+Left, the mouse back button and trackpad swipe-back alike, since all
  // of them surface as popstate. Forward navigation via navigate() is untouched,
  // and the listener is torn down on unmount so Back works normally once the user
  // leaves onboarding.
  useEffect(() => {
    const lockedUrl = window.location.href;
    window.history.pushState(null, '', lockedUrl);
    const handlePopState = () => {
      window.history.pushState(null, '', lockedUrl);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div
      className="h-screen overflow-hidden grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]"
      style={{ background: COLORS.bgBase, color: COLORS.textPrimary }}
    >
      {/* The app hides the document scrollbar globally, so the content column owns
          the scroll here and gets a visible bar of its own. */}
      <style>{`
        .sq-onb-scroll { scrollbar-width: thin; scrollbar-color: ${COLORS.border} transparent; }
        .sq-onb-scroll::-webkit-scrollbar { width: 10px; height: 10px; display: block; }
        .sq-onb-scroll::-webkit-scrollbar-track { background: transparent; }
        .sq-onb-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 8px; }
        .sq-onb-scroll::-webkit-scrollbar-thumb:hover { background: ${COLORS.borderStrong}; }
      `}</style>
      <aside
        className="hidden lg:flex flex-col min-h-0 overflow-y-auto scrollbar-hide"
        style={{ borderRight: `1px solid ${COLORS.border}`, background: SIDEBAR_BG, padding: '30px 32px', gap: '30px' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 30, height: 30, borderRadius: 8, background: COLORS.accent, fontSize: 15, fontWeight: 700, color: '#061021' }}
          >
            Q
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>SellerQI</div>
        </div>

        <div className="flex flex-col" style={{ gap: '22px', flex: 1, minHeight: 0 }}>
          <div>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 9 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Step {idx + 1} of {steps.length}</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>{TIME_LEFT_LABELS[idx]}</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: COLORS.surfaceElevated, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: COLORS.accent, transition: 'width .45s ease', width: progressWidth }} />
            </div>
          </div>

          <div className="flex flex-col" style={{ gap: 2 }}>
            {steps.map((s, i) => {
              const stepNo = i + 1;
              const done = doneSteps.includes(stepNo);
              const skipped = !done && skippedSteps.includes(stepNo);
              const current = stepNo === idx + 1;

              const dotStyle = done
                ? { background: 'rgba(34,197,94,.16)', color: COLORS.good, border: '1px solid rgba(34,197,94,.4)' }
                : current
                  ? { background: COLORS.accent, color: '#061021', border: `1px solid ${COLORS.accent}` }
                  : { background: 'transparent', color: COLORS.textMuted, border: `1px solid ${COLORS.border}` };

              return (
                <div
                  key={s.label}
                  className="flex"
                  style={{
                    gap: 13,
                    padding: '11px 12px',
                    borderRadius: 10,
                    background: current ? 'rgba(59,130,246,.10)' : 'transparent',
                    border: `1px solid ${current ? 'rgba(59,130,246,.3)' : 'transparent'}`,
                  }}
                >
                  <div
                    className="flex-none flex items-center justify-center"
                    style={{ width: 24, height: 24, borderRadius: 999, fontSize: 12, fontWeight: 700, ...dotStyle }}
                  >
                    {done ? '✓' : skipped ? '–' : stepNo}
                  </div>
                  <div className="flex-1 min-w-0" style={{ paddingTop: 1 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 13, fontWeight: 500, color: current || done ? COLORS.textPrimary : COLORS.textSecondary }}>
                        {s.label}
                      </span>
                      {s.tag && !done && (
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 5,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '.04em',
                            textTransform: 'uppercase',
                            background: s.tagTone === 'req' ? 'rgba(239,68,68,.14)' : 'rgba(59,130,246,.14)',
                            color: s.tagTone === 'req' ? '#F87171' : '#7EA8F8',
                          }}
                        >
                          {s.tag}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: '17px', color: COLORS.textMuted, marginTop: 2 }}>{s.sub}</div>
                  </div>
                  <div className="flex-none" style={{ fontSize: 11, color: '#4C5566', paddingTop: 2 }}>{s.time}</div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', padding: '14px 15px', border: `1px solid ${COLORS.border}`, borderRadius: 11, background: PANEL_BG }}>
            <div className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
              <span style={{ color: COLORS.good }}>◷</span>Your progress is saved
            </div>
            <div style={{ fontSize: 12, lineHeight: '18px', color: COLORS.textMuted }}>
              Close this tab and pick up right where you left off. Nothing is lost.
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#4C5566' }}>Amazon-approved SP-API developer</div>
      </aside>

      <main
        className="min-w-0 min-h-0 overflow-y-auto flex flex-col items-center sq-onb-scroll"
        style={{ padding: '46px 40px 70px' }}
      >
        <div style={{ width: '100%', maxWidth }}>
          <ProgressStepper
            steps={steps}
            currentStep={idx + 1}
            doneSteps={doneSteps}
            skippedSteps={skippedSteps}
          />
          {children}
        </div>
      </main>
    </div>
  );
};

export default OnboardingShell;
