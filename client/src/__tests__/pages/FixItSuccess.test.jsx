/**
 * The page Stripe sends a seller to after paying for a Fix it package, and the switch that
 * shows the Fix it buttons (on by default; VITE_FIX_IT_PACKAGES=false hides them).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FixItSuccess from '../../Pages/Payment/FixItSuccess.jsx';
import stripeService from '../../services/stripeService.js';

vi.mock('../../services/stripeService.js', () => ({ default: { confirmFixItPurchase: vi.fn() } }));

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/fix-it/success" element={<FixItSuccess />} />
      <Route path="/seller-central-checker/tasks" element={<p>Tasks page</p>} />
    </Routes>
  </MemoryRouter>
);

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('Fix it success page', () => {
  it('confirms the payment and says what happens next', async () => {
    stripeService.confirmFixItPurchase.mockResolvedValue({ status: 'paid', purchase: { packageName: 'Standard', tasks: 30 } });
    renderAt('/fix-it/success?session_id=cs_test_1');
    expect(await screen.findByText('Payment received — thank you!')).toBeInTheDocument();
    expect(stripeService.confirmFixItPurchase).toHaveBeenCalledWith('cs_test_1');
    expect(screen.getByText(/Standard/)).toBeInTheDocument();
    expect(screen.getByText(/within 1 business day/)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Back to Tasks' }).click();
    expect(await screen.findByText('Tasks page')).toBeInTheDocument();
  });

  it('a monthly package says it is a subscription, when it renews, and where to cancel', async () => {
    stripeService.confirmFixItPurchase.mockResolvedValue({ status: 'paid', purchase: { billing: 'monthly', packageName: 'Accelerated', tasks: 60, renewsAt: '2026-11-27T12:00:00Z' } });
    renderAt('/fix-it/success?session_id=cs_test_1');
    expect(await screen.findByText(/subscribed to/)).toBeInTheDocument();
    expect(screen.getByText(/Fix it Accelerated/)).toBeInTheDocument();
    expect(screen.getByText(/It renews on .*2026/)).toBeInTheDocument();
    expect(screen.getByText(/cancel any time from the Tasks page/)).toBeInTheDocument();
  });

  it('retries while Stripe is still processing, then says not to pay again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stripeService.confirmFixItPurchase.mockResolvedValue({ status: 'processing' });
    renderAt('/fix-it/success?session_id=cs_test_1');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await screen.findByText('Your payment is still processing')).toBeInTheDocument();
    expect(stripeService.confirmFixItPurchase).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/don.t need to pay again/)).toBeInTheDocument();
  });

  it('explains a failure without asking the seller to pay again', async () => {
    stripeService.confirmFixItPurchase.mockRejectedValue({ response: { data: { message: 'Session does not belong to this user' } } });
    renderAt('/fix-it/success?session_id=cs_test_1');
    expect(await screen.findByText(/couldn.t confirm your payment/)).toBeInTheDocument();
    expect(screen.getByText(/don.t pay again/)).toBeInTheDocument();
  });

  it('a link without a session id', async () => {
    renderAt('/fix-it/success');
    expect(await screen.findByText(/missing its payment reference/)).toBeInTheDocument();
    expect(stripeService.confirmFixItPurchase).not.toHaveBeenCalled();
  });
});

describe('VITE_FIX_IT_PACKAGES', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('is on when unset', async () => {
    vi.stubEnv('VITE_FIX_IT_PACKAGES', undefined);
    expect((await import('../../utils/featureFlags.js')).FIX_IT_PACKAGES).toBe(true);
  });

  it('is off only when set to false', async () => {
    vi.stubEnv('VITE_FIX_IT_PACKAGES', 'false');
    expect((await import('../../utils/featureFlags.js')).FIX_IT_PACKAGES).toBe(false);
  });
});
