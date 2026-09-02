/**
 * Tests for marketplace-local calendar-day bucketing.
 *
 * Why these matter more than usual:
 *  - This module replaced a hardcoded `PACIFIC_OFFSET_HOURS = 7` that mis-bucketed every
 *    non-Pacific marketplace (an AU seller's daily sales were short by a 17-hour skew) AND
 *    every US account for the ~5 months a year Pacific is UTC-8 rather than UTC-7.
 *  - It decides the `date` key on DailySkuFinance — i.e. the number sellers read as their
 *    daily sales — and also the window requested from Amazon. A regression here silently
 *    misstates money, so the US-summer equivalence below is pinned byte-for-byte to prove
 *    the change is a no-op for the accounts that were already correct.
 *
 * Style follows financeSyncWindow.test.js: real module, literal fixtures, zero mocks.
 */

const {
  COUNTRY_TO_TIMEZONE,
  DEFAULT_TIMEZONE,
  getMarketplaceTimezone,
  toMarketplaceDateStr,
  marketplaceDayWindowISO,
  marketplaceTodayStr,
  marketplaceYesterdayStr,
  addDaysToDateStr,
  timezoneOffsetMsAt,
} = require('../../utils/marketplaceTimezone.js');

/** The old, buggy implementation — kept verbatim so we can assert what changed and what didn't. */
const LEGACY_PACIFIC_OFFSET_HOURS = 7;
function legacyToPacificDateStr(dateInput) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const pacificMs = d.getTime() - (LEGACY_PACIFIC_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(pacificMs).toISOString().substring(0, 10);
}

const offsetHours = (iso, tz) => timezoneOffsetMsAt(new Date(iso), tz) / 3600000;

describe('the bug this module fixes', () => {
  // The reported case: account 6a40e42712ce56d674f734a0, AU/FE, 2026-07-12.
  // Seller Central said $900.56, the app said $703.48, because orders from the first
  // 17 hours of AEST Jul 12 were filed under Jul 11.
  test('an AU order early on AEST Jul 12 is no longer filed under Jul 11', () => {
    const instant = '2026-07-11T20:00:00Z'; // 06:00 AEST on Jul 12
    expect(legacyToPacificDateStr(instant)).toBe('2026-07-11'); // the bug
    expect(toMarketplaceDateStr(instant, 'AU')).toBe('2026-07-12'); // the fix
  });

  test('the AU skew spans a full 17 hours of each day', () => {
    // 00:00 AEST Jul 12 → still Jul 12 locally, but legacy said Jul 11.
    expect(toMarketplaceDateStr('2026-07-11T14:00:00Z', 'AU')).toBe('2026-07-12');
    expect(legacyToPacificDateStr('2026-07-11T14:00:00Z')).toBe('2026-07-11');
    // 16:59 AEST Jul 12 → the last instant legacy still mislabels.
    expect(toMarketplaceDateStr('2026-07-12T06:59:59Z', 'AU')).toBe('2026-07-12');
    expect(legacyToPacificDateStr('2026-07-12T06:59:59Z')).toBe('2026-07-11');
    // 17:00 AEST Jul 12 → from here the two agree.
    expect(toMarketplaceDateStr('2026-07-12T07:00:00Z', 'AU')).toBe('2026-07-12');
    expect(legacyToPacificDateStr('2026-07-12T07:00:00Z')).toBe('2026-07-12');
  });
});

