/**
 * ESF client Status page: the work the team delivered (Zoho files and links).
 *
 * Pinned: files sit under the day they were delivered in the day-by-day summary; completed
 * tasks expand to show what was delivered; "Download all" zips the task's files; links open
 * directly; staff (logged in as the client) see hidden files with the AI's reason and can
 * show them; clients get no staff controls.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Status from '../../Pages/ESF/EstoreFactory/Status.jsx';
import axiosInstance from '../../config/axios.config.js';
import downloadFile from '../../utils/downloadFile.js';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/downloadFile.js', () => ({ default: vi.fn(() => Promise.resolve()) }));

const image = { key: 'f_11', kind: 'file', name: 'main-image.jpg', mimeType: 'image/jpeg', size: 145890, addedAt: '2026-10-20T10:00:00Z' };
const zip = { key: 'f_13', kind: 'file', name: 'all-images.zip', mimeType: 'file/zip', size: 3 * 1024 * 1024, addedAt: '2026-10-20T10:05:00Z' };
const link = { key: 'l_c1_0123456789ab', kind: 'link', name: 'Google Drive link', url: 'https://drive.google.com/x', addedAt: '2026-10-18T09:00:00Z' };

const task = (overrides = {}) => ({
  id: 'T1', name: 'Product images', status: 'In progress', priority: 'high', team: 'Design', tasklist: 'Images',
  updatedAt: '2026-10-20T10:00:00Z', updateCount: 3, lastUpdateAt: '2026-10-20T10:00:00Z',
  summary: '18 Oct: Shared the shoot plan.\n20 Oct: Final images delivered.',
  deliverables: [link, image, zip],
  yourReplies: [], waitingOnYou: null,
  ...overrides,
});

const board = (overrides = {}) => ({
  linked: true, projectName: 'Acme', waitingOnYou: [], comingUp: [], taskRequests: [], openMessageCount: 0,
  canAttachFiles: false, deliverablesEnabled: true, canManageDeliverables: false,
  inProgress: [task()],
  completed: [task({ id: 'T2', name: 'A+ content', summary: '15 Oct: A+ modules finished.', deliverables: [{ ...image, key: 'f_21', name: 'aplus.png', mimeType: 'image/png', addedAt: '2026-10-15T08:00:00Z' }] })],
  ...overrides,
});

const respond = (data) => ({ data: { data } });

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
  axiosInstance.get.mockImplementation(async (url) => (url === '/api/pagewise/esf/project-status'
    ? respond(board())
    : { data: new Blob(['img']) }));
});
afterEach(() => vi.clearAllMocks());

const openTask = async (name) => {
  await userEvent.click(await screen.findByText(name));
};

describe('Status page deliverables', () => {
  it('shows how many files a task has, and puts each under the day it was delivered', async () => {
    render(<Status />);
    const row = (await screen.findByText('Product images')).closest('[role="button"]');
    expect(within(row).getByTitle('3 delivered files')).toBeInTheDocument();

    await openTask('Product images');
    const day20 = screen.getByText('Final images delivered.').parentElement;
    expect(within(day20).getByTitle('main-image.jpg')).toBeInTheDocument(); // image thumbnail
    expect(within(day20).getByText('all-images.zip')).toBeInTheDocument();
    const day18 = screen.getByText('Shared the shoot plan.').parentElement;
    expect(within(day18).getByText('Google Drive link').closest('a')).toHaveAttribute('href', 'https://drive.google.com/x');
    // Thumbnails come through our server, not from Zoho.
    await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledWith('/api/pagewise/esf/project-status/files/f_11?preview=1', { responseType: 'blob' }));
  });

  it('downloads one file, or all of a task\'s files as a zip', async () => {
    render(<Status />);
    await openTask('Product images');
    await userEvent.click(screen.getByText('all-images.zip'));
    expect(downloadFile).toHaveBeenCalledWith('/api/pagewise/esf/project-status/files/f_13', 'all-images.zip');
    await userEvent.click(screen.getByRole('button', { name: /Download all \(2\)/ }));
    expect(downloadFile).toHaveBeenCalledWith('/api/pagewise/esf/project-status/tasks/T1/files.zip', 'Product images.zip');
  });

  it('explains when files cannot be downloaded yet', async () => {
    downloadFile.mockRejectedValueOnce({ response: { status: 503 } });
    render(<Status />);
    await openTask('Product images');
    await userEvent.click(screen.getByText('all-images.zip'));
    expect(await screen.findByText(/can't be downloaded yet/)).toBeInTheDocument();
  });

  it('completed tasks expand to show what was delivered', async () => {
    render(<Status />);
    await userEvent.click(await screen.findByText('Completed, last 30 days'));
    await openTask('A+ content');
    expect(screen.getByText('A+ modules finished.')).toBeInTheDocument();
    expect(screen.getByTitle('aplus.png')).toBeInTheDocument();
  });

  it('clients get no staff controls', async () => {
    render(<Status />);
    await openTask('Product images');
    expect(screen.queryByRole('button', { name: /Hide .* from client/ })).not.toBeInTheDocument();
  });

  it('staff see hidden files with the AI\'s reason, and can show one to the client', async () => {
    const hidden = { key: 'f_12', kind: 'file', name: 'working.psd', mimeType: 'image/vnd.adobe.photoshop', size: 99, addedAt: '2026-10-20T10:01:00Z', shown: false, aiDecision: 'no', aiReason: 'Working file', override: null };
    axiosInstance.get.mockImplementation(async (url) => (url === '/api/pagewise/esf/project-status'
      ? respond(board({ canManageDeliverables: true, inProgress: [task({ deliverables: [{ ...image, shown: true, aiDecision: 'yes', override: null }, hidden] })] }))
      : { data: new Blob(['img']) }));
    axiosInstance.post.mockResolvedValue(respond({ key: 'f_12', visibility: 'show' }));

    render(<Status />);
    await openTask('Product images');
    expect(screen.getByText('Working file')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show working.psd to client' }));
    expect(axiosInstance.post).toHaveBeenCalledWith('/api/pagewise/esf/project-status/files/f_12/visibility', { visibility: 'show' });
    expect(await screen.findByRole('button', { name: 'Hide working.psd from client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Let the AI decide for working.psd' })).toBeInTheDocument();
  });

  it('nothing new appears while the feature is off', async () => {
    axiosInstance.get.mockResolvedValue(respond(board({ deliverablesEnabled: false, inProgress: [task({ deliverables: [] , hasAttachments: true })] })));
    render(<Status />);
    await openTask('Product images');
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
    expect(screen.getByText('Has attachments in Zoho')).toBeInTheDocument();
  });
});
