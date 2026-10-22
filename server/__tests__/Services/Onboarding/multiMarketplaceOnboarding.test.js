/**
 * Multi-marketplace onboarding: the rules that decide what gets connected.
 *
 * The database flow (atomic upserts, checklist) is exercised against a real local MongoDB
 * separately; these cover the decisions: which state is accepted, which marketplaces an approval
 * can add, how Ads profiles are matched, and who sees the new flow.
 */

const mockStore = new Map();
jest.mock('../../../config/redisConn.js', () => ({
  getRedisClient: () => ({
    setEx: jest.fn(async (key, _ttl, value) => { mockStore.set(key, value); }),
    getDel: jest.fn(async (key) => { const v = mockStore.get(key) ?? null; mockStore.delete(key); return v; }),
  }),
}));
jest.mock('../../../models/user-auth/RegionGrantModel.js', () => ({
  findOne: jest.fn(), find: jest.fn(), updateOne: jest.fn(), exists: jest.fn(),
}));

const RegionGrant = require('../../../models/user-auth/RegionGrantModel.js');
const { createState, consumeState } = require('../../../Services/Onboarding/oauthState.js');
const { supportedParticipations } = require('../../../Services/Sp_API/MarketplaceParticipations.js');
const marketplaces = require('../../../Services/Onboarding/marketplaces.js');
const onboarding = require('../../../Services/Onboarding/multiMarketplaceOnboarding.js');

describe('OAuth state', () => {
  beforeEach(() => mockStore.clear());

  it('is accepted once, for the user and kind it was made for, and carries the region', async () => {
    const state = await createState({ userId: 'u1', kind: 'spapi', region: 'EU', primaryCountry: 'UK' });
    expect(await consumeState(state, { userId: 'u1', kind: 'spapi' })).toEqual({
      userId: 'u1', kind: 'spapi', region: 'EU', primaryCountry: 'UK',
    });
    expect(await consumeState(state, { userId: 'u1', kind: 'spapi' })).toBeNull();
  });

  it('is refused for another user, and is spent by the attempt', async () => {
    const state = await createState({ userId: 'u1', kind: 'spapi', region: 'NA' });
    expect(await consumeState(state, { userId: 'u2', kind: 'spapi' })).toBeNull();
    expect(await consumeState(state, { userId: 'u1', kind: 'spapi' })).toBeNull();
  });

  it('is refused for the other kind of connection', async () => {
    const state = await createState({ userId: 'u1', kind: 'ads', region: 'NA' });
    expect(await consumeState(state, { userId: 'u1', kind: 'spapi' })).toBeNull();
  });

  it('rejects anything that is not a state we could have minted', async () => {
    expect(await consumeState('../../etc', { userId: 'u1', kind: 'spapi' })).toBeNull();
    expect(await consumeState(undefined, { userId: 'u1', kind: 'spapi' })).toBeNull();
  });
});

describe('marketplace catalogue', () => {
  it('knows every pipeline marketplace and its region', () => {
    expect(marketplaces.regionOf('uk')).toBe('EU');
    expect(marketplaces.regionOf('IE')).toBe('EU');
    expect(marketplaces.regionOf('BR')).toBe('NA');
    expect(marketplaces.regionOf('JP')).toBe('FE');
    expect(marketplaces.countriesInRegion('NA').sort()).toEqual(['BR', 'CA', 'MX', 'US']);
    for (const m of marketplaces.MARKETPLACES) expect(marketplaces.REGIONS).toContain(m.region);
  });

  it("maps Amazon's GB to SellerQI's UK", () => {
    expect(marketplaces.fromAmazonCountryCode('GB')).toBe('UK');
    expect(marketplaces.fromAmazonCountryCode('de')).toBe('DE');
  });
});