describe('DST — why a fixed numeric offset can never be correct', () => {
  test('US Pacific is UTC-7 in summer but UTC-8 in winter', () => {
    expect(offsetHours('2026-07-12T12:00:00Z', 'America/Los_Angeles')).toBe(-7);
    expect(offsetHours('2026-01-12T12:00:00Z', 'America/Los_Angeles')).toBe(-8);
  });

  test('Australia/Sydney is UTC+10 in July but UTC+11 in January', () => {
    expect(offsetHours('2026-07-12T12:00:00Z', 'Australia/Sydney')).toBe(10);
    expect(offsetHours('2026-01-12T12:00:00Z', 'Australia/Sydney')).toBe(11);
  });

  test('Europe/London is UTC+0 in winter and UTC+1 in summer', () => {
    expect(offsetHours('2026-01-12T12:00:00Z', 'Europe/London')).toBe(0);
    expect(offsetHours('2026-07-12T12:00:00Z', 'Europe/London')).toBe(1);
  });

  test('the legacy fixed offset drifts from real Pacific in winter', () => {
    // 23:30 PST on Jan 11 (= 07:30Z Jan 12). Legacy subtracts 7h → 00:30 Jan 12: wrong day.
    const instant = '2026-01-12T07:30:00Z';
    expect(legacyToPacificDateStr(instant)).toBe('2026-01-12');
    expect(toMarketplaceDateStr(instant, 'US')).toBe('2026-01-11');
  });

  test('zones without DST stay put all year', () => {
    expect(offsetHours('2026-01-12T12:00:00Z', 'Asia/Kolkata')).toBe(5.5);
    expect(offsetHours('2026-07-12T12:00:00Z', 'Asia/Kolkata')).toBe(5.5);
    expect(offsetHours('2026-01-12T12:00:00Z', 'Asia/Tokyo')).toBe(9);
    expect(offsetHours('2026-07-12T12:00:00Z', 'Asia/Tokyo')).toBe(9);
  });
});

describe('marketplaceDayWindowISO', () => {
  // ★ BACKWARD-COMPATIBILITY GUARD ★
  // Do not "simplify" this away. It proves the fix is a no-op for US accounts in summer,
  // which is the entire basis for shipping it to all accounts at once rather than gating it.
  test('reproduces the legacy hardcoded window byte-for-byte for US in summer', () => {
    const { startISO, endISO } = marketplaceDayWindowISO('2026-07-12', '2026-07-12', 'US');
    expect(startISO).toBe('2026-07-12T07:00:00.000Z');
    expect(endISO).toBe('2026-07-13T06:59:59.999Z');

    // …and identical to how the old code literally built those strings.
    const legacyStart = `2026-07-12T${String(LEGACY_PACIFIC_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`;
    const legacyEnd = `2026-07-13T${String(LEGACY_PACIFIC_OFFSET_HOURS - 1).padStart(2, '0')}:59:59.999Z`;
    expect(startISO).toBe(legacyStart);
    expect(endISO).toBe(legacyEnd);
  });

  test('multi-day US summer window also matches the legacy shape', () => {
    const { startISO, endISO } = marketplaceDayWindowISO('2026-07-01', '2026-07-14', 'US');
    expect(startISO).toBe('2026-07-01T07:00:00.000Z');
    expect(endISO).toBe('2026-07-15T06:59:59.999Z');
  });

  test('shifts correctly for AU (UTC+10) — the window Amazon is asked for', () => {
    const { startISO, endISO } = marketplaceDayWindowISO('2026-07-12', '2026-07-12', 'AU');
    expect(startISO).toBe('2026-07-11T14:00:00.000Z');
    expect(endISO).toBe('2026-07-12T13:59:59.999Z');
  });

  test('uses the real winter offset for US rather than the summer one', () => {
    const { startISO, endISO } = marketplaceDayWindowISO('2026-01-12', '2026-01-12', 'US');
    expect(startISO).toBe('2026-01-12T08:00:00.000Z'); // PST, not PDT
    expect(endISO).toBe('2026-01-13T07:59:59.999Z');
  });

  test('handles a 23-hour spring-forward day without drifting', () => {
    // US DST begins 2026-03-08. That local day is only 23 hours long.
    const { startISO, endISO } = marketplaceDayWindowISO('2026-03-08', '2026-03-08', 'US');
    expect(startISO).toBe('2026-03-08T08:00:00.000Z');
    expect(endISO).toBe('2026-03-09T06:59:59.999Z');
    const lengthHours = (Date.parse(endISO) + 1 - Date.parse(startISO)) / 3600000;
    expect(lengthHours).toBe(23);
    // The start instant must still round-trip to the day we asked for.
    expect(toMarketplaceDateStr(startISO, 'US')).toBe('2026-03-08');
  });

  test('handles a 25-hour fall-back day without drifting', () => {
    // US DST ends 2026-11-01. That local day is 25 hours long.
    const { startISO, endISO } = marketplaceDayWindowISO('2026-11-01', '2026-11-01', 'US');
    const lengthHours = (Date.parse(endISO) + 1 - Date.parse(startISO)) / 3600000;
    expect(lengthHours).toBe(25);
    expect(toMarketplaceDateStr(startISO, 'US')).toBe('2026-11-01');
  });

  test('the window boundaries round-trip back to the requested days', () => {
    for (const country of ['US', 'AU', 'JP', 'UK', 'IN', 'BR']) {
      const { startISO, endISO } = marketplaceDayWindowISO('2026-07-01', '2026-07-14', country);
      expect(toMarketplaceDateStr(startISO, country)).toBe('2026-07-01');
      expect(toMarketplaceDateStr(endISO, country)).toBe('2026-07-14');
      // One ms earlier/later must fall OUTSIDE the requested range, or the window leaks a day.
      expect(toMarketplaceDateStr(new Date(Date.parse(startISO) - 1), country)).toBe('2026-06-30');
      expect(toMarketplaceDateStr(new Date(Date.parse(endISO) + 1), country)).toBe('2026-07-15');
    }
  });

  test('rejects malformed dates rather than silently producing a bad window', () => {
    expect(() => marketplaceDayWindowISO('2026-7-12', '2026-07-12', 'US')).toThrow(/YYYY-MM-DD/);
    expect(() => marketplaceDayWindowISO('2026-07-12', 'garbage', 'US')).toThrow(/YYYY-MM-DD/);
  });
});

