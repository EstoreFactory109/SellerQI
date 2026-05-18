/**
 * Data-driven ordering of issue categories for suggestion prompts (impact = issue count).
 */

function numeric(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function rankIssueDrivers(context) {
    const issues = context?.issues;
    const drivers = [];

    if (!issues || typeof issues !== 'object') {
        return drivers;
    }

    const inv = numeric(issues.inventory);
    if (inv > 0) drivers.push({ type: 'inventory', impact: inv });

    const ppc = numeric(issues.ppc);
    if (ppc > 0) drivers.push({ type: 'ppc', impact: ppc });

    const ranking = numeric(issues.ranking);
    if (ranking > 0) drivers.push({ type: 'ranking', impact: ranking });

    const conversion = numeric(issues.conversion);
    if (conversion > 0) drivers.push({ type: 'conversion', impact: conversion });

    const profitability = numeric(issues.profitability);
    if (profitability > 0) drivers.push({ type: 'profitability', impact: profitability });

    drivers.sort((a, b) => b.impact - a.impact);
    return drivers;
}

module.exports = { rankIssueDrivers };
