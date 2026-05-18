/* eslint-disable no-console */
const { buildExecutionPlan } = require('../Services/AI/layers/ServiceRouter.js');
const { shouldAskClarification } = require('../Services/AI/layers/ClarificationPolicy.js');
const { resolveRequestContext } = require('../Services/AI/layers/RequestContextResolver.js');
const { handleInformationIntent } = require('../Services/AI/layers/services/InformationService.js');
const { handlePostOperationIntent } = require('../Services/AI/layers/services/PostOperationService.js');
const { interpretPrompt } = require('../QMate/interpreter/PromptInterpreter.js');
const {
    buildProfitabilityDerived,
    buildPpcDerived,
    buildIssuesDerived,
} = require('../Services/AI/layers/services/helpers/FrontendParityCalculations.js');
const { buildLLMContext } = require('../Services/AI/layers/helpers/LLMContextBuilder.js');
const {
    selectIssuesSource,
    isValidIssueSummary,
    isValidIssuesChunks,
} = require('../Services/AI/layers/helpers/SourceSelector.js');
const { rankIssueDrivers } = require('../Services/AI/layers/helpers/ReasonRanking.js');
const { validateAnswer } = require('../Services/AI/layers/helpers/ResponseValidator.js');
const { enforceDomain, isAmazonQuery } = require('../Services/AI/layers/guards/DomainGuard.js');
const { isGenericResponse } = require('../Services/AI/layers/guards/ResponseFilter.js');
const { needsClarification } = require('../Services/AI/layers/guards/VagueQueryGuard.js');
const { isOnboardingQuery, CAPABILITIES_ANSWER } = require('../Services/AI/layers/helpers/IntentGuards.js');
const { softenResponse } = require('../Services/AI/layers/helpers/ResponseSoftener.js');
const { buildDiscreteClarificationPrompt } = require('../Services/AI/layers/ClarificationPolicy.js');
const { extractAsin, hasAsin } = require('../Services/AI/layers/helpers/EntityGuards.js');
const {
    selectRelevantDomains,
    buildAsinFacts,
    buildDeterministicSummary,
    buildAsinContextText,
    handleAsinDeepDive,
} = require('../Services/AI/layers/services/AsinDeepDiveService.js');

function assert(name, condition) {
    if (!condition) {
        throw new Error(`FAILED: ${name}`);
    }
    console.log(`PASS: ${name}`);
}

async function testRouting() {
    assert(
        'route value_lookup -> information',
        buildExecutionPlan({ intent: 'value_lookup' }).serviceType === 'information'
    );
    assert(
        'route suggestion -> suggestion_engine',
        buildExecutionPlan({ intent: 'suggestion' }).serviceType === 'suggestion_engine'
    );
    assert(
        'route post_action -> post_operation',
        buildExecutionPlan({ intent: 'post_action' }).serviceType === 'post_operation'
    );
    assert(
        'value_lookup lean information plan requests metrics',
        buildExecutionPlan({ intent: 'value_lookup' }).dataRequirements.metrics === true
    );
    assert(
        'value_lookup lean plan does not fetch reimbursement (accuracy path)',
        buildExecutionPlan({ intent: 'value_lookup' }).dataRequirements.reimbursement === false
    );
    assert(
        'top products productQuery routes to information not suggestion_engine',
        buildExecutionPlan({
            intent: 'suggestion',
            routing: { engine: 'suggestion_engine' },
            entities: {
                metrics: [],
                productQuery: { type: 'top_n_products', metric: 'sales', limit: 10 },
                queryShape: 'ranking',
            },
        }).serviceType === 'information'
    );
    assert(
        'explanation + metrics stays on suggestion_engine',
        buildExecutionPlan({
            intent: 'detailed_explanation',
            routing: { engine: 'suggestion_engine' },
            entities: {
                metrics: ['revenue'],
                queryShape: 'explanation',
            },
        }).serviceType === 'suggestion_engine'
    );
}

function testClarificationPolicy() {
    const lowConfidence = shouldAskClarification({
        interpretation: { confidence: 0.1 },
        resolvedContext: { clarificationState: { attempts: 0, maxAttempts: 2 } },
        threshold: 0.35,
        skipForSimple: false,
    });
    assert('ask clarification under threshold', lowConfidence.ask === true);

    const exhausted = shouldAskClarification({
        interpretation: { confidence: 0.1 },
        resolvedContext: { clarificationState: { attempts: 2, maxAttempts: 2 } },
        threshold: 0.35,
        skipForSimple: false,
    });
    assert('stop clarification after two attempts', exhausted.exhausted === true);

    const explicitNeed = shouldAskClarification({
        interpretation: { confidence: 0.95, clarification: { needed: true, reasons: ['missing_action_targets'] } },
        resolvedContext: { clarificationState: { attempts: 0, maxAttempts: 2 } },
        threshold: 0.35,
        skipForSimple: true,
    });
    assert('layer1 explicit clarification overrides simple bypass', explicitNeed.ask === true);

    const metricBypass = shouldAskClarification({
        interpretation: {
            confidence: 0.05,
            routing: { engine: 'information_engine' },
            entities: { metrics: ['expenses'], queryShape: 'single_metric_lookup' },
            clarification: { needed: false, reasons: [] },
        },
        resolvedContext: { clarificationState: { attempts: 0, maxAttempts: 2 } },
        threshold: 0.35,
        skipForSimple: false,
    });
    assert('clear metric query bypasses confidence clarification', metricBypass.ask === false);
}

