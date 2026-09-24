/**
 * evaluateMessageIntent.js — does the intent prompt still behave?
 *
 *     node server/scripts/evaluateMessageIntent.js
 *
 * ── WHY THIS IS A SCRIPT AND NOT A TEST ──
 * Every unit test around MessageIntentService mocks the model, which means none of them
 * can tell you whether the PROMPT works. That gap is not theoretical: the first version
 * of this feature shipped with missing-detail detection that never fired once, and a
 * request/decision split that looked fine in a mocked suite. Both were found by running
 * real text through the real model.
 *
 * So the prompt has a corpus instead, run by hand after any change to it. It costs a few
 * cents and about a minute, and it is the only thing that catches a prompt edit that
 * quietly stops recognising requests — or starts recognising everything.
 *
 * ── THE FALSE POSITIVES MATTER MORE THAN THE FALSE NEGATIVES ──
 * A missed request costs a client repeating themselves. A queue that fills with
 * greetings and thank-yous costs an admin their trust in it, and an admin who stops
 * reading the queue carefully is worse off than one who never had it. The corpus is
 * weighted accordingly: three quarters of it is messages that must stay silent.
 *
 * Requires OPENAPI_KEY. Read-only — it calls the model and nothing else, touching no
 * database and creating no requests.
 */

require('dotenv').config();
const { detectTaskRequest, detectDecision, MIN_CONFIDENCE } = require('../Services/AI/MessageIntentService.js');

/** [label, message, shouldQueue] — shapes clients actually send. */
const REQUEST_CASES = [
    // Must stay silent. Ordinary conversation that mentions work.
    ['greeting', 'Hi, hope you had a good weekend!', false],
    ['thanks', 'Thanks, that looks great!', false],
    ['status chase', 'Any update on the size chart from last week?', false],
    ['status chase 2', 'Just checking in on where we are with the A+ content', false],
    ['question', 'How is the listing optimisation going?', false],
    ['question 2', 'Why did our BSR drop last week?', false],
    ['question 3', 'Do you handle Walmart listings as well as Amazon?', false],
    ['approval', 'Yes that version looks good, go ahead', false],
    ['approval 2', 'Approved, please proceed with option B', false],
    ['complaint', 'The new images look worse than the old ones honestly', false],
    ['complaint 2', 'This is taking far longer than we agreed', false],
    ['answer to us', 'The dimensions are 30cm x 20cm, and it weighs 1.2kg', false],
    ['answer to us 2', 'Yes B08XYZ1234 is the one I meant', false],
    ['feedback', 'The last batch of copy was much better, nice work', false],
    ['billing', 'Can you send me last month invoice?', false],
    ['out of office', 'I am away until the 14th, my colleague will cover', false],
    ['fyi', 'FYI Amazon just approved our brand registry', false],
    ['confirmation', 'Got it, that all makes sense', false],
    ['chit chat', 'Did you see the news about the FBA fee changes?', false],
    // Past tense: the work is done, and reading it as a request would queue it again.
    ['past tense', 'We already updated the title ourselves last night', false],
    // Hypothetical: asking IF something would be needed, not asking for it.
    ['hypothetical', 'If we added a bundle later, would that need new images?', false],

    // Must queue.
    ['plain request', 'I want your team to create product images for my listed products', true],
    ['polite request', 'Could you please add a size chart to ASIN B08XYZ1234?', true],
    ['urgent request', 'We need the A+ content updated before Prime Day on 10 July', true],
    ['vague request', 'Our images could do with a refresh at some point', true],
    ['multi request', 'Please update the title, bullets and backend keywords on B07ABC5678', true],
    // Buried in pleasantries, which is how most real ones arrive.
    ['buried request', 'Hope you are well. By the way, can you rewrite the bullets on B08XYZ1234 when you get a chance? Thanks!', true],
];

/** [label, staff reply, expected intent] — only asked when a request is waiting. */
const DECISION_CASES = [
    ['clear accept', 'Yes, we can do that. I will get it scheduled this week.', 'accept'],
    ['casual accept', 'Sure, consider it done', 'accept'],
    ['clear reject', 'Sorry, that is not something we cover under your plan.', 'reject'],
    ['soft reject', 'I do not think that is worth doing right now honestly', 'reject'],
    // The trap. A condition is not a decision, and treating it as one would create a
    // task the client has not yet met the terms for.
    ['conditional', 'We could do that, if you send us the product images first', null],
    ['question back', 'Which of the listings did you mean?', null],
    ['still thinking', 'That is an interesting idea, let me think about it', null],
    ['unrelated', 'Just so you know, the Q3 report is ready', null],
];

const run = async () => {
    if (!process.env.OPENAPI_KEY) {
        console.error('OPENAPI_KEY is not set — this script only exercises the live model.');
        process.exit(1);
    }

    console.log(`Confidence floor: ${MIN_CONFIDENCE}\n`);
    const failures = [];

    console.log('── requests ' + '─'.repeat(48));
    for (const [label, text, expected] of REQUEST_CASES) {
        // eslint-disable-next-line no-await-in-loop
        const r = await detectTaskRequest(text);
        const ok = r.actionable === expected;
        if (!ok) failures.push({ kind: expected ? 'missed' : 'NOISE', label, got: r.actionable, conf: r.confidence });
        // Flagged separately: correct today, but one rephrasing from falling the other
        // side of the floor.
        const marginal = ok && expected && r.confidence <= MIN_CONFIDENCE + 0.05;
        console.log(
            `${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(16)} queued=${String(r.actionable).padEnd(5)} want=${String(expected).padEnd(5)} conf=${r.confidence.toFixed(2)}${marginal ? '  <- marginal' : ''}`
        );
    }

    console.log('\n── decisions ' + '─'.repeat(47));
    for (const [label, text, expected] of DECISION_CASES) {
        // eslint-disable-next-line no-await-in-loop
        const r = await detectDecision(text);
        const got = r.actionable ? r.intent : null;
        const ok = got === expected;
        if (!ok) failures.push({ kind: 'decision', label, got, expected });
        console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(16)} intent=${String(got).padEnd(7)} want=${String(expected)}`);
    }

    const total = REQUEST_CASES.length + DECISION_CASES.length;
    console.log('\n' + '='.repeat(60));
    console.log(`${total - failures.length}/${total} correct`);

    const noise = failures.filter((f) => f.kind === 'NOISE');
    if (noise.length) {
        console.log(`\n${noise.length} FALSE POSITIVE(S) — these put noise in the admin's queue:`);
        noise.forEach((f) => console.log(`   ${f.label} (confidence ${f.conf})`));
    }
    failures.filter((f) => f.kind !== 'NOISE').forEach((f) => console.log(`   ${f.kind}: ${f.label}`));

    process.exit(failures.length === 0 ? 0 : 1);
};

run().catch((error) => {
    console.error('FAILED:', error.message);
    process.exit(1);
});
