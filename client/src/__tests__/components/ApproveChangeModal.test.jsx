import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = vi.fn();
vi.mock('../../config/axios.config.js', () => ({ default: { post: (...a) => mockPost(...a) } }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import ApproveChangeModal from '../../Components/Tasks/ApproveChangeModal.jsx';

const TASK = {
  taskId: 'T1',
  proposedAction: { type: 'add_negative_keyword', label: 'Add as negative keyword', summary: 'Add "cheap widget" as a negative exact keyword.', done: false },
};

const open = () => {
  const onClose = vi.fn();
  const onApproved = vi.fn();
  render(<ApproveChangeModal task={TASK} onClose={onClose} onApproved={onApproved} />);
  return { onClose, onApproved };
};

describe('ApproveChangeModal', () => {
  beforeEach(() => mockPost.mockReset());

  it('shows exactly what will change and sends nothing until approved', () => {
    open();
    expect(screen.getByText('Add "cheap widget" as a negative exact keyword.')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends the task id on approve and reports success', async () => {
    mockPost.mockResolvedValue({ data: { data: { results: [{ taskId: 'T1', status: 'succeeded' }] } } });
    const { onApproved } = open();
    fireEvent.click(screen.getByText('Approve: Add as negative keyword'));
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith('T1'));
    expect(mockPost).toHaveBeenCalledWith('/api/pagewise/tasks/approve-actions', { taskIds: ['T1'] }, { withCredentials: true });
    expect(screen.getByText('Done on Amazon')).toBeTruthy();
  });

  it('shows Amazon\'s refusal and does not mark the task done', async () => {
    mockPost.mockResolvedValue({ data: { data: { results: [{ taskId: 'T1', status: 'failed', message: 'Amazon rejected it' }] } } });
    const { onApproved } = open();
    fireEvent.click(screen.getByText('Approve: Add as negative keyword'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Amazon rejected it'));
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('cancel closes without sending', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
