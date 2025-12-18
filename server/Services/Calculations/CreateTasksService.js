/**
 * Create Tasks Service
 * 
 * This service handles creating tasks from error data received from the calculation service.
 * It accepts all error categories: ranking, conversion, inventory, profitability, and sponsoredAds.
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
            
            // Add profitability error tasks
            if (data.profitabilityErrorDetails) {
                tasks.push(...this.generateProfitabilityTasks(data.profitabilityErrorDetails));
            }
            
            // Add sponsored ads error tasks
            if (data.sponsoredAdsErrorDetails) {
                tasks.push(...this.generateSponsoredAdsTasks(data.sponsoredAdsErrorDetails));
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
     * @param {Array} rankingErrors - Array of ranking errors
     * @returns {Array} Array of task items
     */
    generateRankingTasks(rankingErrors) {
        const tasks = [];
        
        rankingErrors.forEach(error => {
            if (error.data?.TotalErrors && error.data.TotalErrors > 0) {
                const productName = error.data.Title?.substring(0, 50) || 'Unknown Product';
                
                // Character limit error - separate task
                if (error.data.charLim?.status === 'Error') {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin: error.asin,
                        errorCategory: 'ranking',
                        errorType: 'title_char_limit',
                        error: 'Title character limit exceeded',
                        solution: 'Optimize product title to meet Amazon\'s character limit requirements. Keep it concise while maintaining keywords.',
                        status: TaskStatus.PENDING
                    });
                }
                
                // Duplicate words error - separate task
                if (error.data.dublicateWords === 'Error') {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin: error.asin,
                        errorCategory: 'ranking',
                        errorType: 'duplicate_words',
                        error: 'Title contains duplicate words',
                        solution: 'Remove duplicate words from the product title to improve search ranking and customer experience.',
                        status: TaskStatus.PENDING
                    });
                }
                
                // If there are other ranking errors not covered above, create a generic task
                const coveredErrors = (error.data.charLim?.status === 'Error' ? 1 : 0) + 
                                    (error.data.dublicateWords === 'Error' ? 1 : 0);
                const remainingErrors = error.data.TotalErrors - coveredErrors;
                
                if (remainingErrors > 0) {
                    tasks.push({
                        taskId: generateTaskId(),
                        productName,
                        asin: error.asin,
                        errorCategory: 'ranking',
                        errorType: 'additional_ranking_issues',
                        error: `Additional ranking optimization needed (${remainingErrors} issues)`,
                        solution: 'Review and optimize product listing elements including keywords, backend search terms, and other ranking factors.',
                        status: TaskStatus.PENDING
                    });
                }
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from conversion errors (each error type as separate task)
     * @param {Array} conversionErrors - Array of conversion errors
     * @returns {Array} Array of task items
     */
    generateConversionTasks(conversionErrors) {
        const tasks = [];
        
        conversionErrors.forEach(error => {
            const productName = error.Title?.substring(0, 50) || 'Unknown Product';
            
            // A+ Content error - separate task
            if (error.aplusErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'missing_aplus_content',
                    error: 'A+ Content missing or needs improvement',
                    solution: 'Create compelling A+ Content with high-quality images and detailed product information to improve conversion rates.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Image error - separate task
            if (error.imageResultErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'poor_images',
                    error: 'Product images need improvement',
                    solution: 'Upload high-quality product images that meet Amazon\'s requirements. Ensure main image has white background and shows the product clearly.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Video error - separate task
            if (error.videoResultErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'missing_video',
                    error: 'Product video missing or low quality',
                    solution: 'Add a professional product demonstration video to showcase features and benefits, improving customer engagement.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Product review error - separate task
            if (error.productReviewResultErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'insufficient_reviews',
                    error: 'Insufficient reviews or poor review quality',
                    solution: 'Implement review acquisition strategy through follow-up emails and improve product quality to earn better reviews.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Star rating error - separate task
            if (error.productStarRatingResultErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'low_star_rating',
                    error: 'Star rating below optimal threshold',
                    solution: 'Focus on improving product quality and customer service to achieve higher star ratings.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Buy Box error - separate task
            if (error.productsWithOutBuyboxErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'conversion',
                    errorType: 'no_buybox',
                    error: 'Not winning the Buy Box',
                    solution: 'Optimize pricing, improve seller metrics, and ensure fast shipping to win the Buy Box more frequently.',
                    status: TaskStatus.PENDING
                });
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from inventory errors (each error type as separate task)
     * @param {Array} inventoryErrors - Array of inventory errors
     * @returns {Array} Array of task items
     */
    generateInventoryTasks(inventoryErrors) {
        const tasks = [];
        
        inventoryErrors.forEach(error => {
            const productName = error.Title?.substring(0, 50) || 'Unknown Product';
            
            // Inventory planning error - separate task
            if (error.inventoryPlanningErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'inventory',
                    errorType: 'inventory_planning',
                    error: 'Inventory planning optimization required',
                    solution: 'Review inventory levels and adjust replenishment strategy to avoid stockouts while minimizing storage costs.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Stranded inventory error - separate task
            if (error.strandedInventoryErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'inventory',
                    errorType: 'stranded_inventory',
                    error: 'Stranded inventory detected',
                    solution: 'Review and fix listing issues causing stranded inventory. Check for suppressed or incomplete listings.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Inbound non-compliance error - separate task
            if (error.inboundNonComplianceErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'inventory',
                    errorType: 'inbound_non_compliance',
                    error: 'Inbound shipment non-compliance',
                    solution: 'Review and correct inbound shipment preparation to meet Amazon\'s requirements and avoid fees.',
                    status: TaskStatus.PENDING
                });
            }
            
            // Replenishment error - separate task
            if (error.replenishmentErrorData) {
                tasks.push({
                    taskId: generateTaskId(),
                    productName,
                    asin: error.asin,
                    errorCategory: 'inventory',
                    errorType: 'replenishment_needed',
                    error: 'Product restocking required',
                    solution: 'Create replenishment shipment to avoid stockout. Review sales velocity and adjust reorder points.',
                    status: TaskStatus.PENDING
                });
            }
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from profitability errors
     * @param {Array} profitabilityErrors - Array of profitability errors
     * @returns {Array} Array of task items
     */
    generateProfitabilityTasks(profitabilityErrors) {
        const tasks = [];
        
        profitabilityErrors.forEach(error => {
            let errorMessage;
            let solution;
            let errorType;
            
            if (error.errorType === 'negative_profit') {
                errorType = 'negative_profit';
                errorMessage = `Product has negative profit: $${error.netProfit.toFixed(2)}`;
                solution = 'Review pricing strategy, reduce costs, or optimize advertising spend to achieve profitability.';
            } else {
                errorType = 'low_profit_margin';
                errorMessage = `Low profit margin: ${error.profitMargin.toFixed(1)}%`;
                solution = 'Improve profit margins by optimizing pricing, reducing costs, or improving advertising efficiency.';
            }
            
            tasks.push({
                taskId: generateTaskId(),
                productName: `Product ${error.asin}`,
                asin: error.asin,
                errorCategory: 'profitability',
                errorType: errorType,
                error: errorMessage,
                solution: solution,
                status: TaskStatus.PENDING
            });
        });
        
        return tasks;
    }
    
    /**
     * Generate tasks from sponsored ads errors (each error as separate task)
     * @param {Array} sponsoredAdsErrors - Array of sponsored ads errors
     * @returns {Array} Array of task items
     */
    generateSponsoredAdsTasks(sponsoredAdsErrors) {
        const tasks = [];
        
        // Each sponsored ads error is already a separate error type, so each creates one task
        sponsoredAdsErrors.forEach(error => {
            let errorMessage;
            let solution;
            let errorType;
            const productName = error.asin ? `Product ${error.asin}` : `Keyword: ${error.keyword}`;
            
            // Each error type gets its own specific task
            switch (error.errorType) {
                case 'high_acos':
                    errorType = 'high_acos';
                    errorMessage = `High ACOS detected (${error.acos.toFixed(1)}%)`;
                    solution = 'Optimize keywords, improve product listing, or adjust bids to reduce ACOS and improve profitability.';
                    break;
                case 'no_sales_high_spend':
                    errorType = 'no_sales_high_spend';
                    errorMessage = `High spend with no sales ($${error.spend.toFixed(2)})`;
                    solution = 'Review keyword relevance, improve product listing, or pause underperforming keywords.';
                    break;
                case 'marginal_profit':
                    errorType = 'marginal_profit';
                    errorMessage = `Marginal profitability (ACOS: ${error.acos.toFixed(1)}%)`;
                    solution = 'Fine-tune bidding strategy and keyword targeting to improve campaign efficiency.';
                    break;
                case 'extreme_high_acos':
                    errorType = 'extreme_high_acos';
                    errorMessage = `Extremely high ACOS (${error.acos.toFixed(1)}%)`;
                    solution = 'Immediately review and optimize or pause this keyword to prevent further losses.';
                    break;
                case 'keyword_no_sales':
                    errorType = 'keyword_no_sales';
                    errorMessage = `Keyword with spend but no sales ($${error.spend.toFixed(2)})`;
                    solution = 'Consider adding as negative keyword or improving product listing relevance.';
                    break;
                default:
                    errorType = 'general_optimization';
                    errorMessage = `Sponsored ads optimization needed (ACOS: ${error.acos.toFixed(1)}%)`;
                    solution = 'Review and optimize sponsored ads performance.';
            }
            
            // Create individual task for each sponsored ads error
            tasks.push({
                taskId: generateTaskId(),
                productName,
                asin: error.asin || 'N/A',
                errorCategory: 'sponsoredAds',
                errorType: errorType,
                error: errorMessage,
                solution: solution,
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

