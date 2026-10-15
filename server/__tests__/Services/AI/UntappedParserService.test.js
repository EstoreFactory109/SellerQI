/**
 * UntappedParserService — reading a price and an explanation out of a Zoho description.
 *
 * The two fixtures below are REAL, captured verbatim from the live portal, because the
 * whole risk in this parser is that the house format is typed by hand and drifts. A
 * fixture someone wrote to match the regex would prove nothing.
 *
 * A_PLUS carries `Price:&nbsp; $2,100` — two spaces after the colon.
 * OUTSIDE_TRAFFIC carries `​Description :` — a zero-width space in front and a space
 * BEFORE the colon. That one is the reason the patterns are slack: a natural
 * `/^Description: /` matches the other three and silently drops this card.
 */

const {
    parseOpportunity, parsePattern, parsePriceLine, clean,
} = require('../../../Services/AI/UntappedParserService.js');

// Captured verbatim from the live Zoho portal on 2026-09-25.
const A_PLUS = "<div style=\"font-size:0.9285rem\"><div style=\"color:rgb(232, 234, 237); font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(20, 22, 26)\"><span style=\"font-weight:600; letter-spacing:-0.025em; line-height:1; color:rgb(255, 255, 255)\">Price:&nbsp; $2,100<span style=\"font-weight:500; color:rgb(138, 144, 153)\">/month&nbsp;</span></span><span style=\"font-size:11.5px; color:rgb(110, 116, 126)\">estimated upside</span><br/></div><p style=\"font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; background-color:rgb(20, 22, 26); margin:0px; font-size:13px; line-height:1.65; color:rgb(155, 161, 171)\"><br/>Description: These nine ASINs get 31,000 views a month between them and convert about 3 points below your listings that do have A+ modules. It is usually the last thing added when a catalogue grows quickly.<br/></p><div><br/></div></div>";

const OUTSIDE_TRAFFIC = "<div style=\"font-size:0.9285rem\"><div><span style=\"font-style:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(19, 23, 32); font-weight:600; letter-spacing:-0.025em; line-height:1; color:rgb(255, 255, 255)\">Price: $2,400<span style=\"font-weight:500; color:rgb(138, 144, 153)\">/month&nbsp;</span></span><span style=\"font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(19, 23, 32); font-size:11.5px; color:rgb(110, 116, 126)\">estimated upside</span><br/></div><div><br/></div><div><span style=\"font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(19, 23, 32); font-size:11.5px; color:rgb(110, 116, 126)\"><span style=\"font-size:0.9286rem\">\u200bDescription :</span>&nbsp;</span><span style=\"color:rgb(155, 161, 171); font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-align:left; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(19, 23, 32); float:none; display:inline !important\">Every sale you make right now comes from inside Amazon. Your unboxing photos do well on Pinterest for competitors in this category, and off-Amazon traffic also improves how your listings rank organically.</span><span style=\"font-style:normal; font-weight:400; letter-spacing:normal; orphans:2; text-indent:0px; text-transform:none; widows:2; word-spacing:0px; white-space:normal; background-color:rgb(19, 23, 32); font-size:11.5px; color:rgb(110, 116, 126)\">\u200b</span><br/></div><div><br/></div></div>";

