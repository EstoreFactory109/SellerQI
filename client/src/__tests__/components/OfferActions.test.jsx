import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockEnabled = [];
const mockPost = vi.fn(() => Promise.resolve({ data: { data: { id: 'D1', status: 'draft', preview: { title: 'Update stock', lines: [] } } } }));
vi.mock('../../config/axios.config.js', () => ({ default: {
  get: (url) => Promise.resolve({ data: { data: url === '/api/actions/capabilities' ? { features: { listings: mockEnabled } } : {} } }),
  post: (...a) => mockPost(...a),
  delete: () => Promise.resolve({}),
} }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import OfferActions from '../../Components/ProductDetails/OfferActions.jsx';

describe('OfferActions', () => {
  beforeEach(() => { mockPost.mockClear(); mockEnabled = [{ actionType: 'listings.update_fbm_stock', enabled: true }, { actionType: 'listings.set_b2b_pricing', enabled: true }]; });

  it('is hidden until switched on', async () => {
    mockEnabled = [];
    const { container } = render(<OfferActions sku="S1" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('sends the stock to the approval window, not to Amazon', async () => {
    render(<OfferActions sku="S1" />);
    fireEvent.click(await screen.findByText('Update FBM stock'));
    fireEvent.change(screen.getByLabelText('Units in stock'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/actions/listings/preview', { actionType: 'listings.update_fbm_stock', input: { sku: 'S1', quantity: 12 }, source: 'screen' }));
  });

  it('builds business pricing with its tiers', async () => {
    render(<OfferActions sku="S1" />);
    fireEvent.click(await screen.findByText('Business pricing'));
    fireEvent.change(screen.getByLabelText('Business price'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('From units'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Price per unit'), { target: { value: '17' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/actions/listings/preview', expect.objectContaining({ actionType: 'listings.set_b2b_pricing', input: { sku: 'S1', price: 18, discountType: 'fixed', tiers: [{ minQuantity: 5, value: 17 }] } })));
  });
});
