import { describe, it, expect } from 'vitest';
import { rootReducer, MARKETPLACE_SCOPED_SLICES } from '../../redux/store/store.js';
import { selectMarketplace, initMarketplace, setMarketplaceMode } from '../../redux/slices/marketplaceSlice.js';

const boot = () => {
  let state = rootReducer(undefined, { type: '@@init' });
  state = rootReducer(state, initMarketplace({ selected: { country: 'US', region: 'NA' } }));
  return {
    ...state,
    Dashboard: { DashBoardInfo: { Country: 'US', Region: 'NA', startDate: '2026-09-01', TotalSales: [1, 2] } },
    AllAccounts: { AllAccounts: [{ country: 'US', region: 'NA' }, { country: 'UK', region: 'EU' }] },
    Auth: { ...state.Auth, isAuthenticated: true },
    ppcMetrics: { ...state.ppcMetrics, marker: 'US data' },
  };
};

describe('switching marketplace', () => {
  it('resets every marketplace-scoped slice and keeps account-level state', () => {
    const before = boot();
    const after = rootReducer(before, selectMarketplace({ country: 'UK', region: 'EU' }));

    expect(after.marketplace.selected).toEqual({ country: 'UK', region: 'EU' });
    expect(after.ppcMetrics.marker).toBeUndefined();
    expect(after.Dashboard.DashBoardInfo).toEqual({ Country: 'UK', Region: 'EU' });
    expect(after.currency).toEqual({ currency: '£', country: 'UK' });
    expect(after.AllAccounts).toBe(before.AllAccounts);
    expect(after.Auth).toBe(before.Auth);
  });

  it('does nothing to the data when the same marketplace is picked again', () => {
    const before = boot();
    const after = rootReducer(before, selectMarketplace({ country: 'US', region: 'NA' }));
    expect(after.ppcMetrics.marker).toBe('US data');
    expect(after.Dashboard.DashBoardInfo.TotalSales).toEqual([1, 2]);
  });

  it('picking a marketplace leaves "All marketplaces"', () => {
    let state = rootReducer(boot(), setMarketplaceMode('all'));
    expect(state.marketplace.mode).toBe('all');
    state = rootReducer(state, selectMarketplace({ country: 'UK', region: 'EU' }));
    expect(state.marketplace.mode).toBe('single');
  });

  it('lists only slices that exist in the store', () => {
    const state = rootReducer(undefined, { type: '@@init' });
    MARKETPLACE_SCOPED_SLICES.forEach((key) => expect(key in state).toBe(true));
  });
});
