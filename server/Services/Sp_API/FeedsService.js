/**
 * SP-API Feeds (2021-06-30): bulk listing changes as one JSON_LISTINGS_FEED.
 *   createFeedDocument -> upload the JSON -> createFeed -> (Amazon processes) ->
 *   getFeed until DONE -> the result document lists each message's outcome.
 * Used only after the seller approved the change (Services/Actions/handlers/feeds.js).
 */
const axios = require('axios');
const zlib = require('zlib');

const CONTENT_TYPE = 'application/json; charset=UTF-8';
const TIMEOUT_MS = 60000;
const auth = (accessToken) => ({ 'x-amz-access-token': accessToken });

/** Pure: a JSON_LISTINGS_FEED document. */
function buildListingsFeed({ sellerId, messages, issueLocale = 'en_US' }) {
    return {
        header: { sellerId, version: '2.0', issueLocale },
        messages: messages.map((m, i) => ({ messageId: i + 1, sku: m.sku, operationType: 'PATCH', productType: m.productType || 'PRODUCT', patches: m.patches }))
    };
}

async function submitListingsFeed({ accessToken, host, marketplaceId, feed }) {
    const doc = await axios.post(`${host}/feeds/2021-06-30/documents`, { contentType: CONTENT_TYPE }, { headers: { ...auth(accessToken), 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
    const { feedDocumentId, url } = doc.data || {};
    if (!feedDocumentId || !url) throw new Error('Amazon did not give an upload location for the feed.');
    // The upload URL is presigned: no SP-API token on this request.
    await axios.put(url, JSON.stringify(feed), { headers: { 'Content-Type': CONTENT_TYPE }, timeout: TIMEOUT_MS, maxBodyLength: Infinity });
    const created = await axios.post(`${host}/feeds/2021-06-30/feeds`, { feedType: 'JSON_LISTINGS_FEED', marketplaceIds: [marketplaceId], inputFeedDocumentId: feedDocumentId },
        { headers: { ...auth(accessToken), 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
    if (!created.data?.feedId) throw new Error('Amazon did not accept the feed.');
    return { feedId: String(created.data.feedId), feedDocumentId };
}

async function getFeed({ accessToken, host, feedId }) {
    const res = await axios.get(`${host}/feeds/2021-06-30/feeds/${encodeURIComponent(feedId)}`, { headers: auth(accessToken), timeout: TIMEOUT_MS });
    return res.data || {};
}

async function cancelFeed({ accessToken, host, feedId }) {
    await axios.delete(`${host}/feeds/2021-06-30/feeds/${encodeURIComponent(feedId)}`, { headers: auth(accessToken), timeout: TIMEOUT_MS });
    return { feedId, cancelled: true };
}

/** The result document: { summary, issues:[{messageId, code, message, severity}] }. */
async function getFeedResult({ accessToken, host, resultFeedDocumentId }) {
    const doc = await axios.get(`${host}/feeds/2021-06-30/documents/${encodeURIComponent(resultFeedDocumentId)}`, { headers: auth(accessToken), timeout: TIMEOUT_MS });
    const file = await axios.get(doc.data.url, { responseType: 'arraybuffer', timeout: TIMEOUT_MS });
    const raw = doc.data.compressionAlgorithm === 'GZIP' ? zlib.gunzipSync(Buffer.from(file.data)) : Buffer.from(file.data);
    return JSON.parse(raw.toString('utf8'));
}

/** Pure: per-SKU outcome from the result document. */
function summarizeFeedResult(result, messages) {
    const bySku = new Map(messages.map((m, i) => [i + 1, m.sku]));
    const errors = [];
    for (const issue of result?.issues || []) {
        if (issue.severity !== 'ERROR') continue;
        errors.push({ sku: bySku.get(Number(issue.messageId)) || null, message: issue.message || issue.code });
    }
    const failedSkus = new Set(errors.map((e) => e.sku));
    return {
        accepted: Number(result?.summary?.messagesAccepted ?? (messages.length - failedSkus.size)),
        invalid: Number(result?.summary?.messagesInvalid ?? failedSkus.size),
        errors: errors.slice(0, 200)
    };
}

module.exports = { buildListingsFeed, submitListingsFeed, getFeed, cancelFeed, getFeedResult, summarizeFeedResult, CONTENT_TYPE };
