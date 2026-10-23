/**
 * The catalogue write touches ONE marketplace, atomically.
 *
 * All of a user's marketplaces share one Seller document. The old findOne + save() rewrote the
 * whole document, so two marketplaces importing at once (or a connect during an import) could
 * overwrite each other or fail with a VersionError. saveListingsForMarketplace reads and writes
 * only the marketplace being imported.
 */

jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

const SellerModel = require('../../../models/user-auth/sellerCentralModel.js');
const {
  saveListingsForMarketplace,
  TOTAT_PRODUCTS_HISTORY_LIMIT,
} = require('../../../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');

const lean = (value) => ({ lean: () => Promise.resolve(value) });

const UK_ACCOUNT = {
  country: 'UK',
  region: 'EU',
  products: [{ asin: 'A1', sku: 'S1', status: 'Active', issueCount: 3 }],
  TotatProducts: [{ NumberOfProducts: 1 }],
};

describe('saveListingsForMarketplace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SellerModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('reads only the marketplace being imported', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean({ _id: 'doc1', User: 'u1', sellerAccount: [UK_ACCOUNT] }));
    await saveListingsForMarketplace('u1', 'UK', 'EU', []);

    const [filter, projection] = SellerModel.findOne.mock.calls[0];
    expect(filter).toEqual({ User: 'u1', sellerAccount: { $elemMatch: { country: 'UK', region: 'EU' } } });
    expect(projection).toEqual({ User: 1, 'sellerAccount.$': 1 });
  });

  it('writes only that marketplace, by country and region, with no document-wide save', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean({ _id: 'doc1', User: 'u1', sellerAccount: [UK_ACCOUNT] }));
    const incoming = [{ asin: 'A1', sku: 'S1', status: 'Active' }, { asin: 'A2', sku: 'S2', status: 'Active' }];

    await saveListingsForMarketplace('u1', 'UK', 'EU', incoming);

    expect(SellerModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = SellerModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'doc1' });
    expect(update.$set).toEqual({ 'sellerAccount.$[acct].products': incoming });
    expect(update.$push['sellerAccount.$[acct].TotatProducts']).toEqual({
      $each: [{ NumberOfProducts: 2 }],
      $slice: -TOTAT_PRODUCTS_HISTORY_LIMIT,
    });
    expect(options).toEqual({ arrayFilters: [{ 'acct.country': 'UK', 'acct.region': 'EU' }] });
  });

  it('still carries forward the fields other services own', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean({ _id: 'doc1', User: 'u1', sellerAccount: [UK_ACCOUNT] }));
    const incoming = [{ asin: 'A1', sku: 'S1', status: 'Active' }];

    await saveListingsForMarketplace('u1', 'UK', 'EU', incoming);

    expect(SellerModel.updateOne.mock.calls[0][1].$set['sellerAccount.$[acct].products'][0].issueCount).toBe(3);
  });

  it('returns the Seller shape the integration code reads products from', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean({ _id: 'doc1', User: 'u1', sellerAccount: [UK_ACCOUNT] }));
    const incoming = [{ asin: 'A9', sku: 'S9', status: 'Inactive' }];

    const result = await saveListingsForMarketplace('u1', 'UK', 'EU', incoming);

    const account = result.sellerAccount.find((a) => a.country === 'UK' && a.region === 'EU');
    expect(account.products).toBe(incoming);
    expect(account.TotatProducts).toEqual([{ NumberOfProducts: 1 }, { NumberOfProducts: 1 }]);
  });

  it('is false when the user has no Seller document, and writes nothing', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean(null)).mockReturnValueOnce(lean(null));
    expect(await saveListingsForMarketplace('u1', 'UK', 'EU', [])).toBe(false);
    expect(SellerModel.updateOne).not.toHaveBeenCalled();
  });

  it('writes nothing for a marketplace the user does not have', async () => {
    SellerModel.findOne.mockReturnValueOnce(lean(null)).mockReturnValueOnce(lean({ _id: 'doc1', User: 'u1' }));
    const result = await saveListingsForMarketplace('u1', 'JP', 'FE', [{ asin: 'A1', sku: 'S1' }]);
    expect(result.sellerAccount).toEqual([]);
    expect(SellerModel.updateOne).not.toHaveBeenCalled();
  });
});
