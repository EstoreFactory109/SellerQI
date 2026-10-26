const mockFindOne = jest.fn();
jest.mock('../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: (...a) => ({ select: () => ({ lean: () => mockFindOne(...a) }) }),
}));

const access = require('../../utils/marketplaceAccess.js');

const seller = (accounts) => ({ sellerAccount: accounts });

beforeEach(() => {
    mockFindOne.mockReset();
    access._cache.clear();
});

describe('parseMarketplaceHeader', () => {
    test.each([
        ['UK:EU', { country: 'UK', region: 'EU' }],
        [' us:na ', { country: 'US', region: 'NA' }],
        ['UK-EU', null],
        ['UK:XX', null],
        ['USA:NA', null],
        ['', null],
        [undefined, null],
    ])('%p', (input, expected) => {
        expect(access.parseMarketplaceHeader(input)).toEqual(expected);
    });
});

describe('listOwnedMarketplaces / ownsMarketplace', () => {
    test('dedupes, uppercases, and marks connection state', async () => {
        mockFindOne.mockResolvedValue(seller([
            { country: 'US', region: 'NA', spiRefreshToken: 'x' },
            { country: 'us', region: 'na', spiRefreshToken: 'y' },
            { country: 'UK', region: 'EU', spiRefreshToken: '  ' },
            { country: 'DE' }, // no region: ignored
        ]));
        expect(await access.listOwnedMarketplaces('u1')).toEqual([
            { country: 'US', region: 'NA', isConnected: true },
            { country: 'UK', region: 'EU', isConnected: false },
        ]);
    });

    test('ownsMarketplace matches only the user\'s own marketplaces', async () => {
        mockFindOne.mockResolvedValue(seller([{ country: 'US', region: 'NA', spiRefreshToken: 'x' }]));
        expect(await access.ownsMarketplace('u1', 'us', 'na')).toBe(true);
        expect(await access.ownsMarketplace('u1', 'UK', 'EU')).toBe(false);
        expect(await access.ownsMarketplace(null, 'US', 'NA')).toBe(false);
    });

    test('caches per user until invalidated', async () => {
        mockFindOne.mockResolvedValue(seller([{ country: 'US', region: 'NA' }]));
        await access.listOwnedMarketplaces('u1');
        await access.listOwnedMarketplaces('u1');
        expect(mockFindOne).toHaveBeenCalledTimes(1);

        access.invalidateMarketplaceAccess('u1');
        await access.listOwnedMarketplaces('u1');
        expect(mockFindOne).toHaveBeenCalledTimes(2);
    });

    test('primaryMarketplace prefers the first connected one', async () => {
        mockFindOne.mockResolvedValue(seller([
            { country: 'UK', region: 'EU' },
            { country: 'US', region: 'NA', spiRefreshToken: 'x' },
        ]));
        expect(await access.primaryMarketplace('u1')).toEqual({ country: 'US', region: 'NA' });
    });
});
