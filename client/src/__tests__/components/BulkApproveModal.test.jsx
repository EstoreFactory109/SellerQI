import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = vi.fn();
vi.mock('../../config/axios.config.js', () => ({ default: { post: (...a) => mockPost(...a) } }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import BulkApproveModal from '../../Components/Tasks/BulkApproveModal.jsx';

const task = (i) => ({ taskId: `T${i}`, proposedAction: { type: 'pause_keyword', label: 'Pause keyword', summary: `Pause keyword ${i}.` } });

describe('BulkApproveModal', () => {
  beforeEach(() => mockPost.mockReset());

  it('lists every change and sends nothing until approved', () => {
    render(<BulkApproveModal tasks={[task(1), task(2)]} onClose={vi.fn()} onApproved={vi.fn()} />);
    expect(screen.getByText('Pause keyword 1.')).toBeTruthy();
    expect(screen.getByText('Pause keyword 2.')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends in groups of 25 and reports each result', async () => {
    const tasks = Array.from({ length: 27 }, (_, i) => task(i));
    mockPost.mockImplementation(async (...args) => { const taskIds = (args[1] || {}).taskIds || []; return ({ data: { data: { results: taskIds.map((id) => ({ taskId: id, status: id === 'T3' ? 'failed' : 'succeeded', message: 'Amazon rejected it' })) } } }); });
    const onApproved = vi.fn();
    render(<BulkApproveModal tasks={tasks} onClose={vi.fn()} onApproved={onApproved} />);
    fireEvent.click(screen.getByText('Approve 27 changes'));
    await waitFor(() => expect(screen.getByText('26 of 27 changes made on Amazon')).toBeTruthy());
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][1].taskIds).toHaveLength(25);
    expect(onApproved).toHaveBeenCalledTimes(26);
    expect(screen.getByText('Amazon rejected it')).toBeTruthy();
  });
});