describe('supportedParticipations', () => {
  const p = (marketplaceId, isParticipating = true, name = 'x') => ({ marketplaceId, isParticipating, name });

  it('keeps participating marketplaces we support, in the approved region, by marketplace id', () => {
    const result = supportedParticipations([
      p('A1F83G8C2ARO7P', true, 'Amazon.co.uk'), // UK
      p('A1PA6795UKMFR9'),                        // DE
      p('A13V1IB3VIYZZH', false),                 // FR, not participating
      p('A21TJRUUN4KGV'),                         // IN — EU region
      p('ATVPDKIKX0DER'),                         // US — another region
      p('UNKNOWN123'),                            // a marketplace we do not support
    ], 'EU');
    expect(result.map((r) => r.country)).toEqual(['UK', 'DE', 'IN']);
    expect(result[0]).toMatchObject({ marketplaceId: 'A1F83G8C2ARO7P', region: 'EU', name: 'Amazon.co.uk' });
  });

  it('lists a marketplace once even if Amazon repeats it', () => {
    expect(supportedParticipations([p('A1F83G8C2ARO7P'), p('A1F83G8C2ARO7P')], 'EU')).toHaveLength(1);
  });
});

describe('proposeProfileMapping', () => {
  const profile = (profileId, countryCode, type = 'seller') => ({ profileId, countryCode, type });

  it('matches each marketplace to its one seller profile', () => {
    const mapping = onboarding.proposeProfileMapping(['UK', 'DE'], [profile('1', 'UK'), profile('2', 'DE')]);
    expect(mapping.map((m) => m.profileId)).toEqual(['1', '2']);
  });

  it('prefers the seller profile over a vendor one in the same country', () => {
    const [uk] = onboarding.proposeProfileMapping(['UK'], [profile('1', 'UK', 'vendor'), profile('2', 'UK', 'seller')]);
    expect(uk.profileId).toBe('2');
  });

  it('leaves the choice to the seller when there is none or several', () => {
    const mapping = onboarding.proposeProfileMapping(['UK', 'DE'], [profile('1', 'UK'), profile('2', 'UK')]);
    expect(mapping[0]).toMatchObject({ profileId: null });
    expect(mapping[0].candidates).toHaveLength(2);
    expect(mapping[1]).toMatchObject({ profileId: null, candidates: [] });
  });
});

describe('who gets the new flow', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('nobody by default', () => {
    delete process.env.MULTI_MARKETPLACE_ONBOARDING_ENABLED;
    delete process.env.MULTI_MARKETPLACE_ONBOARDING_USERS;
    expect(onboarding.isEnabledFor({ email: 'a@b.com' })).toBe(false);
  });

  it('allow-listed emails, case-insensitively, for a production trial', () => {
    process.env.MULTI_MARKETPLACE_ONBOARDING_USERS = 'Tester@Example.com, other@x.com';
    expect(onboarding.isEnabledFor({ email: 'tester@example.com' })).toBe(true);
    expect(onboarding.isEnabledFor({ email: 'someone@else.com' })).toBe(false);
  });

  it('everyone when switched on, except agency and ESF clients', () => {
    process.env.MULTI_MARKETPLACE_ONBOARDING_ENABLED = 'true';
    expect(onboarding.isEnabledFor({ email: 'a@b.com' })).toBe(true);
    expect(onboarding.isEnabledFor({ email: 'a@b.com', isAgencyClient: true })).toBe(false);
    expect(onboarding.isEnabledFor({ email: 'a@b.com', isEsfClient: true })).toBe(false);
  });
});

describe('confirmMarketplaces refuses what the approval cannot cover', () => {
  const grant = (fields) => RegionGrant.findOne.mockReturnValue({
    select: () => ({ lean: async () => ({ spiRefreshToken: 'rt', participations: [{ country: 'UK' }, { country: 'DE' }], ...fields }) }),
  });

  it('a region that has not been approved', async () => {
    RegionGrant.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    await expect(onboarding.confirmMarketplaces({ userId: 'u1', region: 'EU', countries: ['UK'] }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('a marketplace Amazon did not report for this approval', async () => {
    grant({});
    await expect(onboarding.confirmMarketplaces({ userId: 'u1', region: 'EU', countries: ['UK', 'FR'] }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('FR') });
  });

  it('unticking the main marketplace', async () => {
    grant({ primaryCountry: 'UK' });
    await expect(onboarding.confirmMarketplaces({ userId: 'u1', region: 'EU', countries: ['DE'] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('an empty selection', async () => {
    grant({});
    await expect(onboarding.confirmMarketplaces({ userId: 'u1', region: 'EU', countries: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('an unknown region', async () => {
    await expect(onboarding.confirmMarketplaces({ userId: 'u1', region: 'XX', countries: ['UK'] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