async function testInformationAnswers() {
    const gross = await handleInformationIntent({
        interpretation: { intent: 'value_lookup' },
        question: 'what is gross profit for last 30 days',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: {
                    data: {
                        summary: { currency: 'USD', grossProfit: 9239.69, totalSales: 19460.15, ppcSpend: 988.95 },
                        expenses: { totalExpenses: { total: 9231.51 } },
                    },
                },
                profitabilityParity: {
                    data: {
                        summary: { totalSales: 19460.15, totalExpenses: 9231.51 },
                        snapshot: { totals: { totalExpenses: 9231.51 } },
                    },
                },
                salesOnlyParity: {
                    data: {
                        totalSales: { amount: 19460.15, currencyCode: 'USD' },
                        ppcSpent: { amount: 988.95, currencyCode: 'USD' },
                    },
                },
                campaignAuditParity: {
                    data: {
                        summary: { spend: 1200.0 },
                    },
                },
            },
        },
    });
    assert('gross profit deterministic value', /9239\.69/.test(gross.answer_markdown));

    const wasted = await handleInformationIntent({
        interpretation: { intent: 'value_lookup' },
        question: 'tell me money wasted in ads',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' }, wastedAds: { totalWastedSpend: 98.45 } } },
            },
        },
    });
    assert('wasted ads deterministic value', /98\.45/.test(wasted.answer_markdown));

    const reimbursement = await handleInformationIntent({
        interpretation: { intent: 'value_lookup' },
        question: 'how much reimbursement is recoverable',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                reimbursement: {
                    data: {
                        recoverable: { summary: { totalRecoverable: 456.78 } },
                        received: { summary: { totalAmount: 123.45, currency: 'USD' } },
                    },
                },
            },
        },
    });
    assert('reimbursement deterministic value', /456\.78/.test(reimbursement.answer_markdown));

    const bestSelling = await handleInformationIntent({
        interpretation: {
            intent: 'value_lookup',
            outputPreference: { format: 'single_number' },
            entities: { productQuery: { type: 'best_selling_product', metric: 'sales', limit: 1 } },
        },
        question: 'give me my best selling product',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                profitabilityParity: {
                    data: {
                        tableFullForAI: {
                            rows: [
                                { asin: 'B000000001', totalSales: 50 },
                                { asin: 'B000000002', totalSales: 100 },
                            ],
                        },
                    },
                },
            },
        },
    });
    assert('best selling product value', /B000000002/.test(bestSelling.answer_markdown));

    const mostProfitable = await handleInformationIntent({
        interpretation: {
            intent: 'value_lookup',
            entities: { productQuery: { type: 'best_selling_product', metric: 'profit', limit: 1 } },
        },
        question: 'which product of mine is most profitable',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                profitabilityParity: {
                    data: {
                        tableFullForAI: {
                            rows: [
                                { asin: 'B000000001', totalSales: 500, grossProfit: 20 },
                                { asin: 'B000000002', totalSales: 900, grossProfit: 10 },
                                { asin: 'B000000003', totalSales: 300, grossProfit: 80 },
                            ],
                        },
                    },
                },
            },
        },
    });
    assert(
        'most profitable product selects by grossProfit not totalSales',
        /B000000003/.test(mostProfitable.answer_markdown) && /most profitable/i.test(mostProfitable.answer_markdown)
    );

    const topNProfit = await handleInformationIntent({
        interpretation: {
            intent: 'value_lookup',
            entities: { productQuery: { type: 'top_n_products', metric: 'profit', limit: 3 } },
        },
        question: 'top 3 most profitable products',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                profitabilityParity: {
                    data: {
                        tableFullForAI: {
                            rows: [
                                { asin: 'B000000001', totalSales: 500, grossProfit: 20 },
                                { asin: 'B000000002', totalSales: 900, grossProfit: 10 },
                                { asin: 'B000000003', totalSales: 300, grossProfit: 80 },
                                { asin: 'B000000004', totalSales: 100, grossProfit: 5 },
                            ],
                        },
                    },
                },
            },
        },
    });
    assert(
        'top-N profitable orders by grossProfit',
        /B000000003/.test(topNProfit.answer_markdown.split('\n')[1]) &&
            /B000000001/.test(topNProfit.answer_markdown) &&
            /gross profit/i.test(topNProfit.answer_markdown)
    );

    const issuesCount = await handleInformationIntent({
        interpretation: { intent: 'value_lookup', outputPreference: { format: 'single_number' } },
        question: 'how many total issues do i have',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                issuesPageParity: {
                    data: {
                        byCategory: {
                            summary: {
                                ranking: 3,
                                conversion: 2,
                                inventory: 1,
                                account: 4,
                            },
                        },
                    },
                },
            },
        },
    });
    assert('issues total deterministic value', /10/.test(issuesCount.answer_markdown));

    const totalExpenses = await handleInformationIntent({
        interpretation: { intent: 'value_lookup', outputPreference: { format: 'single_number' } },
        question: 'what is total expences for last 30 days',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                profitabilityParity: {
                    data: {
                        snapshot: { totals: { totalExpenses: 7349.83 } },
                        summary: { totalExpenses: 678.9 },
                    },
                },
                metrics: {
                    data: {
                        summary: { currency: 'USD' },
                        expenses: { totalExpenses: { total: 678.9 } },
                    },
                },
            },
        },
    });
    assert('total expenses deterministic value', /7349\.83/.test(totalExpenses.answer_markdown));

    const otherExpenses = await handleInformationIntent({
        interpretation: { intent: 'value_lookup', outputPreference: { format: 'single_number' } },
        question: 'what is other expenses for last 30 days',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD', refunds: 50 } } },
                profitabilityParity: {
                    data: {
                        snapshot: { totals: { totalExpenses: 1000, amazonFees: 300 } },
                    },
                },
            },
        },
    });
    assert('other expenses formula deterministic value', /650\.00/.test(otherExpenses.answer_markdown));

    const refunds = await handleInformationIntent({
        interpretation: { intent: 'value_lookup', outputPreference: { format: 'single_number' } },
        question: 'give me refunds of last 30 days',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD', refunds: 123.45 } } },
            },
        },
    });
    assert('refunds deterministic value', /123\.45/.test(refunds.answer_markdown));

    const totalSales = await handleInformationIntent({
        interpretation: { intent: 'value_lookup', outputPreference: { format: 'single_number' } },
        question: 'what is total sales for last 30 days',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                salesOnlyParity: {
                    data: {
                        totalSales: { amount: 19797.5, currencyCode: 'USD' },
                    },
                },
                profitabilityParity: { data: { summary: { totalSales: 19297.72 } } },
                metrics: { data: { summary: { currency: 'USD', totalSales: 19297.72 } } },
            },
        },
    });
    assert('total sales prefers sales-only parity source', /19797\.50/.test(totalSales.answer_markdown));

    const salesProfitGraph = await handleInformationIntent({
        interpretation: { intent: 'graph', outputPreference: { format: 'graph' } },
        question: 'graphical representation of total sales vs total profit from 1st April 2026 to 12th April 2026',
        resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
        unifiedData: {
            bySource: {
                metrics: { data: { summary: { currency: 'USD' } } },
                profitabilityParity: {
                    data: {
                        chart: [
                            { date: '2026-04-01', totalSales: 100, totalExpenses: 9999 },
                            { date: '2026-04-02', totalSales: 120, totalExpenses: 9999 },
                        ],
                        expenses: {
                            datewise: [
                                { date: '2026-04-01', totalAmount: 40 },
                                { date: '2026-04-02', totalAmount: 50 },
                            ],
                        },
                        ppcGraph: {
                            graphData: [
                                { rawDate: '2026-04-01', spend: 10 },
                                { rawDate: '2026-04-02', spend: 20 },
                            ],
                        },
                    },
                },
                salesOnlyParity: {
                    data: {
                        datewiseChartData: [
                            { originalDate: '2026-04-01', totalSales: 562 },
                            { originalDate: '2026-04-02', totalSales: 494 },
                        ],
                    },
                },
            },
        },
    });
    assert('sales vs profit graph returns chart suggestions', Array.isArray(salesProfitGraph.chart_suggestions) && salesProfitGraph.chart_suggestions.length > 0);
    assert('sales vs profit graph uses datewise expenses source', /512/.test(String(salesProfitGraph.chart_suggestions?.[0]?.data?.[0]?.grossProfit)));
    assert('sales vs profit graph prefers sales-only datewise sales source', /562/.test(String(salesProfitGraph.chart_suggestions?.[0]?.data?.[0]?.totalSales)));
}

