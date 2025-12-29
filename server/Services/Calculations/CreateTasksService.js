/**
 * Create Tasks Service
 * 
 * This service handles creating tasks from error data received from the calculation service.
 * It accepts all error categories: ranking, conversion, inventory, profitability, sponsoredAds, and account.
 * 
 * Each error (including sub-errors) is created as an individual task with detailed error
 * descriptions and solutions matching the Issues by Category page format.
 */

const Task = require('../../models/MCP/TaskModel.js');
const logger = require('../../utils/Logger.js');

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

/**
 * CreateTaskService class handles task creation and management
 */
class CreateTaskService {
    /**
     * Main method to create tasks from all error categories
     * @param {Object} data - Object containing userId and error arrays
     * @returns {Object} Created/updated task document
     */
    async createTasksFromErrors(data) {
        try {
            const { userId } = data;
            
            // Create a product name map from TotalProducts for quick lookup
            const productNameMap = new Map();
            if (Array.isArray(data.TotalProducts)) {
                data.TotalProducts.forEach(product => {
                    if (product.asin) {
                        // Try multiple possible name fields
                        const name = product.itemName || product.title || product.productName || product.name || null;
                        if (name) {
                            productNameMap.set(product.asin, name);
                        }
                    }
                });
            }
            
            // Generate tasks from all error categories
            const tasks = [];
            
            // Add ranking error tasks
            if (data.rankingProductWiseErrors) {
                tasks.push(...this.generateRankingTasks(data.rankingProductWiseErrors));
            }
            
            // Add conversion error tasks
            if (data.conversionProductWiseErrors) {
                tasks.push(...this.generateConversionTasks(data.conversionProductWiseErrors));
            }
            
            // Add inventory error tasks
            if (data.inventoryProductWiseErrors) {
                tasks.push(...this.generateInventoryTasks(data.inventoryProductWiseErrors));
            }
            
            // Add profitability error tasks (with product name lookup)
            if (data.profitabilityErrorDetails) {
                tasks.push(...this.generateProfitabilityTasks(data.profitabilityErrorDetails, productNameMap));
            }
            
            // Add sponsored ads error tasks (with product name lookup)
            if (data.sponsoredAdsErrorDetails) {
                tasks.push(...this.generateSponsoredAdsTasks(data.sponsoredAdsErrorDetails, productNameMap));
            }
            
            // Add account health error tasks
            if (data.AccountErrors) {
                tasks.push(...this.generateAccountTasks(data.AccountErrors));
            }
            
            // Check if user document exists
            let userTaskDocument = await Task.findOne({ userId });
            
            if (userTaskDocument) {
                // Check if current date is greater than or equal to renewal date
                const currentDate = new Date();
                const renewalDate = new Date(userTaskDocument.taskRenewalDate);
                
                // Helper function to get stable task identifier
                const getTaskIdentifier = (task) => `${task.asin}-${task.errorCategory}-${task.errorType}`;
                
                if (currentDate >= renewalDate) {
                    logger.info(`Renewal period reached for user ${userId}. Clearing completed tasks and adding new ones.`);
                    
                    // Remove completed tasks, keep pending
                    const pendingTasks = userTaskDocument.tasks.filter(task => task.status === TaskStatus.PENDING);
                    
                    // Get identifiers of existing pending tasks to avoid duplicates
                    const existingPendingIdentifiers = new Set(
                        pendingTasks.map(task => getTaskIdentifier(task))
                    );
                    
                    // Filter out new tasks that already exist as pending
                    const uniqueNewTasks = tasks.filter(task => 
                        !existingPendingIdentifiers.has(getTaskIdentifier(task))
                    );
                    
                    // Combine pending tasks with only unique new tasks
                    userTaskDocument.tasks = [...pendingTasks, ...uniqueNewTasks];
                    
                    // Update renewal date to 7 days from current date
                    const newRenewalDate = new Date();
                    newRenewalDate.setDate(newRenewalDate.getDate() + 7);
                    userTaskDocument.taskRenewalDate = newRenewalDate;
                    
                    logger.info(`Renewed tasks for user ${userId}. Kept ${pendingTasks.length} pending tasks, added ${uniqueNewTasks.length} new unique tasks (${tasks.length - uniqueNewTasks.length} duplicates skipped).`);
                    await userTaskDocument.save();
                } else {
                    // Not yet renewal time, but still add new tasks that don't already exist
                    logger.info(`Within renewal period for user ${userId}. Checking for new unique tasks to add.`);
                    
                    // Get existing task identifiers using stable identifier (ASIN + errorCategory + errorType)
                    const existingTaskIdentifiers = new Set(
                        userTaskDocument.tasks.map(task => getTaskIdentifier(task))
                    );
                    
                    // Filter out tasks that already exist
                    const newUniqueTasks = tasks.filter(task => 
                        !existingTaskIdentifiers.has(getTaskIdentifier(task))
                    );
                    
                    if (newUniqueTasks.length > 0) {
                        logger.info(`Adding ${newUniqueTasks.length} new unique tasks for user ${userId}`);
                        userTaskDocument.tasks.push(...newUniqueTasks);
                        await userTaskDocument.save();
                    } else {
                        logger.info(`No new unique tasks to add for user ${userId}`);
                    }
                }
            } else {
                // Create new document for the user
                const renewalDate = new Date();
                renewalDate.setDate(renewalDate.getDate() + 7);
                
                userTaskDocument = new Task({
                    userId,
                    tasks,
                    taskRenewalDate: renewalDate
                });
                await userTaskDocument.save();
                logger.info(`Created new task document for user ${userId} with ${tasks.length} tasks`);
            }
            
            return userTaskDocument;
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
        
        // Issue labels for display
        const issueLabels = {
            RestictedWords: 'Restricted Words',
            checkSpecialCharacters: 'Special Characters',
            charLim: 'Character Limit'
        };
        
        rankingErrors.forEach(error => {
            if (!error.data || error.data.TotalErrors === 0) return;
            
            const productName = error.data.Title?.substring(0, 100) || 'Unknown Product';
            const asin = error.asin;
            
            // Process TitleResult, BulletPoints, Description sections
            const sections = ['TitleResult', 'BulletPoints', 'Description'];
            
            sections.forEach(sectionKey => {
                const section = error.data[sectionKey];
                if (!section) return;
                
                // Check RestictedWords error
                if (section.RestictedWords?.status === 'Error') {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'ranking',
                        errorType: `${sectionKey.toLowerCase()}_restricted_words`,
                        error: `${sectionLabels[sectionKey]} | ${issueLabels.RestictedWords}: ${section.RestictedWords.Message || 'Restricted words detected in listing content.'}`,
                        solution: section.RestictedWords.HowTOSolve || 'Review your listing and remove any restricted or banned words according to Amazon\'s guidelines.',
                        status: TaskStatus.PENDING
                    });
                }
                
                // Check checkSpecialCharacters error
                if (section.checkSpecialCharacters?.status === 'Error') {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'ranking',
                        errorType: `${sectionKey.toLowerCase()}_special_characters`,
                        error: `${sectionLabels[sectionKey]} | ${issueLabels.checkSpecialCharacters}: ${section.checkSpecialCharacters.Message || 'Special characters detected in listing content.'}`,
                        solution: section.checkSpecialCharacters.HowTOSolve || 'Remove special characters from your listing content to improve search visibility.',
                        status: TaskStatus.PENDING
                    });
                }
                
                // Check charLim error within section (for Title, Bullets, Description)
                if (section.charLim?.status === 'Error') {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin,
                        errorCategory: 'ranking',
                        errorType: `${sectionKey.toLowerCase()}_char_limit`,
                        error: `${sectionLabels[sectionKey]} | ${issueLabels.charLim}: ${section.charLim.Message || 'Character limit issue detected.'}`,
                        solution: section.charLim.HowTOSolve || 'Optimize your content length to meet Amazon\'s character requirements.',
                        status: TaskStatus.PENDING
                    });
                }
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
            
