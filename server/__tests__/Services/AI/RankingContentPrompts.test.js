/**
 * The AI rewrite prompts must ban exactly what Rankings.js flags. They used to
 * carry an older flat list (non-toxic, eco-friendly, prevent...) and ban it in
 * every section, plus a special-character ban the checks only apply to titles.
 */
const {
    buildTitleSystemPrompt,
    buildBulletPointsSystemPrompt,
    buildDescriptionSystemPrompt
} = require('../../../Services/AI/RankingContentAIService.js');
const { restrictedWordsFound, transformRankingIssues } = require('../../../Services/AI/QMateIssuesService.js');
const { checkTitle, checkBulletPoints } = require('../../../Services/Calculations/Rankings.js');

const hasWord = (prompt, word) => new RegExp(`(^|[^\\w-])${word}([^\\w-]|$)`, 'i').test(prompt);

describe('RankingContentAIService prompts', () => {
    it('bans promotional terms and prohibited claims in titles', () => {
        const prompt = buildTitleSystemPrompt();
        expect(hasWord(prompt, 'sale')).toBe(true);
        expect(hasWord(prompt, 'cure')).toBe(true);
        expect(hasWord(prompt, 'non-toxic')).toBe(false);
    });

    it.each([
        ['bullet points', buildBulletPointsSystemPrompt],
        ['description', buildDescriptionSystemPrompt]
    ])('bans prohibited claims only in %s', (_, build) => {
        const prompt = build();
        expect(hasWord(prompt, 'cure')).toBe(true);
        expect(hasWord(prompt, 'sale')).toBe(false);
        expect(hasWord(prompt, 'non-toxic')).toBe(false);
        expect(prompt).not.toMatch(/SPECIAL CHARACTERS/);
    });
});

describe('QMateIssuesService restricted words', () => {
    it('reads the words from the Rankings.js message', () => {
        const title = checkTitle('Acme Mug on Sale, Cures Colds');
        expect(restrictedWordsFound(title.RestictedWords)).toEqual(expect.arrayContaining(['sale', 'cures', 'on sale']));

        const bullets = checkBulletPoints(['Kills germs and relieves anxiety']);
        expect(restrictedWordsFound(bullets.RestictedWords)).toEqual(['anxiety', 'germs', 'kills germs']);
    });

    it('returns [] for a passing or malformed check', () => {
        expect(restrictedWordsFound(checkTitle('Acme Ceramic Coffee Mug').RestictedWords)).toEqual([]);
        expect(restrictedWordsFound(undefined)).toEqual([]);
        expect(restrictedWordsFound({ Message: 42 })).toEqual([]);
    });

    it('passes the words through transformRankingIssues', () => {
        const issues = transformRankingIssues({
            TitleResult: checkTitle('Acme Mug Sale'),
            BulletPoints: checkBulletPoints(['Cures everything'])
        });
        const byType = Object.fromEntries(issues.map((i) => [i.type, i]));
        expect(byType.title_restricted_words.restrictedWords).toEqual(['sale']);
        expect(byType.bullet_restricted_words.restrictedWords).toEqual(['cures']);
    });
});