async function testPromptInterpretationVariants() {
    const q1 = await interpretPrompt({ prompt: 'tell me the sales of B000000001' });
    assert('extract asin metric lookup', q1.entities?.productQuery?.type === 'asin_metric_lookup');

    const q2 = await interpretPrompt({ prompt: 'give me the asin of my best selling product' });
    assert('extract best selling product query', q2.entities?.productQuery?.type === 'best_selling_product');

    const q3 = await interpretPrompt({ prompt: 'give me the list of top 10 selling products' });
    assert('extract top n products query', q3.entities?.productQuery?.type === 'top_n_products' && q3.entities?.productQuery?.limit === 10);

    const q3b = await interpretPrompt({ prompt: 'which product of mine is most profitable' });
    assert(
        'extract most profitable single product',
        q3b.entities?.productQuery?.type === 'best_selling_product' &&
            q3b.entities?.productQuery?.metric === 'profit' &&
            q3b.entities?.productQuery?.limit === 1
    );

    const q3c = await interpretPrompt({ prompt: 'top ten most profitable products' });
    assert(
        'extract top N profitable products via word-number',
        q3c.entities?.productQuery?.type === 'top_n_products' &&
            q3c.entities?.productQuery?.metric === 'profit' &&
            q3c.entities?.productQuery?.limit === 10
    );

    const q3d = await interpretPrompt({ prompt: 'give me top five highest sales products' });
    assert(
        'extract top-five word-number sales ranking',
        q3d.entities?.productQuery?.type === 'top_n_products' &&
            q3d.entities?.productQuery?.metric === 'sales' &&
            q3d.entities?.productQuery?.limit === 5
    );

    const q4 = await interpretPrompt({ prompt: 'compare sales for my products' });
    assert(
        'comparison missing entities requires clarification',
        q4.clarification?.needed === true &&
            Array.isArray(q4.clarification?.reasons) &&
            q4.clarification.reasons.includes('missing_comparison_entities')
    );

    const q5 = await interpretPrompt({ prompt: 'pause and add anti aging cream to negative' });
    assert('extract pause and add action', q5.postAction?.type === 'pause_and_add_to_negative');

    const q6 = await interpretPrompt({ prompt: 'add anti aging cream to negative exact in sponsored products' });
    assert(
        'extract action metadata for negatives',
        q6.postAction?.type === 'add_to_negative' &&
            q6.postAction?.matchType === 'negativeExact' &&
            q6.postAction?.adType === 'SP'
    );

    const q7 = await interpretPrompt({ prompt: 'what about total expences from 10th april to 14th april' });
    assert('absolute range extracted from natural-language dates', q7.entities?.timeRange?.type === 'absolute_range');
    assert('clear metric query avoids uncertain-intent clarification', q7.clarification?.needed === false);

    const q8 = await interpretPrompt({ prompt: 'gross profit from 25th March 2026 to 12th April, 2026' });
    assert('absolute range with years and comma is extracted', q8.entities?.timeRange?.startDate === '2026-03-25' && q8.entities?.timeRange?.endDate === '2026-04-12');

    const q9 = await interpretPrompt({ prompt: 'graphical representation of total sales vs total profit from 1st April 2026 to 12th April 2026' });
    assert('metric vs metric comparison does not require ASIN clarification', q9.clarification?.reasons?.includes('missing_comparison_entities') !== true);
}

