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

describe('ApproveChangeModal listing fixes', () => {
  const LISTING = {
    taskId: 'T7', asin: 'B01',
    proposedAction: { type: 'update_listing_content', label: 'Fix the bullet points', editable: true, field: 'bulletpoints', summary: "Replace this product's bullet points on Amazon with the text you approve below.", done: false },
  };

  it('asks for text before approving, and sends bullets one per line', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { data: { results: [{ taskId: 'T7', status: 'succeeded' }] } } });
    const onApproved = vi.fn();
    render(<ApproveChangeModal task={LISTING} onClose={vi.fn()} onApproved={onApproved} />);
    fireEvent.click(screen.getByText('Approve: Fix the bullet points'));
    expect(screen.getByRole('alert').textContent).toContain('Write the new text');
    fireEvent.change(screen.getByLabelText('New bullet points (one per line)'), { target: { value: 'First\nSecond\n' } });
    fireEvent.click(screen.getByText('Approve: Fix the bullet points'));
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith('T7'));
    expect(mockPost).toHaveBeenCalledWith('/api/pagewise/tasks/approve-actions', { taskIds: ['T7'], content: { T7: ['First', 'Second'] } }, { withCredentials: true });
  });

  it('fills the field from AI suggestions', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { data: { bulletpoints: ['AI one', 'AI two'] } } });
    render(<ApproveChangeModal task={LISTING} onClose={vi.fn()} onApproved={vi.fn()} />);
    fireEvent.click(screen.getByText('AI suggestions'));
    await waitFor(() => expect(screen.getByLabelText('New bullet points (one per line)').value).toBe('AI one\nAI two'));
    expect(mockPost).toHaveBeenCalledWith('/api/ai/ranking-content', { asin: 'B01', attribute: 'bulletpoints' }, { withCredentials: true });
  });
});
