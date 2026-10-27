import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import stripeService from '../../services/stripeService.js';
import { COLORS } from '../../Components/Shared/index.js';

/**
 * Where Stripe sends a seller after paying for a "Fix it" package
 * (/fix-it/success?session_id=…). Confirms the payment with our server — which also records
 * it and tells the support team if the webhook has not already — then says what happens next.
 * A card payment is normally confirmed at once; "processing" retries a few times.
 */
const RETRY_DELAYS_MS = [1500, 3000, 5000];

export default function FixItSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'confirming', purchase: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
      setState({ status: 'error', purchase: null, error: 'This link is missing its payment reference.' });
      return undefined;
    }
    const confirm = async (attempt = 0) => {
      try {
        const result = await stripeService.confirmFixItPurchase(sessionId);
        if (cancelled) return;
        if (result?.status === 'paid') {
          setState({ status: 'paid', purchase: result.purchase, error: '' });
        } else if (attempt < RETRY_DELAYS_MS.length) {
          setTimeout(() => confirm(attempt + 1), RETRY_DELAYS_MS[attempt]);
        } else {
          setState({ status: 'processing', purchase: null, error: '' });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', purchase: null, error: err.response?.data?.message || 'We could not confirm your payment.' });
      }
    };
    confirm();
    return () => { cancelled = true; };
  }, [searchParams]);

  const { status, purchase, error } = state;
  const backToTasks = () => navigate('/seller-central-checker/tasks');

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: COLORS.bgBase }}>
      <div className="w-full max-w-md rounded-2xl border p-8 text-center" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
        {status === 'confirming' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: COLORS.accent }} />
            <h1 className="mt-4 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>Confirming your payment…</h1>
          </>
        )}

        {status === 'paid' && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12" style={{ color: COLORS.good }} />
            <h1 className="mt-4 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>Payment received — thank you!</h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              You bought the <strong style={{ color: COLORS.textPrimary }}>{purchase?.packageName}</strong> package
              {purchase?.tasks ? ` (${purchase.tasks} tasks)` : ''}. Our team will contact you within 1 business day
              to start fixing your tasks. A receipt is on its way to your email.
            </p>
          </>
        )}

        {status === 'processing' && (
          <>
            <Loader2 className="mx-auto h-10 w-10" style={{ color: COLORS.watch }} />
            <h1 className="mt-4 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>Your payment is still processing</h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              Stripe has not confirmed it yet. You don&rsquo;t need to pay again — our team is told as soon as it goes
              through, and will contact you within 1 business day.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="mx-auto h-12 w-12" style={{ color: COLORS.fix }} />
            <h1 className="mt-4 text-xl font-semibold" style={{ color: COLORS.textPrimary }}>We couldn&rsquo;t confirm your payment</h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              {error} If you were charged, don&rsquo;t pay again — contact support and we&rsquo;ll sort it out.
            </p>
          </>
        )}

        {status !== 'confirming' && (
          <button
            type="button"
            onClick={backToTasks}
            className="mt-6 px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: COLORS.accent, color: '#061021' }}
          >
            Back to Tasks
          </button>
        )}
      </div>
    </div>
  );
}
