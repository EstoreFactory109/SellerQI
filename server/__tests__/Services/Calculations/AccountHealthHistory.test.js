/**
 * AccountHealthHistory — judging Amazon's statuses over the last daily reports.
 *
 * Driven by a real case: a US account (rating 204, cutoff 200) whose daily report
 * read AT_RISK on Oct 10 and Oct 13 and NORMAL around them. Judged one report at a
 * time it raised an "Account Status" task while the Account Health page, reading
 * the next day's report, showed everything fine.
 */
const {
    toDailySeries,
    judgeMetric,
    nearCutoff,
    formatDays,
    humanizeStatus,
} = require('../../../Services/Calculations/AccountHealthHistory.js');

const report = (day, accountStatuses, extra = {}) => ({
    createdAt: new Date(`${day}T08:04:33Z`),
    accountStatuses,
    lateShipmentRateStatus: 'GOOD',
    ...extra,
});

// Oldest first, as written; toDailySeries orders them.
const seq = (...pairs) => pairs.map(([day, s]) => report(day, s));

// The real sequence for that account (no report on Oct 12).
const REAL = seq(
    ['2026-10-08', 'NORMAL'], ['2026-10-09', 'NORMAL'], ['2026-10-10', 'AT_RISK'],
    ['2026-10-11', 'NORMAL'], ['2026-10-13', 'AT_RISK'], ['2026-10-14', 'NORMAL']
);

const judge = (docs, field = 'accountStatuses') => judgeMetric(toDailySeries(docs), field);

describe('toDailySeries', () => {
    // Production writes up to 22 reports a day for one marketplace.
    it('keeps the last report of each day, newest day first', () => {
        const series = toDailySeries([
            report('2026-10-13', 'NORMAL'),
            { ...report('2026-10-13', 'AT_RISK'), createdAt: new Date('2026-10-13T20:00:00Z') },
            report('2026-10-14', 'NORMAL'),
        ]);
        expect(series.map(s => s.day)).toEqual(['2026-10-14', '2026-10-13']);
        expect(series[1].doc.accountStatuses).toBe('AT_RISK');
    });

    it('keeps at most 7 days', () => {
        const docs = Array.from({ length: 10 }, (_, i) => report(`2026-10-${String(i + 1).padStart(2, '0')}`, 'NORMAL'));
        expect(toDailySeries(docs)).toHaveLength(7);
        expect(toDailySeries(docs)[0].day).toBe('2026-10-10');
    });

    it('ignores undated docs and nulls', () => {
        expect(toDailySeries([null, { accountStatuses: 'NORMAL' }, report('2026-10-14', 'NORMAL')])).toHaveLength(1);
    });
});