            // Product review error - use actual error data
            if (error.productReviewResultErrorData) {
                const errorData = error.productReviewResultErrorData;
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'insufficient_reviews',
                    error: `Reviews | Insufficient: ${errorData.Message || 'Your product has fewer reviews than recommended, which can affect buyer confidence and conversion rates.'}`,
                    solution: errorData.HowToSolve || errorData.HowTOSolve || 'Implement a review acquisition strategy through follow-up emails using Amazon\'s Request a Review button. Focus on providing excellent customer service and product quality to encourage positive reviews.',
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
            
            // Buy Box error - use actual error data
            if (error.productsWithOutBuyboxErrorData) {
                const errorData = error.productsWithOutBuyboxErrorData;
                const buyBoxPercentage = errorData.buyBoxPercentage;
                const pageViews = errorData.pageViews || 0;
                const sessions = errorData.sessions || 0;
                
                let errorMessage, solutionMessage;
                
                if (buyBoxPercentage === 0) {
                    errorMessage = `Buy Box | No Ownership: This product has 0% Buy Box ownership. With ${pageViews} page views and ${sessions} sessions, you're losing potential sales to competitors who own the Buy Box.`;
                    solutionMessage = 'Review your pricing strategy and ensure it\'s competitive. Check for pricing errors, verify your seller metrics (shipping time, order defect rate), and consider using repricing tools. Ensure your product is Prime eligible if possible.';
                } else if (buyBoxPercentage !== undefined && buyBoxPercentage < 50) {
                    errorMessage = `Buy Box | Low Percentage: This product has only ${buyBoxPercentage.toFixed(1)}% Buy Box ownership. With ${pageViews} page views and ${sessions} sessions, a significant portion of potential sales are going to competitors.`;
                    solutionMessage = 'Improve your Buy Box percentage by optimizing your pricing, maintaining competitive shipping options, improving seller metrics (late shipment rate, cancellation rate), and ensuring inventory availability. Consider FBA if you\'re currently using FBM.';
                } else {
                    errorMessage = errorData.Message || 'Buy Box | Issue: You are not winning the Buy Box for this product.';
                    solutionMessage = errorData.HowToSolve || errorData.HowTOSolve || 'Optimize pricing, improve seller metrics, and ensure fast shipping to win the Buy Box more frequently.';
                }
                
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin,
                    errorCategory: 'conversion',
                    errorType: 'no_buybox',
                    error: errorMessage,
                    solution: solutionMessage,
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
            
            let errorMessage, solution, errorType;
            
            if (error.errorType === 'negative_profit') {
                errorType = 'negative_profit';
                const netProfit = error.netProfit?.toFixed(2) || '0.00';
                const revenue = error.revenue?.toFixed(2) || '0.00';
                const totalCosts = error.totalCosts?.toFixed(2) || '0.00';
                
                errorMessage = `Profitability | Negative Profit: This product is losing money with a net profit of -$${Math.abs(parseFloat(netProfit)).toFixed(2)}. Revenue: $${revenue}, Total Costs: $${totalCosts}. Immediate action required to prevent ongoing losses.`;
                solution = `Review and optimize your cost structure immediately: 1) Analyze your pricing strategy - consider increasing price if market allows. 2) Review fulfillment costs - consider FBA vs FBM options. 3) Reduce advertising spend or optimize for better ROAS. 4) Negotiate with suppliers for better COGS. 5) Consider discontinuing this product if profitability cannot be achieved.`;
            } else if (error.errorType === 'low_profit_margin') {
                errorType = 'low_profit_margin';
                const profitMargin = error.profitMargin?.toFixed(1) || '0.0';
                const netProfit = error.netProfit?.toFixed(2) || '0.00';
                
                errorMessage = `Profitability | Low Margin: This product has a profit margin of only ${profitMargin}% (Net Profit: $${netProfit}). Low margins leave little room for market fluctuations or unexpected costs.`;
                solution = `Improve profit margins through: 1) Strategic price optimization - test higher price points. 2) Cost reduction through supplier negotiations or alternative sourcing. 3) Optimize advertising efficiency - reduce ACOS while maintaining sales. 4) Consider bundling with higher-margin products. 5) Review fulfillment method for cost savings.`;
            } else {
                errorType = 'profitability_issue';
                errorMessage = `Profitability | Issue: ${error.message || 'This product has profitability concerns that require attention.'}`;
                solution = 'Review your pricing strategy, costs, and advertising spend to improve profitability. Analyze all cost components including FBA fees, referral fees, and advertising costs.';
            }
            
            tasks.push({
                taskId: generateTaskId(),
                productName,
                asin: error.asin,
                errorCategory: 'profitability',
                errorType,
                error: errorMessage,
                solution,
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
            // If we have ASIN but no name, just use the ASIN
            else if (error.asin) {
                productName = error.asin;
            }
            // Last resort
            else {
                productName = 'Campaign Target';
            }
            
            let errorMessage, solution, errorType;
            const acos = error.acos?.toFixed(1) || '0.0';
            const spend = error.spend?.toFixed(2) || '0.00';
            const sales = error.sales?.toFixed(2) || '0.00';
            const clicks = error.clicks || 0;
            const impressions = error.impressions || 0;
            
            switch (error.errorType) {
                case 'high_acos':
                    errorType = 'high_acos';
                    errorMessage = `PPC | High ACOS: This target has an ACOS of ${acos}% (Spend: $${spend}, Sales: $${sales}). Your advertising cost is eating into your profit margins significantly.`;
                    solution = `Reduce ACOS by: 1) Lowering bids on underperforming keywords. 2) Adding negative keywords to filter irrelevant traffic. 3) Improving product listing conversion rate. 4) Focusing budget on proven, profitable keywords. 5) Consider pausing this target if ACOS remains high after optimization.`;
                    break;
                    
                case 'extreme_high_acos':
                    errorType = 'extreme_high_acos';
                    errorMessage = `PPC | Critical ACOS: This target has an extremely high ACOS of ${acos}% (Spend: $${spend}, Sales: $${sales}). You are losing money on every sale through this advertising channel.`;
                    solution = `URGENT: 1) Consider pausing this target immediately to stop losses. 2) If keeping active, drastically reduce bids (50%+ reduction). 3) Review keyword relevance - is this target actually related to your product? 4) Add as negative keyword if consistently underperforming. 5) Analyze search term report for wasted spend.`;
                    break;
                    
                case 'no_sales_high_spend':
                    errorType = 'no_sales_high_spend';
                    errorMessage = `PPC | No Sales: This target has spent $${spend} with ${clicks} clicks but generated $0 in sales. Your advertising budget is being wasted on non-converting traffic.`;
                    solution = `Address zero-sale spend by: 1) Review keyword relevance - ensure it matches buyer intent. 2) Check your product listing for conversion issues. 3) Analyze competitor pricing and reviews. 4) Consider adding this as a negative keyword. 5) If keyword is relevant, optimize listing copy and images before resuming spend.`;
                    break;
                    
                case 'keyword_no_sales':
                    errorType = 'keyword_no_sales';
                    errorMessage = `PPC | Keyword Without Sales: The keyword "${error.keyword || 'Unknown'}" has spent $${spend} with ${clicks} clicks but no sales. This suggests either poor keyword-product match or listing conversion issues.`;
                    solution = `Optimize or remove: 1) Add as negative keyword if not relevant to your product. 2) If relevant, lower bid and continue monitoring. 3) Review search term report to understand what queries are triggering this keyword. 4) Improve product listing if the keyword is relevant but not converting.`;
                    break;
                    
                case 'marginal_profit':
                    errorType = 'marginal_profit';
                    errorMessage = `PPC | Marginal Performance: This target has an ACOS of ${acos}% (Spend: $${spend}, Sales: $${sales}). While generating sales, the advertising efficiency is suboptimal.`;
                    solution = `Fine-tune for better performance: 1) Gradually reduce bids while monitoring performance. 2) Test different match types (broad, phrase, exact). 3) Analyze day-parting data to optimize ad scheduling. 4) Review placement adjustments for better ROAS. 5) Consider if this spend could be better allocated to higher-performing keywords.`;
                    break;
                    
                case 'low_ctr':
                    errorType = 'low_ctr';
                    const ctr = ((clicks / impressions) * 100).toFixed(2);
                    errorMessage = `PPC | Low Click-Through Rate: This target has a CTR of only ${ctr}% (${clicks} clicks from ${impressions} impressions). Low CTR indicates your ad or product is not compelling to shoppers.`;
                    solution = `Improve CTR by: 1) Optimize main product image for better visibility. 2) Review and improve product title for keyword relevance. 3) Ensure pricing is competitive. 4) Check that star rating is competitive. 5) Consider if this keyword is truly relevant to your product.`;
                    break;
                    
                default:
                    errorType = 'ppc_optimization';
                    errorMessage = `PPC | Optimization Needed: This advertising target requires optimization (ACOS: ${acos}%, Spend: $${spend}, Sales: $${sales}).`;
                    solution = 'Review this campaign target and optimize based on performance data. Consider adjusting bids, adding negative keywords, or improving product listing conversion rate.';
            }
            
            tasks.push({
                taskId: generateTaskId(),
                productName,
                asin: error.asin || 'N/A',
                errorCategory: 'sponsoredAds',
                errorType,
                error: errorMessage,
                solution,
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
     * @returns {Object} Created/updated task document
     */
    async createTasksFromCalculateServiceData(userId, dashboardData) {
        return this.createTasksFromErrors({
            userId,
            ...dashboardData
        });
    }
    
    /**
     * Get all tasks for a user
     * @param {string} userId - User ID
     * @returns {Object|null} Task document or null
     */
    async getUserTasks(userId) {
        try {
            return await Task.findOne({ userId });
        } catch (error) {
            logger.error('Error fetching user tasks:', error);
            throw new Error('Failed to fetch user tasks');
        }
    }
    
    /**
     * Update task status
     * @param {string} userId - User ID
     * @param {string} taskId - Task ID
     * @param {string} status - New status
     * @returns {Object|null} Updated task document
     */
    async updateTaskStatus(userId, taskId, status) {
        try {
            const userTaskDocument = await Task.findOne({ userId });
            if (!userTaskDocument) {
                throw new Error('User task document not found');
            }
            
            const task = userTaskDocument.tasks.find(t => t.taskId === taskId);
            if (!task) {
                throw new Error('Task not found');
            }
            
            task.status = status;
            await userTaskDocument.save();
            
            return userTaskDocument;
        } catch (error) {
            logger.error('Error updating task status:', error);
            throw new Error('Failed to update task status');
        }
    }
}

module.exports = new CreateTaskService();
