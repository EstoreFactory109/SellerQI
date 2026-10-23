/**
 * Connect page with multi-marketplace onboarding on: tick every marketplace, choose a main one.
 *
 * Pinned: several marketplaces can be ticked, the first is main until another is chosen, and the
 * trip to Amazon goes to the MAIN marketplace's region carrying every pick.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import ConnectToAmazon from '../../Pages/Onboarding/ConnectToAmazon.jsx';
import axiosInstance from '../../config/axios.config.js';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-redux', () => ({ useSelector: (pick) => pick({ Auth: { isAuthenticated: true, user: {} } }) }));

afterEach(() => vi.clearAllMocks());

const renderOn = () => {
  axiosInstance.get.mockResolvedValue({ data: { data: { enabled: true, primary: null, regions: [], marketplaces: [] } } });
  return render(<MemoryRouter><ConnectToAmazon /></MemoryRouter>);
};

describe('ConnectToAmazon — several marketplaces', () => {
  it('ticks several, makes the first main, and lets another become main', async () => {
    renderOn();
    await userEvent.click(await screen.findByRole('button', { name: /United States of America/ }));
    await userEvent.click(screen.getByRole('button', { name: /United Kingdom/ }));
    await userEvent.click(screen.getByRole('button', { name: /Germany/ }));

    expect(screen.getByRole('button', { name: /Germany/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Main')).toHaveLength(1);
    expect(screen.getByText(/3 marketplaces in 2 regions/)).toBeInTheDocument();

    const makeMain = screen.getAllByRole('button', { name: 'Make main' });
    expect(makeMain).toHaveLength(2);
    await userEvent.click(makeMain[0]); // United Kingdom (Europe rows follow North America)
    expect(screen.getByText(/approve Europe, then North America/)).toBeInTheDocument();
  });

  it('sends the seller to the main marketplace\'s region with every pick', async () => {
    axiosInstance.post.mockResolvedValue({ data: { data: { state: 'a'.repeat(64) } } });
    const assign = vi.spyOn(window, 'location', 'get').mockReturnValue({ origin: 'http://app', href: '' });
    renderOn();
    await userEvent.click(await screen.findByRole('button', { name: /United States of America/ }));
    await userEvent.click(screen.getByRole('button', { name: /Canada/ }));
    await userEvent.click(screen.getByRole('button', { name: /United Kingdom/ }));
    await userEvent.click(screen.getByRole('button', { name: /Connect with Amazon/ }));

    await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/app/onboarding/oauth-state', {
      kind: 'spapi', region: 'NA', primaryCountry: 'US', plannedCountries: ['US', 'CA', 'UK'],
    }));
    assign.mockRestore();
  });

  it('un-ticking the main marketplace hands main to the next pick', async () => {
    renderOn();
    await userEvent.click(await screen.findByRole('button', { name: /United States of America/ }));
    await userEvent.click(screen.getByRole('button', { name: /Japan/ }));
    await userEvent.click(screen.getByRole('button', { name: /United States of America/ }));
    expect(screen.getByText(/1 marketplace in 1 region — you’ll approve Far East\./)).toBeInTheDocument();
    expect(screen.getAllByText('Main')).toHaveLength(1);
  });
});