async function testRequestContextDatePrecedence() {
    const interpreted = await interpretPrompt({ prompt: 'gross profit from 25th March 2026 to 12th April, 2026' });
    const ctx = resolveRequestContext({
        interpreted,
        request: {},
        runtimeContext: {
            startDate: '2026-04-01',
            endDate: '2026-04-06',
            calendarMode: 'custom',
            userId: 'u',
            country: 'US',
            region: 'NA',
        },
    });
    assert('prompt absolute range overrides runtime context dates', ctx.startDate === '2026-03-25' && ctx.endDate === '2026-04-12');
}

async function testPostOperationReadiness() {
    const baseInterpretation = {
        intent: 'post_action',
        postAction: {
            type: 'pause_and_add_to_negative',
            targets: ['anti aging cream'],
            adType: 'SP',
            matchType: 'negativePhrase',
            mode: 'preview',
        },
    };

    const preview = await handlePostOperationIntent({
        interpretation: baseInterpretation,
        unifiedData: {
            bySource: {
                campaignAuditParity: {
                    data: {
                        wastedSpend: {
                            data: [
                                {
                                    keyword: 'anti aging cream',
                                    keywordId: '101',
                                    campaignId: '201',
                                    adGroupId: '301',
                                },
                            ],
                        },
                    },
                },
            },
        },
    });
    assert('preview-first action contract', preview.content_actions?.[0]?.action === 'confirm_execute');
    assert('confirmation token present', Boolean(preview.content_actions?.[0]?.confirmationToken));
    assert(
        'endpoint-ready payload generated',
        preview.content_actions?.[0]?.executablePayloads?.[0]?.endpoint === '/api/pagewise/ads/pause-and-add-to-negative'
    );

    const ambiguous = await handlePostOperationIntent({
        interpretation: baseInterpretation,
        unifiedData: {
            bySource: {
                campaignAuditParity: {
                    data: {
                        wastedSpend: {
                            data: [
                                { keyword: 'anti aging cream', keywordId: '1', campaignId: '2', adGroupId: '3' },
                                { keyword: 'anti aging cream', keywordId: '4', campaignId: '5', adGroupId: '6' },
                            ],
                        },
                    },
                },
            },
        },
    });
    assert('ambiguous targets trigger clarification', ambiguous.needs_clarification === true);
}

