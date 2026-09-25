/**
 * Offer parsing for the Buy Box pricing report.
 *
 * WHY THESE ARE THE TESTS THAT MATTER
 * Everything the report says about price — the Buy Box price, who holds it, and
 * the gap against our own offer — comes out of one parser, and that parser
 * could not be run against a live Amazon response: every SP-API account on this
 * machine returns 401 invalid_client. A mocked fetch would only prove the code
 * agrees with my guess about the field names.
 *
 * So these pin the behaviour AROUND the guess, and above all the distinctions a
 * money column must never blur:
 *
 *   - absent is null, never 0. A 0 would win every price comparison and report
 *     a competitor undercutting us by the full price of the item.
 *   - a price is a LANDED price. A cheap listing with paid delivery is not the
 *     cheaper offer, and a gap computed from listing prices alone is wrong by
 *     the shipping charge.
 *   - "no seller id returned" is not "no competitor".
 */
jest.mock('../../../models/products/CompetitiveOffersModel.js', () => ({ create: jest.fn() }));
jest.mock('../../../models/MCP/BuyBoxDataModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));

const {
    parseOffersPayload,
    asinOfResponse,
    MAX_ASINS_PER_BATCH,
} = require('../../../Services/Sp_API/GET_COMPETITIVE_OFFERS.js');

/** One offer, with only the fields a test cares about spelled out. */
const offer = (over = {}) => ({
    SellerId: 'A1SELLER',
    ListingPrice: { Amount: 20, CurrencyCode: 'USD' },
    Shipping: { Amount: 0, CurrencyCode: 'USD' },
    IsBuyBoxWinner: false,
    ...over,
});

const payload = (over = {}) => ({
    ASIN: 'B0TEST',
    Summary: { TotalOfferCount: 2, ...(over.Summary || {}) },
    Offers: over.Offers || [],
});

describe('parseOffersPayload', () => {
    it('reads the Buy Box price, its seller and its fulfilment', () => {
        const parsed = parseOffersPayload(payload({
            Summary: {
                TotalOfferCount: 2,
                BuyBoxPrices: [{ LandedPrice: { Amount: 22.99, CurrencyCode: 'USD' } }],
            },
            Offers: [
                offer({ SellerId: 'A1WINNER', IsBuyBoxWinner: true, IsFulfilledByAmazon: true, ListingPrice: { Amount: 22.99 } }),
                offer({ SellerId: 'A2OTHER' }),
            ],
        }));

        expect(parsed.buyBoxPrice).toBe(22.99);
        expect(parsed.buyBoxSellerId).toBe('A1WINNER');
        expect(parsed.buyBoxIsFba).toBe(true);
        expect(parsed.currency).toBe('USD');
        expect(parsed.totalOfferCount).toBe(2);
    });

    it('adds shipping in, because a landed price is what a shopper pays', () => {
        const parsed = parseOffersPayload(payload({
            Offers: [offer({ ListingPrice: { Amount: 18 }, Shipping: { Amount: 5.99 }, MyOffer: true })],
        }));

        // Not 18. A gap computed from listing prices alone would call this
        // offer the cheaper one while the shopper pays six pounds more.
        expect(parsed.ourLandedPrice).toBe(23.99);
        expect(parsed.offers[0].listingPrice).toBe(18);
        expect(parsed.offers[0].shipping).toBe(5.99);
    });

    it('finds our own offer by MyOffer or by merchant token', () => {
        const byFlag = parseOffersPayload(payload({
            Offers: [offer({ SellerId: 'A9UNKNOWN', MyOffer: true, ListingPrice: { Amount: 30 } })],
        }));
        expect(byFlag.ourLandedPrice).toBe(30);

        // MyOffer is not documented as always present on this endpoint, so the
        // token match is the other half of the answer.
        const byToken = parseOffersPayload(payload({
            Offers: [offer({ SellerId: 'A1VZGOURS', ListingPrice: { Amount: 31 } })],
        }), 'A1VZGOURS');
        expect(byToken.ourLandedPrice).toBe(31);
        expect(byToken.offers[0].isOurs).toBe(true);
    });

    it('does not mistake a competitor for us when we hold no merchant token', () => {
        const parsed = parseOffersPayload(payload({
            Offers: [offer({ SellerId: 'A2COMPETITOR', ListingPrice: { Amount: 15 } })],
        }), '');

        expect(parsed.offers[0].isOurs).toBe(false);
        // Null, not 15: we have no idea what our own price is here.
        expect(parsed.ourLandedPrice).toBeNull();
    });

    it('returns null for an absent price rather than zero', () => {
        // Zero is the dangerous default: it wins every comparison and would
        // report a competitor undercutting us by the entire price.
        const parsed = parseOffersPayload(payload({ Offers: [offer({ ListingPrice: undefined })] }));

        expect(parsed.buyBoxPrice).toBeNull();
        expect(parsed.ourLandedPrice).toBeNull();
        expect(parsed.lowestPrice).toBeNull();
        expect(parsed.offers[0].landedPrice).toBeNull();
    });

    it('prefers the summary Buy Box price over the winning offer when they disagree', () => {
        // They disagree when Amazon returns a summary but truncates the offer
        // list. The summary is the one that is always about the Buy Box.
        const parsed = parseOffersPayload(payload({
            Summary: { BuyBoxPrices: [{ LandedPrice: { Amount: 10 } }] },
            Offers: [offer({ IsBuyBoxWinner: true, ListingPrice: { Amount: 99 } })],
        }));

        expect(parsed.buyBoxPrice).toBe(10);
    });

    it('falls back to the winning offer when the summary has no Buy Box price', () => {
        const parsed = parseOffersPayload(payload({
            Offers: [offer({ IsBuyBoxWinner: true, ListingPrice: { Amount: 41 }, Shipping: { Amount: 1 } })],
        }));

        expect(parsed.buyBoxPrice).toBe(42);
    });

    it('keeps the price when Amazon returns no seller id', () => {
        const parsed = parseOffersPayload(payload({
            Summary: { BuyBoxPrices: [{ LandedPrice: { Amount: 12.5, CurrencyCode: 'GBP' } }] },
            Offers: [offer({ SellerId: undefined, IsBuyBoxWinner: true })],
        }));

        // An unnamed competitor is still a competitor, and the gap is the part
        // that gets actioned.
        expect(parsed.buyBoxSellerId).toBe('');
        expect(parsed.buyBoxPrice).toBe(12.5);
        expect(parsed.currency).toBe('GBP');
    });

    it('reads the lower-cased spellings too', () => {
        const parsed = parseOffersPayload({
            summary: { totalOfferCount: 1, buyBoxPrices: [{ landedPrice: { amount: 8, currencyCode: 'EUR' } }] },
            offers: [{ sellerId: 'A1X', listingPrice: { amount: 8 }, isBuyBoxWinner: true, isFulfilledByAmazon: true }],
        });

        expect(parsed.buyBoxPrice).toBe(8);
        expect(parsed.buyBoxSellerId).toBe('A1X');
        expect(parsed.buyBoxIsFba).toBe(true);
    });

    it('carries feedback through, as context for whether a cheaper offer is credible', () => {
        const parsed = parseOffersPayload(payload({
            Offers: [offer({ SellerFeedbackRating: { SellerPositiveFeedbackRating: 92, FeedbackCount: 415 } })],
        }));

        expect(parsed.offers[0].feedbackRating).toBe(92);
        expect(parsed.offers[0].feedbackCount).toBe(415);
    });

    it('survives the shapes a real response throws at it', () => {
        for (const junk of [undefined, null, {}, 'a string']) {
            const parsed = parseOffersPayload(junk);
            expect(parsed.offers).toEqual([]);
            expect(parsed.buyBoxPrice).toBeNull();
            expect(parsed.totalOfferCount).toBe(0);
        }

        // Offers present but not an array — must not throw.
        expect(parseOffersPayload({ Offers: 'nope' }).offers).toEqual([]);
    });
});

describe('asinOfResponse', () => {
    it('reads the ASIN from the payload', () => {
        expect(asinOfResponse({ body: { payload: { ASIN: 'B01' } } })).toBe('B01');
        expect(asinOfResponse({ body: { Payload: { asin: 'B02' } } })).toBe('B02');
    });

    it('falls back to the request uri, which is how a failed entry is identified', () => {
        // A per-ASIN failure carries no payload at all, so without this the row
        // could not be attributed and the ASIN would silently vanish.
        expect(asinOfResponse({
            request: { uri: '/products/pricing/v0/items/B03/offers' },
            status: { statusCode: 404 },
        })).toBe('B03');
    });

    it('decodes an escaped ASIN in the uri', () => {
        expect(asinOfResponse({ request: { uri: '/products/pricing/v0/items/B%2F04/offers' } })).toBe('B/04');
    });

    it('returns empty rather than guessing', () => {
        expect(asinOfResponse({})).toBe('');
        expect(asinOfResponse({ request: { uri: '/something/else' } })).toBe('');
    });
});

describe('batch size', () => {
    it('matches Amazon\'s documented maximum', () => {
        // Exceeding it is a 400 for the whole batch, losing all twenty ASINs.
        expect(MAX_ASINS_PER_BATCH).toBe(20);
    });
});
