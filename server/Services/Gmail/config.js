/**
 * config.js — Gmail integration configuration.
 *
 * Mirrors Services/Zoho/config.js: credentials from the environment, the refresh token
 * in Mongo (models/system/GmailConnectionModel.js), everything read lazily so a missing
 * variable surfaces at call time with a name rather than baking `undefined` into a
 * module-load-time object.
 *
 * Required in .env:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REDIRECT_URI       must match the Authorized redirect URI in the Google Cloud
 *                            console EXACTLY, e.g.
 *                            https://members.sellerqi.com/api/gmail/auth/callback
 *   GMAIL_INBOX_ADDRESS      the shared ESF inbox, e.g. hello@estorefactory.com
 *
 * Required for push (Phase 3), optional otherwise:
 *   GMAIL_PUBSUB_TOPIC              projects/<project>/topics/<topic>
 *   GMAIL_PUBSUB_AUDIENCE           the push subscription's OIDC audience
 *   GMAIL_PUBSUB_SERVICE_ACCOUNT    the service account email allowed to push
 *
 * Optional:
 *   GMAIL_MESSAGING_ENABLED         'true' to run ingestion; default OFF
 *   GMAIL_POLL_MINUTES              default 10
 *
 * ── WHY A SEPARATE OAUTH CLIENT FROM GOOGLE SIGN-IN ──
 * NOT `GOOGLE_CLIENT_ID`. `gmail.modify` is a *restricted* scope: adding it to the
 * client that powers Google sign-in would drag the entire sign-in flow into
 * restricted-scope verification, and a verification problem would then take login down
 * with it. Two clients, two blast radii.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONE-TIME GOOGLE CLOUD SETUP
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. A NEW OAuth 2.0 Client ID (Web application), separate from Google sign-in for the
 *    reason above. Authorized redirect URI exactly:
 *        https://members.sellerqi.com/api/gmail/auth/callback
 *
 * 2. PUBLISHING STATUS MUST BE "IN PRODUCTION", not "Testing" — even unverified.
 *
 *    This is the one with a deadline. In "Testing", Google expires refresh tokens
 *    after SEVEN DAYS. The integration works perfectly for a week and then dies with
 *    `invalid_grant`, which reads like a revoked credential rather than a setting
 *    nobody touched. GmailAuth.mapTokenError says so explicitly, but avoiding it is
 *    far cheaper than diagnosing it. Start verification early — it is wall-clock time,
 *    not work, and nothing else here is blocked on it.
 *
 * 3. Pub/Sub:
 *        gcloud pubsub topics create gmail-inbox
 *
 *        # THE STEP THAT IS ALWAYS MISSED. Without it users.watch fails with an
 *        # error pointing nowhere near Pub/Sub.
 *        gcloud pubsub topics add-iam-policy-binding gmail-inbox \
 *          --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
 *          --role=roles/pubsub.publisher
 *
 *        gcloud pubsub subscriptions create gmail-inbox-push \
 *          --topic=gmail-inbox \
 *          --push-endpoint=https://members.sellerqi.com/api/gmail/pubsub/push \
 *          --push-auth-service-account=<push-sa>@<project>.iam.gserviceaccount.com \
 *          --push-auth-token-audience=https://members.sellerqi.com/api/gmail/pubsub/push
 *
 *    The push auth service account is not optional, and GMAIL_PUBSUB_SERVICE_ACCOUNT
 *    must match it. See Services/Gmail/pubsubVerifier.js for why a valid signature
 *    alone proves nothing.
 *
 * ── TURNING IT ON ──
 * Deploy with GMAIL_MESSAGING_ENABLED=false. Sign in as owner/admin, GET
 * /api/gmail/auth/url, consent AS THE SHARED INBOX. Check /api/gmail/status shows
 * `connected: true` with the right `inbox`. Set the flag true and restart — polling
 * begins. POST /api/gmail/watch to start push. Then email the inbox from a linked
 * client's address and confirm the thread appears on both Messages pages, labelled by
 * project, with no name, address or phone anywhere.
 *
 * EIGHT DAYS LATER, confirm /api/gmail/status still shows no lastError. That is the
 * Testing-mode expiry above, and it is the one failure that looks like success until
 * it suddenly doesn't.
 *
 * ── ROLLBACK ──
 * GMAIL_MESSAGING_ENABLED=false stops ingestion and sending; nothing is deleted and
 * the connection survives. To stop the crons entirely, remove setupGmailInboxCron()
 * from cronProducerStandalone.js. DELETE /api/gmail/disconnect forgets the credential
 * and revokes at Google, leaving stored conversations untouched.
 */

