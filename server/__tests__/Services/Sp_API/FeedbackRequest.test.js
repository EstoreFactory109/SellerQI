/**
 * Amazon's "update your feedback" message: sent only when Amazon lists it as allowed
 * for the order (it is allowed once per order).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('axios', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: async () => ({ sellerAccount: [{ country: 'US', region: 'NA', spiRefreshToken: 'r' }] }) }) })
}));
jest.mock('../../../Services/Sp_API/GenerateTokens.js', () => ({ generateAccessToken: async () => 'tok' }));
jest.mock('../../../controllers/config/config.js', () => ({ URIs: { NA: 'https://sellingpartnerapi-na.amazon.com' }, marketplaceConfig: { US: 'ATVPDKIKX0DER' } }));
const { requestFeedbackUpdate } = require('../../../Services/Sp_API/FeedbackRequest.js');

describe('requestFeedbackUpdate', () => {
    it('sends the empty updateFeedback message when Amazon allows it', async () => {
        mockGet.mockResolvedValue({ data: { _links: { actions: [{ name: 'updateFeedback' }, { name: 'sendInvoice' }] } } });
        mockPost.mockResolvedValue({ data: {} });
        await expect(requestFeedbackUpdate({ userId: 'u', country: 'US', region: 'NA', orderId: '114-1' })).resolves.toEqual({ orderId: '114-1', sent: true });
        expect(mockPost).toHaveBeenCalledWith(
            'https://sellingpartnerapi-na.amazon.com/messaging/v1/orders/114-1/messages/updateFeedback?marketplaceIds=ATVPDKIKX0DER',
            {}, expect.objectContaining({ headers: expect.objectContaining({ 'x-amz-access-token': 'tok' }) }));
    });

    it('sends nothing when Amazon no longer offers it', async () => {
        mockGet.mockResolvedValue({ data: { _links: { actions: [{ name: 'sendInvoice' }] } } });
        await expect(requestFeedbackUpdate({ userId: 'u', country: 'US', region: 'NA', orderId: '114-1' })).rejects.toThrow('nothing was sent');
        expect(mockPost).not.toHaveBeenCalled();
    });
});