describe('the real descriptions from the live portal', () => {
    test('reads the price, the period and the label out of the A+ card', async () => {
        const result = await parseOpportunity(A_PLUS);

        expect(result.amount).toBe(2100);
        expect(result.currencyCode).toBe('USD');
        expect(result.period).toBe('month');
        expect(result.amountLabel).toBe('estimated upside');
        expect(result.parsedBy).toBe('pattern');
    });

    test('the body is the agency’s words, with no price line and no markup', async () => {
        const result = await parseOpportunity(A_PLUS);

        expect(result.body).toMatch(/^These nine ASINs get 31,000 views/);
        expect(result.body).not.toMatch(/Price|\$2,100|Description:/);
        expect(result.body).not.toMatch(/<|&nbsp;|&quot;/);
    });

    test('the awkward one parses too — zero-width space and "Description :"', async () => {
        // The card a strict pattern loses. If this ever regresses it does so silently:
        // three cards still render and the fourth just is not there.
        const result = await parseOpportunity(OUTSIDE_TRAFFIC);

        expect(result.parsedBy).toBe('pattern');
        expect(result.amount).toBe(2400);
        expect(result.body).toMatch(/^Every sale you make right now comes from inside Amazon/);
    });

    test('no zero-width characters survive into the stored body', async () => {
        // They are invisible in Zoho and in the browser, but they break any later
        // matching on this text and make a trailing one look like a stray space.
        const result = await parseOpportunity(OUTSIDE_TRAFFIC);

        expect(result.body).not.toMatch(/[​-‍﻿]/);
        expect(result.body.endsWith('organically.')).toBe(true);
    });

    test('the model is never called when the pattern works', async () => {
        // Guards the rule that matters most: these are the agency’s words about a
        // client’s business, and a rewrite that reads better while changing "2,900
        // times a month" is worse than no rewrite at all.
        const result = await parseOpportunity(OUTSIDE_TRAFFIC);
        expect(result.parsedBy).toBe('pattern');
    });
});

describe('the shapes a person actually types', () => {
    test.each([
        ['Price: $3,600/month estimated upside\n\nDescription: Body.', 3600, 'month'],
        ['Price:  $1,100 /mo estimated upside\n\nDescription: Body.', 1100, 'month'],
        ['price : $900 per month\n\ndescription : Body.', 900, 'month'],
        ['Price: $4,380\n\nDescription: Body.', 4380, 'once'],
        ['Price: $12,000/year\n\nDescription: Body.', 12000, 'year'],
    ])('%s', (text, amount, period) => {
        const result = parsePattern(text);
        expect(result.amount).toBe(amount);
        expect(result.period).toBe(period);
        expect(result.body).toBe('Body.');
    });

    test('a figure with no period is a one-off, not a monthly', () => {
        // "$4,380 recoverable, one-off" must never be summed into a /mo headline.
        expect(parsePriceLine('$4,380 recoverable, one-off').period).toBe('once');
    });

    test('non-dollar currencies keep their own code', () => {
        expect(parsePriceLine('£2,100/month').currencyCode).toBe('GBP');
        expect(parsePriceLine('€900/month').currencyCode).toBe('EUR');
    });

    test('thousands separators do not truncate the amount', () => {
        // Number('2,100') is NaN, and a naive parseInt gives 2 — a 1000x understatement
        // that would look plausible on the page.
        expect(parsePriceLine('$2,100/month').amount).toBe(2100);
        expect(parsePriceLine('$1,234,567/month').amount).toBe(1234567);
    });
});

describe('what happens when it cannot read the description', () => {
    test('prose with no headers at all still yields a body', async () => {
        const result = await parseOpportunity('<p>Just a paragraph about a thing.</p>');

        expect(result.body).toBe('Just a paragraph about a thing.');
        expect(result.amount).toBeNull();
    });

    test('a price with no figure keeps the words and drops the number', () => {
        const result = parsePattern('Price: TBD\n\nDescription: We will scope it.');

        expect(result.amount).toBeNull();
        expect(result.body).toBe('We will scope it.');
    });

    test('an empty description never throws', async () => {
        for (const input of [null, undefined, '', '   ', '<div></div>']) {
            const result = await parseOpportunity(input);
            expect(result.parsedBy).toBe('none');
            expect(result.amount).toBeNull();
        }
    });

    test('the price line cannot swallow the description', () => {
        // `\s` matches newlines, so a lazy pattern here eats the whole document and the
        // body comes back empty.
        const result = parsePattern('Price: $500/month upside\n\nDescription: The body.');
        expect(result.amountLabel).toBe('upside');
        expect(result.body).toBe('The body.');
    });

    test('clean() strips zero-width characters, which \\s does not match', () => {
        expect(clean('​Description​')).toBe('Description');
        expect(/\s/.test('​')).toBe(false);
    });
});
