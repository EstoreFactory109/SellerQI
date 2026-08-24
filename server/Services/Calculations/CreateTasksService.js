/**
 * Create Tasks Service
 * 
 * This service handles creating tasks from error data received from the calculation service.
 * It accepts all error categories: ranking, conversion, inventory, profitability, sponsoredAds, and account.
 * 
 * Each error (including sub-errors) is created as an individual task with detailed error
 * descriptions and solutions matching the Issues by Category page format.
 * 
 * OPTIMIZED: Tasks are now stored in a separate TaskItem collection (one document per task)
 * to avoid the 16MB MongoDB document limit. The Task model only stores metadata (taskRenewalDate).
 */

const Task = require('../../models/MCP/TaskModel.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const logger = require('../../utils/Logger.js');
const { getTaskPriorityMeta } = require('./TaskPrioritizationService.js');
const { buildGroupsFromTasks } = require('./TaskOpportunityGroupsService.js');

// Chunk size for bulk insert operations
const TASK_INSERT_CHUNK_SIZE = 500;

/**
 * Generate a unique ID for tasks (alternative to uuid)
 * Uses timestamp + random string for uniqueness
 * @returns {string} Unique ID
 */
const generateTaskId = () => {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 15);
    return `task_${timestamp}_${randomStr}`;
};

// Task status constants
const TaskStatus = {
    PENDING: 'pending',
    COMPLETED: 'completed',
    IN_PROGRESS: 'in_progress'
};

// Keeps a search-term/keyword identifier from becoming unbounded in the dedup key.
const MAX_ENTITY_ID_LENGTH = 100;

/**
 * The entity a sponsored-ads issue is actually ABOUT, used as the task's dedup
 * identity (the `asin` slot, which participates in the
 * userId+asin+errorCategory+errorType unique index).
 *
 * This must match the issue's granularity. It previously read
 * `asin || campaignId || keywordId`, which for keyword-level issues fell through
 * to campaignId — so every wasted keyword in one campaign collided and only the
 * first survived. On one real account that silently discarded 72 of 93 wasted
 * keywords and 7 of 11 auto-campaign terms, taking their recoverable dollars
 * with them and making the Tasks page structurally unable to agree with the
 * dashboard's totals.
 *
 * @param {Object} error - a sponsored-ads error record
 * @returns {string}
 */
const getSponsoredAdsEntityId = (error) => {
    let id;
    switch (error.errorType) {
        case 'wasted_spend_keyword':
        case 'keyword_no_sales':
            // Keyword-level: one task per keyword.
            id = error.keywordId || error.keyword;
            break;
        case 'search_term_zero_sales':
        case 'auto_campaign_migration_needed':
            // Search-term-level: one task per term. The same term across two auto
            // campaigns is deliberately one task, because it's one action.
            id = error.searchTerm;
            break;
        case 'high_acos':
        case 'high_acos_campaign':
        case 'extreme_high_acos':
        case 'marginal_profit':
        case 'no_sales_high_spend':
        case 'low_ctr':
            // Campaign/target-level.
            id = error.campaignId || error.asin;
            break;
        default:
            id = error.asin || error.campaignId || error.keywordId;
    }
    return String(id ?? 'N/A').substring(0, MAX_ENTITY_ID_LENGTH) || 'N/A';
};

/**
 * Renders profitability error/solution text from renderData. Pure function so
 * it can run at read time (see getUserTasks) instead of being baked into the
 * stored task at creation time.
 * @param {string} errorType - 'negative_profit' | 'low_margin' | anything else
 * @param {Object} renderData - { netProfit, sales, profitMargin, message }
 * @returns {{error: string, solution: string}}
 */
const renderProfitabilityTaskText = (errorType, renderData = {}) => {
    const netProfit = typeof renderData.netProfit === 'number' ? renderData.netProfit : 0;
    const sales = typeof renderData.sales === 'number' ? renderData.sales : 0;
    const profitMargin = typeof renderData.profitMargin === 'number' ? renderData.profitMargin : 0;

    if (errorType === 'negative_profit') {
        const totalCosts = sales - netProfit;
        return {
            error: `Profitability | Negative Profit: This product is losing money with a net profit of -$${Math.abs(netProfit).toFixed(2)}. Revenue: $${sales.toFixed(2)}, Total Costs: $${totalCosts.toFixed(2)}. Immediate action required to prevent ongoing losses.`,
            solution: `Review and optimize your cost structure immediately: 1) Analyze your pricing strategy - consider increasing price if market allows. 2) Review fulfillment costs - consider FBA vs FBM options. 3) Reduce advertising spend or optimize for better ROAS. 4) Negotiate with suppliers for better COGS. 5) Consider discontinuing this product if profitability cannot be achieved.`
        };
    }
    if (errorType === 'low_margin') {
        return {
            error: `Profitability | Low Margin: This product has a profit margin of only ${profitMargin.toFixed(1)}% (Net Profit: $${netProfit.toFixed(2)}). Low margins leave little room for market fluctuations or unexpected costs.`,
            solution: `Improve profit margins through: 1) Strategic price optimization - test higher price points. 2) Cost reduction through supplier negotiations or alternative sourcing. 3) Optimize advertising efficiency - reduce ACOS while maintaining sales. 4) Consider bundling with higher-margin products. 5) Review fulfillment method for cost savings.`
        };
    }
    return {
        error: `Profitability | Issue: ${renderData.message || 'This product has profitability concerns that require attention.'}`,
        solution: 'Review your pricing strategy, costs, and advertising spend to improve profitability. Analyze all cost components including FBA fees, referral fees, and advertising costs.'
    };
};

