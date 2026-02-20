const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const SellerModel = require('../../models/user-auth/sellerCentralModel.js');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const generateReport = async (accessToken, marketplaceIds, baseURI) => {
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
            
        const reportType = "GET_MERCHANT_LISTINGS_ALL_DATA";
        const requestBody = {
            reportType: reportType,
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString(),
        };
        
        // Add reportOptions to request English headers (for non-English marketplaces)
        const reportOptions = getReportOptions(reportType);
        if (reportOptions) {
            requestBody.reportOptions = reportOptions;
        }
        
        const response = await axios.post(
            `https://${baseURI}/reports/2021-06-30/reports`,
            requestBody,
            {
                headers: {
                    "x-amz-access-token": accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.reportId;
    } catch (error) {
        logger.error("Error generating report:", error.response ? error.response.data : error.message);
        return false;
    }
};

const checkReportStatus = async (accessToken, reportId, baseURI) => {
    try {
        const response = await axios.get(
            `https://${baseURI}/reports/2021-06-30/reports/${reportId}`,
            {
                headers: { "x-amz-access-token": accessToken },
            }
        );

        const status = response.data.processingStatus;
        const reportDocumentId = response.data.reportDocumentId || null;

        logger.info(`Report Status: ${status}`);

        switch (status) {
            case "DONE":
                logger.info(`Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;
            case "FATAL":
                logger.error("Report failed with a fatal error.");
                return false;
            case "CANCELLED":
                logger.error("Report was cancelled by Amazon.");
                return false;
            case "IN_PROGRESS":
                return null;
            case "IN_QUEUE":
                return null;
            case "DONE_NO_DATA":
                logger.error("Report completed but contains no data.");
                return false;
            case "FAILED":
                logger.error("Report failed for an unknown reason.");
                return false;
            default:
                logger.error(`Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("Error checking report status:", error.response ? error.response.data : error.message);
        return false;
    }
};

const getReportLink = async (accessToken, reportDocumentId, baseURI) => {
    try {
        const response = await axios.get(
            `https://${baseURI}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        if (!response.data.url) {
            logger.error("No valid report URL found");
            return false;
        }

        return response.data.url;
    } catch (error) {
        logger.error("Error downloading report:", error.response ? error.response.data : error.message);
        return false;
    }
};

const getReport = async (accessToken, marketplaceIds, userId, country, region, baseURI) => {
    logger.info("GET_MERCHANT_LISTINGS_ALL_DATA starting");
    
    if (!accessToken || !marketplaceIds) {
        logger.error(new ApiError(400, "Credentials are missing"));
        return false;
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds, baseURI);
        
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        const retryInterval = 10000;
        let attempt = 0;
        
        while (true) {
            attempt++;
            logger.info(`Checking report status... (Attempt ${attempt})`);
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseURI);
            
            if (reportDocumentId === false) {
                logger.error("Report failed or was cancelled");
                return false;
            }
            
            if (reportDocumentId) {
                break;
            }
            
            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, retryInterval));
        }

        const reportUrl = await getReportLink(accessToken, reportDocumentId, baseURI);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
            return false;
        }

        const refinedData = await convertTSVToJson(fullReport.data);

        if (refinedData.length === 0) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        const ProductData = [];
        
        // Helper function to normalize a string for comparison (lowercase, remove special chars)
        // Also strips non-ASCII chars to handle encoding corruption (e.g. H�ndler-SKU)
        const normalizeKey = (str) => {
            return str.toLowerCase()
                .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
                .replace(/é/g, 'e').replace(/è/g, 'e').replace(/ê/g, 'e')
                .replace(/à/g, 'a').replace(/â/g, 'a')
                .replace(/[-_\s]/g, '')
                .replace(/[^\x00-\x7F]/g, ''); // Remove any remaining non-ASCII chars (handles encoding corruption)
        };
        
        // Helper function to find field with different possible names (handles localized headers)
        // Only uses exact match and normalized full-key comparison (no partial match to avoid false positives)
        const findField = (item, ...possibleNames) => {
            // First: try exact match
            for (const name of possibleNames) {
                if (item[name] !== undefined && item[name] !== null && item[name] !== '') {
                    return item[name];
                }
            }
            
            // Second: try normalized comparison against all keys (full match only)
            const normalizedTargets = possibleNames.map(normalizeKey);
            for (const key of Object.keys(item)) {
                const normalizedKey = normalizeKey(key);
                if (normalizedTargets.includes(normalizedKey)) {
                    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
                        return item[key];
                    }
                }
            }
            
            // Note: Removed partial match step - it caused false positives like 
            // 'Produkt-ID-Typ' (value "4") matching target 'productid' before 'Produkt-ID' (actual ASIN)
            
            return null;
        };
        
        // Log first record headers for debugging localization issues
        if (refinedData.length > 0) {
            logger.info('[GET_MERCHANT_LISTINGS_ALL_DATA] Sample record headers:', Object.keys(refinedData[0]).join(', '));
        }
        
        // Process records in chunks to yield to event loop (prevents blocking lock extension)
        const CHUNK_SIZE = 200;
        for (let i = 0; i < refinedData.length; i += CHUNK_SIZE) {
            const chunk = refinedData.slice(i, i + CHUNK_SIZE);
            
            for (const data of chunk) {
                // Handle multiple possible header names (English, German, French, Italian, Spanish, etc.)
                const asin = findField(data, 
                    // English variants
                    'asin1', 'ASIN1', 'asin', 'ASIN', 'product-id', 'Product-ID',
                    // German variants (ASIN 1 with space is the actual header in German reports)
                    'ASIN 1', 'Produkt-ID'
                );
                
                // For SKU, also try to find any key ending with -SKU or containing 'SKU' as fallback
                let sku = findField(data,
                    // English variants
                    'seller-sku', 'Seller SKU', 'seller_sku', 'sku', 'SKU', 'merchant-sku',
                    // German variants (Händler-SKU is the actual header in German reports)
                    // Include variants with and without umlauts, and ASCII-only versions
                    'Händler-SKU', 'Haendler-SKU', 'Handler-SKU', 'Hndler-SKU',
                    'Verkäufer-SKU', 'Verkaeufer-SKU', 'Verkaeufer-SKU',
                    'Angebots-SKU', 'Artikel-SKU',
                    // French variants
                    'sku-vendeur', 'référence-vendeur', 'reference-vendeur', 'SKU vendeur',
                    // Italian variants
                    'SKU venditore', 'sku-venditore',
                    // Spanish variants
                    'SKU del vendedor', 'sku-vendedor'
                );
                
                // Fallback: if SKU not found, try to find any key containing 'SKU' (case-insensitive)
                // This handles encoding-corrupted headers like 'H�ndler-SKU'
                if (!sku) {
                    for (const key of Object.keys(data)) {
                        if (key.toUpperCase().includes('SKU') && !key.toLowerCase().includes('fnsku')) {
                            const val = data[key];
                            if (val !== undefined && val !== null && val !== '') {
                                sku = val;
                                break;
                            }
                        }
                    }
                }
                
                const itemName = findField(data,
                    // English variants
                    'item-name', 'Item Name', 'item_name', 'product-name', 'Product Name', 'title', 'Title',
                    // German variants
                    'Produktname', 'Artikelname', 'Artikelbezeichnung', 'Titel', 'Bezeichnung',
                    // French variants
                    'nom-du-produit', 'titre', 'nom-article',
                    // Italian variants
                    'nome-prodotto', 'titolo',
                    // Spanish variants
                    'nombre-producto', 'titulo'
                ) || "Unknown Product";
                
                const price = findField(data,
                    'price', 'Price', 'Preis', 'prix', 'prezzo', 'precio', 'your-price', 'Your Price'
                ) || 0;
                
                const status = findField(data,
                    'status', 'Status', 'listing-status', 'Listing-Status',
                    'Angebotsstatus', 'statut', 'stato', 'estado',
                    'open-date', 'Open Date' // Sometimes status is inferred from open-date presence
                );
                
                const quantity = parseInt(findField(data,
                    'quantity', 'Quantity', 'quantity-available', 'fulfillable-quantity',
                    'Menge', 'Verfügbare Menge', 'Verfuegbare Menge',
                    'quantité', 'quantite', 'quantità', 'cantidad'
                ) || 0) || 0;

                // Only add products that have required fields (asin and sku)
                if (asin && sku) {
                    ProductData.push({
                        asin: asin,
                        sku: sku,
                        itemName: itemName,
                        price: price,
                        status: status || 'Active',
                        quantity: quantity,
                    });
                } else {
                    logger.warn('[GET_MERCHANT_LISTINGS_ALL_DATA] Skipping product with missing asin or sku:', {
                        foundAsin: asin,
                        foundSku: sku,
                        availableKeys: Object.keys(data).slice(0, 10).join(', ')
                    });
                }
            }
            
            // Yield to event loop after each chunk
            await yieldToEventLoop();
        }

       
        const getSellerDetails = await SellerModel.findOne({ User: userId });
        if (!getSellerDetails) {
            logger.error(new ApiError(404, "Seller not found"));
            return false;
        }
        

        for (let i = 0; i < getSellerDetails.sellerAccount.length; i++) {
            if (getSellerDetails.sellerAccount[i].country === country && getSellerDetails.sellerAccount[i].region === region) {
                getSellerDetails.sellerAccount[i].products=ProductData;
                getSellerDetails.sellerAccount[i].TotatProducts.push({
                    NumberOfProducts:ProductData.length
                })
                break;
            }
        }


        await getSellerDetails.save();
        logger.info("Data saved successfully");
        logger.info("GET_MERCHANT_LISTINGS_ALL_DATA ended");
        return getSellerDetails;
    } catch (error) {
        logger.error("Error in getReport:", error.message);
        return false;
    }
};

/**
 * Convert TSV buffer to JSON using async streaming parser.
 * Uses async parsing to prevent blocking the event loop during large file processing.
 */
async function convertTSVToJson(tsvBuffer) {
    try {
        const records = await parseAsync(tsvBuffer, {
            delimiter: '\t',
            columns: true,
            reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA'
        });

        return records;

    } catch (error) {
        logger.error('[GET_MERCHANT_LISTINGS_ALL_DATA] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return await convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_MERCHANT_LISTINGS_ALL_DATA] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            return [];
        }
    }
}

async function convertTSVToJsonLegacy(tsvBuffer) {
    let decompressedData;
    try {
        decompressedData = await gunzip(tsvBuffer);
    } catch (decompressError) {
        decompressedData = tsvBuffer;
    }
    const tsv = decompressedData.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    if (rows.length === 0) return [];
    const headers = rows[0].split("\t");
    return rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});
    });
}

module.exports = getReport;
