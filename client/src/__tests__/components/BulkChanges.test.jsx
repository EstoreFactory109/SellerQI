import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../config/axios.config.js', () => ({ default: {
  get: (url) => {
    if (url === '/api/actions/capabilities') return Promise.resolve({ data: { data: { features: { feeds: [{ actionType: 'feeds.cancel_feed', enabled: true }] } } } });
    if (url === '/api/actions/history') return Promise.resolve({ data: { data: { changes: [
      { id: 'R1', feature: 'feeds', actionType: 'feeds.bulk_fbm_stock', status: 'awaiting_amazon', preview: { title: 'Update stock for 3 SKUs' }, createdAt: '2026-10-30T10:00:00Z' },
      { id: 'R2', feature: 'feeds', actionType: 'feeds.bulk_fbm_stock', status: 'succeeded', message: 'Done on Amazon. 2 updated, 1 refused by Amazon.', preview: { title: 'Update stock for 3 SKUs' }, createdAt: '2026-10-29T10:00:00Z' },
    ] } } });
    return Promise.resolve({ data: { data: {} } });
  },
  post: vi.fn(), delete: vi.fn(),
} }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import { parseStockLines } from '../../Components/Products/BulkStockUpdate.jsx';
import ChangeHistoryPanel from '../../Components/Actions/ChangeHistoryPanel.jsx';

describe('parseStockLines', () => {
  it('reads SKU and quantity separated by comma, tab or semicolon, skipping a header', () => {
    expect(parseStockLines('SKU,quantity\nA-1, 12\nB-2\t0\n"C-3";5\n')).toEqual({ items: [{ sku: 'A-1', quantity: 12 }, { sku: 'B-2', quantity: 0 }, { sku: 'C-3', quantity: 5 }], bad: [] });
  });
  it('points at lines that are not SKU, quantity', () => {
    expect(parseStockLines('A-1, 12\nB-2, lots\nC-3').bad).toEqual([2, 3]);
  });
});

describe('ChangeHistoryPanel', () => {
  it('shows what Amazon is still processing (with Cancel) and the per-SKU outcome when done', async () => {
    render(<ChangeHistoryPanel feature="feeds" title="Bulk stock updates" />);
    expect(await screen.findByText('Amazon is processing')).toBeTruthy();
    expect(screen.getByText('Done on Amazon. 2 updated, 1 refused by Amazon.')).toBeTruthy();
    expect(await screen.findByText('Cancel')).toBeTruthy();
  });
});