/**
 * Renders sponsored-ads error/solution text from renderData. Pure function,
 * same wording as before, just parameterized for read-time rendering.
 * @param {string} errorType - normalized errorType (see generateSponsoredAdsTasks)
 * @param {Object} renderData - { acos, spend, sales, clicks, impressions, keyword, searchTerm, campaignName }
 * @returns {{error: string, solution: string}}
 */
const renderSponsoredAdsTaskText = (errorType, renderData = {}) => {
    const acos = typeof renderData.acos === 'number' ? renderData.acos.toFixed(1) : '0.0';
    const spend = typeof renderData.spend === 'number' ? renderData.spend.toFixed(2) : '0.00';
    const sales = typeof renderData.sales === 'number' ? renderData.sales.toFixed(2) : '0.00';
    const clicks = renderData.clicks || 0;
    const campaignName = renderData.campaignName;
    const keyword = renderData.keyword;
    const searchTerm = renderData.searchTerm;

    switch (errorType) {
        case 'high_acos':
        case 'high_acos_campaign': {
            const campaignContext = campaignName ? `Campaign "${campaignName}"` : 'This target';
            return {
                error: `PPC | High ACOS: ${campaignContext} has an ACOS of ${acos}% (Spend: $${spend}, Sales: $${sales}). Your advertising cost is eating into your profit margins significantly.`,
                solution: `Reduce ACOS by: 1) Lowering bids on underperforming keywords. 2) Adding negative keywords to filter irrelevant traffic. 3) Improving product listing conversion rate. 4) Focusing budget on proven, profitable keywords. 5) Consider pausing this campaign if ACOS remains high after optimization.`
            };
        }
        case 'wasted_spend_keyword': {
            const keywordName = keyword || 'Unknown';
            return {
                error: `PPC | Wasted Spend Keyword: The keyword "${keywordName}" has spent $${spend} with ${clicks} clicks but no sales (Sales: $${sales}). This suggests either poor keyword-product match or listing conversion issues.`,
                solution: `Optimize or remove: 1) Add as negative keyword if not relevant to your product. 2) If relevant, lower bid and continue monitoring. 3) Review search term report to understand what queries are triggering this keyword. 4) Improve product listing if the keyword is relevant but not converting.`
            };
        }
        case 'search_term_zero_sales': {
            const searchTermName = searchTerm || 'Unknown';
            return {
                error: `PPC | Search Term with Zero Sales: The search term "${searchTermName}" has generated ${clicks} clicks and spent $${spend} but no sales. Consider adding this as a negative keyword.`,
                solution: `Address zero-sale search term: 1) Add "${searchTermName}" as a negative keyword to prevent future wasted spend. 2) Review if the search term is relevant to your product - if not, definitely add as negative. 3) If relevant, check your product listing for conversion issues. 4) Analyze competitor listings for this search term.`
            };
        }
        case 'auto_campaign_migration_needed': {
            const autoSearchTerm = searchTerm || 'Unknown';
            return {
                error: `PPC | Auto Campaign Migration: The search term "${autoSearchTerm}" in auto campaign "${campaignName || 'Unknown'}" has generated $${sales} in sales. Consider migrating this to a manual campaign for better control.`,
                solution: `Migrate to manual campaign: 1) Create a new manual campaign or add to existing manual campaign. 2) Add "${autoSearchTerm}" as an exact match keyword. 3) Set an appropriate bid based on current performance. 4) Monitor performance in the manual campaign. 5) Consider pausing the auto campaign if manual campaign performs better.`
            };
        }
        default:
            return {
                error: `PPC | Optimization Needed: This advertising target requires optimization (ACOS: ${acos}%, Spend: $${spend}, Sales: $${sales}).`,
                solution: 'Review this campaign target and optimize based on performance data. Consider adjusting bids, adding negative keywords, or improving product listing conversion rate.'
            };
    }
};

/**
 * Renders Buy-Box error/solution text from renderData. Pure function, same
 * wording as before, just parameterized for read-time rendering.
 * @param {Object} renderData - { buyBoxPercentage, pageViews, sessions, message, solution }
 * @returns {{error: string, solution: string}}
 */
