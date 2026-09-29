/**
 * quoteSplitter — recovering the answers a client typed inside the quoted email.
 *
 * Ported from the node:test suite that shipped with the module, against fixtures re-keyed
 * to this repo's test identity. Two groups were ADDED here and they are the ones that
 * matter for this codebase:
 *
 *   1. "our previous email is redacted" — the original suite diffed against a raw sent
 *      body, which is a copy we do not have. We store bodyRedacted only, so the real diff
 *      runs against "Hi [name]," while the client's quoted copy says "Hi Nitesh,". Without
 *      the placeholder rule the client's own name is reported as an answer they typed.
 *   2. The real prepareBody → splitEmail chain, since ingest never hands this raw HTML.
 */

const { splitEmail, buildBodyForModel, cleanReply } = require('../../../Services/Email/quoteSplitter.js');
const { prepareBody, toPlainText } = require('../../../Services/Email/emailRichText.js');
const F = require('./__emailFixtures.js');

const replies = (split) => split.inlineReplies.map((r) => r.reply);

describe('splitEmail — answers typed inside the quote', () => {
    test('finds both answers by diffing against the email we sent', () => {
        const s = splitEmail(F.INLINE_ANSWERS, { previousMessages: [F.INLINE_ANSWERS_PREVIOUS] });

        expect(replies(s)).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
        // The context is what makes "2500 sets." mean anything downstream.
        expect(s.inlineReplies[0].context).toMatch(/pack size\/quantity\?$/);
    });

    test('the signature under the quote is not mistaken for an answer', () => {
        const s = splitEmail(F.INLINE_ANSWERS, { previousMessages: [F.INLINE_ANSWERS_PREVIOUS] });
        const all = replies(s).join(' ');

        expect(all).not.toMatch(/Nitesh Kumar/);
        expect(all).not.toMatch(/913-269-8400/);
        expect(all).not.toMatch(/Natural Environmental Solutions/);
    });

    test('without a previous email the heuristics still find both answers', () => {
        // The "? <text>" path. This is what runs on the first inbound message of a thread,
        // before we have ever replied.
        expect(replies(splitEmail(F.INLINE_ANSWERS))).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
    });

    test('Outlook: answers typed between our lines, with no ">" anywhere', () => {
        const s = splitEmail(F.OUTLOOK_INLINE, { previousMessages: [F.OUTLOOK_INLINE_PREVIOUS] });

        expect(replies(s)).toEqual([
            'US FIRST, THEN CANADA',
            'NO, LEAVE THE BUNDLE OUT FOR NOW',
        ]);
        expect(s.inlineReplies[1].context).toMatch(/KB-100\?$/);
    });
});

/**
 * A false positive is worse than the bug it fixes: a recovered "answer" is handed to the
 * intent model and can end up in a Zoho task as something the client said.
 */
describe('splitEmail — ordinary top replies must yield nothing', () => {
    test('Gmail, with and without the previous email', () => {
        for (const s of [
            splitEmail(F.TOP_REPLY_GMAIL, { previousMessages: [F.TOP_REPLY_GMAIL_PREVIOUS] }),
            splitEmail(F.TOP_REPLY_GMAIL),
        ]) {
            expect(s.inlineReplies).toEqual([]);
            expect(s.body).toMatch(/VERISOL/);
            // The wrapped "On … <\n addr> wrote:" header is the one emailRichText misses.
            expect(s.body).not.toMatch(/wrote:/);
        }
    });

    test('Outlook: the body stops at the rule line', () => {
        const s = splitEmail(F.TOP_REPLY_OUTLOOK);

        expect(s.body).toMatch(/The rest are approved\./);
        expect(s.body).not.toMatch(/PLOs Submitted/);
    });
});

describe('splitEmail — what counts as quoted', () => {
    test("a genuine forward is kept apart, not dropped into 'quoted'", () => {
        const s = splitEmail(F.FORWARDED);

        expect(s.body).toMatch(/benefit relations with Amazon/);
        expect(s.forwarded).toMatch(/Fulfillment by Amazon/);
        expect(s.quoted).toBe('');
    });

    test('the Zoho mirror banner is quoted history, not a forward', () => {
        const s = splitEmail(F.ZOHO_MIRROR);

        expect(s.body).toBe(
            'Sender: Natural Environmental Solutions\n\n'
            + 'That would be great to check expiration dates. Thank you so much.',
        );
        expect(s.quoted).toMatch(/bin check/);
        expect(s.forwarded).toBeNull();
    });

    test('a message with no quote at all passes straight through', () => {
        const s = splitEmail('Please go ahead with the launch.');

        expect(s.body).toBe('Please go ahead with the launch.');
        expect(s.quotedTrimmed).toBe(false);
        expect(s.inlineReplies).toEqual([]);
    });
});

/**
 * THE PLACEHOLDER TRAP.
 *
 * EmailThreadModels stores no raw body, so the only copy of our own email available to the
 * diff is the redacted one. Compared literally, every identifier we redacted reads as a
 * word the client just typed — starting with their own name in our greeting.
 */
