import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const mockPost = vi.fn();
const mockDelete = vi.fn(() => Promise.resolve({}));
const mockGet = vi.fn();
vi.mock('../../config/axios.config.js', () => ({ default: { post: (...a) => mockPost(...a), delete: (...a) => mockDelete(...a), get: (...a) => mockGet(...a) } }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import { ChangeRequestModal } from '../../Components/Actions/ChangeRequestModal.jsx';

const REQUEST = { feature: 'ads', actionType: 'ads.pause_keywords', input: { keywordIds: ['K1'], adType: 'SP' } };
const DRAFT = { id: 'D1', status: 'draft', preview: { title: 'Pause 1 keyword', target: 'Amazon Ads', lines: [{ label: '"garlic press"', before: 'Enabled', after: 'Paused' }], warnings: [] } };

const open = () => {
  const onFinish = vi.fn();
  render(<ChangeRequestModal request={REQUEST} onFinish={onFinish} />);
  return { onFinish };
};

describe('ChangeRequestModal', () => {
  beforeEach(() => { mockPost.mockReset(); mockDelete.mockClear(); mockGet.mockReset(); });

  it('only asks for a preview when it opens, and shows exactly what will change', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: DRAFT } });
    open();
    await screen.findByText('"garlic press"');
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/actions/ads/preview', { actionType: 'ads.pause_keywords', input: REQUEST.input, source: 'screen' });
  });

  it('sends exactly one approval on Send to Amazon and reports the outcome', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: DRAFT } });
    mockPost.mockResolvedValueOnce({ data: { data: { id: 'D1', status: 'succeeded', message: 'Done on Amazon.' } } });
    const { onFinish } = open();
    fireEvent.click(await screen.findByText('Send to Amazon'));
    await screen.findByText('Done on Amazon.');
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenLastCalledWith('/api/actions/ads/D1/approve');
    fireEvent.click(screen.getByText('Close'));
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });

  it('cancels the unsent preview when closed, and reports that nothing was approved', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: DRAFT } });
    const { onFinish } = open();
    fireEvent.click(await screen.findByText('Cancel'));
    expect(mockDelete).toHaveBeenCalledWith('/api/actions/ads/D1');
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('cannot send while Amazon reports a blocking issue', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { ...DRAFT, preview: { ...DRAFT.preview, blocking: true, amazonIssues: ['Price below the minimum'] } } } });
    open();
    expect(await screen.findByText('Price below the minimum')).toBeTruthy();
    expect(screen.getByText('Send to Amazon').disabled).toBe(true);
  });
});

describe('no screen writes to Amazon without the approval window', () => {
  // QMate used to apply a listing fix straight from a chat reply; the PPC page sent
  // pause/negative changes with no preview. Guard against either coming back.
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  it.each(['Pages/Tools/QMate.jsx', 'Pages/Dashboard/PPCDashboard.jsx', 'Components/ProductDetails/ProductPPCIssuesTable.jsx'])('%s', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\/api\/qmate\/apply-fix|\/api\/qmate\/ppc\/|\/api\/pagewise\/ads\//);
  });
});
