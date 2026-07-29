const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { createLinkToken, verifyLinkToken } = require('../../utils/Tokens.js');
const WhatsAppLink = require('../../models/user-auth/WhatsAppLinkModel.js');
const QMateChat = require('../../models/ai/QMateChatModel.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { getUserLocation } = require('../../Services/User/UserLocationService.js');
const { QMateService } = require('../../Services/AI/QMateService.js');
const whatsappService = require('../../Services/WhatsApp/WhatsAppService.js');

// Single per-user chat document dedicated to the WhatsApp channel, so WhatsApp
// history stays separate from web chats while reusing the existing QMateChat
// collection unchanged.
const WHATSAPP_CHAT_TITLE = 'WhatsApp';
// Cap history fed back into the model to bound token usage.
const MAX_HISTORY_TURNS = 20;

/**
 * POST /api/whatsapp/mint-link-token  (auth required)
 * Mints a short-lived link token for the logged-in user and returns a wa.me
 * deep link the client can open. Sending the message from WhatsApp completes
 * the binding in the webhook.
 */
const mintLinkToken = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }

    const token = await createLinkToken(userId);
    if (!token) {
        return res.status(500).json(new ApiError(500, 'Failed to create link token.'));
    }

    const botNumber = whatsappService.normalizeNumber(
        process.env.META_WHATSAPP_DISPLAY_NUMBER || ''
    );
    const deepLink = botNumber
        ? `https://wa.me/${botNumber}?text=${encodeURIComponent(`LINK-${token}`)}`
        : null;

    return res.status(200).json(
        new ApiResponse(200, { token, deepLink, botNumber }, 'Link token created successfully')
    );
});

/**
 * Resolve or create the dedicated WhatsApp chat document for a user.
 */
async function getWhatsAppChat(userId) {
    let chat = await QMateChat.findOne({ User: userId, title: WHATSAPP_CHAT_TITLE });
    if (!chat) {
        chat = await QMateChat.create({ User: userId, title: WHATSAPP_CHAT_TITLE, messages: [] });
    }
    return chat;
}

/**
 * Handle the "switch to <marketplace>" command. Validates the requested token
 * against the user's connected Seller marketplaces and updates the active
 * country/region on the link doc. Returns a reply string.
 */
async function handleSwitchCommand(link, argument) {
    const arg = (argument || '').trim().toLowerCase();
    const sellerDoc = await Seller.findOne({ User: link.userId }).sort({ createdAt: -1 });
    const accounts = (sellerDoc && Array.isArray(sellerDoc.sellerAccount)) ? sellerDoc.sellerAccount : [];
    const marketplaces = accounts.filter((a) => a && a.country && a.region);

    if (marketplaces.length === 0) {
        return 'No connected marketplaces were found on your account.';
    }

    if (!arg) {
        const list = marketplaces
            .map((m) => `• ${m.country} (${m.region})`)
            .join('\n');
        return `Which marketplace? Reply "switch to <name>". Available:\n${list}`;
    }

    const match = marketplaces.find((m) =>
        (m.country && m.country.toLowerCase().includes(arg)) ||
        (m.countryCode && m.countryCode.toLowerCase() === arg) ||
        (m.region && m.region.toLowerCase() === arg)
    );

    if (!match) {
        const list = marketplaces.map((m) => `• ${m.country} (${m.region})`).join('\n');
        return `Couldn't find a marketplace matching "${argument}". Available:\n${list}`;
    }

    link.activeCountry = match.country;
    link.activeRegion = match.region;
    await link.save();
    return `✅ Switched to ${match.country} (${match.region}). Ask me anything about this marketplace.`;
}

/**
 * The core inbound processing, run after the webhook has been acknowledged.
 * Sends replies to the user via the active WhatsApp provider. Never throws to the caller.
 */
