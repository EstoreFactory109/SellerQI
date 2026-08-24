/**
 * Tests for ProductsToFixList — the single component all three "products to fix"
 * surfaces render, so what it shows is what every page shows.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProductsToFixList from '../../Components/Shared/ProductsToFixList.jsx';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const product = (over = {}) => ({
  asin: over.asin || 'B0AAAAAAAA',
  rank: over.rank ?? 1,
  productName: over.productName || 'A Widget',
  // Capped: the gap already contains the ad waste, so profitImpact is max(), not the sum.
  profitImpact: over.profitImpact ?? 122.29,
  profitGap: over.profitGap ?? 122.29,
  adWasteComponent: over.adWasteComponent ?? 24.28,
  capitalTiedUp: over.capitalTiedUp ?? 0,
  amountIsEstimated: over.amountIsEstimated ?? true,
  taskCount: over.taskCount ?? 3,
  adsTaskCount: over.adsTaskCount ?? 12,
  categories: over.categories || ['ranking', 'profitability'],
  notInCatalogue: over.notInCatalogue ?? false,
  why: over.why ?? 'This product is not ranking well.',
  action: over.action ?? 'Optimize the listing.',
  ...over
});

const renderList = (props = {}) =>
  render(
    <MemoryRouter>
      <ProductsToFixList currency="A$" {...props} />
    </MemoryRouter>
  );

describe('ProductsToFixList', () => {
  it('shows the amount in the account currency', () => {
    renderList({ products: [product()] });
    expect(screen.getByText(/A\$122\.29/)).toBeInTheDocument();
  });

  it('marks an inferred amount with an asterisk', () => {
    renderList({ products: [product({ amountIsEstimated: true })] });
    expect(screen.getByText('A$122.29*')).toBeInTheDocument();
  });

  it('does not mark a fully measured amount', () => {
    renderList({ products: [product({ amountIsEstimated: false, adWasteComponent: 0 })] });
    expect(screen.getByText('A$122.29')).toBeInTheDocument();
    expect(screen.queryByText('A$122.29*')).not.toBeInTheDocument();
  });

  // The figure must read as containing the ad waste, not as excluding it.
  it('shows wasted ad spend as a component of the figure, not an addition', () => {
    renderList({ products: [product({ profitImpact: 122.29, adWasteComponent: 24.28 })] });
    expect(screen.getByText(/of which ~A\$24\.28 wasted ad spend/)).toBeInTheDocument();
    // And never the naive sum.
    expect(screen.queryByText(/A\$146\.57/)).not.toBeInTheDocument();
  });

  it('shows capital tied up separately from profit', () => {
    renderList({ products: [product({ profitImpact: 10, profitGap: 10, adWasteComponent: 0, amountIsEstimated: false, capitalTiedUp: 7902.24 })] });
    expect(screen.getByText('A$10.00')).toBeInTheDocument();
    expect(screen.getByText(/A\$7,902\.24 capital/)).toBeInTheDocument();
    expect(screen.getByText('profit impact')).toBeInTheDocument();
  });

  it('shows the AI prose and the action', () => {
    renderList({ products: [product()] });
    expect(screen.getByText(/not ranking well/)).toBeInTheDocument();
    expect(screen.getByText(/Optimize the listing/)).toBeInTheDocument();
  });

  it('totals both issue tallies, since ad issues are attributed separately', () => {
    renderList({ products: [product({ taskCount: 3, adsTaskCount: 12 })] });
    expect(screen.getByText(/15 issues/)).toBeInTheDocument();
  });

  it('flags a product that is advertised but not listed', () => {
    renderList({ products: [product({ notInCatalogue: true })] });
    expect(screen.getByText('not listed')).toBeInTheDocument();
  });

  it('deep-links to that product\'s tasks', () => {
    renderList({ products: [product({ asin: 'B07HP4V8NK' })] });
    screen.getByRole('button').click();
    expect(mockNavigate).toHaveBeenCalledWith('/seller-central-checker/tasks?asin=B07HP4V8NK');
  });

  it('honours a caller-supplied click handler instead of navigating', () => {
    const onProductClick = vi.fn();
    renderList({ products: [product({ asin: 'B01' })], onProductClick });
    screen.getByRole('button').click();
    expect(onProductClick).toHaveBeenCalledWith('B01');
  });

  it('respects the limit so a narrow card can show fewer', () => {
    const products = Array.from({ length: 8 }, (_, i) => product({ asin: `B0${i}`, rank: i + 1 }));
    renderList({ products, limit: 3 });
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('hides the action line in compact mode but keeps the reason', () => {
    renderList({ products: [product()], compact: true });
    expect(screen.getByText(/not ranking well/)).toBeInTheDocument();
    expect(screen.queryByText(/Optimize the listing/)).not.toBeInTheDocument();
  });

  it('says nothing needs attention when the list is empty', () => {
    renderList({ products: [] });
    expect(screen.getByText(/No products need attention/i)).toBeInTheDocument();
  });

  it('shows a placeholder while loading rather than an empty state', () => {
    renderList({ products: [], loading: true });
    expect(screen.queryByText(/No products need attention/i)).not.toBeInTheDocument();
  });

  it('labels a product with no recoverable money as "to review" rather than showing a zero', () => {
    renderList({ products: [product({ profitImpact: 0, profitGap: 0, adWasteComponent: 0, amountIsEstimated: false })] });
    expect(screen.getByText('to review')).toBeInTheDocument();
    expect(screen.queryByText(/A\$0\.00/)).not.toBeInTheDocument();
  });
});
