/**
 * UntappedParserService.js — a Zoho subtask description into a priced opportunity.
 *
 * The agency writes each untapped opportunity as a subtask in Zoho, with the money and
 * the explanation inside the description in a loose house format:
 *
 *     Price: $3,600/month estimated upside
 *
 *     Description: People search "Kessler kitchen scale" about 2,900 times a month …
 *
 * ── THE FORMAT IS LOOSER THAN IT LOOKS ──
 * That block is typed by hand into Zoho's rich-text editor, so what arrives is HTML with
 * the figure split across styling spans, and the four live examples this was written
 * against already disagree with each other:
 *
 *     "Price:&nbsp; $2,100"      two spaces after the colon
 *     "​Description: …"           a zero-width space (U+200B) glued to the front
 *     "​Description : …"          a space BEFORE the colon
 *
 * A strict `/^Description: /` matches three of the four and silently drops the fourth,
 * which is why the patterns below are deliberately slack about whitespace and why
 * `clean()` strips zero-width characters before anything else looks at the text.
 *
 * ── DETERMINISTIC FIRST, MODEL ONLY WHEN THAT FAILS ──
 * The regex path is tried first and its result is never sent to the model for
 * improvement. These are the agency's own words about a client's business, and a rewrite
 * that reads better while quietly changing "2,900 times a month" is worse than no
 * rewrite. The model runs only when the pattern finds nothing — a description written in
 * some other shape — and even then it extracts, it does not compose.
 *
 * ── AND IT NEVER THROWS ──
 * Following every other service in this directory: no key, no model, bad JSON or an
 * unparseable body all end at the same place — an opportunity with `amount: null` and
 * whatever text we could recover. It still renders on the page, just without a figure.
 * Dropping it instead would hide work the agency had written down.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const { toPlainText } = require('../Zoho/zohoRichText.js');

const MODEL = process.env.UNTAPPED_PARSE_MODEL || 'gpt-4o-mini';
const PARSER_VERSION = 1;

/** Long enough for any real description, short enough to bound a bad payload. */
const MAX_INPUT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 600;

/** Currency symbols the agency actually uses. Anything else falls back to USD. */
const CURRENCY_BY_SYMBOL = { $: 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR', '¥': 'JPY' };

let client = null;
const getClient = () => {
    if (client) return client;
    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) return null;
    client = new OpenAI({ apiKey });
    return client;
};

/**
 * Zero-width characters are invisible in Zoho's editor and survive copy-paste, so they
 * end up in the middle of words no one can see. Stripped before any matching, because a
 * `\s` class does NOT match them — U+200B is not whitespace to a regex.
 */
const clean = (text) => String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

/**
 * Pull the money out of a price line like `$2,100/month estimated upside`.
 *
 * Returns nulls rather than throwing on a line with no figure in it — a "Price:" the
 * author left blank is missing data, not corrupt data.
 */
const parsePriceLine = (line) => {
    const match = /([$£€₹¥])\s*([\d,]+(?:\.\d+)?)/.exec(line || '');
    if (!match) return { amount: null, currencyCode: null, period: null, amountLabel: null };

    const amount = Number(match[2].replace(/,/g, ''));
    const rest = line.slice(match.index + match[0].length);

    // `/month`, `/mo`, `per month` — or nothing, which means a one-off.
    const periodMatch = /^\s*(?:\/|per\s+)\s*(month|mo|year|yr|week|wk)\b/i.exec(rest);
    const unit = periodMatch ? periodMatch[1].toLowerCase() : null;
    const period = unit ? ({ mo: 'month', yr: 'year', wk: 'week' }[unit] || unit) : 'once';

    const label = rest.slice(periodMatch ? periodMatch[0].length : 0).trim();

    return {
        amount: Number.isFinite(amount) ? amount : null,
        currencyCode: CURRENCY_BY_SYMBOL[match[1]] || 'USD',
        period,
        amountLabel: label || null,
    };
};