describe('judgeMetric', () => {
    it('the real flip-flopping account is a warning, not an error and not nothing', () => {
        const j = judge(REAL);
        expect(j.level).toBe('warning');
        expect(j.badDays.sort()).toEqual(['2026-10-10', '2026-10-13']);
        expect(j.latest).toBe('NORMAL');
        expect(j.latestGood).toBe(true);
        expect(j.daysJudged).toBe(6);
    });

    it('was also a warning on Oct 13 itself, the day the old code raised an error', () => {
        expect(judge(REAL.slice(0, 5)).level).toBe('warning');
    });

    it('is an error when the newest two days are both bad', () => {
        const j = judge(seq(['2026-10-12', 'NORMAL'], ['2026-10-13', 'AT_RISK'], ['2026-10-14', 'AT_RISK']));
        expect(j.level).toBe('error');
        expect(j.consecutiveBad).toBe(2);
    });

    it('a single blip is ok', () => {
        expect(judge(seq(['2026-10-12', 'NORMAL'], ['2026-10-13', 'AT_RISK'], ['2026-10-14', 'NORMAL'])).level).toBe('ok');
    });

    it('a single bad newest day after good days is ok (one day is a blip)', () => {
        expect(judge(seq(['2026-10-13', 'NORMAL'], ['2026-10-14', 'AT_RISK'])).level).toBe('ok');
    });

    // Never delayed or softened.
    it('DEACTIVATED is an error immediately, even after good days', () => {
        expect(judge(seq(['2026-10-13', 'NORMAL'], ['2026-10-14', 'DEACTIVATED'])).level).toBe('error');
    });

    // One stretch of bad days that has ended is a recovery, not instability.
    it('a single bad stretch that has since recovered is ok', () => {
        const j = judge(seq(
            ['2026-10-08', 'AT_RISK'], ['2026-10-09', 'AT_RISK'], ['2026-10-10', 'AT_RISK'],
            ['2026-10-11', 'NORMAL'], ['2026-10-12', 'NORMAL'], ['2026-10-13', 'NORMAL'], ['2026-10-14', 'NORMAL']
        ));
        expect(j.level).toBe('ok');
        expect(j.badRuns).toBe(1);
    });

    it('bad, recovered, then bad again is a warning even with the latest bad day alone', () => {
        const j = judge(seq(['2026-10-11', 'AT_RISK'], ['2026-10-12', 'NORMAL'], ['2026-10-13', 'NORMAL'], ['2026-10-14', 'AT_RISK']));
        expect(j.level).toBe('warning');
        expect(j.badRuns).toBe(2);
    });

    it('all good is ok', () => {
        expect(judge(seq(['2026-10-13', 'NORMAL'], ['2026-10-14', 'NORMAL'])).level).toBe('ok');
    });

    describe('with one day of history (new account or a gap)', () => {
        it('judges a bad value as before: an error', () => {
            expect(judge(seq(['2026-10-14', 'AT_RISK'])).level).toBe('error');
        });

        it('a good value is ok', () => {
            expect(judge(seq(['2026-10-14', 'NORMAL'])).level).toBe('ok');
        });
    });

    describe('FAIR (Amazon\'s middle tier)', () => {
        const fair = (statuses) => statuses.map(([day, v]) => report(day, 'NORMAL', { lateShipmentRateStatus: v }));

        it('a FAIR stretch that has gone back to GOOD is ok', () => {
            const j = judgeMetric(toDailySeries(fair([['2026-10-12', 'FAIR'], ['2026-10-13', 'FAIR'], ['2026-10-14', 'GOOD']])), 'lateShipmentRateStatus');
            expect(j.level).toBe('ok');
        });

        it('is never an error on its own, however long it lasts', () => {
            const j = judgeMetric(toDailySeries(fair([['2026-10-12', 'FAIR'], ['2026-10-13', 'FAIR'], ['2026-10-14', 'FAIR']])), 'lateShipmentRateStatus');
            expect(j.level).toBe('warning');
        });

        it('alone on a single day of history is a warning', () => {
            expect(judgeMetric(toDailySeries(fair([['2026-10-14', 'FAIR']])), 'lateShipmentRateStatus').level).toBe('warning');
        });

        it('BAD two days running is still an error', () => {
            const j = judgeMetric(toDailySeries(fair([['2026-10-13', 'BAD'], ['2026-10-14', 'BAD']])), 'lateShipmentRateStatus');
            expect(j.level).toBe('error');
        });
    });

    it('a field no report carries is "none" (no data), not an error', () => {
        const j = judge(seq(['2026-10-13', ''], ['2026-10-14', undefined]));
        expect(j.level).toBe('none');
    });

    it('lists every judged day for the history strip, newest first', () => {
        expect(judge(REAL).days).toEqual(['2026-10-14', '2026-10-13', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08']);
    });
});

describe('wording helpers', () => {
    it('nearCutoff is true only just above the 200 cutoff', () => {
        expect(nearCutoff(204)).toBe(true);
        expect(nearCutoff(200)).toBe(true);
        expect(nearCutoff(219)).toBe(true);
        expect(nearCutoff(220)).toBe(false);
        expect(nearCutoff(199)).toBe(false);
        expect(nearCutoff(undefined)).toBe(false);
    });

    it('formats days oldest first', () => {
        expect(formatDays(['2026-10-13', '2026-10-10'])).toBe('Oct 10, Oct 13');
    });

    it('humanizes Amazon status codes', () => {
        expect(humanizeStatus('AT_RISK')).toBe('At Risk');
        expect(humanizeStatus('NORMAL')).toBe('Normal');
    });
});
