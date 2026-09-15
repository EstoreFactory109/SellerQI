/**
 * Zoho comment bodies arrive as HTML with inline styling and mention markup.
 * They are converted to plain text at SYNC time, so these cases are the line
 * that keeps third-party HTML out of the database and therefore out of the
 * browser — not a cosmetic formatting concern.
 */

const { toPlainText, toSummary } = require('../../../Services/Zoho/zohoRichText.js');

describe('toPlainText', () => {
    test('strips tags and keeps the words', () => {
        expect(toPlainText('<div><b>Hello</b> there</div>')).toBe('Hello there');
    });

    test('renders a Zoho mention as a readable name', () => {
        // Verbatim from a live comment on the Meta Ads task.
        expect(toPlainText('zp[@zpuser#911885654#Rakshita Tank]zp please review'))
            .toBe('@Rakshita Tank please review');
    });

    test('turns line and block breaks into newlines', () => {
        expect(toPlainText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
        expect(toPlainText('One<br/>Two')).toBe('One\nTwo');
    });

    test('collapses the blank-line runs Zoho\'s nested divs produce', () => {
        expect(toPlainText('<div><div><div>A</div></div></div><br/><br/><br/><div>B</div>'))
            .toBe('A\n\nB');
    });

    test('decodes the entities that actually appear', () => {
        expect(toPlainText('Fees&nbsp;&amp;&nbsp;charges &lt;10&gt; &quot;q&quot; &#39;s&#39;'))
            .toBe('Fees & charges <10> "q" \'s\'');
    });

    test('drops script and style content rather than inlining it as text', () => {
        // Nothing in this app renders the output as HTML, but leaking script
        // source into a comment body would still be wrong and confusing.
        expect(toPlainText('<style>.x{color:red}</style>Hi<script>alert(1)</script>')).toBe('Hi');
    });

    test('marks list items', () => {
        expect(toPlainText('<ul><li>First</li><li>Second</li></ul>')).toBe('• First\n• Second');
    });

    test('is safe on empty and non-string input', () => {
        expect(toPlainText('')).toBe('');
        expect(toPlainText(null)).toBe('');
        expect(toPlainText(undefined)).toBe('');
        expect(toPlainText(42)).toBe('');
    });

    test('leaves no angle-bracket markup behind on a real-world body', () => {
        const real = '<div style="font-size:0.9285rem"><div style="margin:0px"><b>Meta(Facebook, Instagram)</b>'
            + '<span style="font-size:1.0714rem"><br/></span>Details as follow: Post+Ads</div></div>';
        const out = toPlainText(real);
        expect(out).not.toMatch(/<[a-z/][^>]*>/i);
        expect(out).toContain('Meta(Facebook, Instagram)');
        expect(out).toContain('Details as follow: Post+Ads');
    });
});

describe('toSummary', () => {
    test('takes the first non-empty line', () => {
        expect(toSummary('<br/><br/><p>First line</p><p>Second</p>')).toBe('First line');
    });

    test('clips with an ellipsis past the limit', () => {
        const out = toSummary(`<p>${'a'.repeat(300)}</p>`, 50);
        expect(out).toHaveLength(50);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('toPlainLabel', () => {
    const { toPlainLabel } = require('../../../Services/Zoho/zohoRichText.js');

    test('decodes entities in a task name', () => {
        // Zoho stores names HTML-escaped, so this reached the client's page verbatim
        // as "Mice &amp; Rats".
        expect(toPlainLabel('Morgan&rsquo;s Repellent For Mice &amp; Rats'))
            .toBe('Morgan’s Repellent For Mice & Rats');
    });

    test('collapses newlines and runs of spaces onto one line', () => {
        // A name with a stray newline broke the grid row it was rendered in.
        expect(toPlainLabel('Project Details\n')).toBe('Project Details');
        expect(toPlainLabel('EBC   -   Squirrel')).toBe('EBC - Squirrel');
    });

    test('returns null for nothing, rather than an empty label', () => {
        expect(toPlainLabel(null)).toBeNull();
        expect(toPlainLabel('   ')).toBeNull();
    });
});
