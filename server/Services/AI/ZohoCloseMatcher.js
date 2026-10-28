/**
 * ZohoCloseMatcher.js — which of a client's open SellerQI tasks did this closed Zoho task fix?
 *
 * For ESF clients added by staff: the team works from its own Zoho tasks ("Fix A+ content for
 * the blue and red mugs"), and when one closes, the SellerQI tasks it covers should be marked
 * done. A wrong match marks a task done that nobody fixed, so:
 *   1. a cheap shortlist first — only tasks that share a real thing with the Zoho task (an
 *      ASIN/SKU, a product word, or the kind of problem); no shortlist, no AI call
 *   2. only ids we offered count; several may match (one Zoho task often covers several)
 *   3. only "high" confidence counts; the prompt is biased against matching
 *   4. no key, a dead endpoint or junk means no match
 * Never throws.
 */
const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');

const MODEL = process.env.ZOHO_CLOSE_MATCH_MODEL || 'gpt-4o-mini';
const MAX_OFFERED = 20;

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey, timeout: 20000, maxRetries: 1 });
    return client;
};

const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'our', 'all', 'new', 'fix', 'fixed', 'task', 'update', 'updated', 'done', 'product', 'products', 'listing', 'listings', 'amazon', 'seller', 'central', 'please', 'check']);
const words = (s) => new Set(plain(s).toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** The kind of problem, as words a team member would write in a Zoho task. */
const KIND_WORDS = [
    { re: /\ba\+|aplus|a plus|enhanced brand content|ebc\b/i, cat: 'conversion', type: /aplus/ },
    { re: /\bbrand story\b/i, cat: 'conversion', type: /brand_story/ },
    { re: /\bimage|photo|picture|main image\b/i, cat: 'conversion', type: /image/ },
    { re: /\bvideo\b/i, cat: 'conversion', type: /video/ },
    { re: /\bbuy ?box|featured offer\b/i, cat: 'conversion', type: /buybox|featured_offer/ },
    { re: /\breview|rating\b/i, cat: 'conversion', type: /rating|review/ },
    { re: /\btitle\b/i, cat: 'ranking', type: /^titleresult_/ },
    { re: /\bbullet/i, cat: 'ranking', type: /^bulletpoints_/ },
    { re: /\bdescription\b/i, cat: 'ranking', type: /^description_/ },
    { re: /\bbackend|search terms?|keywords?\b/i, cat: null, type: /backend_keywords|keyword|search_term/ },
    { re: /\bacos|campaign|ppc|ads?\b|advertis/i, cat: 'sponsoredAds', type: /./ },
    { re: /\bprice|pricing|margin|profit|cogs\b/i, cat: 'profitability', type: /./ },
    { re: /\bstock|restock|replenish|inventory|fba shipment|inbound\b/i, cat: 'inventory', type: /stock|replenish|inbound|weeks_of_cover/ },
    { re: /\bsuppress|stranded|listing (error|warning)|compliance\b/i, cat: null, type: /suppress|stranded|listing_(errors|warnings)|compliance/ },
    { re: /\bodr|order defect|late shipment|cancellation|tracking|account health|policy\b/i, cat: 'account', type: /./ },
];

/**
 * Open tasks that share a real thing with the Zoho task, best first.
 * @param {{ name: string, description?: string, comments?: Array<{ content: string }> }} zohoTask
 * @param {Array} tasks  open TaskItems (rendered: error text present)
 */
function shortlist(zohoTask, tasks) {
    const text = [zohoTask.name, zohoTask.description, ...(zohoTask.comments || []).slice(-5).map((c) => c.content)].map(plain).join(' ');
    const lower = text.toLowerCase();
    const zWords = words(text);
    const kinds = KIND_WORDS.filter((k) => k.re.test(text));
    const scored = [];
    for (const t of tasks) {
        let score = 0;
        const asin = String(t.asin || '');
        if (/^B0[0-9A-Z]{8}$/i.test(asin) && lower.includes(asin.toLowerCase())) score += 10;
        const sku = t.renderData?.sku || t.renderData?.skus?.[0]?.sku;
        if (sku && lower.includes(String(sku).toLowerCase())) score += 10;
        const productHits = [...words(t.productName)].filter((w) => zWords.has(w)).length;
        score += Math.min(productHits, 3) * 2;
        const kindHit = kinds.some((k) => (!k.cat || k.cat === t.errorCategory) && k.type.test(String(t.errorType)));
        if (kindHit) score += 3;
        // A kind alone is too weak for product-level tasks (every A+ task would qualify);
        // account-level tasks have no product, so for them the kind is the thing.
        const productLevel = asin && asin !== 'ACCOUNT';
        if ((productLevel && (score >= 5 || (kindHit && productHits > 0))) || (!productLevel && kindHit)) {
            scored.push({ t, score });
        }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_OFFERED).map((x) => x.t);
}

const SYSTEM_PROMPT = [
    'An Amazon seller\'s agency has just CLOSED one of its tasks. Below are the seller\'s open issues from SellerQI.',
    'List the issues this closed task clearly fixed: the same fix, on the same product (or the same account setting).',
    'A closed task can fix several issues (e.g. "A+ content for the blue and red mugs" fixes the A+ issue on both mugs).',
    'Do NOT match an issue just because it is the same kind of problem on a different product, or a different problem on the same product.',
    'When unsure, leave it out — marking an unfixed issue as done misleads the seller.',
    'Reply as JSON: {"matches":[{"issue":"<issue key>","confidence":"high"|"medium"|"low","reason":"<short>"}]}.',
].join(' ');

/**
 * @returns {Promise<Array<{ taskId: string, reason: string }>>} high-confidence matches only
 */
async function matchClosedTask(zohoTask, candidates) {
    if (!candidates?.length) return [];
    const ai = getClient();
    if (!ai) return [];
    const offered = new Map(candidates.map((t) => [String(t.taskId), t]));
    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            temperature: 0,
            max_tokens: 700,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        `Closed agency task: ${plain(zohoTask.name)}`,
                        zohoTask.description ? `Description: ${plain(zohoTask.description).slice(0, 600)}` : null,
                        ...(zohoTask.comments || []).slice(-3).map((c) => `Comment: ${plain(c.content).slice(0, 300)}`),
                        '',
                        'Seller\'s open issues:',
                        ...candidates.map((t) => `- ${t.taskId}: ${plain(t.error).slice(0, 220)}${t.productName ? ` [product: ${t.productName}${t.asin ? `, ${t.asin}` : ''}]` : ''}`),
                    ].filter((l) => l !== null).join('\n'),
                },
            ],
        });
        const parsed = JSON.parse(completion?.choices?.[0]?.message?.content || 'null');
        const out = [];
        const seen = new Set();
        for (const m of Array.isArray(parsed?.matches) ? parsed.matches : []) {
            const id = String(m?.issue ?? '');
            if (m?.confidence !== 'high' || !offered.has(id) || seen.has(id)) continue;
            seen.add(id);
            out.push({ taskId: id, reason: String(m.reason || '').slice(0, 200) });
        }
        return out;
    } catch (error) {
        logger.warn(`[ZohoCloseMatcher] model call failed: ${String(error.message).slice(0, 200)}`);
        return [];
    }
}

module.exports = { shortlist, matchClosedTask, _reset: () => { client = null; } };