describe('country → timezone resolution', () => {
  // The authoritative list is marketplaceConfig in server/controllers/config/config.js,
  // mirrored by MARKETPLACES in server/Services/MCP/constants.js and the connect-flow picker.
  const AUTHORITATIVE_COUNTRIES = [
    'US', 'CA', 'MX', 'BR',
    'IE', 'ES', 'UK', 'FR', 'BE', 'NL', 'DE', 'IT', 'SE', 'ZA', 'PL', 'EG', 'TR', 'SA', 'AE', 'IN',
    'SG', 'AU', 'JP',
  ];

  test('covers all 23 supported marketplaces', () => {
    for (const country of AUTHORITATIVE_COUNTRIES) {
      expect(COUNTRY_TO_TIMEZONE[country]).toBeDefined();
    }
    expect(AUTHORITATIVE_COUNTRIES).toHaveLength(23);
  });

  test('includes IE and ZA, which COUNTRY_TO_SALES_CHANNEL omitted', () => {
    expect(COUNTRY_TO_TIMEZONE.IE).toBe('Europe/Dublin');
    expect(COUNTRY_TO_TIMEZONE.ZA).toBe('Africa/Johannesburg');
  });

  test('every configured zone is one Intl actually accepts', () => {
    for (const [country, tz] of Object.entries(COUNTRY_TO_TIMEZONE)) {
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: tz })).not.toThrow();
      // A bogus zone silently resolving to UTC would be the dangerous failure.
      expect(toMarketplaceDateStr('2026-07-12T12:00:00Z', country)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('is case-insensitive', () => {
    expect(getMarketplaceTimezone('au')).toBe('Australia/Sydney');
    expect(getMarketplaceTimezone('Au')).toBe('Australia/Sydney');
  });

  test('accepts GB as an alias for UK', () => {
    expect(getMarketplaceTimezone('GB')).toBe(getMarketplaceTimezone('UK'));
  });

  test('NA marketplaces use Pacific, because that is how Amazon reports them', () => {
    expect(getMarketplaceTimezone('US')).toBe('America/Los_Angeles');
    expect(getMarketplaceTimezone('CA')).toBe('America/Los_Angeles');
    expect(getMarketplaceTimezone('MX')).toBe('America/Los_Angeles');
  });

  test('unknown or missing country falls back to Pacific instead of throwing', () => {
    // Throwing here would abort a finance sync mid-flight; Pacific preserves prior behaviour.
    expect(getMarketplaceTimezone('ZZ')).toBe(DEFAULT_TIMEZONE);
    expect(getMarketplaceTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(getMarketplaceTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(getMarketplaceTimezone('')).toBe(DEFAULT_TIMEZONE);
    expect(toMarketplaceDateStr('2026-07-12T12:00:00Z', 'ZZ')).toBe('2026-07-12');
  });
});

describe('toMarketplaceDateStr input handling', () => {
  test('accepts Date, ISO string and epoch ms alike', () => {
    const iso = '2026-07-12T00:30:00Z';
    expect(toMarketplaceDateStr(new Date(iso), 'AU')).toBe('2026-07-12');
    expect(toMarketplaceDateStr(iso, 'AU')).toBe('2026-07-12');
    expect(toMarketplaceDateStr(Date.parse(iso), 'AU')).toBe('2026-07-12');
  });

  test('returns null for unusable input, matching the old helper', () => {
    for (const bad of [null, undefined, '', 'not-a-date', new Date('nope')]) {
      expect(toMarketplaceDateStr(bad, 'AU')).toBeNull();
      expect(legacyToPacificDateStr(bad)).toBeNull();
    }
  });

  test('does not fall back to a UTC day key on valid input', () => {
    // A UTC fallback was the pre-existing bug in the postedDateStr paths.
    expect(toMarketplaceDateStr('2026-07-12T02:00:00Z', 'AU')).toBe('2026-07-12');
    expect(toMarketplaceDateStr('2026-07-12T02:00:00Z', 'US')).toBe('2026-07-11');
  });
});

describe('today / yesterday anchors', () => {
  test('resolve in the marketplace calendar, not the server or UTC one', () => {
    // 2026-07-12T02:00Z = 12:00 AEST Jul 12, but only 19:00 PDT Jul 11.
    const now = new Date('2026-07-12T02:00:00Z');
    expect(marketplaceTodayStr('AU', now)).toBe('2026-07-12');
    expect(marketplaceTodayStr('US', now)).toBe('2026-07-11');
    expect(marketplaceYesterdayStr('AU', now)).toBe('2026-07-11');
    expect(marketplaceYesterdayStr('US', now)).toBe('2026-07-10');
  });

  test('yesterday is always exactly one calendar day before today', () => {
    for (const iso of ['2026-03-08T12:00:00Z', '2026-11-01T12:00:00Z', '2026-01-01T00:30:00Z']) {
      for (const country of ['US', 'AU', 'UK']) {
        const today = marketplaceTodayStr(country, new Date(iso));
        expect(marketplaceYesterdayStr(country, new Date(iso))).toBe(addDaysToDateStr(today, -1));
      }
    }
  });

  test('crossing a DST boundary does not skip or repeat a day', () => {
    // Anchoring on the calendar day (not now-24h) is what makes this hold.
    const beforeSpringForward = new Date('2026-03-08T09:00:00Z'); // 02:00 PDT Mar 8
    expect(marketplaceTodayStr('US', beforeSpringForward)).toBe('2026-03-08');
    expect(marketplaceYesterdayStr('US', beforeSpringForward)).toBe('2026-03-07');
  });
});

describe('addDaysToDateStr', () => {
  test('moves whole calendar days', () => {
    expect(addDaysToDateStr('2026-07-12', 1)).toBe('2026-07-13');
    expect(addDaysToDateStr('2026-07-12', -1)).toBe('2026-07-11');
    expect(addDaysToDateStr('2026-07-12', 0)).toBe('2026-07-12');
  });

  test('crosses month, year and leap-day boundaries', () => {
    expect(addDaysToDateStr('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysToDateStr('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToDateStr('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
  });

  test('is unaffected by DST, since it is pure calendar math', () => {
    expect(addDaysToDateStr('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToDateStr('2026-11-01', 1)).toBe('2026-11-02');
  });
});
