/**
 * ESF reports mailer.
 *
 * What is pinned here is what would go wrong quietly and expensively:
 *
 *  - the audience. These are a managed-service deliverable; an ordinary seller
 *    receiving one is a customer-facing mistake, not a cosmetic bug.
 *  - the cadence grouping. Every report must belong to exactly one cycle, or a
 *    client gets it twice a week or never at all.
 *  - "bi-weekly" meaning a fortnight. Cron cannot express it, so it is a gate in
 *    code — get it inverted and the cycle runs every week.
 *  - never emailing an empty envelope when a cycle has no data behind it.
 *  - ONE PDF per report for the whole account. A client with US and IN used
 *    to get two of every report; now each covers every marketplace.
 */
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../Services/Calculations/EsfAccountReportsService.js', () => ({
    getEsfAccountReports: jest.fn(),
}));
jest.mock('../../../Services/Reports/reportPdf.js', () => ({
    renderReportPdf: jest.fn(),
    reportPdfFilename: jest.fn((report, mk) => `${report.name} - ${mk?.country}.pdf`),
    MAX_PDF_ROWS: 40,
}));
jest.mock('../../../Services/Email/SendEsfReportsEmail.js', () => ({
    sendEsfReportsEmail: jest.fn(),
    createReportsTransport: jest.fn(() => ({ close: jest.fn() })),
}));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const User = require('../../../models/user-auth/userModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { getEsfAccountReports } = require('../../../Services/Calculations/EsfAccountReportsService.js');
const { renderReportPdf, reportPdfFilename } = require('../../../Services/Reports/reportPdf.js');
const { sendEsfReportsEmail, createReportsTransport } = require('../../../Services/Email/SendEsfReportsEmail.js');

const {
    runEsfReportsCadence,
    findEsfClients,
    CADENCE_GROUPS,
    isoWeek,
    isBiweeklyWeek,
} = require('../../../Services/BackgroundJobs/esfReportsMailer.js');

const CLIENT = { _id: 'client1', firstName: 'Ada', email: 'ada@example.com' };

const stubClients = (users, marketplaces = [{ country: 'US', region: 'NA' }]) => {
    User.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(users) }) });
    Seller.findOne.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve({ sellerAccount: marketplaces }) }),
    });
};

const US = { country: 'US', region: 'NA', currency: '$' };
const IN = { country: 'IN', region: 'EU', currency: '₹' };

/** A payload shaped like getEsfAccountReports returns. */
const reportPayload = (available = [], marketplaces = [US], primary = marketplaces[0]) => ({
    marketplace: primary,
    primary,
    marketplaces,
    reports: Object.values(CADENCE_GROUPS)
        .flatMap((g) => g.reportKeys)
        .map((key) => ({
            key,
            name: key,
            date: 'today',
            insight: `${key} insight`,
            tone: 'neutral',
            available: available.includes(key),
            marketplace: primary,
            multi: marketplaces.length > 1,
            summary: available.includes(key) ? { rows: [{ a: 1 }], columns: [{ key: 'a', label: 'A' }], totalRows: 1 } : undefined,
        })),
});

/**
 * Freeze the clock WITHOUT faking setTimeout: a faked setTimeout never
 * resolves anything awaiting one, so a test
 * hangs to its timeout and — worse — leaves fake timers installed for every
 * test after it.
 */
const freezeClock = (iso) => {
    /**
     * Resolve the timestamp BEFORE installing fake timers.
     *
     * useFakeTimers swaps the global Date for sinon's ClockDate, so a Date built after
     * that line is a ClockDate — and sinon's own setSystemTime guards with
     * `epoch instanceof Date` against the NATIVE constructor it captured at module load.
     * The two never match, and it throws "now should be milliseconds since UNIX epoch"
     * pointing at a line that looks entirely correct.
     */
    const at = new Date(iso).getTime();
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick'] });
    jest.setSystemTime(at);
};