function testGuardrails() {
    assert('domain allows seller sales question', isAmazonQuery('Why are my sales dropping?') === true);
    assert('domain blocks off-topic joke', enforceDomain('Tell me a joke').blocked === true);
    assert('domain allows help me', enforceDomain('help me').blocked === false);
    assert('domain allows what can you help', enforceDomain('What can you help me with?').blocked === false);
    assert('domain allows tell me something for clarification path', enforceDomain('Tell me something').blocked === false);
    assert('domain allows seller vocab title/reviews/rating/pricing', [
        'Why is my product title suppressed?',
        'How many reviews do I have?',
        'Show my product ratings',
        'Is my pricing competitive?',
        'Any returns this week?',
    ].every((q) => enforceDomain(q).blocked === false));
    assert(
        'domain allows expenses typo with time range',
        enforceDomain('what is my expences of last 7 days').blocked === false
    );
    assert(
        'domain allows my + relative time range heuristic',
        enforceDomain('how are my numbers this week').blocked === false
    );
    assert(
        'domain still blocks off-topic time-range without my/our',
        enforceDomain('what is the weather today').blocked === true
    );
    assert('needsClarification on bare help', needsClarification('help') === true);
    assert('needsClarification on tell me something', needsClarification('Tell me something') === true);
    assert('generic response filter catches LLM trope', isGenericResponse('As an AI language model I cannot...') === true);
}

function testOnboardingBypass() {
    assert('onboarding detects bare help', isOnboardingQuery('help') === true);
    assert('onboarding detects what can you help', isOnboardingQuery('What can you help me with?') === true);
    assert('onboarding detects what can you do', isOnboardingQuery('what can you do') === true);
    assert('onboarding detects how can you help', isOnboardingQuery('How can you help?') === true);
    assert('onboarding detects hi greeting', isOnboardingQuery('hi') === true);
    assert('onboarding ignores real seller question', isOnboardingQuery('Why are my sales dropping?') === false);
    assert('onboarding ignores tell me something (stays vague)', isOnboardingQuery('Tell me something') === false);
    assert(
        'capabilities answer avoids generic LLM tropes',
        isGenericResponse(CAPABILITIES_ANSWER) === false
    );
}

function testResponseSoftener() {
    assert(
        'softener strips "Please choose"',
        /please choose/i.test(softenResponse('Please choose one option to proceed.')) === false
    );
    assert(
        'softener strips "Option 1 / Option 2" scaffolding',
        /option\s*[1-4]/i.test(
            softenResponse('Option 1: Single value. Option 2: Full breakdown. Option 3: Chart.')
        ) === false
    );
    assert(
        'softener preserves substantive content',
        /gross profit is \$1200/.test(softenResponse('Your gross profit is $1200.'))
    );
}

function buildMockDeepDiveBundle(overrides = {}) {
    return {
        asin: 'B0DPFZNWBM',
        domains: { basicInfo: true, performance: true, ppcIssues: true, issues: true },
        bundle: {
            basicInfo: {
                success: true,
                data: {
                    asin: 'B0DPFZNWBM', name: 'Demo Product', sku: 'SKU1', price: 19.99,
                    sales: 1200, unitsSold: 60, grossProfit: -115.43,
                    amzFee: 150, fbaFees: 80, storageFees: 15, totalFees: 245,
                    refunds: 20, adsSpend: 420,
                    starRating: 4.2, numRatings: 132, hasAPlus: false, hasBrandStory: false,
                },
            },
            performance: {
                success: true,
                data: {
                    sessions: 1500, pageViews: 2200, conversionRate: 4.0, buyBoxPercentage: 88,
                    sales: 1200, ppcSpend: 420, ppcSales: 600,
                    impressions: 32000, clicks: 450, acos: 70, ctr: 1.4,
                },
            },
            ppcIssues: {
                success: true,
                data: {
                    asin: 'B0DPFZNWBM', hasAds: true,
                    summary: { totalIssues: 3, criticalIssues: 2, warningIssues: 1 },
                    ppcMetrics: { spend: 420, sales: 600, acos: 70, impressions: 32000, clicks: 450, cpc: 0.93, roas: 1.43, conversionRate: 3.2 },
                    issues: [
                        { type: 'HIGH_ACOS', severity: 'critical', title: 'ACOS above break-even', recommendation: 'Pause wasted keywords.' },
                        { type: 'LOW_CTR', severity: 'warning', title: 'CTR below 0.5%', recommendation: 'Refresh ad creative.' },
                    ],
                },
            },
            issues: {
                success: true, source: 'issues_data_chunks',
                data: {
                    asin: 'B0DPFZNWBM', totalErrors: 5,
                    errorCounts: { ranking: 2, conversion: 2, inventory: 1 },
                    rankingErrors: {}, conversionErrors: {}, inventoryErrors: {},
                },
            },
            ...(overrides.bundle || {}),
        },
    };
}