/**
 * `gmail.modify` — a superset of readonly + send + insert.
 *
 * `insert` is the reason a narrower scope will not do: it is what puts a client's
 * portal reply into the Gmail thread without actually mailing anyone, so Gmail stays
 * the complete record of the conversation. `gmail.send` alone cannot do that, and
 * sending it instead would email our own inbox from itself.
 *
 * Changing this list invalidates the existing grant — Google requires fresh consent for
 * a widened scope, so a reconnect is mandatory after any edit here.
 */
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://gmail.googleapis.com/gmail/v1';

const getCredentials = () => ({
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI,
    inboxAddress: (process.env.GMAIL_INBOX_ADDRESS || '').trim().toLowerCase(),
});

const getPubSubConfig = () => ({
    topicName: process.env.GMAIL_PUBSUB_TOPIC,
    audience: process.env.GMAIL_PUBSUB_AUDIENCE,
    serviceAccount: (process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT || '').trim().toLowerCase(),
});

/**
 * Master switch. Default OFF so the code can ship, and be deployed, before the Google
 * Cloud project exists — nothing polls, nothing watches, and the pages render empty
 * rather than erroring.
 */
const isMessagingEnabled = () => process.env.GMAIL_MESSAGING_ENABLED === 'true';

/** All paths are relative to the authenticated user, which is always the shared inbox. */
const PATHS = {
    profile: () => '/users/me/profile',
    watch: () => '/users/me/watch',
    stopWatch: () => '/users/me/stop',
    history: () => '/users/me/history',
    messages: () => '/users/me/messages',
    message: (id) => `/users/me/messages/${id}`,
    attachment: (messageId, attachmentId) =>
        `/users/me/messages/${messageId}/attachments/${attachmentId}`,
    send: () => '/users/me/messages/send',
    // insert is a plain POST to the collection, distinct from /send — it files a message
    // into the mailbox without transmitting it.
    insert: () => '/users/me/messages',
};

/**
 * Labels the watch subscribes to.
 *
 * `SENT` is here deliberately and is not optional. A reply the admin sends from Gmail is
 * labelled SENT, never INBOX, so an INBOX-only watch fires no notification for it — the
 * message would surface only on the next poll, leaving the staff inbox showing "Needs a
 * reply" for up to GMAIL_POLL_MINUTES after it was answered. See inboundRouting.js.
 */
const WATCH_LABEL_IDS = ['INBOX', 'SENT'];

/**
 * Header stamped on anything we write into Gmail ourselves.
 *
 * Both portal paths put a message INTO the mailbox — the client's reply by insert, the
 * staff reply by send — and both come back through the watch looking like new mail.
 * This is the first of two echo guards; the second is Message-ID reconciliation.
 */
const ORIGIN_HEADER = 'X-SellerQI-Origin';

/** Gmail's own cap on a history page. */
const HISTORY_PAGE_SIZE = 500;

/**
 * How far one sync run will walk before stopping and leaving the rest for the next.
 *
 * Bounded because a mailbox that has been disconnected for a week returns a very long
 * history, and an unbounded walk inside one job would hold the cursor — a single
 * serialised value — for as long as it took.
 */
const MAX_HISTORY_PAGES_PER_RUN = 20;

/** Bodies above this are stored truncated; the full text stays in Gmail. */
const MAX_BODY_CHARS = 20000;

const REQUEST_TIMEOUT_MS = 20000;
const TOKEN_REQUEST_TIMEOUT_MS = 15000;

const getPollMinutes = () => {
    const raw = Number(process.env.GMAIL_POLL_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
};

module.exports = {
    getCredentials,
    getPubSubConfig,
    isMessagingEnabled,
    getPollMinutes,
    SCOPES,
    AUTH_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    API_BASE,
    PATHS,
    WATCH_LABEL_IDS,
    ORIGIN_HEADER,
    HISTORY_PAGE_SIZE,
    MAX_HISTORY_PAGES_PER_RUN,
    MAX_BODY_CHARS,
    REQUEST_TIMEOUT_MS,
    TOKEN_REQUEST_TIMEOUT_MS,
};