const renderBuyBoxTaskText = (renderData = {}) => {
    const buyBoxPercentage = renderData.buyBoxPercentage;
    const pageViews = renderData.pageViews || 0;
    const sessions = renderData.sessions || 0;

    // Upstream only ever flags buyBoxPercentage === 0 (see the asinBuyBoxData
    // filter in DashboardCalculation.js), so this is the only tailored tier;
    // anything else falls through to the generic message below.
    if (buyBoxPercentage === 0) {
        return {
            error: `Buy Box | No Ownership: This product has 0% Buy Box ownership. With ${pageViews} page views and ${sessions} sessions, you're losing potential sales to competitors who own the Buy Box.`,
            solution: 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics (shipping time, order defect rate), and consider using repricing tools. Ensure your product is Prime eligible if possible.'
        };
    }
    return {
        error: renderData.message || 'Buy Box | Issue: You are not winning the Buy Box for this product.',
        solution: renderData.solution || 'Optimize pricing, improve seller metrics, and ensure fast shipping to win the Buy Box more frequently.'
    };
};

/**
 * CreateTaskService class handles task creation and management
 */
class CreateTaskService {
    /**
     * Main method to create tasks from all error categories
     * 
     * OPTIMIZED: Tasks are now stored in the TaskItem collection (one document per task)
     * instead of embedding in the Task document. This avoids the 16MB BSON limit.
     * 
     * @param {Object} data - Object containing userId and error arrays
     * @returns {Object} Result containing task counts and metadata
     */
    async createTasksFromErrors(data) {
        try {
            const { userId } = data;
            
            // Create a product name map from TotalProducts for quick lookup
            const productNameMap = new Map();
            if (Array.isArray(data.TotalProducts)) {
                data.TotalProducts.forEach(product => {
                    if (product.asin) {
                        const name = product.itemName || product.title || product.productName || product.name || null;
                        if (name) {
                            productNameMap.set(product.asin, name);
                        }
                    }
                });
            }
            
            // Generate tasks from all error categories
            const tasks = [];
            
            if (data.rankingProductWiseErrors) {
                tasks.push(...this.generateRankingTasks(data.rankingProductWiseErrors));
            }
            
            if (data.conversionProductWiseErrors) {
                tasks.push(...this.generateConversionTasks(data.conversionProductWiseErrors));
            }
            
            if (data.inventoryProductWiseErrors) {
                tasks.push(...this.generateInventoryTasks(data.inventoryProductWiseErrors));
            }
            
            if (data.profitabilityErrorDetails) {
                tasks.push(...this.generateProfitabilityTasks(data.profitabilityErrorDetails, productNameMap));
            }
            
            if (data.sponsoredAdsErrorDetails) {
                tasks.push(...this.generateSponsoredAdsTasks(data.sponsoredAdsErrorDetails, productNameMap));
            }
            
            if (data.AccountErrors) {
                tasks.push(...this.generateAccountTasks(data.AccountErrors));
            }
            
            // Check if user metadata document exists
            let userTaskDocument = await Task.findOne({ userId });

            // Whether this run replaced the whole task set, as opposed to only
            // inserting newly-appeared tasks. Callers use it to decide when the
            // derived AI views need regenerating: within the renewal period an
            // existing task's amount/type is never rewritten (the unique index
            // rejects it), so nothing they summarise has changed.
            let tasksRebuilt = false;

            if (userTaskDocument) {
                const currentDate = new Date();
                const renewalDate = new Date(userTaskDocument.taskRenewalDate);
                
                if (currentDate >= renewalDate) {
                    logger.info(`Renewal period reached for user ${userId}. Clearing all tasks and creating fresh set.`);
                    
                    // Delete ALL tasks from TaskItem collection (not just completed)
                    const deleteResult = await TaskItem.deleteByUserId(userId);
                    logger.info(`Deleted ${deleteResult.deletedCount} tasks for user ${userId}`);
                    
                    // Insert new tasks in chunks (duplicates handled by unique index)
                    const insertResult = await TaskItem.bulkInsertTasks(userId, tasks, TASK_INSERT_CHUNK_SIZE);
                    
                    // Update renewal date
                    const newRenewalDate = new Date();
                    newRenewalDate.setDate(newRenewalDate.getDate() + 7);
                    userTaskDocument.taskRenewalDate = newRenewalDate;
                    userTaskDocument.tasks = []; // Clear legacy embedded tasks
                    await userTaskDocument.save();
                    
                    tasksRebuilt = true;
                    logger.info(`Renewed tasks for user ${userId}. Inserted ${insertResult.insertedCount} fresh tasks.`);
                } else {
                    logger.info(`Within renewal period for user ${userId}. Adding new unique tasks.`);
                    
                    // Insert new tasks in chunks (duplicates handled by unique index)
                    const insertResult = await TaskItem.bulkInsertTasks(userId, tasks, TASK_INSERT_CHUNK_SIZE);
                    
                    // Clear legacy embedded tasks if present
                    if (userTaskDocument.tasks && userTaskDocument.tasks.length > 0) {
                        userTaskDocument.tasks = [];
                        await userTaskDocument.save();
                    }
                    
                    logger.info(`Added ${insertResult.insertedCount} new unique tasks for user ${userId}`);
                }
            } else {
                // Create new metadata document
                const renewalDate = new Date();
                renewalDate.setDate(renewalDate.getDate() + 7);
                
                userTaskDocument = new Task({
                    userId,
                    tasks: [], // No longer store tasks here
                    taskRenewalDate: renewalDate
                });
                await userTaskDocument.save();
                
                // Insert tasks into TaskItem collection
                const insertResult = await TaskItem.bulkInsertTasks(userId, tasks, TASK_INSERT_CHUNK_SIZE);
                // A brand-new account's first task set is a full build, not an increment.
                tasksRebuilt = true;
                logger.info(`Created new task metadata for user ${userId}, inserted ${insertResult.insertedCount} tasks`);
            }

            // Return task counts for compatibility
            const taskCounts = await TaskItem.countByStatus(userId);

            return {
                userId,
                tasksRebuilt,
                taskRenewalDate: userTaskDocument.taskRenewalDate,
                taskCount: taskCounts.total,
                pendingCount: taskCounts.pending,
                completedCount: taskCounts.completed,
                inProgressCount: taskCounts.in_progress
            };
        } catch (error) {
            logger.error('Error creating tasks:', error);
            throw new Error('Failed to create tasks from error data');
        }
    }
    