async function processInbound({ from, text }) {
    try {
        // 1) Linking branch — "LINK-<token>"
        const linkMatch = /^LINK-(.+)$/i.exec(text.trim());
        if (linkMatch) {
            const verified = await verifyLinkToken(linkMatch[1].trim());
            if (!verified || !verified.isvalid) {
                await whatsappService.sendMessage(
                    from,
                    'That connection link is invalid or has expired. Please open SellerQI → Settings → Account Integrations → Connect WhatsApp to get a fresh link.'
                );
                return;
            }

            const user = await User.findById(verified.userId).select('email firstName');
            if (!user) {
                await whatsappService.sendMessage(from, 'We could not find your SellerQI account. Please try connecting again.');
                return;
            }

            const loc = await getUserLocation(verified.userId);
            await WhatsAppLink.findOneAndUpdate(
                { whatsappNumber: from },
                {
                    userId: verified.userId,
                    whatsappNumber: from,
                    verifiedAt: new Date(),
                    activeCountry: loc.country || undefined,
                    activeRegion: loc.region || undefined,
                    status: 'active',
                    lastMessageAt: new Date(),
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            const where = loc.country ? ` Your active marketplace is ${loc.country}${loc.region ? ` (${loc.region})` : ''}.` : '';
            await whatsappService.sendMessage(
                from,
                `✅ Connected as ${user.email}.${where}\n\nAsk me anything about your Amazon business. Type "switch to <marketplace>" to change marketplace, or "unlink" to disconnect.`
            );
            return;
        }

        // 2) Identity gate — must be a linked, active number
        const link = await WhatsAppLink.findOne({ whatsappNumber: from, status: 'active' });
        if (!link) {
            await whatsappService.sendMessage(
                from,
                "You're not connected yet. Open SellerQI → Settings → Account Integrations → Connect WhatsApp to link your account."
            );
            return;
        }

        link.lastMessageAt = new Date();

        // 3) Command branch — unlink / switch
        const lower = text.trim().toLowerCase();
        if (lower === 'unlink' || lower === 'logout' || lower === 'disconnect') {
            link.status = 'unlinked';
            await link.save();
            await whatsappService.sendMessage(
                from,
                'You have been disconnected. Connect again anytime from SellerQI → Settings → Account Integrations.'
            );
            return;
        }
        const switchMatch = /^switch(?:\s+to)?(?:\s+region)?\s*(.*)$/i.exec(text.trim());
        if (switchMatch && lower.startsWith('switch')) {
            const reply = await handleSwitchCommand(link, switchMatch[1]);
            await whatsappService.sendMessage(from, reply);
            return;
        }

        // 4) Chat branch — resolve marketplace and ask QMate
        let country = link.activeCountry;
        let region = link.activeRegion;
        if (!country || !region) {
            const loc = await getUserLocation(link.userId);
            country = country || loc.country;
            region = region || loc.region;
            if (loc.country && !link.activeCountry) link.activeCountry = loc.country;
            if (loc.region && !link.activeRegion) link.activeRegion = loc.region;
        }

        if (!country || !region) {
            await link.save();
            await whatsappService.sendMessage(
                from,
                "I couldn't determine your marketplace. Please connect an Amazon account in SellerQI first, then try again."
            );
            return;
        }

        const chat = await getWhatsAppChat(link.userId);
        const chatHistory = (chat.messages || [])
            .slice(-MAX_HISTORY_TURNS)
            .map((m) => ({ role: m.role, content: m.content || '' }));

        const result = await QMateService.generateResponseOptimized({
            userId: link.userId,
            country,
            region,
            question: text.trim(),
            chatHistory,
            conversationContext: chat.conversationContext || {},
        });

        const answer =
            (result && result.answer_markdown) ||
            'Sorry, I was unable to generate a response. Please try again.';
        const outbound = whatsappService.flattenMarkdown(answer);

        await whatsappService.sendMessage(from, outbound);

        // 5) Persist the turn (reuse existing QMateChat shape)
        chat.messages.push({ role: 'user', content: text.trim(), charts: [], followUps: [] });
        chat.messages.push({ role: 'assistant', content: answer, charts: [], followUps: [] });
        if (result && result.conversationContext && typeof result.conversationContext === 'object') {
            chat.conversationContext = result.conversationContext;
        }
        await chat.save();
        await link.save();
    } catch (error) {
        logger.error('[WhatsApp] Error processing inbound message:', error);
        try {
            await whatsappService.sendMessage(
                from,
                'Something went wrong on our end. Please try again in a moment.'
            );
        } catch (sendErr) {
            logger.error('[WhatsApp] Failed to send error reply:', sendErr);
        }
    }
}

/**
 * GET /api/whatsapp/webhook  (Meta verification handshake)
 * Meta calls this once when you set/verify the callback URL. Echo back
 * hub.challenge when hub.mode=subscribe and hub.verify_token matches our
 * configured token; otherwise 403.
 */
const verifyWebhook = asyncHandler(async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
        logger.info('[WhatsApp] Meta webhook verification succeeded');
        return res.status(200).send(String(challenge != null ? challenge : ''));
    }
    logger.warn('[WhatsApp] Meta webhook verification failed (mode/token mismatch)');
    return res.status(403).send('Forbidden');
});

/**
 * POST /api/whatsapp/webhook  (no auth middleware — verified by Meta signature)
 * Mounted with express.raw, so req.body is a Buffer. We verify Meta's
 * X-Hub-Signature-256 over the raw body, ACK 200 immediately, then process the
 * message asynchronously (QMate answers can take several seconds).
 */
const handleWebhook = asyncHandler(async (req, res) => {
    const rawBody = req.body; // Buffer (express.raw)
    const signature = req.headers['x-hub-signature-256'];

    // Authenticate via Meta's HMAC-SHA256 signature (App Secret).
    if (process.env.META_APP_SECRET) {
        const valid = whatsappService.verifyInboundSignature(rawBody, signature);
        if (!valid) {
            logger.warn('[WhatsApp] Rejected webhook with invalid X-Hub-Signature-256');
            return res.status(401).json(new ApiResponse(401, null, 'Invalid signature'));
        }
    } else if (process.env.NODE_ENV === 'production') {
        // Fail closed in production if the App Secret is not configured.
        logger.error('[WhatsApp] META_APP_SECRET not configured — rejecting webhook in production');
        return res.status(401).json(new ApiResponse(401, null, 'Webhook not configured'));
    } else {
        logger.warn('[WhatsApp] META_APP_SECRET not set — skipping signature check (non-production)');
    }

    // Parse the (verified) raw body.
    let payload;
    try {
        payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}'));
    } catch (e) {
        logger.warn('[WhatsApp] Webhook body was not valid JSON');
        return res.status(200).json(new ApiResponse(200, null, 'ignored'));
    }

    const parsed = whatsappService.parseInboundMessage(payload);

    // ACK immediately so Meta doesn't retry; process asynchronously.
    res.status(200).json(new ApiResponse(200, null, 'received'));

    if (parsed) {
        // Fire-and-forget; processInbound handles its own errors.
        processInbound(parsed);
    }
});

module.exports = {
    mintLinkToken,
    verifyWebhook,
    handleWebhook,
};
