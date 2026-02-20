/**
 * asyncCsvParser.js
 * 
 * Async CSV/TSV parsing utilities that yield to the event loop.
 * This prevents blocking the Node.js event loop during large file parsing,
 * which is critical for BullMQ lock extension to work properly.
 * 
 * Key features:
 * - Async streaming parsing instead of sync blocking
 * - Periodic yields to event loop during record processing
 * - Compatible with existing code patterns
 */

const { parse } = require('csv-parse');
const { promisify } = require('util');
const zlib = require('zlib');
const gunzip = promisify(zlib.gunzip);
const logger = require('./Logger');

// Chunk size for yielding to event loop during record processing
const YIELD_CHUNK_SIZE = 500;

/**
 * Yield to event loop to allow timers (like lock extension) to fire
 * @returns {Promise<void>}
 */
async function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Parse TSV/CSV data asynchronously using streaming parser.
 * This prevents blocking the event loop during large file parsing.
 * 
 * @param {Buffer|string} data - Raw data (can be gzipped or plain text)
 * @param {Object} options - Parsing options
 * @param {string} options.delimiter - Field delimiter (default: '\t' for TSV)
 * @param {boolean} options.columns - Use first row as headers (default: true)
 * @param {Function} options.onProgress - Optional callback for progress updates
 * @returns {Promise<Array>} Parsed records
 */
async function parseAsync(data, options = {}) {
    const {
        delimiter = '\t',
        columns = true,
        onProgress = null,
        reportType = 'unknown'
    } = options;

    // Decompress if gzipped
    let textData;
    if (Buffer.isBuffer(data)) {
        try {
            const decompressed = await gunzip(data);
            textData = decompressed.toString('utf-8');
        } catch (decompressError) {
            textData = data.toString('utf-8');
        }
    } else {
        textData = data;
    }

    if (!textData || textData.trim().length === 0) {
        logger.warn(`[asyncCsvParser:${reportType}] Empty data received`);
        return [];
    }

    return new Promise((resolve, reject) => {
        const records = [];
        let recordCount = 0;

        const parser = parse({
            columns: columns,
            delimiter: delimiter,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
            skip_records_with_error: true
        });

        parser.on('readable', async () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
                recordCount++;

                // Yield to event loop periodically
                if (recordCount % YIELD_CHUNK_SIZE === 0) {
                    await yieldToEventLoop();
                    if (onProgress) {
                        onProgress(recordCount);
                    }
                }
            }
        });

        parser.on('error', (error) => {
            logger.error(`[asyncCsvParser:${reportType}] Parsing error:`, error.message);
            reject(error);
        });

        parser.on('end', () => {
            logger.info(`[asyncCsvParser:${reportType}] Parsed ${records.length} records`);
            resolve(records);
        });

        parser.write(textData);
        parser.end();
    });
}

/**
 * Process an array in chunks with event loop yields.
 * Use this for large forEach/map operations.
 * 
 * @param {Array} array - Array to process
 * @param {Function} processor - Async function to process each item
 * @param {number} chunkSize - Items per chunk before yielding (default: 100)
 * @returns {Promise<Array>} Results array (if processor returns values)
 */
async function processArrayWithYield(array, processor, chunkSize = 100) {
    const results = [];
    
    for (let i = 0; i < array.length; i += chunkSize) {
        const chunk = array.slice(i, i + chunkSize);
        
        for (const item of chunk) {
            const result = await processor(item);
            if (result !== undefined) {
                results.push(result);
            }
        }
        
        // Yield to event loop after each chunk
        await yieldToEventLoop();
    }
    
    return results;
}

/**
 * Filter an array in chunks with event loop yields.
 * 
 * @param {Array} array - Array to filter
 * @param {Function} predicate - Filter predicate function
 * @param {number} chunkSize - Items per chunk before yielding (default: 100)
 * @returns {Promise<Array>} Filtered array
 */
async function filterArrayWithYield(array, predicate, chunkSize = 100) {
    const results = [];
    
    for (let i = 0; i < array.length; i += chunkSize) {
        const chunk = array.slice(i, i + chunkSize);
        
        for (const item of chunk) {
            if (await predicate(item)) {
                results.push(item);
            }
        }
        
        // Yield to event loop after each chunk
        await yieldToEventLoop();
    }
    
    return results;
}

/**
 * Map an array in chunks with event loop yields.
 * 
 * @param {Array} array - Array to map
 * @param {Function} mapper - Mapping function
 * @param {number} chunkSize - Items per chunk before yielding (default: 100)
 * @returns {Promise<Array>} Mapped array
 */
async function mapArrayWithYield(array, mapper, chunkSize = 100) {
    const results = [];
    
    for (let i = 0; i < array.length; i += chunkSize) {
        const chunk = array.slice(i, i + chunkSize);
        
        const chunkResults = await Promise.all(chunk.map(item => mapper(item)));
        results.push(...chunkResults);
        
        // Yield to event loop after each chunk
        await yieldToEventLoop();
    }
    
    return results;
}

module.exports = {
    parseAsync,
    yieldToEventLoop,
    processArrayWithYield,
    filterArrayWithYield,
    mapArrayWithYield,
    YIELD_CHUNK_SIZE
};