/**
 * The deterministic path. Returns null when the shape is not recognised at all, which is
 * the only thing that lets the model have a turn.
 */
const parsePattern = (text) => {
    // `[^\S\n]` rather than `\s` so the price line cannot swallow the following lines.
    const priceMatch = /(?:^|\n)[^\S\n]*price[^\S\n]*:?[^\S\n]*([^\n]*)/i.exec(text);
    const bodyMatch = /(?:^|\n)[^\S\n]*description[^\S\n]*:[^\S\n]*([\s\S]*)$/i.exec(text);

    if (!priceMatch && !bodyMatch) return null;

    const price = priceMatch
        ? parsePriceLine(priceMatch[1])
        : { amount: null, currencyCode: null, period: null, amountLabel: null };

    /**
     * With no "Description:" key, everything that is not the price line is the body.
     * Better than returning nothing: the author wrote prose, just without the header.
     */
    const body = bodyMatch
        ? bodyMatch[1].trim()
        : text.replace(priceMatch ? priceMatch[0] : '', '').trim();

    if (price.amount === null && !body) return null;

    return { ...price, body, parsedBy: 'pattern' };
};

const SYSTEM_PROMPT = [
    'You extract two things from an agency note about a sales opportunity: the money and the explanation.',
    '',
    'Rules:',
    '1. Copy the explanation VERBATIM from the note. Do not rewrite, summarise, shorten or improve it.',
    '2. amount is a plain number with no symbol or separators: "$3,600" is 3600.',
    '3. period is "month", "year", "week" or "once". Use "once" for a one-off figure.',
    '4. If the note has no figure at all, amount must be null. Never invent one.',
    '',
    'Answer with JSON only: {"amount": number|null, "currencyCode": str|null, "period": str|null, "amountLabel": str|null, "body": str}',
].join('\n');

const parseWithModel = async (text) => {
    const ai = getClient();
    if (!ai) return null;

    try {
        const completion = await ai.chat.completions.create({
            model: MODEL,
            // Extraction, not composition — the same setting the other extractors use.
            temperature: 0.1,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text.slice(0, MAX_INPUT_CHARS) },
            ],
        });

        const parsed = JSON.parse(completion?.choices?.[0]?.message?.content || 'null');
        if (!parsed || typeof parsed !== 'object') return null;

        // JSON mode guarantees valid JSON, never the right shape. Each field is checked.
        const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)
            ? parsed.amount
            : null;
        const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
        if (amount === null && !body) return null;

        return {
            amount,
            currencyCode: typeof parsed.currencyCode === 'string' ? parsed.currencyCode : 'USD',
            period: typeof parsed.period === 'string' ? parsed.period : null,
            amountLabel: typeof parsed.amountLabel === 'string' ? parsed.amountLabel : null,
            body,
            parsedBy: 'ai',
        };
    } catch (error) {
        // The message only — the OpenAI SDK puts the whole request body into its error on
        // a 4xx, and Logger.js writes unrotated to logs.txt.
        logger.warn(`[UntappedParser] model call failed: ${error.message?.slice(0, 200)}`);
        return null;
    }
};

/**
 * @param {string} html the subtask's Zoho description
 * @returns {{amount:number|null, currencyCode:string|null, period:string|null,
 *            amountLabel:string|null, body:string, parsedBy:'pattern'|'ai'|'none'}}
 */
const parseOpportunity = async (html) => {
    const text = clean(toPlainText(html));

    const byPattern = text ? parsePattern(text) : null;
    if (byPattern) return byPattern;

    const byModel = text ? await parseWithModel(text) : null;
    if (byModel) return byModel;

    // Everything failed. Keep the text so the card still says something.
    return {
        amount: null,
        currencyCode: null,
        period: null,
        amountLabel: null,
        body: text,
        parsedBy: 'none',
    };
};

module.exports = {
    parseOpportunity,
    parsePattern,
    parsePriceLine,
    clean,
    PARSER_VERSION,
};
