/**
 * Buyer messages (SP-API Messaging). Amazon decides per order which messages are
 * allowed; a message is never resent automatically.
 */
const { userError } = require('../errors.js');

const requestFeedback = {
    actionType: 'messaging.request_feedback',
    feature: 'messaging',
    idempotent: false,
    validate(input) {
        const orderId = String(input?.orderId || '').trim();
        if (!orderId) throw userError('Choose the order.');
        return { orderId };
    },
    async preview(input) {
        return {
            title: 'Ask the buyer to update their feedback',
            target: `Order ${input.orderId}`,
            lines: [{ label: 'Message', before: '', after: "Amazon's standard \"please update your feedback\" message (Amazon writes it; once per order)" }],
            warnings: ['Best sent after you have resolved the buyer\'s problem.'],
            payload: input
        };
    },
    async execute(payload, ctx) {
        const { requestFeedbackUpdate } = require('../../Sp_API/FeedbackRequest.js');
        return requestFeedbackUpdate({ userId: ctx.userId, country: ctx.country, region: ctx.region, orderId: payload.orderId });
    }
};

module.exports = { handlers: [requestFeedback] };
