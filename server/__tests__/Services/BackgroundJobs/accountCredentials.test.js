const { classifyAccountCredentials } = require('../../../Services/BackgroundJobs/accountCredentials.js');

const SP = { spiRefreshToken: 'Atzr|sp' };
const ADS = { adsRefreshToken: 'Atzr|ads', ProfileId: '123' };

describe('classifyAccountCredentials', () => {
    it('both connected', () => {
        expect(classifyAccountCredentials({ ...SP, ...ADS })).toEqual({ sp: 'connected', ads: 'connected', runnable: true });
    });

    it('SP only is runnable', () => {
        expect(classifyAccountCredentials(SP)).toEqual({ sp: 'connected', ads: 'not_connected', runnable: true });
    });

    it('Ads only is runnable', () => {
        expect(classifyAccountCredentials(ADS)).toEqual({ sp: 'not_connected', ads: 'connected', runnable: true });
    });

    it('nothing connected is not runnable', () => {
        expect(classifyAccountCredentials({})).toEqual({ sp: 'not_connected', ads: 'not_connected', runnable: false });
        expect(classifyAccountCredentials(undefined).runnable).toBe(false);
        expect(classifyAccountCredentials(null).runnable).toBe(false);
    });

    it('treats an empty or blank token as not connected', () => {
        expect(classifyAccountCredentials({ spiRefreshToken: '', adsRefreshToken: '  ', ProfileId: '1' }).runnable).toBe(false);
    });

    it('Ads without a ProfileId is not connected — no Ads call can be made', () => {
        expect(classifyAccountCredentials({ ...SP, adsRefreshToken: 'Atzr|ads' }).ads).toBe('not_connected');
    });

    it('accepts a numeric ProfileId', () => {
        expect(classifyAccountCredentials({ adsRefreshToken: 'Atzr|ads', ProfileId: 123 }).ads).toBe('connected');
    });

    it('a revoked grant is not usable', () => {
        expect(classifyAccountCredentials({ ...SP, spiAuthRevokedAt: new Date() }))
            .toEqual({ sp: 'revoked', ads: 'not_connected', runnable: false });
        expect(classifyAccountCredentials({ ...SP, ...ADS, adsAuthRevokedAt: new Date() }))
            .toEqual({ sp: 'connected', ads: 'revoked', runnable: true });
    });

    it('a revoked SP grant with working Ads still runs (Ads only)', () => {
        expect(classifyAccountCredentials({ ...SP, ...ADS, spiAuthRevokedAt: new Date() }).runnable).toBe(true);
    });
});
