import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockCapabilities = [];
const mockPost = vi.fn();
const mockGet = vi.fn((url) => {
  if (url === '/api/actions/capabilities') return Promise.resolve({ data: { data: { features: { ads: mockCapabilities } } } });
  if (url === '/api/actions/ads/campaigns') return Promise.resolve({ data: { data: { campaigns: [
    { campaignId: '11', name: 'Garlic exact', state: 'ENABLED', targetingType: 'MANUAL', dailyBudget: 15 },
    { campaignId: '12', name: 'Garlic auto', state: 'PAUSED', targetingType: 'AUTO', dailyBudget: 5 },
  ] } } });
  return Promise.resolve({ data: { data: {} } });
});
vi.mock('../../config/axios.config.js', () => ({ default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a), delete: () => Promise.resolve({}) } }));
vi.mock('../../utils/analytics.js', () => ({ trackEvent: vi.fn() }));

import CampaignManager from '../../Components/PPC/CampaignManager.jsx';

const all = ['ads.set_campaign_state', 'ads.set_ad_group_state', 'ads.add_keywords', 'ads.create_campaign', 'ads.create_ad_group'].map((actionType) => ({ actionType, enabled: true }));

describe('CampaignManager', () => {
  beforeEach(() => { mockPost.mockReset(); mockCapabilities = all; });

  it('stays hidden until these changes are switched on for the account', async () => {
    mockCapabilities = all.map((a) => ({ ...a, enabled: false }));
    const { container } = render(<CampaignManager />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/actions/capabilities'));
    expect(container.textContent).toBe('');
  });

  it('pauses a campaign through the approval window, never directly', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { id: 'D1', status: 'draft', preview: { title: 'Pause 1 campaign', lines: [{ label: 'Garlic exact', before: 'Enabled', after: 'Paused' }] } } } });
    render(<CampaignManager />);
    fireEvent.click(await screen.findByText('Pause'));
    await screen.findByText('Pause 1 campaign');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/actions/ads/preview', { actionType: 'ads.set_campaign_state', input: { ids: ['11'], state: 'PAUSED' }, source: 'screen' });
  });

  it('asks for the campaign name before archiving', async () => {
    render(<CampaignManager />);
    const archive = await screen.findAllByText('Archive');
    fireEvent.click(archive[0]);
    const cont = screen.getByText('Continue');
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type Garlic exact to confirm'), { target: { value: 'Garlic exact' } });
    expect(cont.disabled).toBe(false);
    mockPost.mockResolvedValueOnce({ data: { data: { id: 'D2', status: 'draft', preview: { title: 'Archive 1 campaign', lines: [] } } } });
    fireEvent.click(cont);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/actions/ads/preview', expect.objectContaining({ input: { ids: ['11'], state: 'ARCHIVED', confirmArchive: true } })));
  });
});