function testAsinDeepDiveSelectorAndFormatting() {
    const lossDomains = selectRelevantDomains('why is B0DPFZNWBM making loss');
    assert(
        'loss question selects full deep dive',
        lossDomains.basicInfo && lossDomains.performance && lossDomains.ppcIssues && lossDomains.issues
    );
    const ppcDomains = selectRelevantDomains('acos for B0DPFZNWBM');
    assert(
        'acos question selects ppcIssues without performance/issues',
        ppcDomains.ppcIssues === true && ppcDomains.performance === false && ppcDomains.issues === false
    );
    const saleDomains = selectRelevantDomains('B0DPFZNWBM sales');
    assert(
        'simple sales question selects basicInfo + issues fallback',
        saleDomains.basicInfo === true && saleDomains.issues === true && saleDomains.ppcIssues === false
    );
    const perfDomains = selectRelevantDomains('how is B0DPFZNWBM performing');
    assert(
        'performance question selects performance domain',
        perfDomains.performance === true
    );

    const facts = buildAsinFacts(buildMockDeepDiveBundle(), 'USD');
    assert('reconciled sales picked up from basic info', facts.reconciled.sales === 1200);
    assert('reconciled gross profit surfaced', facts.reconciled.grossProfit === -115.43);
    assert('reconciled ad spend surfaced', facts.reconciled.adsSpend === 420);

    const summary = buildDeterministicSummary(facts);
    assert('deterministic summary mentions sales', /Sales: USD 1200\.00/.test(summary));
    assert('deterministic summary mentions ad spend', /Ad spend: USD 420\.00/.test(summary));
    assert('deterministic summary mentions ACOS', /ACOS: 70\.00%/.test(summary));
    assert('deterministic summary mentions gross profit', /Gross profit: USD -115\.43/.test(summary));
    assert('deterministic summary mentions open issues', /Open issues: 5/.test(summary));

    const ctx = buildAsinContextText(facts);
    assert(
        'LLM context text includes PPC and issue counts',
        /PPC:/.test(ctx) && /ISSUE COUNTS:/.test(ctx) && /Ranking errors: 2/.test(ctx)
    );
}

async function testAsinDeepDiveReasoningHandler() {
    // Monkey-patch the product-detail services to avoid DB calls during the test.
    const ProductBasicInfoService = require('../Services/Calculations/ProductBasicInfoService.js');
    const ProductPerformanceService = require('../Services/Calculations/ProductPerformanceService.js');
    const ProductPPCIssuesService = require('../Services/Calculations/ProductPPCIssuesService.js');
    const QMateProductsService = require('../Services/AI/QMateProductsService.js');

    const originals = {
        basic: ProductBasicInfoService.getProductBasicInfo,
        perf: ProductPerformanceService.getProductPerformanceByAsin,
        ppc: ProductPPCIssuesService.getProductPPCIssues,
        full: QMateProductsService.getFullAsinIssues,
    };

    const mock = buildMockDeepDiveBundle();
    ProductBasicInfoService.getProductBasicInfo = async () => mock.bundle.basicInfo;
    ProductPerformanceService.getProductPerformanceByAsin = async () => mock.bundle.performance;
    ProductPPCIssuesService.getProductPPCIssues = async () => mock.bundle.ppcIssues;
    QMateProductsService.getFullAsinIssues = async () => mock.bundle.issues;

    let capturedMessages = null;
    const modelTools = {
        client: {},
        createCompletionWithFallback: async (_client, messages) => {
            capturedMessages = messages;
            return {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            answer: 'B0DPFZNWBM is losing money because ad spend of USD 420.00 exceeds the attributed PPC sales and ACOS at 70% is well above break-even. Pause wasted keywords and fix the conversion issues to turn this around.',
                            confidence: 'high',
                        }),
                    },
                }],
            };
        },
    };

    try {
        // Reasoning path
        const reasoning = await handleAsinDeepDive({
            interpretation: {
                intent: 'value_lookup',
                entities: { asins: ['B0DPFZNWBM'], queryShape: 'explanation' },
                outputPreference: { format: 'unspecified' },
            },
            unifiedData: { bySource: { metrics: { data: { summary: { currency: 'USD' } } } } },
            question: 'tell me why B0DPFZNWBM is making loss',
            resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
            modelTools,
        });
        assert(
            'deep-dive reasoning answer mentions ad spend and ACOS',
            /ad spend/i.test(reasoning.answer_markdown) && /70%/.test(reasoning.answer_markdown)
        );
        assert(
            'deep-dive prompt includes reconciled facts for LLM',
            capturedMessages && /FINANCIALS/.test(capturedMessages[1].content) && /ACOS: 70\.00%/.test(capturedMessages[1].content)
        );
        assert(
            'deep-dive follow-ups reference ASIN',
            Array.isArray(reasoning.follow_up_questions) && reasoning.follow_up_questions[0].includes('B0DPFZNWBM')
        );

        // Deterministic path
        const deterministic = await handleAsinDeepDive({
            interpretation: {
                intent: 'value_lookup',
                entities: { asins: ['B0DPFZNWBM'], queryShape: 'single_metric_lookup' },
                outputPreference: { format: 'unspecified' },
            },
            unifiedData: { bySource: { metrics: { data: { summary: { currency: 'USD' } } } } },
            question: 'B0DPFZNWBM sales',
            resolvedContext: { userId: 'u', country: 'US', region: 'NA' },
            modelTools,
        });
        assert(
            'deep-dive deterministic answer shows sales value',
            /Sales: USD 1200\.00/.test(deterministic.answer_markdown)
        );
        assert('deep-dive deterministic skips LLM', !/\bbecause\b/i.test(deterministic.answer_markdown));
    } finally {
        ProductBasicInfoService.getProductBasicInfo = originals.basic;
        ProductPerformanceService.getProductPerformanceByAsin = originals.perf;
        ProductPPCIssuesService.getProductPPCIssues = originals.ppc;
        QMateProductsService.getFullAsinIssues = originals.full;
    }
}

