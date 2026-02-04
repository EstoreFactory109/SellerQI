import React, { useMemo, useState } from 'react';
import axiosInstance from '../config/axios.config.js';

const EMAIL_REGEX = /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;

const UnsubscribeAlerts = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState({ type: 'idle', message: '' }); // idle | success | error
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: 'idle', message: '' });

    if (!normalizedEmail) {
      setStatus({ type: 'error', message: 'Email is required.' });
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    setIsConfirmOpen(true);
  };

  const onConfirmUnsubscribe = async () => {
    try {
      setIsSubmitting(true);
      await axiosInstance.post('/api/alerts/unsubscribe', { email: normalizedEmail });
      setStatus({ type: 'success', message: 'You have been unsubscribed from alerts.' });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to unsubscribe. Please try again.';
      setStatus({ type: 'error', message: msg });
    } finally {
      setIsSubmitting(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: '#0b1220',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#111a2e',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: 24,
          color: '#e6eaf2',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Unsubscribe from alerts</h2>
        <p style={{ marginTop: 8, marginBottom: 18, color: 'rgba(230,234,242,0.75)', lineHeight: 1.5 }}>
          Enter your account email and we’ll stop sending alerts to you.
        </p>

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 14, color: 'rgba(230,234,242,0.85)' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoComplete="email"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '12px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#0b1220',
              color: '#e6eaf2',
              outline: 'none',
            }}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              marginTop: 14,
              width: '100%',
              padding: '12px 12px',
              borderRadius: 10,
              border: 'none',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              background: isSubmitting ? 'rgba(99,102,241,0.55)' : '#6366f1',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {isSubmitting ? 'Unsubscribing…' : 'Unsubscribe'}
          </button>
        </form>

        {isConfirmOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              zIndex: 9999,
            }}
            onClick={() => {
              if (!isSubmitting) setIsConfirmOpen(false);
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 520,
                background: '#111a2e',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 14,
                padding: 20,
                color: '#e6eaf2',
                boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 18, fontWeight: 750 }}>Confirm unsubscribe</div>
              <div style={{ marginTop: 8, color: 'rgba(230,234,242,0.75)', lineHeight: 1.5 }}>
                Are you sure you want to unsubscribe <b>{normalizedEmail}</b> from alerts?
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsConfirmOpen(false)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: 'transparent',
                    color: '#e6eaf2',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onConfirmUnsubscribe}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: isSubmitting ? 'rgba(99,102,241,0.55)' : '#6366f1',
                    color: '#fff',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                  }}
                >
                  {isSubmitting ? 'Unsubscribing…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {status.type !== 'idle' && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${status.type === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
              background: status.type === 'success' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
              color: status.type === 'success' ? 'rgba(187,247,208,0.95)' : 'rgba(254,202,202,0.95)',
            }}
          >
            {status.message}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnsubscribeAlerts;

