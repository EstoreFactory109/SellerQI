const { generateFollowUps } = require('../helpers/FollowUpGenerator.js');

const ACTION_CATALOG = {
    pause_keyword: {
        single: { endpoint: '/api/pagewise/ads/pause-keyword', method: 'POST' },
        bulk: { endpoint: '/api/pagewise/ads/pause-keywords', method: 'POST' },
    },
    add_to_negative: {
        singleOrBulk: { endpoint: '/api/pagewise/ads/add-to-negative', method: 'POST' },
    },
    pause_and_add_to_negative: {
        single: { endpoint: '/api/pagewise/ads/pause-and-add-to-negative', method: 'POST' },
        bulk: { endpoint: '/api/pagewise/ads/pause-and-add-to-negative-bulk', method: 'POST' },
    },
};

function normalizeTargets(action) {
    if (!action) return [];
    if (Array.isArray(action.targets)) return action.targets.filter(Boolean);
    return [];
}

function normalizeText(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildKeywordUniverse(unifiedData) {
    const rows = [];
    const campaignAudit = unifiedData?.bySource?.campaignAuditParity?.data || {};
    const buckets = [
        campaignAudit?.wastedSpend?.data,
        campaignAudit?.topKeywords?.data,
        campaignAudit?.zeroSales?.data,
    ];
    for (const bucket of buckets) {
        if (!Array.isArray(bucket)) continue;
        for (const r of bucket) {
            rows.push({
                keyword: r?.keyword || r?.keywordText || r?.targetingText || '',
                keywordId: r?.keywordId != null ? String(r.keywordId) : null,
                campaignId: r?.campaignId != null ? String(r.campaignId) : null,
                adGroupId: r?.adGroupId != null ? String(r.adGroupId) : null,
                matchType: r?.matchType || null,
                source: 'campaignAuditParity',
            });
        }
    }

    const keywordData = unifiedData?.bySource?.keywords?.data;
    const allKeywords = keywordData?.allKeywords?.data || [];
    for (const r of allKeywords) {
        rows.push({
            keyword: r?.keyword || '',
            keywordId: r?.keywordId != null ? String(r.keywordId) : null,
            campaignId: r?.campaignId != null ? String(r.campaignId) : null,
            adGroupId: r?.adGroupId != null ? String(r.adGroupId) : null,
            matchType: r?.matchType || null,
            source: 'keywordService',
        });
    }
    return rows.filter((r) => r.keyword);
}

function resolveTargets(targets, universe) {
    const matched = [];
    const ambiguous = [];
    const unmatched = [];
    for (const target of targets) {
        const nTarget = normalizeText(target);
        const exact = universe.filter((r) => normalizeText(r.keyword) === nTarget);
        if (exact.length === 1) {
            matched.push({ target, row: exact[0], strategy: 'exact' });
            continue;
        }
        if (exact.length > 1) {
            ambiguous.push({ target, candidates: exact.slice(0, 5) });
            continue;
        }
        const contains = universe.filter((r) => normalizeText(r.keyword).includes(nTarget) || nTarget.includes(normalizeText(r.keyword)));
        if (contains.length === 1) {
            matched.push({ target, row: contains[0], strategy: 'contains' });
        } else if (contains.length > 1) {
            ambiguous.push({ target, candidates: contains.slice(0, 5) });
        } else {
            unmatched.push(target);
        }
    }
    return { matched, ambiguous, unmatched };
}

function buildExecutablePayloads(action, matches) {
    const adType = action?.adType || 'SP';
    const matchType = action?.matchType || 'negativePhrase';
    const type = action?.type || '';
    const rows = matches.map((m) => m.row);
    const payloads = [];

    if (type === 'block_keywords' || type === 'pause_keywords') {
        const ids = rows.map((r) => r.keywordId).filter(Boolean);
        if (ids.length > 0) {
            payloads.push(
                ids.length > 1
                    ? { ...ACTION_CATALOG.pause_keyword.bulk, body: { keywordIds: ids, adType } }
                    : { ...ACTION_CATALOG.pause_keyword.single, body: { keywordId: ids[0], adType } }
            );
        }
    }

    if (type === 'add_to_negative' || type === 'block_keywords') {
        const keywords = rows
            .filter((r) => r.campaignId && r.keyword)
            .map((r) => ({
                campaignId: r.campaignId,
                adGroupId: r.adGroupId || undefined,
                keywordText: r.keyword,
                matchType: r.matchType || matchType,
            }));
        if (keywords.length > 0) {
            payloads.push({
                ...ACTION_CATALOG.add_to_negative.singleOrBulk,
                body: {
                    keywords,
                    level: keywords.every((k) => k.adGroupId) ? 'adGroup' : 'campaign',
                    matchType,
                },
            });
        }
    }

    if (type === 'pause_and_add_to_negative') {
        const rowsWithAll = rows.filter((r) => r.keywordId && r.campaignId && r.adGroupId && r.keyword);
        if (rowsWithAll.length === 1) {
            const r = rowsWithAll[0];
            payloads.push({
                ...ACTION_CATALOG.pause_and_add_to_negative.single,
                body: {
                    keywordId: r.keywordId,
                    campaignId: r.campaignId,
                    adGroupId: r.adGroupId,
                    keywordText: r.keyword,
                    matchType: r.matchType || matchType,
                    adType,
                },
            });
        } else if (rowsWithAll.length > 1) {
            payloads.push({
                ...ACTION_CATALOG.pause_and_add_to_negative.bulk,
                body: {
                    keywords: rowsWithAll.map((r) => ({
                        keywordId: r.keywordId,
                        campaignId: r.campaignId,
                        adGroupId: r.adGroupId,
                        keywordText: r.keyword,
                        matchType: r.matchType || matchType,
                    })),
                    adType,
                },
            });
        }
    }

    return payloads;
}

function confirmationToken(action, payloads) {
    const raw = JSON.stringify({ action: action?.type, payloads });
    return Buffer.from(raw).toString('base64').slice(0, 64);
}

async function handlePostOperationIntent({ interpretation, unifiedData }) {
    const action = interpretation?.postAction || null;
    const targets = normalizeTargets(action);

    if (!action?.type) {
        return {
            status: 200,
            answer_markdown: 'I detected an action request, but I could not determine the action type.',
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: true,
            clarifying_questions: [
                'Which action do you want? Option 1: Pause keywords, Option 2: Add negative keywords, Option 3: Pause campaigns, Option 4: Cancel',
            ],
            intent_interpretation: interpretation,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    if (targets.length === 0) {
        return {
            status: 200,
            answer_markdown: `I understood the action \`${action.type}\`, but I need exact targets before proceeding.`,
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: true,
            clarifying_questions: [
                'Share the exact targets to apply this action. Example: "pause keyword anti aging cream, witch hazel toner".',
            ],
            intent_interpretation: interpretation,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    const universe = buildKeywordUniverse(unifiedData);
    const resolution = resolveTargets(targets, universe);
    const executablePayloads = buildExecutablePayloads(action, resolution.matched);
    const token = confirmationToken(action, executablePayloads);

    if (resolution.unmatched.length > 0 || executablePayloads.length === 0) {
        return {
            status: 200,
            answer_markdown: 'I could not safely prepare executable actions for all targets yet.',
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: true,
            clarifying_questions: [
                `Unmatched targets: ${resolution.unmatched.join(', ') || 'none'}`,
                'Reply with exact keyword text(s) as seen in your ads tables.',
            ],
            intent_interpretation: interpretation,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: ['campaignAuditParity', 'keywords'],
        };
    }

    if (resolution.ambiguous.length > 0) {
        const examples = resolution.ambiguous
            .slice(0, 2)
            .map((a) => `${a.target}: ${a.candidates.map((c) => c.keyword).join(' | ')}`)
            .join('\n');
        return {
            status: 200,
            answer_markdown: 'I found ambiguous targets. Please pick exact keywords before execution.',
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: true,
            clarifying_questions: [
                `Ambiguous matches:\n${examples}`,
                'Reply with exact keyword text(s) to continue.',
            ],
            intent_interpretation: interpretation,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: ['campaignAuditParity', 'keywords'],
        };
    }

    return {
        status: 200,
        answer_markdown:
            `Action preview ready.\n\n` +
            `- Action: ${action.type}\n` +
            `- Targets provided: ${targets.length}\n` +
            `- Targets matched in account data: ${resolution.matched.length}\n` +
            `- Targets unmatched: ${resolution.unmatched.length}\n` +
            `- Executable steps prepared: ${executablePayloads.length}\n\n` +
            `Use the Fix It actions to execute this safely.`,
        chart_suggestions: [],
        // Phase 4 / Task 4.1: deterministic intent-templated follow-ups
        // sourced from FollowUpGenerator.
        follow_up_questions: generateFollowUps(
            interpretation?.intent,
            interpretation?.entities,
            unifiedData
        ),
        needs_clarification: false,
        content_actions: [
            {
                action: 'confirm_execute',
                type: action.type,
                targets,
                mode: action.mode || 'safe',
                scope: action.scope || 'selection',
                confirmationToken: token,
                unmatchedTargets: resolution.unmatched,
                executablePayloads,
                actionCatalog: ACTION_CATALOG,
            },
        ],
        intent_interpretation: interpretation,
        responseSource: 'deterministic',
        dataConfidence: 'high',
        dataSources: ['campaignAuditParity', 'keywords'],
    };
}

module.exports = { handlePostOperationIntent };
