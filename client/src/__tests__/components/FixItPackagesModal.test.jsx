import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FixItPackagesModal, { FIX_IT_PACKAGES } from '../../Components/Tasks/FixItPackagesModal.jsx';

const open = (props = {}) => {
  const onClose = vi.fn();
  render(<FixItPackagesModal open onClose={onClose} {...props} />);
  return { onClose };
};

describe('FixItPackagesModal', () => {
  it('renders nothing while closed', () => {
    render(<FixItPackagesModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the three packages with their prices, task counts and pace', () => {
    open();
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect(screen.getByText('$299')).toBeInTheDocument();
    expect(screen.getByText('30 tasks a month')).toBeInTheDocument();
    expect(screen.getByText('1 task per day')).toBeInTheDocument();
    expect(screen.getByText('$499')).toBeInTheDocument();
    expect(screen.getByText('60 tasks a month')).toBeInTheDocument();
    // Trial is a one-off; the other two are monthly subscriptions.
    expect(screen.getByText('One-time payment')).toBeInTheDocument();
    expect(screen.getAllByText('Billed monthly · cancel anytime')).toHaveLength(2);
    expect(screen.getAllByText('/month')).toHaveLength(2);
    expect(screen.getByText('2 tasks per day')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('keeps the package data in step with what is shown', () => {
    expect(FIX_IT_PACKAGES.map(p => [p.price, p.tasks])).toEqual([[25, 2], [299, 30], [499, 60]]);
  });

  it('starts with nothing selected and Purchase disabled', () => {
    open();
    screen.getAllByRole('radio').forEach(r => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('button', { name: 'Purchase' })).toBeDisabled();
  });

  it('enables Purchase once a package is chosen and names its price', () => {
    open();
    fireEvent.click(screen.getByText('$299').closest('button'));
    expect(screen.getByText('$299').closest('button')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Subscribe for $299/month' })).toBeEnabled();
  });

  it('only one package is selected at a time', () => {
    open();
    fireEvent.click(screen.getByText('$25').closest('button'));
    fireEvent.click(screen.getByText('$499').closest('button'));
    expect(screen.getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Subscribe for $499/month' })).toBeInTheDocument();
  });

  it('hands the chosen package to onPurchase', () => {
    const onPurchase = vi.fn();
    open({ onPurchase });
    fireEvent.click(screen.getByText('$25').closest('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Purchase for $25' }));
    expect(onPurchase).toHaveBeenCalledWith(expect.objectContaining({ id: 'trial', price: 25, tasks: 2 }));
  });

  // The purchase is not wired to a backend yet; the button must not look like it worked.
  it('says purchase is unavailable when no handler is connected', () => {
    open();
    fireEvent.click(screen.getByText('$25').closest('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Purchase for $25' }));
    expect(screen.getByRole('status')).toHaveTextContent(/not available yet/i);
  });

  it('closes from the X button, the backdrop and Escape', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the panel itself is clicked', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByText('Let us fix it for you'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('forgets a previous selection when reopened', () => {
    const { rerender } = render(<FixItPackagesModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('$299').closest('button'));
    rerender(<FixItPackagesModal open={false} onClose={() => {}} />);
    rerender(<FixItPackagesModal open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Purchase' })).toBeDisabled();
  });
});

describe('FixItPackagesModal - value for this seller', () => {
  const t = (id, amount) => ({ taskId: id, amount, errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword' });
  // 3 open tasks: the trial covers the top 2 ($600 + $300), standard covers all 3.
  const OPEN = [t('a', 300), t('b', 600), t('c', 0)];

  it('shows what each package could cover from the seller\'s highest-value tasks', () => {
    open({ openTasks: OPEN, currency: '$' });
    expect(screen.getByText('$25').closest('button')).toHaveTextContent('Covers your top 2 tasks, worth ~$900/mo');
    expect(screen.getByText('$299').closest('button')).toHaveTextContent('Covers your top 3 tasks, worth ~$900/mo');
  });

  it('shows payback in days, rounded up, when amounts are in USD', () => {
    open({ openTasks: OPEN, currency: '$' });
    // $25 / ($900 / 30 per day) = 0.83 days; $299 / $30 = 9.97 -> 10 days.
    expect(screen.getByText('$25').closest('button')).toHaveTextContent('Could pay for itself in ~< 1 day');
    expect(screen.getByText('$299').closest('button')).toHaveTextContent('Could pay for itself in ~10 days');
  });

  // Prices are USD; comparing them with £ or A$ amounts would be a false claim.
  it('hides payback when the marketplace currency is not USD', () => {
    open({ openTasks: OPEN, currency: '£' });
    expect(screen.getByText('$299').closest('button')).toHaveTextContent('worth ~£900/mo');
    expect(screen.queryByText(/pay for itself/)).not.toBeInTheDocument();
  });

  it('notes tasks with no dollar estimate rather than hiding them', () => {
    open({ openTasks: OPEN, currency: '$' });
    expect(screen.getByText('$299').closest('button')).toHaveTextContent('Includes 1 task with no dollar estimate');
  });

  it('makes no money claim when no open task carries an amount', () => {
    open({ openTasks: [t('x', 0), t('y', 0)], currency: '$' });
    expect(screen.queryByText(/worth/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pay for itself/)).not.toBeInTheDocument();
  });

  it('recommends the smallest package that covers the open tasks, without selecting it', () => {
    open({ openTasks: OPEN, currency: '$' });
    expect(screen.getByText('Recommended for your 3 tasks').closest('button')).toHaveTextContent('$299');
    screen.getAllByRole('radio').forEach(r => expect(r).toHaveAttribute('aria-checked', 'false'));
  });

  it('shows no recommendation or value lines without open tasks', () => {
    open();
    expect(screen.queryByText(/Recommended for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Covers your top/)).not.toBeInTheDocument();
  });

  it('tracks package selection and the purchase click', () => {
    window.gtag = vi.fn();
    open({ openTasks: OPEN, currency: '$' });
    fireEvent.click(screen.getByText('$499').closest('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe for $499/month' }));
    expect(window.gtag).toHaveBeenCalledWith('event', 'fixit_package_select', { package_id: 'accelerated' });
    expect(window.gtag).toHaveBeenCalledWith('event', 'fixit_purchase_click', { package_id: 'accelerated', price: 499 });
    delete window.gtag;
  });
});

describe('FixItPackagesModal - an existing subscription', () => {
  it('marks the current plan and blocks a second subscription, but the Trial stays available', () => {
    render(<FixItPackagesModal open onClose={() => {}} onPurchase={vi.fn()} currentSubscription={{ live: true, packageId: 'standard', packageName: 'Standard' }} />);
    expect(screen.getByText('Your plan')).toBeInTheDocument();
    fireEvent.click(screen.getByText('$499').closest('button'));
    expect(screen.getByText('$499').closest('button')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/You're subscribed to Standard/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('$25').closest('button'));
    expect(screen.getByRole('button', { name: 'Purchase for $25' })).toBeEnabled();
  });
});