describe('splitEmail — diffing against our REDACTED previous email', () => {
    const split = () => splitEmail(F.INLINE_ANSWERS, {
        previousMessages: [F.INLINE_ANSWERS_PREVIOUS_REDACTED],
    });

    test("the client's own name in our greeting is not reported as an answer", () => {
        // Our stored copy says "Hi [name],"; their quoted copy says "Hi Nitesh,".
        expect(F.INLINE_ANSWERS_PREVIOUS_REDACTED).toContain('Hi [name],');
        expect(F.INLINE_ANSWERS).toContain('> Hi Nitesh,');

        expect(replies(split()).join(' ')).not.toMatch(/Nitesh/);
    });

    test('the real answers survive the redacted comparison', () => {
        expect(replies(split())).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
    });

    test('a redacted link and phone do not surface as answers either', () => {
        const all = replies(split()).join(' ');

        expect(all).not.toMatch(/docs\.google\.com/);
        expect(all).not.toMatch(/818\) 308-1444/);
    });
});

/**
 * A long thread quotes several of our emails. The diff only ever holds the most recent
 * one, so every OLDER block looks entirely new — and reporting a whole block as "what the
 * client typed" is the wall-of-false-answers failure, not a missed answer.
 */
describe('splitEmail — older history further down the chain', () => {
    const PREVIOUS = 'Please confirm the pack size and the oz variant before we proceed.';
    const EMAIL = [
        'Answers below.',
        '',
        'On Sep 21, 2026, at 2:30 AM, Support eStore Factory <hello@estorefactory.com> wrote:',
        '',
        'Please confirm the pack size? 2500 sets. and the oz variant before we proceed.',
        '',
        'On Aug 2, 2026, at 9:00 AM, Support eStore Factory <hello@estorefactory.com> wrote:',
        '',
        'Following up on the pallet scheduling for the Dallas warehouse, the carrier has',
        'asked whether we can move the delivery window to the first week of September.',
    ].join('\n');

    test('an unrelated older block is skipped, not reported wholesale', () => {
        const s = splitEmail(EMAIL, { previousMessages: [PREVIOUS] });

        expect(replies(s)).toEqual(['2500 sets.']);
        expect(replies(s).join(' ')).not.toMatch(/pallet|Dallas|carrier/);
    });
});

describe('splitEmail — the diff bound', () => {
    test('an impossible cell budget falls back to the heuristics rather than failing', () => {
        const s = splitEmail(F.INLINE_ANSWERS, {
            previousMessages: [F.INLINE_ANSWERS_PREVIOUS],
            maxDiffCells: 1,
        });

        // Same answers, reached the other way — the fallback is a real path, not a stub.
        expect(replies(s)).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
    });

    test('an empty previous message falls back instead of calling everything new', () => {
        const s = splitEmail(F.INLINE_ANSWERS, { previousMessages: [''] });

        expect(replies(s)).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
    });
});

/**
 * Ingest hands this the output of prepareBody, never a raw payload. This is the chain the
 * plan measured: run correctly, the QE email keeps 3 of 56 lines and loses both answers.
 */
/**
 * Ingest flattens before it splits — toPlainText, then splitEmail. It must NOT keep using
 * prepareBody first, because prepareBody cuts the chain and the answers go with it.
 */
describe('the real toPlainText → splitEmail chain', () => {
    test('recovers exactly what prepareBody alone throws away', () => {
        // isHtml is an OPTION and it defaults to TRUE; passing false positionally is
        // silently ignored and treats plain text as markup. prepareBody returns
        // { text, quotedTrimmed }, not a string.
        const { text: prepared } = prepareBody(F.INLINE_ANSWERS, { isHtml: false });
        expect(prepared).not.toMatch(/2500 sets/);
        expect(prepared).not.toMatch(/4\.5 oz/);
        expect(prepared.split('\n').filter(Boolean)).toHaveLength(2);

        const flat = toPlainText(F.INLINE_ANSWERS, { isHtml: false });
        const s = splitEmail(flat, { previousMessages: [F.INLINE_ANSWERS_PREVIOUS_REDACTED] });

        // Same body prepareBody produced, and both answers back alongside it.
        expect(s.body).toBe(prepared);
        expect(replies(s)).toEqual([
            '2500 sets.',
            'Sorry for the type, it shound be 4.5 oz',
        ]);
    });

    test('a flattened HTML quote still splits, even with no ">" left', () => {
        const html = '<p>Approved, thanks.</p><div>On Mon, 21 Sep 2026, Support '
            + '&lt;hello@estorefactory.com&gt; wrote:</div><blockquote>Please review.</blockquote>';
        const s = splitEmail(toPlainText(html, { isHtml: true }));

        expect(s.body).toMatch(/Approved, thanks\./);
        expect(s.body).not.toMatch(/Please review/);
    });
});

describe('buildBodyForModel', () => {
    test('returns the body untouched when there is nothing to recover', () => {
        expect(buildBodyForModel('Approved.', [])).toBe('Approved.');
    });

    test('labels each answer with the line it answers', () => {
        const out = buildBodyForModel('Thanks.', [
            { context: 'confirm the correct pack size/quantity?', reply: '2500 sets.' },
        ]);

        expect(out).toMatch(/Replies the client typed inside the quoted email/);
        expect(out).toMatch(/pack size\/quantity\?": 2500 sets\./);
        expect(out.startsWith('Thanks.')).toBe(true);
    });
});

describe('cleanReply', () => {
    test('cuts at a sign-off', () => {
        expect(cleanReply('2500 sets. Warm Regards, Nitesh Kumar')).toBe('2500 sets.');
    });

    test('drops a bare header, link or address', () => {
        expect(cleanReply('From: someone@example.com')).toBe('');
        expect(cleanReply('https://docs.google.com/document/d/abc/edit')).toBe('');
        expect(cleanReply('---')).toBe('');
    });
});
