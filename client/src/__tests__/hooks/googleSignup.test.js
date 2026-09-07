/**
 * Tests for the needs-signup detector — the signal that turns a failed Google
 * sign-in into an offer to create the account, instead of the dead-end error it
 * used to show.
 *
 * There is deliberately no plan mapping to test here: the product is free and the
 * server grants PRO to every new account (resolveFreeAccountPlan in
 * server/controllers/user-auth/UserController.js), so the client sends no plan.
 */

import { describe, it, expect } from 'vitest';
import { isNeedsSignupError } from '../../services/googleAuthService.js';

describe('isNeedsSignupError', () => {
  const needsSignup = {
    response: { status: 404, data: { data: { needsSignup: true, email: 'a@b.co' } } },
  };

  it('recognises the offer-signup response', () => {
    expect(isNeedsSignupError(needsSignup)).toBe(true);
  });

  it('ignores a 404 that is not the signup offer', () => {
    expect(isNeedsSignupError({ response: { status: 404, data: { data: {} } } })).toBe(false);
    expect(isNeedsSignupError({ response: { status: 404, data: {} } })).toBe(false);
  });

  it('ignores other statuses even when the flag is present', () => {
    expect(
      isNeedsSignupError({ response: { status: 500, data: { data: { needsSignup: true } } } })
    ).toBe(false);
  });

  it('survives errors with no response at all', () => {
    expect(isNeedsSignupError(new Error('network down'))).toBe(false);
    expect(isNeedsSignupError(undefined)).toBe(false);
  });
});
