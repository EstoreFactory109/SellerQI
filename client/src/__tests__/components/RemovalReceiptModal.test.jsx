import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('../../config/axios.config.js', () => ({
  default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) },
}));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import RemovalReceiptModal from '../../Components/Tasks/RemovalReceiptModal.jsx';

const LINES = [
  { orderId: 'R1', sku: 'S1', asin: 'A1', productName: 'Garlic Press', requestDate: '2026-10-01', lastUpdatedDate: '2026-10-10', shippedQuantity: 10 },
  { orderId: 'R2', sku: 'S2', asin: null, productName: null, requestDate: '2026-10-02', lastUpdatedDate: '2026-10-12', shippedQuantity: 4 },
];

const open = (props = {}) => {
  const onClose = vi.fn();
  const onConfirmed = vi.fn();
  render(<RemovalReceiptModal open onClose={onClose} onConfirmed={onConfirmed} {...props} />);
  return { onClose, onConfirmed };
};

const received = (orderId, sku) => screen.getByLabelText(`Units received for order ${orderId}, SKU ${sku}`);

describe('RemovalReceiptModal', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue({ data: { data: LINES } });
  });

  it('renders nothing while closed', () => {
    render(<RemovalReceiptModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('lists the lines to confirm with "received" pre-filled to what Amazon shipped', async () => {
    open();
    expect(mockGet).toHaveBeenCalledWith('/api/removal-receipts/pending', { withCredentials: true });
    expect(await screen.findByText('Garlic Press')).toBeInTheDocument();
    expect(received('R1', 'S1')).toHaveValue(10);
    expect(received('R2', 'S2')).toHaveValue(4);
    // A line with no catalogue name falls back to its SKU.
    expect(screen.getAllByText('S2').length).toBeGreaterThan(0);
    expect(screen.getByText('Everything shipped is marked as received.')).toBeInTheDocument();
  });

  it('sends every line, says what is missing, and reports back so the task can be ticked off', async () => {
    mockPost.mockResolvedValue({ data: { data: { saved: 2, rejected: [] } } });
    const { onConfirmed } = open();
    await screen.findByText('Garlic Press');
    fireEvent.change(received('R1', 'S1'), { target: { value: '7' } });
    expect(screen.getByText('3 units will be marked as missing.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/api/removal-receipts/confirm', {
      entries: [
        { orderId: 'R1', sku: 'S1', receivedQuantity: 7 },
        { orderId: 'R2', sku: 'S2', receivedQuantity: 4 },
      ],
    }, { withCredentials: true });
    expect(await screen.findByRole('status')).toHaveTextContent('3 units are missing');
    expect(onConfirmed).toHaveBeenCalledWith({ saved: 2, short: 1 });
  });

  it('blocks Confirm on a count that is not a whole number from 0 to shipped', async () => {
    open();
    await screen.findByText('Garlic Press');
    fireEvent.change(received('R1', 'S1'), { target: { value: '11' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.change(received('R1', 'S1'), { target: { value: '2.5' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.change(received('R1', 'S1'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.change(received('R1', 'S1'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('shows lines the server rejected and does not tick the task off', async () => {
    mockPost.mockResolvedValue({ data: { data: { saved: 1, rejected: [{ orderId: 'R2', sku: 'S2', reason: 'Not a returned removal order line from the last 60 days' }] } } });
    const { onConfirmed } = open();
    await screen.findByText('Garlic Press');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Order R2, SKU S2: Not a returned removal order line/)).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('says so when there is nothing left to confirm', async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    open();
    expect(await screen.findByText(/Nothing left to confirm/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('shows the server message when loading fails', async () => {
    mockGet.mockRejectedValue({ response: { data: { message: 'Failed to load removal orders' } } });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load removal orders');
  });
});
