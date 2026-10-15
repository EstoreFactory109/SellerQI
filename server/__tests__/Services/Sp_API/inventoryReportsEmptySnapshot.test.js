/**
 * Stranded inventory, inbound non-compliance and restock recommendations must
 * SAVE an empty snapshot when Amazon reports nothing (DONE_NO_DATA, or a
 * document with no rows / no in-window rows).
 *
 * They used to save nothing, so the last report that HAD problems stayed the
 * newest document and the Issues page kept showing problems the seller had
 * fixed — for up to 187 days in production. On the async path DONE_NO_DATA
 * reached finalize with no document id, the download threw, and the run was
 * recorded FAILED.
 */

// Callable as well as carrying get/post: the download is axios(config).
jest.mock('axios', () => Object.assign(jest.fn(), { get: jest.fn(), post: jest.fn() }));
jest.mock('../../../Services/inventory/StrandedInventoryUIDataService', () => ({
    saveStrandedInventoryUIData: jest.fn(),
}));
jest.mock('../../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js', () => ({ create: jest.fn() }));
jest.mock('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js', () => ({ create: jest.fn() }));
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));

const axios = require('axios');
const logger = require('../../../utils/Logger.js');
const { saveStrandedInventoryUIData } = require('../../../Services/inventory/StrandedInventoryUIDataService');
const InboundModel = require('../../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const RestockModel = require('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const UserModel = require('../../../models/user-auth/userModel.js');

const getStranded = require('../../../Services/Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const getInbound = require('../../../Services/Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const getRestock = require('../../../Services/Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');

const USER = '64b000000000000000000001';
const ctx = { userId: USER, country: 'US', region: 'NA', accessToken: 't', baseuri: 'sp.example', marketplaceIds: ['ATVPDKIKX0DER'] };
const specOf = (service) => service.spApiAsync.buildSpecs(ctx)[0];

/** Queue a downloadable document whose body is `tsv`. */
const serveDocument = (tsv) => {
    axios.get.mockResolvedValueOnce({ data: { url: 'https://doc' } });
    axios.mockResolvedValueOnce({ data: Buffer.from(tsv) });
};

/** Make the inline poll loop's sleeps instant. */
const instantSleeps = () => jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });

const daysAgo = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

beforeEach(() => {
    saveStrandedInventoryUIData.mockResolvedValue({ success: true, batchId: 'b1', itemCount: 0 });
    InboundModel.create.mockImplementation(async (doc) => ({ _id: 'i1', ...doc }));
    RestockModel.create.mockImplementation(async (doc) => ({ _id: 'r1', ...doc }));
    UserModel.findById.mockResolvedValue({ save: jest.fn().mockResolvedValue(true) });
});

