/**
 * Picks a single issues data source for QMate: precomputed (IssueSummary + IssuesDataChunks),
 * summary-only, or live Analyse totals. Avoids mixing incompatible sources in one answer.
 */

function isValidIssueSummary(summary) {
    if (!summary || typeof summary !== 'object') return false;
    if (summary.isStale === true) return false;
    if (!summary.lastCalculatedAt) return false;

    const totalIssues = Number(summary.totalIssues ?? 0);
    const totalActiveProducts = Number(summary.totalActiveProducts ?? 0);
    if (totalIssues === 0 && totalActiveProducts > 0) {
        return false;
    }

    return true;
}

function isValidIssuesChunks(chunks) {
    if (!chunks || typeof chunks !== 'object') return false;
    const data = chunks.data;
    if (!Array.isArray(data) || data.length === 0) return false;
    const itemCount = Number(chunks.itemCount ?? 0);
    if (!Number.isFinite(itemCount) || itemCount <= 0) return false;
    return true;
}

function selectIssuesSource({ issueSummary, issuesChunks, analyseData }) {
    const summaryValid = isValidIssueSummary(issueSummary);
    const chunksValid = isValidIssuesChunks(issuesChunks);

    if (summaryValid && chunksValid) {
        return {
            source: 'precomputed',
            data: {
                summary: issueSummary,
                details: issuesChunks,
            },
        };
    }

    if (summaryValid && !chunksValid) {
        return {
            source: 'summary_only',
            data: {
                summary: issueSummary,
                details: null,
            },
        };
    }

    if (analyseData && typeof analyseData === 'object') {
        return {
            source: 'analyse',
            data: analyseData,
        };
    }

    return {
        source: 'analyse',
        data: analyseData || null,
    };
}

/**
 * Builds a chunks-shaped view from QMateIssuesService.getQMateIssuesContext `data` payload.
 */
function buildIssuesChunksFromQMateContext(issuesContextData) {
    if (!issuesContextData || typeof issuesContextData !== 'object') return null;
    const products = Array.isArray(issuesContextData.topErrorAsins) ? issuesContextData.topErrorAsins : [];
    const ranking = Array.isArray(issuesContextData.rankingIssues) ? issuesContextData.rankingIssues : [];
    const data = products.length > 0 ? products : ranking;
    const itemCount =
        Number(issuesContextData.dataCounts?.productsWithIssuesRetrieved ?? 0) ||
        Number(issuesContextData.summary?.numberOfProductsWithIssues ?? 0) ||
        data.length;
    return { data, itemCount };
}

module.exports = {
    isValidIssueSummary,
    isValidIssuesChunks,
    selectIssuesSource,
    buildIssuesChunksFromQMateContext,
};
