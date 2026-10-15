/**
 * Task statuses the server sets on its own (task reconcile):
 *   resolved       — the issue stopped being detected; counts as done, not toggleable
 *   stillDetected  — the seller marked it done over a week ago, but the data still shows it
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import Tasks from '../../Pages/Tools/Tasks.jsx';
import tasksReducer from '../../redux/slices/TasksSlice.js';

vi.mock('../../redux/slices/TasksSlice.js', async () => {
  const actual = await vi.importActual('../../redux/slices/TasksSlice.js');
  return {
    ...actual,
    fetchTasks: () => ({ type: 'tasks/fetchTasks/noop' }),
    updateTaskStatus: () => ({ type: 'tasks/updateTaskStatus/noop' }),
  };
});

const makeTask = (over = {}) => ({
  productName: 'Product',
  asin: 'B000',
  errorCategory: 'ranking',
  errorType: 'titleresult_char_limit',
  error: 'Some error text',
  solution: 'Some solution text',
  status: 'pending',
  amount: 0,
  effortMinutes: 5,
  impactWeight: 50,
  isQuickWin: true,
  ...over,
});

const TASKS = [
  makeTask({ taskId: 't-open', asin: 'B001', error: 'Open issue' }),
  makeTask({ taskId: 't-resolved', asin: 'B002', error: 'Gone issue', status: 'resolved' }),
  makeTask({ taskId: 't-still', asin: 'B003', error: 'Still there', stillDetected: true }),
];

// Seed through the real reducer, so the resolved -> completedTasks rule is exercised.
const seededTasksState = () => tasksReducer(undefined, {
  type: 'tasks/fetchTasks/fulfilled',
  payload: { tasks: TASKS, groups: [], taskRenewalDate: null },
});

const renderTasks = () => {
  const tasksState = seededTasksState();
  const store = configureStore({
    reducer: {
      tasks: () => tasksState,
      currency: () => ({ currency: '$' }),
      Auth: () => ({ user: { _id: 'u1' } }),
      Dashboard: () => ({ DashBoardInfo: { TotalProduct: [] } }),
      pageData: () => ({}),
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter><Tasks /></MemoryRouter>
    </Provider>
  );
};

describe('TasksSlice', () => {
  it('counts server-resolved tasks as done', () => {
    expect(seededTasksState().completedTasks).toEqual(['t-resolved']);
  });

  it('clears stillDetected once the seller acts on the task', () => {
    const state = tasksReducer(seededTasksState(), {
      type: 'tasks/updateTaskStatus/fulfilled',
      payload: { taskId: 't-still', status: 'completed' },
    });
    expect(state.tasks.find(t => t.taskId === 't-still').stillDetected).toBe(false);
    expect(state.completedTasks).toContain('t-still');
  });
});

describe('Tasks page - server-set statuses', () => {
  it('labels a resolved task "Resolved automatically" and disables its checkbox', () => {
    renderTasks();
    // Done tasks are never highlighted, so the resolved one sits in the collapsed bucket.
    fireEvent.click(screen.getByText('Everything else').closest('button'));
    const badge = screen.getByText('Resolved automatically');
    expect(badge).toHaveAttribute('title', 'Our latest data no longer shows this issue.');

    const toggle = screen.getByTitle('Resolved automatically — this issue is no longer detected');
    expect(toggle).toBeDisabled();
  });

  it('labels a reopened task "Still detected" and explains why', () => {
    renderTasks();
    const badge = screen.getByText('Still detected');
    expect(badge.getAttribute('title')).toMatch(/marked this done over a week ago/);
  });

  it('labels an ordinary open task "Pending"', () => {
    renderTasks();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });
});
