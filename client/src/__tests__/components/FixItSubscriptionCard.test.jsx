/**
 * The seller's monthly Fix it subscription on the Tasks page.
 * Pinned: shows the plan and when it renews; cancel asks first and then says until when the
 * team keeps working; "Keep my subscription" undoes it; a failed payment asks for a new card;
 * errors from the server are shown; nothing renders without a live subscription.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import FixItSubscriptionCard from '../../Components/Tasks/FixItSubscriptionCard.jsx';
import stripeService from '../../services/stripeService.js';

vi.mock('../../services/stripeService.js', () => ({
  default: { cancelFixItSubscription: vi.fn(), resumeFixItSubscription: vi.fn(), openFixItBillingPortal: vi.fn(), getFixItSubscription: vi.fn() },
}));

const sub = (over = {}) => ({
  live: true, packageId: 'standard', packageName: 'Standard', tasks: 30, priceUsd: 299,
  status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-11-27T12:00:00Z', monthsPaid: 2, ...over,
});

afterEach(() => vi.clearAllMocks());

describe('FixItSubscriptionCard', () => {
  it('shows the plan, the month and when it renews', () => {
    render(<FixItSubscriptionCard subscription={sub()} />);
    expect(screen.getByText(/Fix it Standard: 30 tasks a month, \$299\/month/)).toBeInTheDocument();
    expect(screen.getByText(/month 2/)).toBeInTheDocument();
    expect(screen.getByText(/Renews on .*2026 for \$299/)).toBeInTheDocument();
  });

  it('cancel asks first, then says the team keeps working until the paid month ends', async () => {
    const onChange = vi.fn();
    stripeService.cancelFixItSubscription.mockResolvedValue(sub({ cancelAtPeriodEnd: true }));
    const { rerender } = render(<FixItSubscriptionCard subscription={sub()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    expect(stripeService.cancelFixItSubscription).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cancelAtPeriodEnd: true })));
    rerender(<FixItSubscriptionCard subscription={sub({ cancelAtPeriodEnd: true })} onChange={onChange} />);
    expect(screen.getByText(/Cancelled — the team keeps working until .*2026, then it stops/)).toBeInTheDocument();
  });

  it('a cancelled subscription can be kept', async () => {
    const onChange = vi.fn();
    stripeService.resumeFixItSubscription.mockResolvedValue(sub());
    render(<FixItSubscriptionCard subscription={sub({ cancelAtPeriodEnd: true })} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my subscription' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cancelAtPeriodEnd: false })));
  });

  it('a failed payment asks for a new card; Update card opens Stripe', () => {
    render(<FixItSubscriptionCard subscription={sub({ status: 'past_due' })} />);
    expect(screen.getByText(/last payment didn't go through/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update card' }));
    expect(stripeService.openFixItBillingPortal).toHaveBeenCalled();
  });

  it('shows the server\'s message when something fails', async () => {
    stripeService.openFixItBillingPortal.mockRejectedValue({ response: { data: { message: 'Updating your card online is not available right now. Please contact support.' } } });
    render(<FixItSubscriptionCard subscription={sub()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update card' }));
    expect(await screen.findByText(/not available right now/)).toBeInTheDocument();
  });

  it('renders nothing without a live subscription', () => {
    const { container } = render(<FixItSubscriptionCard subscription={sub({ live: false, status: 'canceled' })} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<FixItSubscriptionCard subscription={null} />).container).toBeEmptyDOMElement();
  });
});
