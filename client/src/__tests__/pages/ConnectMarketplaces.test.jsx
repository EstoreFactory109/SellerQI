/**
 * Multi-marketplace onboarding checklist (/connect-marketplaces).
 *
 * Pinned: a region's discovered marketplaces are offered pre-ticked with the main one locked;
 * saving sends exactly the ticked set; the Ads matching proposes the server's match; other
 * regions can be added; and "Continue" starts the fetches and moves on. Also the shared
 * marketplace list and the consent URLs the flow sends sellers to.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import ConnectMarketplaces from '../../Pages/Onboarding/ConnectMarketplaces.jsx';
import axiosInstance from '../../config/axios.config.js';
import {
  COUNTRY_DATA,
  sellerCentralConsentUrl,
  adsConsentUrl,
} from '../../utils/amazonMarketplaces.js';
import { pendingOnboardingTrip } from '../../utils/multiMarketplaceOnboarding.js';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const marketplace = (country, region, extra = {}) => ({
  country, region, primary: false, spApi: true, ads: false, fetch: { status: 'not_started' }, ...extra,
});

const region = (code, extra = {}) => ({
  region: code, sellerCentral: false, ads: false, discoveryFailed: false, available: [], confirmed: [], adsMapping: [], ...extra,
});

const checklist = (overrides = {}) => ({
  enabled: true,
  primary: { country: 'UK', region: 'EU' },
  regions: [region('NA'), region('EU'), region('FE')],
  marketplaces: [],
  ...overrides,
});

const respond = (data) => ({ data: { data } });

const renderPage = () => render(
  <MemoryRouter initialEntries={['/connect-marketplaces']}>
    <Routes>
      <Route path="/connect-marketplaces" element={<ConnectMarketplaces />} />
      <Route path="/analyse-account" element={<div>analysing page</div>} />
      <Route path="/connect-to-amazon" element={<div>single marketplace page</div>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => sessionStorage.getItem.mockReturnValue(null));
afterEach(() => vi.clearAllMocks());

describe('ConnectMarketplaces', () => {
  it('offers the region\'s marketplaces pre-ticked, keeps the main one, and saves the ticked set', async () => {
    const eu = region('EU', {
      sellerCentral: true,
      available: [{ country: 'UK' }, { country: 'DE' }, { country: 'FR' }],
    });
    axiosInstance.get.mockResolvedValue(respond(checklist({ regions: [region('NA'), eu, region('FE')] })));
    axiosInstance.post.mockResolvedValue(respond(checklist({
      regions: [region('NA'), { ...eu, confirmed: ['UK', 'DE'] }, region('FE')],
      marketplaces: [marketplace('UK', 'EU', { primary: true }), marketplace('DE', 'EU')],
    })));

    renderPage();
    const france = await screen.findByRole('button', { name: /France/ });
    const uk = screen.getByRole('button', { name: /United Kingdom/ });
    expect(france).toHaveAttribute('aria-pressed', 'true');
    expect(within(uk).getByLabelText('Always included')).toBeInTheDocument();

    await userEvent.click(france);
    await userEvent.click(uk); // locked: stays selected
    await userEvent.click(screen.getByRole('button', { name: /Add selected marketplaces/ }));

    expect(axiosInstance.post).toHaveBeenCalledWith('/app/onboarding/marketplaces', { region: 'EU', countries: ['UK', 'DE'] });
    // Confirmed: the picker gives way to the region's marketplaces, with France still on offer.
    expect(await screen.findByText('Germany')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add selected marketplaces/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add more marketplaces from Europe/ })).toBeInTheDocument();
  });

  it('proposes the matched Ads profile and saves the mapping', async () => {
    const eu = region('EU', {
      sellerCentral: true,
      ads: true,
      available: [{ country: 'UK' }],
      confirmed: ['UK'],
      adsMapping: [{ country: 'UK', profileId: '111', candidates: [{ profileId: '111', name: 'UK shop', type: 'seller' }] }],
    });
    axiosInstance.get.mockResolvedValue(respond(checklist({
      regions: [region('NA'), eu, region('FE')],
      marketplaces: [marketplace('UK', 'EU', { primary: true })],
    })));
    axiosInstance.post.mockResolvedValue(respond(checklist()));

    renderPage();
    const select = await screen.findByRole('combobox');
    expect(select).toHaveValue('111');
    await userEvent.click(screen.getByRole('button', { name: /Save Ads profiles/ }));

    expect(axiosInstance.post).toHaveBeenCalledWith('/app/onboarding/ads/profiles', {
      region: 'EU',
      mapping: [{ country: 'UK', profileId: '111' }],
    });
  });

  it('starts preparing the main marketplace once its region is done, then continues', async () => {
    const eu = region('EU', { sellerCentral: true, ads: true, available: [{ country: 'UK' }], confirmed: ['UK'] });
    axiosInstance.get.mockResolvedValue(respond(checklist({
      regions: [region('NA'), eu, region('FE')],
      marketplaces: [marketplace('UK', 'EU', { primary: true, ads: true })],
    })));
    axiosInstance.post.mockResolvedValue(respond({
      started: ['UK'],
      checklist: checklist({
        regions: [region('NA'), eu, region('FE')],
        marketplaces: [marketplace('UK', 'EU', { primary: true, ads: true, fetch: { status: 'queued' } })],
      }),
    }));

    renderPage();
    await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/app/onboarding/start', { scope: 'primary' }));

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(axiosInstance.post).toHaveBeenCalledWith('/app/onboarding/start', { scope: 'all' });
    expect(await screen.findByText('analysing page')).toBeInTheDocument();
  });

  it('cannot continue before the main marketplace is connected', async () => {
    const eu = region('EU', { sellerCentral: true, available: [{ country: 'UK' }] });
    axiosInstance.get.mockResolvedValue(respond(checklist({ regions: [region('NA'), eu, region('FE')] })));

    renderPage();
    expect(await screen.findByRole('button', { name: /Continue/ })).toBeDisabled();
  });

  it('lets the seller add another region', async () => {
    const eu = region('EU', { sellerCentral: true, confirmed: ['UK'], available: [{ country: 'UK' }] });
    axiosInstance.get.mockResolvedValue(respond(checklist({
      regions: [region('NA'), eu, region('FE')],
      marketplaces: [marketplace('UK', 'EU', { primary: true })],
    })));

    renderPage();
    expect(await screen.findByRole('button', { name: /North America/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Far East/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\s*Europe/ })).not.toBeInTheDocument();
  });

  it('sends a seller the flag is off for back to the single-marketplace flow', async () => {
    axiosInstance.get.mockResolvedValue(respond({ enabled: false }));
    renderPage();
    expect(await screen.findByText('single marketplace page')).toBeInTheDocument();
  });
});

describe('shared marketplace list', () => {
  it('gives every marketplace a region and a Seller Central site in that region\'s style', () => {
    expect(COUNTRY_DATA).toHaveLength(23);
    for (const c of COUNTRY_DATA) {
      expect(['NA', 'EU', 'FE']).toContain(c.region);
      expect(c.sellerCentralUrl).toMatch(/^https:\/\/sellercentral[.-]/);
      expect(c.marketplaceId).toMatch(/^[A-Z0-9]{9,14}$/);
    }
    expect(new Set(COUNTRY_DATA.map((c) => c.code)).size).toBe(23);
  });
});

describe('consent URLs', () => {
  it('opens the chosen marketplace\'s Seller Central when it is in the region, else the region default', () => {
    const base = { state: 's', applicationId: 'app', redirectUri: 'https://x/auth/callback' };
    expect(sellerCentralConsentUrl({ ...base, region: 'EU', country: 'DE' })).toMatch(/^https:\/\/sellercentral-europe\.amazon\.com\/apps\/authorize\/consent\?/);
    expect(sellerCentralConsentUrl({ ...base, region: 'NA', country: 'DE' })).toMatch(/^https:\/\/sellercentral\.amazon\.com\//);
    expect(sellerCentralConsentUrl({ ...base, region: 'FE' })).toMatch(/^https:\/\/sellercentral\.amazon\.co\.jp\//);
    expect(sellerCentralConsentUrl({ ...base, region: 'EU', beta: true })).toContain('version=beta');
  });

  it('uses the region\'s Login with Amazon host for Ads', () => {
    const url = new URL(adsConsentUrl({ region: 'EU', state: 's', clientId: 'c', redirectUri: 'https://x/auth/callback' }));
    expect(url.origin).toBe('https://eu.account.amazon.com');
    expect(url.searchParams.get('scope')).toBe('advertising::campaign_management');
    expect(url.searchParams.get('state')).toBe('s');
  });
});

describe('callback routing', () => {
  it('recognises only the trip it started', () => {
    // The test setup stubs sessionStorage, so feed the stored trip through getItem.
    sessionStorage.getItem.mockImplementation((key) => (key === 'sqi_mm_onboarding_oauth' ? JSON.stringify({ state: 'abc', kind: 'ads' }) : null));
    expect(pendingOnboardingTrip('abc')).toEqual({ state: 'abc', kind: 'ads' });
    expect(pendingOnboardingTrip('other')).toBeNull();
    expect(pendingOnboardingTrip(null)).toBeNull();
  });
});