function testAsinHandling() {
    assert('extractAsin parses uppercase', extractAsin('B0DPFZNWBM sales') === 'B0DPFZNWBM');
    assert(
        'extractAsin is case-insensitive and normalizes',
        extractAsin('tell me why b0dpfznwbm is losing money') === 'B0DPFZNWBM'
    );
    assert('extractAsin returns null for no-asin query', extractAsin('help me') === null);
    assert('hasAsin true with asin', hasAsin('how is B0DPFZNWBM performing') === true);
    assert('hasAsin false without asin', hasAsin('show my sales') === false);

    const dec = shouldAskClarification({
        interpretation: {
            confidence: 0.05,
            entities: { asins: ['B0DPFZNWBM'] },
            clarification: { needed: false },
        },
        resolvedContext: { clarificationState: { attempts: 0, maxAttempts: 2 } },
        threshold: 0.35,
        skipForSimple: false,
        question: 'why is B0DPFZNWBM losing money',
    });
    assert('clarification bypassed when ASIN present', dec.ask === false && dec.reason === 'asin_bypass');

    const layer1 = shouldAskClarification({
        interpretation: {
            confidence: 0.9,
            entities: { asins: ['B0DPFZNWBM'] },
            clarification: { needed: true, reasons: ['missing_action_targets'] },
        },
        resolvedContext: { clarificationState: { attempts: 0, maxAttempts: 2 } },
        threshold: 0.35,
        question: 'pause keyword for B0DPFZNWBM',
    });
    assert('ASIN does NOT override explicit layer1 clarification need', layer1.ask === true);
}

function testClarificationPromptIsConversational() {
    const prompt = buildDiscreteClarificationPrompt();
    assert('discrete prompt is not option-numbered form', /option\s*[1-4]/i.test(prompt) === false);
    assert('discrete prompt does not say "Please choose"', /please choose/i.test(prompt) === false);
    assert('discrete prompt is non-empty conversational text', typeof prompt === 'string' && prompt.length > 10);
}

function testReasonRankingAndValidation() {
    const ranked = rankIssueDrivers({
        issues: { ppc: 2, inventory: 5, ranking: 1, conversion: 0, profitability: 3, total: 11 },
    });
    assert('rank drivers by impact descending', ranked[0].type === 'inventory' && ranked[0].impact === 5);
    assert(
        'validateAnswer allows no-issues phrasing when counts are zero',
        validateAnswer('You have no issues in the summary.', {
            issues: { total: 0, inventory: 0, ppc: 0, ranking: 0, conversion: 0, profitability: 0 },
        }) === true
    );
    assert(
        'validateAnswer rejects issue claims without data',
        validateAnswer('We have detected critical inventory issues you must fix.', {
            issues: { total: 0, inventory: 0, ppc: 0, ranking: 0, conversion: 0, profitability: 0 },
        }) === false
    );
}