// The jest config sets resetMocks, which strips the implementations given in the
// jest.mock factories above — so every one of them is re-established here.
beforeEach(() => {
    stubClients([CLIENT]);
    getEsfAccountReports.mockResolvedValue(reportPayload([]));
    renderReportPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    reportPdfFilename.mockImplementation((report, mk) => `${report.name} - ${mk?.country}.pdf`);
    sendEsfReportsEmail.mockResolvedValue('msg-1');
    createReportsTransport.mockReturnValue({ close: jest.fn() });
});

// Unconditional, so a test that fails before its own cleanup cannot strand fake
// timers on the whole file.
afterEach(() => {
    jest.useRealTimers();
});

describe('cadence grouping', () => {
    it('assigns all seven reports, each to exactly one cycle', () => {
        const keys = Object.values(CADENCE_GROUPS).flatMap((g) => g.reportKeys);
        expect(keys).toHaveLength(7);
        expect(new Set(keys).size).toBe(7);
    });

    it('groups three weekly, one bi-weekly, two monthly and one quarterly', () => {
        expect(CADENCE_GROUPS.weekly.reportKeys).toHaveLength(3);
        expect(CADENCE_GROUPS.biweekly.reportKeys).toHaveLength(1);
        expect(CADENCE_GROUPS.monthly.reportKeys).toHaveLength(2);
        expect(CADENCE_GROUPS.quarterly.reportKeys).toHaveLength(1);
    });
});

describe('bi-weekly gate', () => {
    it('computes ISO week numbers', () => {
        expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe(1);
        expect(isoWeek(new Date('2026-09-23T00:00:00Z'))).toBe(39);
    });

    it('runs on even ISO weeks and holds on odd ones', () => {
        expect(isBiweeklyWeek(new Date('2026-09-23T00:00:00Z'))).toBe(false);  // week 39
        expect(isBiweeklyWeek(new Date('2026-09-30T00:00:00Z'))).toBe(true);   // week 40
    });

    it('sends nothing on an off week', async () => {
        freezeClock('2026-09-23T08:15:00Z');  // week 39
        const result = await runEsfReportsCadence('biweekly');

        expect(result.skipped).toBe(true);
        expect(sendEsfReportsEmail).not.toHaveBeenCalled();
    });

    it('force overrides the gate, for a manual run', async () => {
        freezeClock('2026-09-23T08:15:00Z');
        getEsfAccountReports.mockResolvedValue(reportPayload(['inventory-restock']));

        const result = await runEsfReportsCadence('biweekly', { force: true });

        expect(result.skipped).toBeUndefined();
        expect(sendEsfReportsEmail).toHaveBeenCalled();
    });
});

describe('audience', () => {
    it('asks only for ESF clients', async () => {
        await findEsfClients();
        expect(User.find).toHaveBeenCalledWith({ isEsfClient: true });
    });

    it('drops a client with no connected marketplace', async () => {
        User.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([CLIENT]) }) });
        Seller.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ sellerAccount: [] }) }) });

        expect(await findEsfClients()).toEqual([]);
    });

    it('skips a client with no email rather than throwing', async () => {
        stubClients([{ _id: 'c2', firstName: 'NoMail' }]);
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox']));

        const result = await runEsfReportsCadence('weekly');

        expect(sendEsfReportsEmail).not.toHaveBeenCalled();
        expect(result.sent).toBe(0);
    });
});

