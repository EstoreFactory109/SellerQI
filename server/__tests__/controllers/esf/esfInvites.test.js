/**
 * Tests for ESF invitation plumbing.
 *
 * The link builder matters most: if it points at the wrong host the invitation
 * email is useless, and that only shows up once someone clicks a real one.
 */

const EsfInvite = require('../../../models/user-auth/EsfInviteModel.js');

describe('EsfInvite model', () => {
  describe('generateToken', () => {
    it('is 64 hex characters (32 random bytes)', () => {
      expect(EsfInvite.generateToken()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not repeat', () => {
      const tokens = new Set(Array.from({ length: 200 }, () => EsfInvite.generateToken()));
      expect(tokens.size).toBe(200);
    });
  });

  describe('isUsable', () => {
    const invite = (overrides) => new EsfInvite({
      email: 'a@b.com',
      token: EsfInvite.generateToken(),
      invitedBy: '000000000000000000000001',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000),
      ...overrides,
    });

    it('is usable while pending and unexpired', () => {
      expect(invite({}).isUsable()).toBe(true);
    });

    it('is not usable once accepted', () => {
      expect(invite({ status: 'accepted' }).isUsable()).toBe(false);
    });

    it('is not usable once revoked', () => {
      expect(invite({ status: 'revoked' }).isUsable()).toBe(false);
    });

    it('is not usable once expired', () => {
      expect(invite({ expiresAt: new Date(Date.now() - 1000) }).isUsable()).toBe(false);
    });
  });
});

describe('invite link building', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  const load = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../../../controllers/esf/esfInvites.js').buildInviteLink;
  };

  it('uses ESF_INVITE_BASE_URI when set', () => {
    process.env.ESF_INVITE_BASE_URI = 'https://members.example.com/esf-invite';
    expect(load()('abc123')).toBe('https://members.example.com/esf-invite/abc123');
  });

  it('tolerates a trailing slash on the explicit base', () => {
    process.env.ESF_INVITE_BASE_URI = 'https://members.example.com/esf-invite/';
    expect(load()('abc123')).toBe('https://members.example.com/esf-invite/abc123');
  });

  it('derives the app host from RESET_LINK_BASE_URI when no explicit base is set', () => {
    delete process.env.ESF_INVITE_BASE_URI;
    process.env.RESET_LINK_BASE_URI = 'https://members.sellerqi.com/reset-password';
    // Must land on the members app, not on the reset-password path.
    expect(load()('tok')).toBe('https://members.sellerqi.com/esf-invite/tok');
  });

  it('falls back to FRONTEND_URL when neither base is configured', () => {
    delete process.env.ESF_INVITE_BASE_URI;
    delete process.env.RESET_LINK_BASE_URI;
    process.env.FRONTEND_URL = 'http://localhost:3000';
    expect(load()('tok')).toBe('http://localhost:3000/esf-invite/tok');
  });
});
