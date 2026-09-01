/**
 * Tests for the legacy ads-document prune SELECTION rule.
 *
 * WHY THIS EXISTS
 * This is the only piece of this week's work that DELETES. 4.4GB of the 5.3GB in
 * adsKeywordsPerformance + searchterms is superseded legacy documents: the pre-per-day
 * schema wrote one whole report snapshot per document, and up to 158 accumulated per
 * account, while every read path resolves exactly ONE of them —
 * `findOne(...).sort({ createdAt: -1 })`. Everything older is unreachable.
 *
 * "Unreachable" is the entire safety argument, so the selection rule has to match those
 * readers exactly. The cases below are the ways it could quietly stop matching:
 *   - keeping the wrong document in a group (would change what every reader returns);
 *   - treating a per-day document as a candidate (would destroy real daily data);
 *   - merging the two collections' different `userId` BSON types into one group.
 */

const {
    selectSupersededLegacyDocs,
    groupKeyFor,
} = require('../../scripts/pruneSupersededLegacyAdsDocs.js');

/** Fake ObjectId: object-shaped with toHexString, like the real thing. */
function oid(hex) {
    return { toHexString: () => hex, toString: () => hex };
}

const doc = (id, userId, country, region, createdAt, extra = {}) => ({
    _id: id, userId, country, region, createdAt: new Date(createdAt), ...extra,
});

describe('selection keeps exactly one document per group', () => {
    test('keeps the newest by createdAt, deletes the rest', () => {
        const docs = [
            doc('old', 'u1', 'US', 'NA', '2026-01-01'),
            doc('newest', 'u1', 'US', 'NA', '2026-05-18'),
            doc('mid', 'u1', 'US', 'NA', '2026-03-01'),
        ];
        const { groups, kept, candidates } = selectSupersededLegacyDocs(docs);

        expect(groups).toBe(1);
        expect(kept.map((d) => d._id)).toEqual(['newest']);
        expect(candidates.map((d) => d._id).sort()).toEqual(['mid', 'old']);
    });

    test('a lone document in a group is never a candidate', () => {
        const { kept, candidates } = selectSupersededLegacyDocs([doc('only', 'u1', 'US', 'NA', '2020-01-01')]);
        expect(kept.map((d) => d._id)).toEqual(['only']);
        expect(candidates).toEqual([]);
    });

    test('country and region separate groups', () => {
        const docs = [
            doc('us-a', 'u1', 'US', 'NA', '2026-01-01'),
            doc('us-b', 'u1', 'US', 'NA', '2026-02-01'),
            doc('ca', 'u1', 'CA', 'NA', '2026-01-01'),
            doc('uk', 'u1', 'UK', 'EU', '2026-01-01'),
        ];
        const { groups, kept, candidates } = selectSupersededLegacyDocs(docs);

        expect(groups).toBe(3);
        expect(kept.map((d) => d._id).sort()).toEqual(['ca', 'uk', 'us-b']);
        expect(candidates.map((d) => d._id)).toEqual(['us-a']);
    });

    // Equal timestamps must not let the dry run and the apply run disagree about which
    // document survives.
    test('ties on createdAt break deterministically on _id', () => {
        const docs = [
            doc('aaa', 'u1', 'US', 'NA', '2026-01-01'),
            doc('zzz', 'u1', 'US', 'NA', '2026-01-01'),
        ];
        const first = selectSupersededLegacyDocs(docs);
        const second = selectSupersededLegacyDocs([...docs].reverse());

        expect(first.kept.map((d) => d._id)).toEqual(['zzz']);
        expect(second.kept.map((d) => d._id)).toEqual(['zzz']);
    });
});

describe('per-day documents are never touched', () => {
    // THE regression test. A per-day document reaching the candidate list would delete
    // real daily ads data, which nothing else holds.
    test('a document with a metricDate is excluded entirely', () => {
        const docs = [
            doc('legacy-old', 'u1', 'US', 'NA', '2026-01-01'),
            doc('legacy-new', 'u1', 'US', 'NA', '2026-02-01'),
            doc('daily', 'u1', 'US', 'NA', '2026-03-01', { metricDate: '2026-03-01' }),
        ];
        const { kept, candidates, skippedHasMetricDate } = selectSupersededLegacyDocs(docs);

        expect(skippedHasMetricDate).toBe(1);
        expect(candidates.map((d) => d._id)).toEqual(['legacy-old']);
        expect(kept.map((d) => d._id)).toEqual(['legacy-new']);
        expect([...kept, ...candidates].map((d) => d._id)).not.toContain('daily');
    });

    test('metricDate: null still counts as legacy', () => {
        const docs = [
            doc('a', 'u1', 'US', 'NA', '2026-01-01', { metricDate: null }),
            doc('b', 'u1', 'US', 'NA', '2026-02-01', { metricDate: null }),
        ];
        const { candidates, skippedHasMetricDate } = selectSupersededLegacyDocs(docs);
        expect(skippedHasMetricDate).toBe(0);
        expect(candidates.map((d) => d._id)).toEqual(['a']);
    });
});

