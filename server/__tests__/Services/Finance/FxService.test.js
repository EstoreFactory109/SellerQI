jest.mock('../../../utils/Logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../../config/redisConn.js', () => ({ getRedisClient: () => null }));
const mockUpdateOne = jest.fn().mockResolvedValue({});
jest.mock('../../../models/system/FxRateModel.js', () => ({ updateOne: (...a) => mockUpdateOne(...a) }));

const Fx = require('../../../Services/Finance/FxService.js');

// Shapes taken from the live sources on 2026-10-12.
const ECB = { date: '2026-10-09', rates: { USD: 1.1206, GBP: 0.84763, INR: 108.3965, ZAR: 18.527 } };
const FALLBACK = { result: 'success', rates: { USD: 1, EUR: 0.8924, EGP: 52.502776, AED: 3.6725, SAR: 3.75 } };

describe('buildRateTable', () => {
    const table = Fx.buildRateTable(ECB, FALLBACK);

    test('ECB rates are taken as-is against EUR', () => {
        expect(table.rates.EUR).toBe(1);
        expect(table.rates.GBP).toBe(0.84763);
        expect(table.sources.GBP).toBe('ecb');
    });

    test('AED and SAR come from their USD pegs, not the fallback', () => {
        expect(table.rates.AED).toBeCloseTo(1.1206 * 3.6725, 6);
        expect(table.sources.AED).toBe('peg:USD');
        expect(table.sources.SAR).toBe('peg:USD');
    });

    test('EGP comes from the fallback, rebased through USD', () => {
        expect(table.rates.EGP).toBeCloseTo(52.502776 / 0.8924, 6);
        expect(table.sources.EGP).toBe('open.er-api');
    });

    test('a currency no source has is left out and reported, never set to 1', () => {
        expect(table.rates.SEK).toBeUndefined();
        expect(table.missing).toContain('SEK');
    });

    test('without a fallback, EGP is simply missing', () => {
        const t = Fx.buildRateTable(ECB, null);
        expect(t.rates.EGP).toBeUndefined();
        expect(t.missing).toContain('EGP');
    });
});

describe('rateFromTable', () => {
    const table = { date: '2026-10-09', rates: { EUR: 1, USD: 1.12, GBP: 0.85 } };
    const now = new Date('2026-10-12T12:00:00Z');

    test('cross rate goes through EUR', () => {
        const r = Fx.rateFromTable(table, 'GBP', 'USD', now);
        expect(r.rate).toBeCloseTo(1.12 / 0.85, 10);
        expect(r.asOf).toBe('2026-10-09');
        expect(r.stale).toBe(false);
    });

    test('same currency is 1, even with no table', () => {
        expect(Fx.rateFromTable(null, 'usd', 'USD', now).rate).toBe(1);
    });

    test('an unknown currency is null, never 1', () => {
        expect(Fx.rateFromTable(table, 'EGP', 'USD', now)).toBeNull();
    });

    test('flags rates older than the stale cut-off', () => {
        const r = Fx.rateFromTable(table, 'GBP', 'USD', new Date('2026-10-15T12:00:00Z'));
        expect(r.stale).toBe(true);
    });

    test('refuses rates past the unusable cut-off', () => {
        expect(Fx.rateFromTable(table, 'GBP', 'USD', new Date('2026-10-25T12:00:00Z'))).toBeNull();
    });
});

describe('fetchAndStoreDailyRates', () => {
    test('stores the merged table under the ECB date', async () => {
        const http = { get: jest.fn((url) => Promise.resolve({ data: url.includes('frankfurter') ? ECB : FALLBACK })) };
        const table = await Fx.fetchAndStoreDailyRates({ http });

        expect(table.date).toBe('2026-10-09');
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { date: '2026-10-09' },
            expect.objectContaining({ $set: expect.objectContaining({ base: 'EUR' }) }),
            { upsert: true },
        );
    });

    test('a failed fallback still stores the ECB rates', async () => {
        const http = { get: jest.fn((url) => (url.includes('frankfurter') ? Promise.resolve({ data: ECB }) : Promise.reject(new Error('down')))) };
        const table = await Fx.fetchAndStoreDailyRates({ http });
        expect(table.rates.GBP).toBe(0.84763);
        expect(table.rates.EGP).toBeUndefined();
    });
});
