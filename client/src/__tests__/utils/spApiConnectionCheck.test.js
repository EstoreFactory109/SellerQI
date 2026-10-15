/**
 * Adding a second marketplace must start at Seller Central. The connect page used
 * to ask "is ANY marketplace SP-API connected?", so a seller with US connected who
 * clicked Connect on AU was sent straight to the Ads step.
 */
import { describe, it, expect } from 'vitest';
import { isSpApiConnected, isSpApiConnectedFromAccounts } from '../../utils/spApiConnectionCheck.js';

// Shape of the Redux AllAccounts list (Services/main/Analyse.js).
const allAccounts = [
  { country: 'US', region: 'NA', SpAPIrefreshTokenStatus: true, AdsAPIrefreshTokenStatus: true },
  { country: 'AU', region: 'FE', SpAPIrefreshTokenStatus: false, AdsAPIrefreshTokenStatus: false },
];

// Shape of the /app/profile user.
const user = {
  sellerCentral: {
    sellerAccount: [
      { country: 'US', region: 'NA', spiRefreshToken: 'connected' },
      { country: 'AU', region: 'FE' },
    ],
  },
};

describe('isSpApiConnectedFromAccounts', () => {
  it('scopes to the given marketplace', () => {
    expect(isSpApiConnectedFromAccounts(allAccounts, 'AU', 'FE')).toBe(false);
    expect(isSpApiConnectedFromAccounts(allAccounts, 'US', 'NA')).toBe(true);
  });

  it('is false for a marketplace not in the list yet', () => {
    expect(isSpApiConnectedFromAccounts(allAccounts, 'JP', 'FE')).toBe(false);
  });

  it('counts any marketplace when none is given', () => {
    expect(isSpApiConnectedFromAccounts(allAccounts)).toBe(true);
  });
});

describe('isSpApiConnected', () => {
  it('scopes to the given marketplace', () => {
    expect(isSpApiConnected(user, 'AU', 'FE')).toBe(false);
    expect(isSpApiConnected(user, 'US', 'NA')).toBe(true);
  });

  it('counts any marketplace when none is given', () => {
    expect(isSpApiConnected(user)).toBe(true);
  });
});