describe('userId BSON types group separately', () => {
    // adsKeywordsPerformance stores userId as an ObjectId; searchterms stores it as a
    // String. A document whose stored type differs from the type its readers query with
    // is unreachable by them, so it must never displace a reachable one.
    test('an ObjectId and an equal string do not share a group', () => {
        const hex = '507f1f77bcf86cd799439011';
        const docs = [
            doc('as-oid', oid(hex), 'US', 'NA', '2026-01-01'),
            doc('as-string', hex, 'US', 'NA', '2026-02-01'),
        ];
        const { groups, kept, candidates } = selectSupersededLegacyDocs(docs);

        expect(groups).toBe(2);
        expect(kept.map((d) => d._id).sort()).toEqual(['as-oid', 'as-string']);
        expect(candidates).toEqual([]);
    });

    test('two ObjectIds with the same hex do share a group', () => {
        const hex = '507f1f77bcf86cd799439011';
        const { groups, candidates } = selectSupersededLegacyDocs([
            doc('a', oid(hex), 'US', 'NA', '2026-01-01'),
            doc('b', oid(hex), 'US', 'NA', '2026-02-01'),
        ]);
        expect(groups).toBe(1);
        expect(candidates.map((d) => d._id)).toEqual(['a']);
    });

    test('groupKeyFor tags the type', () => {
        const hex = '507f1f77bcf86cd799439011';
        expect(groupKeyFor({ userId: oid(hex), country: 'US', region: 'NA' })).toBe(`oid:${hex}|US|NA`);
        expect(groupKeyFor({ userId: hex, country: 'US', region: 'NA' })).toBe(`string:${hex}|US|NA`);
    });
});

describe('minimum-age guard', () => {
    // Legacy writing stopped on 2026-05-18, so nothing recent should exist. The guard is
    // insurance: if a legacy write path is ever re-enabled, its output cannot be deleted
    // out from under it on the same day.
    test('a superseded but recent document is kept', () => {
        const now = new Date('2026-08-20').getTime();
        const docs = [
            doc('recent', 'u1', 'US', 'NA', '2026-08-15'),
            doc('newest', 'u1', 'US', 'NA', '2026-08-19'),
            doc('ancient', 'u1', 'US', 'NA', '2025-01-01'),
        ];
        const { kept, candidates, skippedTooRecent } = selectSupersededLegacyDocs(docs, {
            minAgeMs: 30 * 24 * 60 * 60 * 1000,
            now,
        });

        expect(kept.map((d) => d._id)).toEqual(['newest']);
        expect(candidates.map((d) => d._id)).toEqual(['ancient']);
        expect(skippedTooRecent).toBe(1);
    });

    test('the newest in a group is kept regardless of age', () => {
        const now = new Date('2026-08-20').getTime();
        const { kept, candidates } = selectSupersededLegacyDocs(
            [doc('only', 'u1', 'US', 'NA', '2019-01-01')],
            { minAgeMs: 30 * 24 * 60 * 60 * 1000, now }
        );
        expect(kept.map((d) => d._id)).toEqual(['only']);
        expect(candidates).toEqual([]);
    });
});

describe('degenerate input', () => {
    test('empty and non-array input are safe', () => {
        expect(selectSupersededLegacyDocs([]).candidates).toEqual([]);
        expect(selectSupersededLegacyDocs(undefined).candidates).toEqual([]);
    });

    test('documents without an _id are ignored', () => {
        const { candidates, groups } = selectSupersededLegacyDocs([
            { userId: 'u1', country: 'US', region: 'NA', createdAt: new Date('2026-01-01') },
        ]);
        expect(groups).toBe(0);
        expect(candidates).toEqual([]);
    });
});
