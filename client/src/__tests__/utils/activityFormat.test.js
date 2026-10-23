import { describe, it, expect } from 'vitest';
import { formatLastActive, formatDuration, actorLabel, isStaffActor } from '../../utils/activityFormat.js';

const now = Date.parse('2026-10-23T12:00:00Z');
const ago = (ms) => new Date(now - ms);

describe('activity formatting', () => {
  it('last active in seconds, minutes, hours and days', () => {
    expect(formatLastActive(ago(12 * 1000), now)).toBe('12s ago');
    expect(formatLastActive(ago(5 * 60 * 1000), now)).toBe('5m ago');
    expect(formatLastActive(ago(3 * 3600 * 1000), now)).toBe('3h ago');
    expect(formatLastActive(ago(50 * 3600 * 1000), now)).toBe('2d ago');
    expect(formatLastActive(null, now)).toBeNull();
  });

  it('time spent', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(180)).toBe('3m');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatDuration(undefined)).toBe('0s');
  });

  it('labels staff and member visits', () => {
    expect(actorLabel({ kind: 'esf_staff', name: 'Priya' })).toBe('Viewed by ESF staff · Priya');
    expect(actorLabel({ kind: 'super_admin' })).toBe('Viewed by super admin');
    expect(actorLabel({ kind: 'member', name: 'Sam' })).toBe('Team member · Sam');
    expect(actorLabel({ kind: 'owner' })).toBeNull();
    expect(isStaffActor({ kind: 'agency' })).toBe(true);
    expect(isStaffActor({ kind: 'member' })).toBe(false);
  });
});
