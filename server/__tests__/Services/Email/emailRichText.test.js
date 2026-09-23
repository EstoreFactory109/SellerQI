/**
 * Turning a received email into text that can be redacted.
 *
 * Every case here is a way a client's identity survives into text that staff will
 * read. They are not hypothetical: the first three were verified against
 * Services/Zoho/zohoRichText.js, which leaks all of them, and are the reason this is a
 * separate module rather than a reuse.
 *
 * The ordering rule this file enforces throughout: HTML must become flat, decoded,
 * normalised text BEFORE redaction runs. A redactor pointed at raw markup cannot match
 * a name split across tags or written as entities, and will silently pass it through.
 */

const { toPlainText, toPlainLabel, stripQuotedChain, prepareBody } = require('../../../Services/Email/emailRichText.js');

const LEAKED = /nitesh|kumar|morgansrepellent|913/i;

describe('HTML comments', () => {
    test('a comment containing ">" does not leak its contents', () => {
        // The naive /<[^>]+>/ matches only as far as the FIRST ">", deleting
        // "<!-- a >" and leaving the address behind as visible text.
        const out = toPlainText('<p>Hi</p><!-- reply-to: a > nitesh@example.com -->');

        expect(out).toBe('Hi');
        expect(out).not.toMatch(LEAKED);
    });

    test('Outlook conditional comments are removed whole', () => {
        // Outlook wraps signature blocks in these as a matter of course, and they
        // contain ">" routinely — so this is the common case, not an edge case.
        const out = toPlainText('<p>Hi</p><!--[if gte mso 9]><p>nitesh@x.com</p><![endif]-->');

        expect(out).toBe('Hi');
        expect(out).not.toMatch(LEAKED);
    });
});

describe('non-body elements', () => {
    test('<title> does not survive into the body', () => {
        // Emails are frequently whole HTML documents, and the subject often repeats
        // in the title with the sender's name attached.
        const out = toPlainText('<html><head><title>Invoice for Nitesh Kumar</title></head><body>Hi</body></html>');

        expect(out).toBe('Hi');
        expect(out).not.toMatch(LEAKED);
    });

    test('script and style contents are dropped', () => {
        expect(toPlainText('<style>.x{}</style><script>var a="nitesh@x.com"</script><p>Hi</p>'))
            .toBe('Hi');
    });
});

describe('identity that is only readable once flattened', () => {
    test('table cells are separated, so a name laid out in a signature still reads', () => {
        // Concatenating to "NiteshKumar" means the full-name redaction never fires
        // and only the weaker part-matching does.
        expect(toPlainText('<td>Nitesh</td><td>Kumar</td>')).toBe('Nitesh Kumar');
    });

    test('a name split across inline tags is rejoined', () => {
        expect(toPlainText('Nit<b>esh</b> Kumar')).toBe('Nitesh Kumar');
    });

    test('entity-encoded identity is decoded', () => {
        // Redaction after decoding is the only order that works: "&#78;itesh" would
        // otherwise pass through untouched and decode at render time.
        expect(toPlainText('&#78;itesh &lt;n@x.com&gt;')).toBe('Nitesh <n@x.com>');
        expect(toPlainText('&#x4E;itesh')).toBe('Nitesh');
    });

    test('a non-breaking space between names reads as a space', () => {
        // Pasting from Word produces these constantly; left alone the full name
        // never matches.
        expect(toPlainText('Nitesh Kumar')).toBe('Nitesh Kumar');
    });

    test('zero-width characters are stripped', () => {
        expect(toPlainText('Nit​esh Kumar')).toBe('Nitesh Kumar');
    });

    test('full-width characters fold to their plain forms', () => {
        expect(toPlainText('Ｎｉｔｅｓｈ')).toBe('Nitesh');
    });
});

describe('quoted reply chains', () => {
    test('cuts a Gmail chain, losing the signature and address inside it', () => {
        const { text, quotedTrimmed } = prepareBody(
            'Yes, go ahead.\n\nOn Mon, 22 Sep 2026 at 14:03, Nitesh Kumar <walmart@morgansrepellent.com> wrote:\n> Confirm pricing?\n> Thanks, Nitesh · 913-269-8400',
            { isHtml: false }
        );

        expect(text).toBe('Yes, go ahead.');
        expect(quotedTrimmed).toBe(true);
        expect(text).not.toMatch(LEAKED);
    });

    test('cuts an Outlook "Original Message" block', () => {
        const { text } = prepareBody(
            'Approved.\n\n-----Original Message-----\nFrom: Nitesh Kumar <walmart@morgansrepellent.com>\nSent: Monday\nSubject: Re: pricing',
            { isHtml: false }
        );

        expect(text).toBe('Approved.');
        expect(text).not.toMatch(LEAKED);
    });

    test('cuts a Gmail HTML quote container', () => {
        const { text } = prepareBody(
            '<div>Approved.</div><div class="gmail_quote"><div>On Mon, Nitesh Kumar &lt;walmart@morgansrepellent.com&gt; wrote:</div><blockquote>old</blockquote></div>',
            { isHtml: true }
        );

        expect(text).toBe('Approved.');
        expect(text).not.toMatch(LEAKED);
    });

    test('cuts at the EARLIEST marker when a chain has several', () => {
        // A long thread stacks them; cutting at the last would keep everything above it.
        const { text } = stripQuotedChain(
            'New.\n\nOn Mon, A wrote:\nolder\n\n-----Original Message-----\noldest',
            false
        );

        expect(text.trim()).toBe('New.');
    });

    test('cuts a run of ">" lines with no header above them', () => {
        const { text } = stripQuotedChain('Fine by me.\n\n> old line\n> older line', false);

        expect(text.trim()).toBe('Fine by me.');
    });

    test('leaves a message with no chain untouched', () => {
        const { text, trimmed } = stripQuotedChain('Just a plain message.', false);

        expect(text).toBe('Just a plain message.');
        expect(trimmed).toBe(false);
    });

    test('does not mistake ordinary prose for a quote header', () => {
        // "On Monday we agreed…" must not truncate the message.
        const { trimmed } = stripQuotedChain('On Monday we agreed to ship the labels.', false);

        expect(trimmed).toBe(false);
    });
});

describe('toPlainLabel', () => {
    test('collapses a subject to one line', () => {
        expect(toPlainLabel('Re:  pricing\n  question')).toBe('Re: pricing question');
    });

    test('returns null for nothing rather than an empty label', () => {
        expect(toPlainLabel('')).toBeNull();
        expect(toPlainLabel('   ')).toBeNull();
        expect(toPlainLabel(null)).toBeNull();
    });
});

describe('robustness', () => {
    test('never throws on malformed input', () => {
        ['<p>unclosed', '<!-- unterminated', '&#999999999;', '<<<>>>', '&#x;', null, undefined, 42]
            .forEach((input) => expect(() => toPlainText(input)).not.toThrow());
    });

    test('plain-text mode leaves angle brackets alone', () => {
        // A plain-text part is not markup; stripping "tags" from it would eat real
        // content such as an inequality or an address in angle brackets.
        expect(toPlainText('a < b and b > c', { isHtml: false })).toBe('a < b and b > c');
    });
});