function testSourceSelector() {
    const lastOk = new Date().toISOString();
    const pre = selectIssuesSource({
        issueSummary: {
            totalIssues: 12,
            totalActiveProducts: 5,
            lastCalculatedAt: lastOk,
            isStale: false,
        },
        issuesChunks: { data: [{ asin: 'X' }], itemCount: 3 },
        analyseData: { totalIssues: 99 },
    });
    assert('Case1 valid cache -> precomputed', pre.source === 'precomputed');

    const stale = selectIssuesSource({
        issueSummary: {
            totalIssues: 0,
            totalActiveProducts: 10,
            lastCalculatedAt: lastOk,
            isStale: false,
        },
        issuesChunks: { data: [], itemCount: 0 },
        analyseData: { totalIssues: 44 },
    });
    assert('Case2 false-zero summary -> analyse', stale.source === 'analyse' && stale.data.totalIssues === 44);

    const partial = selectIssuesSource({
        issueSummary: {
            totalIssues: 8,
            totalActiveProducts: 2,
            lastCalculatedAt: lastOk,
            isStale: false,
        },
        issuesChunks: { data: [], itemCount: 0 },
        analyseData: { totalIssues: 1 },
    });
    assert('Case3 chunks missing -> summary_only', partial.source === 'summary_only');

    const none = selectIssuesSource({
        issueSummary: {
            isStale: true,
            totalIssues: 5,
            totalActiveProducts: 1,
            lastCalculatedAt: lastOk,
        },
        issuesChunks: null,
        analyseData: { totalIssues: 7 },
    });
    assert('Case4 stale summary -> analyse', none.source === 'analyse');

    assert('validator rejects stale flag', isValidIssueSummary({ totalIssues: 1, lastCalculatedAt: lastOk, isStale: true }) === false);
    assert('validator rejects empty chunks', isValidIssuesChunks({ data: [], itemCount: 0 }) === false);
}

function testLLMContextBuilder() {
    const ctx = buildLLMContext(
        {
            bySource: {
                metrics: {
                    data: {
                        summary: { totalSales: 100, grossProfit: 40, ppcSpend: 10 },
                    },
                },
                issues: {
                    data: {
                        totalIssues: 5,
                        inventoryErrors: 2,
                        sponsoredAdsErrors: 1,
                    },
                },
                products: { data: { topProducts: [{ asin: 'A', totalSales: 50 }, { asin: 'B', totalSales: 40 }] } },
                inventory: { data: { summary: { skuCount: 12 } } },
            },
        },
        {}
    );
    assert('LLM context maps metrics summary', ctx.sales === 100 && ctx.profit === 40 && ctx.adSpend === 10);
    assert(
        'LLM context maps issues counts',
        ctx.issues.total === 5 && ctx.issues.inventory === 2 && ctx.issues.ppc === 1
    );
    assert('LLM context caps top products', Array.isArray(ctx.topProducts) && ctx.topProducts.length === 2);
    assert('LLM context includes inventory summary', ctx.inventory && ctx.inventory.skuCount === 12);
}

function testFrontendParityCalculations() {
    const profitability = buildProfitabilityDerived({
        profitabilityParity: {
            summary: { totalSales: 1000, totalExpenses: 300, grossProfit: 20 },
            tableFullForAI: {
                rows: [
                    { asin: 'B1', totalSales: 100, grossProfit: -10 },
                    { asin: 'B2', totalSales: 100, grossProfit: 5 },
                    { asin: 'B3', totalSales: 100, grossProfit: 30 },
                ],
            },
        },
        campaignAuditParity: {
            summary: { spend: 800 },
            wastedSpend: { data: [{ spend: 10 }, { spend: 15 }] },
        },
        reimbursement: {
            recoverable: { summary: { totalRecoverable: 55 } },
            received: { summary: { totalAmount: 25 } },
        },
    });
    assert('profitability derived totals', profitability.totalSales === 1000 && profitability.totalExpenses === 300);
    assert('export-like health categorization', profitability.productHealth.businessHealth === 'CRITICAL');

    const ppc = buildPpcDerived({
        campaignAuditParity: {
            highAcos: { data: [{}, {}] },
            wastedSpend: { data: [{ spend: 20 }, { spend: 5 }] },
            topKeywords: { data: [{ sales: 100, spend: 20 }, { sales: 50, spend: 15 }] },
            zeroSales: { data: [{}, {}, {}] },
        },
    });
    assert('ppc derived wasted spend total', ppc.totals.totalWastedSpend === 25);
    assert('ppc derived acos-like ratio', /23\.33/.test(String(ppc.totals.topKeywordAcos.toFixed(2))));

    const issues = buildIssuesDerived({
        issuesPageParity: {
            byCategory: {
                summary: { ranking: 3, conversion: 2, inventory: 1, account: 4 },
            },
        },
        issuesByProductParity: {
            productWiseError: [{}, {}, {}],
        },
    });
    assert('issues derived total count', issues.counts.totalIssues === 10);
}

async function run() {
    await testRouting();
    testClarificationPolicy();
    await testInformationAnswers();
    await testPromptInterpretationVariants();
    await testRequestContextDatePrecedence();
    testFrontendParityCalculations();
    testGuardrails();
    testOnboardingBypass();
    testResponseSoftener();
    testAsinHandling();
    testAsinDeepDiveSelectorAndFormatting();
    await testAsinDeepDiveReasoningHandler();
    testClarificationPromptIsConversational();
    testReasonRankingAndValidation();
    testSourceSelector();
    testLLMContextBuilder();
    await testPostOperationReadiness();
    console.log('All QMate layered regression checks passed.');
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