    /**
     * Generate tasks from ranking errors
     * Each sub-error (Title | Restricted Words, Bullet Points | Special Characters, etc.) 
     * is created as a separate task with the actual error message and solution from the source data.
     * @param {Array} rankingErrors - Array of ranking errors
     * @returns {Array} Array of task items
     */
    generateRankingTasks(rankingErrors) {
        const tasks = [];
        
        // Section labels for display
        const sectionLabels = {
            TitleResult: 'Title',
            BulletPoints: 'Bullet Points',
            Description: 'Description',
            charLim: 'Backend Keywords'
        };
        
        // Issue labels, error-type slugs, and fallback solutions per check.
        // wordRepetition and capitalization only appear on Title (Amazon's title
        // requirements); the first three are shared by every section.
        const issueChecks = [
            {
                key: 'RestictedWords',
                label: 'Restricted Words',
                errorType: 'restricted_words',
                fallbackMessage: 'Restricted words detected in listing content.',
                fallbackSolution: 'Review your listing and remove any restricted or banned words according to Amazon\'s guidelines.'
            },
            {
                key: 'checkSpecialCharacters',
                label: 'Special Characters',
                errorType: 'special_characters',
                fallbackMessage: 'Special characters detected in listing content.',
                fallbackSolution: 'Remove special characters from your listing content to improve search visibility.'
            },
            {
                key: 'charLim',
                label: 'Character Limit',
                errorType: 'char_limit',
                fallbackMessage: 'Character limit issue detected.',
                fallbackSolution: 'Optimize your content length to meet Amazon\'s character requirements.'
            },
            {
                key: 'wordRepetition',
                label: 'Word Repetition',
                errorType: 'word_repetition',
                fallbackMessage: 'The same word is repeated more than twice.',
                fallbackSolution: 'Rewrite so that no word appears more than twice. Prepositions, articles, and conjunctions are exempt; brand names are not.'
            },
            {
                key: 'capitalization',
                label: 'Capitalization',
                errorType: 'capitalization',
                fallbackMessage: 'Capitalization does not follow Amazon\'s requirements.',
                fallbackSolution: 'Capitalize the first letter of each word, except prepositions, conjunctions, and articles. Do not use all caps or all lowercase.'
            }
        ];

        rankingErrors.forEach(error => {
            if (!error.data || error.data.TotalErrors === 0) return;
            
            const productName = error.data.Title?.substring(0, 100) || 'Unknown Product';
            const asin = error.asin;
            
            // Process TitleResult, BulletPoints, Description sections
            const sections = ['TitleResult', 'BulletPoints', 'Description'];
            
            sections.forEach(sectionKey => {
                const section = error.data[sectionKey];
                if (!section) return;
                
                issueChecks.forEach(({ key, label, errorType, fallbackMessage, fallbackSolution }) => {
                    const check = section[key];
                    if (check?.status !== 'Error') return;

                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'ranking',
                        errorType: `${sectionKey.toLowerCase()}_${errorType}`,
                        error: `${sectionLabels[sectionKey]} | ${label}: ${check.Message || fallbackMessage}`,
                        solution: check.HowTOSolve || fallbackSolution,
                        status: TaskStatus.PENDING
                    });
                });
            });
            
            // Process Backend Keywords (charLim at root level)
            if (error.data.charLim?.status === 'Error') {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'ranking',
                    errorType: 'backend_keywords_char_limit',
                    error: `${sectionLabels.charLim}: ${error.data.charLim.Message || 'Backend keywords exceed Amazon\'s byte limit.'}`,
                    solution: error.data.charLim.HowTOSolve || 'Reduce your backend search terms to stay within Amazon\'s 249-byte limit.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Check duplicate words error
            if (error.data.dublicateWords === 'Error') {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'ranking',
                    errorType: 'duplicate_words',
                    error: 'Title | Duplicate Words: Your product title contains repeated words which can negatively impact search ranking and customer experience.',
                    solution: 'Review and remove duplicate words from your product title. Each word should appear only once for optimal search performance.',
                    status: TaskStatus.PENDING
                });
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from conversion errors
     * Each error type (Images, Videos, Reviews, Rating, Buy Box, A+ Content) uses the actual
     * Message and HowToSolve from the source error data.
     * @param {Array} conversionErrors - Array of conversion errors
     * @returns {Array} Array of task items
     */
    generateConversionTasks(conversionErrors) {
        const tasks = [];
        
        conversionErrors.forEach(error => {
            const productName = error.Title?.substring(0, 100) || 'Unknown Product';
            const asin = error.asin;
            
            // A+ Content error - use actual error data
            if (error.aplusErrorData) {
                const errorData = error.aplusErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'missing_aplus_content',
                    error: `A+ Content | Missing: ${errorData.Message || 'Your product listing lacks A+ Content. Not utilizing A+ Content leads to missed opportunities for enhanced visual storytelling and detailed product explanations.'}`,
                    solution: errorData.HowToSolve || errorData.HowTOSolve || 'Create A+ Content for your product listing to provide a richer buying experience. Include detailed descriptions, high-quality images, comparison charts, and more to effectively showcase your product. Consider hiring agencies like eStore Factory for professional A+ page creation.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Image error - use actual error data
            if (error.imageResultErrorData) {
                const errorData = error.imageResultErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'insufficient_images',
                    error: `Images | Insufficient: ${errorData.Message || 'Your product listing has fewer than the recommended 7 images, limiting buyers\' ability to fully evaluate the product.'}`,
                    solution: errorData.HowToSolve || errorData.HowTOSolve || 'Increase the number of images to at least 7, covering all angles and important features of your product. Include high-quality images that showcase the product in use, important details, variations, and packaging.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Video error - use actual error data
            if (error.videoResultErrorData) {
                const errorData = error.videoResultErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'missing_video',
                    error: `Video | Missing: ${errorData.Message || 'Your product listing does not include a video, missing an opportunity to demonstrate product features and benefits.'}`,
                    solution: errorData.HowToSolve || errorData.HowTOSolve || 'Add a professional product demonstration video to your listing. Videos help customers understand your product better and can significantly improve conversion rates.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Star rating error - use actual error data
            if (error.productStarRatingResultErrorData) {
                const errorData = error.productStarRatingResultErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'low_star_rating',
                    error: `Rating | Low: ${errorData.Message || 'Your product\'s star rating is below the optimal threshold, which can deter potential buyers.'}`,
                    solution: errorData.HowToSolve || errorData.HowTOSolve || 'Focus on improving product quality and addressing common customer complaints. Respond promptly to negative reviews and consider product improvements based on feedback.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Buy Box error - store the raw numbers, render text on read (see renderBuyBoxTaskText)
            if (error.productsWithOutBuyboxErrorData) {
                const errorData = error.productsWithOutBuyboxErrorData;

                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'no_buybox',
                    renderData: {
                        buyBoxPercentage: errorData.buyBoxPercentage,
                        pageViews: errorData.pageViews,
                        sessions: errorData.sessions,
                        message: errorData.Message,
                        solution: errorData.HowToSolve || errorData.HowTOSolve
                    },
                    amount: errorData.amount || 0,
                    amountIsEstimated: !!errorData.amountIsEstimated,
                    status: TaskStatus.PENDING
                });
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from inventory errors
     * Each sub-error type (Long-Term Storage, Unfulfillable, Stranded, Inbound Non-Compliance, 
     * Replenishment) is created as a separate task with actual Message and HowToSolve from source data.
     * @param {Array} inventoryErrors - Array of inventory errors
     * @returns {Array} Array of task items
     */
    generateInventoryTasks(inventoryErrors) {
        const tasks = [];
        
        inventoryErrors.forEach(error => {
            const productName = error.Title?.substring(0, 100) || 'Unknown Product';
            const asin = error.asin;
            
            // Process inventory planning errors (contains sub-errors)
            if (error.inventoryPlanningErrorData) {
                const planningData = error.inventoryPlanningErrorData;
                
                // Long-Term Storage Fees error
                if (planningData.longTermStorageFees?.status === 'Error') {
                    const ltsf = planningData.longTermStorageFees;
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'inventory',
                        errorType: 'long_term_storage_fees',
                        error: `Inventory Planning | Long-Term Storage Fees: ${ltsf.Message || 'Your inventory has been stored in FBA for a long period, making it eligible for Long-Term Storage Fees (LTSF).'}`,
                        solution: ltsf.HowToSolve || ltsf.HowTOSolve || 'Review your inventory levels and sales velocity to identify slow-moving stock. Consider running promotions or lowering prices to increase sales. Alternatively, remove excess inventory from FBA to avoid additional fees.',
                        amount: ltsf.amount || 0,
                        status: TaskStatus.PENDING
                    });
                }

                // Unfulfillable inventory error
                if (planningData.unfulfillable?.status === 'Error') {
                    const unfulfillable = planningData.unfulfillable;
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'inventory',
                        errorType: 'unfulfillable_inventory',
                        error: `Inventory Planning | Unfulfillable Inventory: ${unfulfillable.Message || 'You have unfulfillable inventory in FBA which cannot be sold in its current condition.'}`,
                        solution: unfulfillable.HowToSolve || unfulfillable.HowTOSolve || 'Review the details of your unfulfillable inventory in Seller Central. Decide whether to have items returned for assessment, refurbishing, or disposal. Implement strategies to reduce future occurrences.',
                        // Capital, not profit — see TaskItemModel.capitalAmount.
                        capitalAmount: unfulfillable.capitalAmount || 0,
                        status: TaskStatus.PENDING
                    });
                }
            }

            // Stranded inventory error
            if (error.strandedInventoryErrorData) {
                const strandedData = error.strandedInventoryErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'inventory',
                    errorType: 'stranded_inventory',
                    error: `Stranded Inventory | Product Not Listed: ${strandedData.Message || 'Some of your inventory is stranded, meaning it is in Amazon\'s fulfillment centers but not actively listed for sale.'}`,
                    solution: strandedData.HowToSolve || strandedData.HowTOSolve || 'Check the Stranded Inventory Report in Seller Central > Inventory > Manage Inventory to identify affected SKUs. Resolve listing errors, pricing rules, or account suspensions causing the issue.',
                    capitalAmount: strandedData.capitalAmount || 0,
                    amountIsEstimated: !!strandedData.amountIsEstimated,
                    status: TaskStatus.PENDING
                });
            }
            
            // Inbound non-compliance error
            if (error.inboundNonComplianceErrorData) {
                const complianceData = error.inboundNonComplianceErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'inventory',
                    errorType: 'inbound_non_compliance',
                    error: `Inbound Non-Compliance | Shipment Issue: ${complianceData.Message || 'There is an issue with a product in your incoming shipment that may cause delays.'}`,
                    solution: complianceData.HowToSolve || complianceData.HowTOSolve || 'Check the Shipment Status in Seller Central > Inventory > Manage FBA Shipments. Resolve issues with labeling, quantity discrepancies, or carrier delays. Contact Amazon Seller Support if needed.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Replenishment/restock errors - handles single or multiple
            if (error.replenishmentErrorData) {
                const processReplenishmentError = (repError) => {
                    if (repError.status !== 'Error') return;
                    
                    const sku = repError.sku || '';
                    const skuInfo = sku ? ` (SKU: ${sku})` : '';
                    const qty = repError.recommendedReplenishmentQty || repError.data || 0;
                    const available = repError.available || 0;
                    
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'inventory',
                        errorType: `replenishment_needed${sku ? '_' + sku.substring(0, 20) : ''}`,
                        error: `Replenishment | Low Inventory${skuInfo}: ${repError.Message || `Product requires restocking. ${available} units available, Amazon recommends replenishing ${qty} units.`}`,
                        solution: repError.HowToSolve || repError.HowTOSolve || 'Create an FBA shipment immediately with the recommended quantity. Analyze your sales data to forecast demand more accurately. Consider setting up automatic restocking alerts in Seller Central.',
                        status: TaskStatus.PENDING
                    });
                };
                
                if (Array.isArray(error.replenishmentErrorData)) {
                    error.replenishmentErrorData.forEach(processReplenishmentError);
                } else {
                    processReplenishmentError(error.replenishmentErrorData);
                }
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from profitability errors
     * Provides detailed, actionable error messages and solutions.
     * @param {Array} profitabilityErrors - Array of profitability errors
     * @param {Map} productNameMap - Map of ASIN to product name for lookup
     * @returns {Array} Array of task items
     */
    generateProfitabilityTasks(profitabilityErrors, productNameMap = new Map()) {
        const tasks = [];
        
        profitabilityErrors.forEach(error => {
            // Try to get product name from error, then from map, then use ASIN as last resort
            let productName = error.productName;
            if (!productName && error.asin) {
                productName = productNameMap.get(error.asin);
            }
            // Final fallback - just use ASIN but make it clear
            productName = productName ? productName.substring(0, 100) : error.asin;
            
            const errorType = error.errorType === 'negative_profit' ? 'negative_profit'
                : error.errorType === 'low_margin' ? 'low_margin'
                : 'profitability_issue';

            tasks.push({
                taskId: generateTaskId(),
                productName,
                asin: error.asin,
                errorCategory: 'profitability',
                errorType,
                renderData: {
                    netProfit: error.netProfit,
                    sales: error.sales,
                    profitMargin: error.profitMargin,
                    message: error.message
                },
                amount: error.amount || 0,
                status: TaskStatus.PENDING
            });
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from sponsored ads errors
     * Each error type gets detailed, actionable descriptions and solutions.
     * @param {Array} sponsoredAdsErrors - Array of sponsored ads errors
     * @param {Map} productNameMap - Map of ASIN to product name for lookup
     * @returns {Array} Array of task items
     */
    generateSponsoredAdsTasks(sponsoredAdsErrors, productNameMap = new Map()) {
        const tasks = [];
        
        sponsoredAdsErrors.forEach(error => {
            let productName;
            
            // Try to get product name from error first
            if (error.productName) {
                productName = error.productName.substring(0, 100);
            } 
            // Then try the product name map lookup
            else if (error.asin && productNameMap.get(error.asin)) {
                productName = productNameMap.get(error.asin).substring(0, 100);
            }
            // For keyword-only errors, use keyword
            else if (error.keyword) {
                productName = `Keyword: ${error.keyword.substring(0, 50)}`;
            }
            // For search term errors, use search term
            else if (error.searchTerm) {
                productName = `Search Term: ${error.searchTerm.substring(0, 50)}`;
            }
            // For campaign errors, use campaign name
            else if (error.campaignName) {
                productName = `Campaign: ${error.campaignName.substring(0, 50)}`;
            }
            // If we have ASIN but no name, just use the ASIN
            else if (error.asin) {
                productName = error.asin;
            }
            // Last resort
            else {
                productName = 'Campaign Target';
            }
            
            // Only the four errorTypes below are ever produced upstream (see
            // calculateSponsoredAdsErrors in DashboardCalculation.js). Anything
            // else normalizes to 'ppc_optimization', which is exactly the case
            // renderSponsoredAdsTaskText falls back to — so a stored errorType
            // and its rendered text can never disagree.
            let errorType;
            switch (error.errorType) {
                case 'high_acos':
                case 'high_acos_campaign':
                    errorType = 'high_acos';
                    break;
                case 'wasted_spend_keyword':
                    errorType = 'wasted_spend_keyword';
                    break;
                case 'search_term_zero_sales':
                    errorType = 'search_term_zero_sales';
                    break;
                case 'auto_campaign_migration_needed':
                    errorType = 'auto_campaign_migration_needed';
                    break;
                default:
                    errorType = 'ppc_optimization';
            }

            tasks.push({
                taskId: generateTaskId(),
                productName,
                asin: getSponsoredAdsEntityId(error),
                errorCategory: 'sponsoredAds',
                errorType,
                renderData: {
                    acos: error.acos,
                    spend: error.spend,
                    sales: error.sales,
                    clicks: error.clicks,
                    impressions: error.impressions,
                    keyword: error.keyword,
                    searchTerm: error.searchTerm,
                    campaignName: error.campaignName,
                    // Not rendered — carried so ad waste can be attributed back to the
                    // products a campaign advertises (see AdsProductAttributionService).
                    // Keyword/search-term records have no ASIN of their own, so the
                    // campaign is the only link to a product.
                    campaignId: error.campaignId ? String(error.campaignId) : undefined
                },
                amount: error.amount || 0,
                status: TaskStatus.PENDING
            });
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from account health errors
     * Each account health issue is created as a task with the actual Message and HowTOSolve from source data.
     * @param {Object} accountErrors - Object containing account health errors
     * @returns {Array} Array of task items
     */
    generateAccountTasks(accountErrors) {
        const tasks = [];
        
        if (!accountErrors || typeof accountErrors !== 'object') return tasks;
        
        // Map of error keys to readable names
        const errorLabels = {
            accountStatus: 'Account Status',
            PolicyViolations: 'Policy Violations',
            validTrackingRateStatus: 'Valid Tracking Rate',
            orderWithDefectsStatus: 'Order Defect Rate',
            lateShipmentRateStatus: 'Late Shipment Rate',
            CancellationRate: 'Cancellation Rate',
            negativeFeedbacks: 'Negative Feedback',
            NCX: 'Negative Customer Experience',
            a_z_claims: 'A-to-Z Claims',
            responseUnder24HoursCount: 'Response Time'
        };
        
        Object.keys(accountErrors).forEach(key => {
            // Skip TotalErrors counter and empty objects
            if (key === 'TotalErrors') return;
            const errorData = accountErrors[key];
            if (!errorData || !errorData.status || errorData.status !== 'Error') return;
            
            const errorLabel = errorLabels[key] || key;
            
            tasks.push({
                taskId: generateTaskId(),
                productName: 'Account Health',
                asin: 'ACCOUNT',
                errorCategory: 'account',
                errorType: key,
                error: `Account | ${errorLabel}: ${errorData.Message || `Your ${errorLabel.toLowerCase()} requires attention.`}`,
                solution: errorData.HowTOSolve || errorData.HowToSolve || `Check your Account Health Dashboard in Seller Central to address this ${errorLabel.toLowerCase()} issue.`,
                status: TaskStatus.PENDING
            });
        });
        
        return tasks;
    }

    /**
     * Create tasks from calculate service data
     * @param {string} userId - User ID
     * @param {Object} dashboardData - Dashboard data containing error arrays
     * @returns {Object} Result containing task counts and metadata
     */
    async createTasksFromCalculateServiceData(userId, dashboardData) {
        return this.createTasksFromErrors({
            userId,
            ...dashboardData
        });
    }
    
    /**
     * Renders `error`/`solution` on the fly for a task stored as `renderData`
     * (profitability, sponsoredAds, Buy Box). Legacy tasks that already have
     * `error`/`solution` baked in pass through unchanged.
     * @param {Object} task - lean TaskItem document
     * @returns {Object} task with `error`/`solution` populated
     */
    renderTaskIfNeeded(task) {
        if (task.error != null && task.solution != null) {
            return task;
        }

        let rendered;
        if (task.renderData) {
            if (task.errorCategory === 'profitability') {
                rendered = renderProfitabilityTaskText(task.errorType, task.renderData);
            } else if (task.errorCategory === 'sponsoredAds') {
                rendered = renderSponsoredAdsTaskText(task.errorType, task.renderData);
            } else if (task.errorCategory === 'conversion' && task.errorType === 'no_buybox') {
                rendered = renderBuyBoxTaskText(task.renderData);
            }
        }
        if (!rendered) {
            rendered = {
                error: 'This task requires attention. Details are unavailable.',
                solution: 'Please refresh or contact support if this issue persists.'
            };
        }

        return { ...task, error: rendered.error, solution: rendered.solution };
    }

    /**
     * Get all tasks for a user
     *
     * OPTIMIZED: Now queries TaskItem collection instead of embedded array.
     *
     * @param {string} userId - User ID
     * @param {Object} options - Query options (limit, skip, status, sort)
     * @returns {Object} Task data with metadata and tasks array
     */
    async getUserTasks(userId, options = {}) {
        try {
            // Get metadata from Task document
            const userTaskDocument = await Task.findOne({ userId }).lean();

            // Get tasks from TaskItem collection. Each task is rendered (for the
            // lean renderData-backed types) and annotated with effort/impact so
            // the client can sort them into High impact / Quick wins / the rest.
            const rawTasks = await TaskItem.findByUserId(userId, options);
            const tasks = rawTasks.map(task => ({
                ...this.renderTaskIfNeeded(task),
                ...getTaskPriorityMeta(task)
            }));
            const taskCounts = await TaskItem.countByStatus(userId);

            // The same issue-type groups the Dashboard's "Top things to fix" shows,
            // sent once rather than per task. Lets a task row state its standing
            // ("1 of 93 wasted keywords, $187.41 total") so a small per-item figure
            // reads as a slice of the dashboard's number, not a contradiction.
            const { groups } = buildGroupsFromTasks(tasks, { maxGroups: Infinity });

            return {
                userId,
                taskRenewalDate: userTaskDocument?.taskRenewalDate || null,
                tasks,
                groups,
                taskCount: taskCounts.total,
                pendingCount: taskCounts.pending,
                completedCount: taskCounts.completed,
                inProgressCount: taskCounts.in_progress
            };
        } catch (error) {
            logger.error('Error fetching user tasks:', error);
            throw new Error('Failed to fetch user tasks');
        }
    }
    
    /**
     * Update task status
     * 
     * OPTIMIZED: Now updates TaskItem document directly.
     * 
     * @param {string} userId - User ID
     * @param {string} taskId - Task ID
     * @param {string} status - New status
     * @returns {Object} Updated task
     */
    async updateTaskStatus(userId, taskId, status) {
        try {
            const task = await TaskItem.findOneAndUpdate(
                { userId, taskId },
                { status },
                { new: true }
            ).lean();
            
            if (!task) {
                throw new Error('Task not found');
            }
            
            return task;
        } catch (error) {
            logger.error('Error updating task status:', error);
            throw new Error('Failed to update task status');
        }
    }
    
    /**
     * Delete all tasks for a user
     * @param {string} userId - User ID
     * @returns {Object} Deletion result
     */
    async deleteAllUserTasks(userId) {
        try {
            const result = await TaskItem.deleteByUserId(userId);
            logger.info(`Deleted ${result.deletedCount} tasks for user ${userId}`);
            return result;
        } catch (error) {
            logger.error('Error deleting user tasks:', error);
            throw new Error('Failed to delete user tasks');
        }
    }
}

const createTaskServiceInstance = new CreateTaskService();

// Exposed for unit testing the read-time renderers directly; existing consumers
// (PageWiseDataController.js, DashboardCalculation.js) keep using this same
// singleton instance exactly as before — nothing about the default export shape
// changes for them.
createTaskServiceInstance.renderProfitabilityTaskText = renderProfitabilityTaskText;
createTaskServiceInstance.renderSponsoredAdsTaskText = renderSponsoredAdsTaskText;
createTaskServiceInstance.renderBuyBoxTaskText = renderBuyBoxTaskText;

module.exports = createTaskServiceInstance;
