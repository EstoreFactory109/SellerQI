/**
 * EsfUntappedController.js — GET /api/pagewise/esf/untapped
 *
 * The client's "Untapped" page: opportunities the agency has spotted but nobody has
 * started. Written in Zoho, pulled in by the nightly sync, served from Mongo.
 *
 * ── A PLAIN DATABASE READ, LIKE THE STATUS PAGE ──
 * No Zoho call happens in this request path and none should be added. The parsing this
 * data needs can reach OpenAI, which is exactly why it runs on the 24h tick and not
 * here — a page load must not wait on two third parties.
 *
 * ── AN EMPTY PAGE IS A REAL ANSWER ──
 * Three different nothings reach the client as different states, because they need
 * different words: not linked to a Zoho project at all, linked with no Untapped
 * tasklist written yet, and linked with a tasklist we could not read. Collapsing them
 * into one blank page is what makes a working feature look broken.
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const UserModel = require('../../models/user-auth/userModel.js');
const EsfUntapped = require('../../models/system/EsfUntappedModel.js');
const logger = require('../../utils/Logger.js');

/**
 * What one opportunity looks like on the wire.
 *
 * A projection rather than the raw row, following toClientTask on the Status page: the
 * client has no use for `taskId`/`parentTaskId`/`parsedBy` and those are our internal
 * handles on the Zoho record. `parsedBy` in particular is a diagnostic about our own
 * parser, and showing a client "we could not read this" would be telling them about a
 * problem that is ours to fix.
 */
const toClientOpportunity = (opportunity) => ({
    id: opportunity.taskId,
    title: opportunity.title,
    body: opportunity.body || '',
    amount: typeof opportunity.amount === 'number' ? opportunity.amount : null,
    period: opportunity.period || null,
    amountLabel: opportunity.amountLabel || null,
});

const empty = (extra = {}) => ({
    linked: false,
    projectName: null,
    within: [],
    off: [],
    totalAmount: 0,
    currencyCode: 'USD',
    syncedAt: null,
    ...extra,
});

const getEsfUntapped = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const user = await UserModel.findById(userId).select('zohoProject').lean();
        const projectId = user?.zohoProject?.projectId;

        if (!projectId) {
            return res.status(200).json(new ApiResponse(
                200, empty(), 'No Zoho project is linked to this account'
            ));
        }

        const doc = await EsfUntapped.findOne({ projectId }).lean();

        // Linked, but nothing written yet. `linked: true` with empty lists is what lets
        // the page say "nothing here yet" rather than "connect a project".
        if (!doc) {
            return res.status(200).json(new ApiResponse(200, empty({
                linked: true,
                projectName: user?.zohoProject?.projectName || null,
            }), 'No untapped opportunities have been published yet'));
        }

        const opportunities = doc.opportunities || [];
        const within = opportunities.filter((o) => o.section === 'within');
        const off = opportunities.filter((o) => o.section === 'off');

        /**
         * Summed here, not on the page.
         *
         * The hero used to be a hardcoded "$14,450/mo" that agreed with nothing. Adding
         * it up server-side from the same rows the cards render means the total and the
         * cards cannot disagree. Opportunities with no readable figure contribute 0 —
         * they still show, they just do not inflate the headline.
         */
        const totalAmount = opportunities.reduce((sum, o) => sum + (o.amount || 0), 0);

        return res.status(200).json(new ApiResponse(200, {
            linked: true,
            projectName: doc.projectName || user?.zohoProject?.projectName || null,
            within: within.map(toClientOpportunity),
            off: off.map(toClientOpportunity),
            totalAmount,
            currencyCode: doc.currencyCode || 'USD',
            // The page says "Updated 6 hours ago" from this. On something refreshed once
            // a day, that line is the difference between "empty" and "broken".
            syncedAt: doc.syncedAt || null,
        }, 'Untapped opportunities fetched successfully'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfUntapped] ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load your untapped opportunities'));
    }
});

module.exports = { getEsfUntapped };
