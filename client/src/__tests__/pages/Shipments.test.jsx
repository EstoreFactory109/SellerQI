import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = vi.fn(() => Promise.resolve({ data: { data: { id: 'D1', status: 'draft', preview: { title: 'Create a shipment plan for 48 units', lines: [] } } } }));
vi.mock('../../config/axios.config.js', () => ({ default: {
  get: (url) => {
    if (url === '/api/actions/capabilities') return Promise.resolve({ data: { data: { features: { inbound: [{ actionType: 'inbound.create_plan', enabled: true }] } } } });
    if (url === '/api/actions/inbound/plans') return Promise.resolve({ data: { data: { plans: [{ inboundPlanId: 'wf30559037-2ef3', name: 'FBA Week of 10-26-2026 KC', status: 'ACTIVE', createdAt: '2026-10-29T17:17:31Z' }] } } });
    return Promise.resolve({ data: { data: {} } });
  },
  post: (...a) => mockPost(...a), delete: () => Promise.resolve({}),
} }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../Components/Marketplace/MarketplaceSwitcher.jsx', () => ({ default: () => null }));

import Shipments from '../../Pages/Inventory/Shipments.jsx';

describe('Shipments to Amazon', () => {
  beforeEach(() => mockPost.mockClear());

  it('lists the plans from Amazon', async () => {
    render(<Shipments />);
    expect(await screen.findByText('FBA Week of 10-26-2026 KC')).toBeTruthy();
  });

  it('sends a new plan to the approval window, not to Amazon', async () => {
    render(<Shipments />);
    fireEvent.click(await screen.findByText('New shipment'));
    fireEvent.change(screen.getByLabelText('SKUs to send: SKU, quantity (one per line)'), { target: { value: 'SKU-1 FBA, 48' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/actions/inbound/preview', expect.objectContaining({ actionType: 'inbound.create_plan', input: expect.objectContaining({ items: [{ sku: 'SKU-1 FBA', quantity: 48 }] }) })));
  });
});