describe('what gets attached', () => {
    it('sends one email carrying every available report in the cycle', async () => {
        getEsfAccountReports.mockResolvedValue(reportPayload(['account-overview', 'buybox', 'review-requests']));

        const result = await runEsfReportsCadence('weekly');

        expect(sendEsfReportsEmail).toHaveBeenCalledTimes(1);
        const call = sendEsfReportsEmail.mock.calls[0][0];
        expect(call.attachments).toHaveLength(3);
        expect(call.cadenceLabel).toBe('Weekly');
        // Attributable, unlike the existing weekly report's null receiverId.
        expect(call.userId).toBe('client1');
        expect(result.sent).toBe(1);
    });

    it('omits a report with no data instead of attaching a blank page', async () => {
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox']));

        await runEsfReportsCadence('weekly');

        const call = sendEsfReportsEmail.mock.calls[0][0];
        expect(call.attachments).toHaveLength(1);
        expect(call.reports[0].name).toBe('buybox');
    });

    it('sends no email at all when the whole cycle has no data', async () => {
        getEsfAccountReports.mockResolvedValue(reportPayload([]));

        const result = await runEsfReportsCadence('weekly');

        expect(sendEsfReportsEmail).not.toHaveBeenCalled();
        expect(result.nothingToSend).toBe(1);
    });

    it('sends ONE PDF per report covering every marketplace, primary first in its name', async () => {
        stubClients([CLIENT], [{ country: 'IN', region: 'EU' }, { country: 'US', region: 'NA' }]);
        // Connected IN first; US is primary (highest sales), so it leads.
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox'], [IN, US], US));

        await runEsfReportsCadence('weekly');

        const call = sendEsfReportsEmail.mock.calls[0][0];
        expect(call.attachments.map((a) => a.filename)).toEqual(['buybox - US, IN.pdf']);
        expect(call.reports[0].marketplaceLabel).toBe('Amazon US, IN');
        // Rendered led by the primary marketplace.
        expect(renderReportPdf.mock.calls[0][1].marketplace).toEqual(US);
    });

    it('builds the cycle once per client, at the depth of the PDF', async () => {
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox']));

        await runEsfReportsCadence('weekly');

        expect(getEsfAccountReports).toHaveBeenCalledTimes(1);
        expect(getEsfAccountReports).toHaveBeenCalledWith('client1', {
            keys: CADENCE_GROUPS.weekly.reportKeys,
            rowLimit: 40,
        });
    });

    it('sends nothing for a client whose reports could not be built, and moves on', async () => {
        stubClients([CLIENT, { ...CLIENT, _id: 'client2', email: 'b@example.com' }]);
        getEsfAccountReports
            .mockRejectedValueOnce(new Error('mongo down'))
            .mockResolvedValueOnce(reportPayload(['buybox']));

        const result = await runEsfReportsCadence('weekly');

        expect(sendEsfReportsEmail).toHaveBeenCalledTimes(1);
        expect(result.nothingToSend).toBe(1);
        expect(result.sent).toBe(1);
    });
});

describe('robustness', () => {
    it('keeps going when one report fails to render', async () => {
        getEsfAccountReports.mockResolvedValue(reportPayload(['account-overview', 'buybox', 'review-requests']));
        renderReportPdf
            .mockRejectedValueOnce(new Error('pdf exploded'))
            .mockResolvedValue(Buffer.from('%PDF-fake'));

        await runEsfReportsCadence('weekly');

        // Two survive; the email still goes with what rendered.
        expect(sendEsfReportsEmail.mock.calls[0][0].attachments).toHaveLength(2);
    });

    it('closes the pooled transport even when a send throws', async () => {
        const transport = { close: jest.fn() };
        createReportsTransport.mockReturnValue(transport);
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox']));
        sendEsfReportsEmail.mockRejectedValue(new Error('smtp gone'));

        await expect(runEsfReportsCadence('weekly')).rejects.toThrow('smtp gone');
        expect(transport.close).toHaveBeenCalled();
    });

    it('counts a failed send without aborting the run', async () => {
        stubClients([CLIENT, { ...CLIENT, _id: 'client2', email: 'b@example.com' }]);
        getEsfAccountReports.mockResolvedValue(reportPayload(['buybox']));
        sendEsfReportsEmail.mockResolvedValueOnce(false).mockResolvedValueOnce('msg-2');

        const result = await runEsfReportsCadence('weekly');

        expect(result.failed).toBe(1);
        expect(result.sent).toBe(1);
    });

    it('rejects an unknown cadence rather than silently sending nothing', async () => {
        await expect(runEsfReportsCadence('fortnightly')).rejects.toThrow(/Unknown cadence/);
    });
});