describe('stranded inventory', () => {
    it('async finalize with no document (DONE_NO_DATA) saves an empty snapshot and reports empty', async () => {
        const result = await specOf(getStranded).finalize({ reportDocumentId: null });

        expect(result).toEqual({ empty: true });
        expect(saveStrandedInventoryUIData).toHaveBeenCalledWith(USER, 'US', 'NA', []);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('async finalize on a header-only document saves an empty snapshot', async () => {
        serveDocument('sku\tasin\tstatus-primary\tstranded-reason\n');

        const result = await specOf(getStranded).finalize({ reportDocumentId: 'd1' });

        expect(saveStrandedInventoryUIData).toHaveBeenCalledWith(USER, 'US', 'NA', []);
        expect(result).toEqual({ empty: true });
    });

    it('async finalize with rows saves them and is not empty', async () => {
        saveStrandedInventoryUIData.mockResolvedValue({ success: true, batchId: 'b1', itemCount: 1 });
        serveDocument('sku\tasin\tstatus-primary\tstranded-reason\nS1\tB0001\tStranded\tNo listing\n');

        const result = await specOf(getStranded).finalize({ reportDocumentId: 'd1' });

        expect(saveStrandedInventoryUIData).toHaveBeenCalledWith(USER, 'US', 'NA', [
            { asin: 'B0001', status_primary: 'Stranded', stranded_reason: 'No listing' },
        ]);
        expect(result).toEqual({ empty: false });
    });

    it('inline DONE_NO_DATA saves an empty snapshot instead of returning a failure', async () => {
        instantSleeps();
        axios.post.mockResolvedValue({ data: { reportId: 'rep1' } });
        axios.get.mockResolvedValueOnce({ data: { processingStatus: 'DONE_NO_DATA' } });

        const result = await getStranded('t', ['ATVPDKIKX0DER'], USER, 'sp.example', 'US', 'NA');

        expect(saveStrandedInventoryUIData).toHaveBeenCalledWith(USER, 'US', 'NA', []);
        expect(result).toMatchObject({ itemCount: 0 });
        expect(result.success).not.toBe(false);
    });

    it('inline FATAL is still a failure and saves nothing', async () => {
        instantSleeps();
        axios.post.mockResolvedValue({ data: { reportId: 'rep1' } });
        axios.get.mockResolvedValueOnce({ data: { processingStatus: 'FATAL' } });

        const result = await getStranded('t', ['ATVPDKIKX0DER'], USER, 'sp.example', 'US', 'NA');

        expect(result).toEqual({ success: false, message: 'Error in generating the report' });
        expect(saveStrandedInventoryUIData).not.toHaveBeenCalled();
    });
});

describe('inbound non-compliance', () => {
    it('async finalize with no document (DONE_NO_DATA) saves ErrorData [] and reports empty', async () => {
        const result = await specOf(getInbound).finalize({ reportDocumentId: null });

        expect(result).toEqual({ empty: true });
        expect(InboundModel.create).toHaveBeenCalledWith({ userId: USER, country: 'US', region: 'NA', ErrorData: [] });
    });

    it('async finalize saves ErrorData [] when every issue is outside the 30-day window', async () => {
        serveDocument(
            'shipment-creation-date\tissue-reported-date\tasin\tproblem-type\n' +
            `${daysAgo(90)}\t${daysAgo(60)}\tB0001\tLabeling\n`
        );

        const result = await specOf(getInbound).finalize({ reportDocumentId: 'd1' });

        expect(InboundModel.create).toHaveBeenCalledWith({ userId: USER, country: 'US', region: 'NA', ErrorData: [] });
        expect(result).toEqual({ empty: true });
    });

    it('async finalize keeps an in-window issue and is not empty', async () => {
        serveDocument(
            'shipment-creation-date\tissue-reported-date\tasin\tproblem-type\n' +
            `${daysAgo(10)}\t${daysAgo(5)}\tB0002\tLabeling\n`
        );

        const result = await specOf(getInbound).finalize({ reportDocumentId: 'd1' });

        expect(InboundModel.create.mock.calls[0][0].ErrorData).toEqual([
            { issueReportedDate: daysAgo(5), shipmentCreationDate: daysAgo(10), asin: 'B0002', problemType: 'Labeling' },
        ]);
        expect(result).toEqual({ empty: false });
    });

    it('inline DONE_NO_DATA saves ErrorData []', async () => {
        instantSleeps();
        axios.post.mockResolvedValue({ data: { reportId: 'rep1' } });
        axios.get.mockResolvedValueOnce({ data: { processingStatus: 'DONE_NO_DATA' } });

        const result = await getInbound('t', ['ATVPDKIKX0DER'], USER, 'sp.example', 'US', 'NA');

        expect(InboundModel.create).toHaveBeenCalledWith({ userId: USER, country: 'US', region: 'NA', ErrorData: [] });
        expect(result).toMatchObject({ ErrorData: [] });
    });
});

describe('restock recommendations', () => {
    it('async finalize with no document (DONE_NO_DATA) saves Products [] and reports empty', async () => {
        const result = await specOf(getRestock).finalize({ reportDocumentId: null });

        expect(result).toEqual({ empty: true });
        expect(RestockModel.create).toHaveBeenCalledWith({ User: USER, region: 'NA', country: 'US', Products: [] });
    });

    it('a header-only document saves Products [] without the misleading timeout log', async () => {
        serveDocument('ASIN\tFNSKU\tRecommended replenishment qty\n');

        const result = await specOf(getRestock).finalize({ reportDocumentId: 'd1' });

        expect(RestockModel.create).toHaveBeenCalledWith({ User: USER, region: 'NA', country: 'US', Products: [] });
        expect(result).toEqual({ empty: true });
        const errorText = logger.error.mock.calls.map((c) => String(c[0]?.message || c[0])).join(' ');
        expect(errorText).not.toMatch(/did not complete within 5 minutes/);
    });

    it('inline DONE_NO_DATA saves Products []', async () => {
        instantSleeps();
        axios.post.mockResolvedValue({ data: { reportId: 'rep1' } });
        axios.get.mockResolvedValueOnce({ data: { processingStatus: 'DONE_NO_DATA' } });

        const result = await getRestock('t', ['ATVPDKIKX0DER'], USER, 'sp.example', 'US', 'NA');

        expect(RestockModel.create).toHaveBeenCalledWith({ User: USER, region: 'NA', country: 'US', Products: [] });
        expect(result).toMatchObject({ Products: [] });
    });

    it('inline treats IN_QUEUE as still processing rather than failing', async () => {
        instantSleeps();
        axios.post.mockResolvedValue({ data: { reportId: 'rep1' } });
        axios.get
            .mockResolvedValueOnce({ data: { processingStatus: 'IN_QUEUE' } })
            .mockResolvedValueOnce({ data: { processingStatus: 'DONE_NO_DATA' } });

        const result = await getRestock('t', ['ATVPDKIKX0DER'], USER, 'sp.example', 'US', 'NA');

        expect(result).toMatchObject({ Products: [] });
    });
});
