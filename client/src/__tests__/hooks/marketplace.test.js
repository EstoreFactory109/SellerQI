import { describe, it, expect } from 'vitest';
import { resolveMarketplaceParam, connectedMarketplaces, ALL_MARKETPLACES } from '../../hooks/useMarketplace.js';
import { addMarketplaceHeader, isOwnApiRequest, marketplaceHeaderValue } from '../../utils/marketplaceRequest.js';

const accounts = [
  { country: 'US', region: 'NA', isConnected: true },
  { country: 'UK', region: 'EU', isConnected: false },
  { country: 'US', region: 'NA', isConnected: true },
];

describe('resolveMarketplaceParam', () => {
  it('accepts a country code or country:region the user owns', () => {
    expect(resolveMarketplaceParam('uk', accounts)).toEqual({ country: 'UK', region: 'EU' });
    expect(resolveMarketplaceParam('US:NA', accounts)).toEqual({ country: 'US', region: 'NA' });
  });
  it('recognises "all"', () => {
    expect(resolveMarketplaceParam('ALL', accounts)).toBe(ALL_MARKETPLACES);
  });
  it('rejects a marketplace the user does not have', () => {
    expect(resolveMarketplaceParam('DE', accounts)).toBeNull();
    expect(resolveMarketplaceParam('US:EU', accounts)).toBeNull();
    expect(resolveMarketplaceParam(null, accounts)).toBeNull();
  });
});

describe('connectedMarketplaces', () => {
  it('dedupes and puts connected marketplaces first', () => {
    expect(connectedMarketplaces([accounts[1], ...accounts])).toEqual([
      { country: 'US', region: 'NA', isConnected: true },
      { country: 'UK', region: 'EU', isConnected: false },
    ]);
  });
});

describe('X-Marketplace header', () => {
  const base = 'https://api.sellerqi.com';

  it('is sent only to our own API', () => {
    expect(isOwnApiRequest({ url: '/api/pagewise/navbar' }, base)).toBe(true);
    expect(isOwnApiRequest({ url: `${base}/api/x` }, base)).toBe(true);
    expect(isOwnApiRequest({ url: 'https://cdn.example.com/a.js' }, base)).toBe(false);
    expect(isOwnApiRequest({ url: '/api/x', baseURL: base }, base)).toBe(true);
    expect(isOwnApiRequest({ url: '/x', baseURL: 'https://other.com' }, base)).toBe(false);
  });

  it('adds the header, without overriding one a caller set', () => {
    expect(addMarketplaceHeader({ url: '/api/x', headers: {} }, 'UK:EU').headers['X-Marketplace']).toBe('UK:EU');
    expect(addMarketplaceHeader({ url: '/api/x', headers: { 'X-Marketplace': 'US:NA' } }, 'UK:EU').headers['X-Marketplace']).toBe('US:NA');
    expect(addMarketplaceHeader({ url: '/api/x', headers: {} }, null).headers['X-Marketplace']).toBeUndefined();
  });

  it('formats the selection', () => {
    expect(marketplaceHeaderValue({ country: 'UK', region: 'EU' })).toBe('UK:EU');
    expect(marketplaceHeaderValue(null)).toBeNull();
  });
});
