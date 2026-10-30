/**
 * Every change SellerQI can make on Amazon, by action type. A handler is:
 *
 *   actionType  'feature.verb'        feature   ads | listings | messaging | ...
 *   flag        env prefix for a new kind of change (see actionGates.js); none = always on
 *   idempotent  sending twice is harmless (a timeout may then be retried by the seller)
 *   validate(input, ctx)  -> clean input, or throws userError
 *   preview(input, ctx)   -> { title, target, lines:[{label,before,after}], warnings,
 *                              amazonIssues?, blocking?, payload, expected? }   (reads only)
 *   staleCheck(doc, ctx)  -> throws staleError if Amazon changed since the preview
 *   execute(payload, ctx) -> Amazon's answer, or { pending: true, amazon: {...} }
 *   poll(doc, ctx)        -> for pending changes
 *
 * A handler without validate/preview can only run from the Tasks page.
 */
const HANDLERS = new Map();

for (const mod of [
    require('./handlers/ads.js'),
    require('./handlers/adsCampaigns.js'),
    require('./handlers/listings.js'),
    require('./handlers/messaging.js')
]) {
    for (const handler of mod.handlers) {
        if (HANDLERS.has(handler.actionType)) throw new Error(`Duplicate action type ${handler.actionType}`);
        HANDLERS.set(handler.actionType, handler);
    }
}

const get = (actionType) => HANDLERS.get(actionType) || null;
const all = () => [...HANDLERS.values()];
const previewable = (handler) => !!(handler && typeof handler.preview === 'function');

module.exports = { get, all, previewable };
