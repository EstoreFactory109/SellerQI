/**
 * GET_FBA_INVENTORY_PLANNING_DATA column names as Amazon sent them in a live US
 * report (Oct 2026), after the parser's header normalisation.
 */
jest.mock('../../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js', () => ({ create: jest.fn() }));
const { convertTSVToJson, mapPlanningRow } = require('../../../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');

const HEADERS = ['asin', 'inv-age-91-to-180-days', 'units-shipped-t90', 'unfulfillable-quantity',
    'quantity-to-be-charged-ais-366-455-days', 'estimated-ais-366-455-days',
    'quantity-to-be-charged-ais-456-plus-days', 'estimated-ais-456-plus-days',
    'Exempted from Low-Inventory-Level fee?', 'Low-Inventory-Level fee applied in current week?',
    'Short term historical days of supply', 'Long term historical days of supply'];

it('reads the low-inventory fee columns, the surcharge estimate and the split 365+ buckets', async () => {
    const tsv = HEADERS.join('\t') + '\n' + ['B01', '40', '90', '2', '3', '12.50', '4', '8.25', 'No', 'Yes', '21.4', '26.0'].join('\t') + '\n';
    const [record] = await convertTSVToJson(Buffer.from(tsv));
    const row = mapPlanningRow(record);
    expect(row).toMatchObject({
        asin: 'B01',
        quantity_to_be_charged_ais_365_plus_days: '7',
        estimated_ais_total: 20.75,
        inv_age_91_to_180_days: '40',
        units_shipped_t90: '90',
        low_inventory_level_fee_applied: 'Yes',
        low_inventory_level_fee_exempt: 'No',
        historical_days_of_supply_short: '21.4',
        historical_days_of_supply_long: '26.0'
    });
});

it('keeps a 365+ column where the marketplace still sends one', async () => {
    const tsv = 'asin\tquantity-to-be-charged-ais-365-plus-days\nB02\t5\n';
    const [record] = await convertTSVToJson(Buffer.from(tsv));
    expect(mapPlanningRow(record).quantity_to_be_charged_ais_365_plus_days).toBe('5');
    expect(mapPlanningRow(record).estimated_ais_total).toBeNull();
});
