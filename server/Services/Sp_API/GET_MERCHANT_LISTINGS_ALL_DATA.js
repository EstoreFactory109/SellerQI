const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const SellerModel = require('../../models/user-auth/sellerCentralModel.js');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

/**
 * How many `TotatProducts` history entries to keep per seller account.
 *
 * That array is appended to on every run and was capped by nothing. Production had one document
 * carrying 1,131 entries. It has ZERO readers anywhere in client or server — only the schema, the
 * write below, and the account-delete script reference it — so its only real cost is read
 * amplification: every unprojected `Seller.findOne` drags the whole thing over the wire, and that
 * happens several times per pipeline run (ProductIssuesService, Integration, ScheduledIntegration,
 * FbaInventoryStorageService). Kept rather than dropped so a short history stays available.
 */
const TOTAT_PRODUCTS_HISTORY_LIMIT = 90;

/** Statuses for which `issues` is meaningful — see carryForwardProductFields. */
const ISSUE_BEARING_STATUSES = new Set(['Inactive', 'Incomplete']);

/**
 * Identity for a listing row. Composite `asin|sku`, matching FbaInventoryStorageService — the one
 * other service that carries values into `products[]`.
 *
 * SKU alone would be enough in the normal case (checked across production: 79,015 products, zero
 * duplicate SKUs within an account). ASIN alone would NOT be — 95 accounts have one ASIN spread
 * across multiple SKUs. The composite is chosen because it fails to match when a SKU is re-pointed
 * at a different ASIN, which is exactly the case where the old `issueCount` MUST NOT be carried:
 * that count is derived per-ASIN (ProductIssuesService keys its map by asin), so inheriting it
 * across an ASIN change would silently attribute one product's errors to another.
 */
function productKey(p) {
    return `${String(p?.asin ?? '').trim()}|${String(p?.sku ?? '').trim()}`;
}

/**
 * Carry per-product fields that OTHER services own across the merchant-listings rebuild.
 *
 * WHY THIS EXISTS
 * The listings report only supplies {asin, sku, itemName, price, status, quantity}. Assigning it
 * straight over `sellerAccount[].products` made Mongoose apply sub-schema defaults to everything
 * else, so `issueCount` reset to 0 and `issues`/`has_b2b_pricing` were dropped — for the whole
 * account, in the INIT phase, minutes into a run. Those values are only recomputed in CALC_REVIEW,
 * phase 7 of 8, which on large accounts is HOURS later. The dashboard reads the live document with
 * no snapshot layer and hides any product with no issues, so the "products to fix" widgets sat
 * empty for that entire window. `has_b2b_pricing` was worse: nothing on the scheduled path ever
 * restores it, so it was being wiped permanently.
 *
 * This does NOT change which products exist. The caller still assigns the freshly-built array, so
 * delisted rows disappear exactly as before — that drop-out is relied on by product counts and by
 * the asin/sku arrays that drive downstream SP-API calls.
 *
 * @param {Array} existingProducts products currently on the seller doc (may be a Mongoose array)
 * @param {Array} incomingProducts freshly built rows from the report; MUTATED and returned
 */
function carryForwardProductFields(existingProducts, incomingProducts) {
    const incoming = Array.isArray(incomingProducts) ? incomingProducts : [];
    const existing = Array.isArray(existingProducts) ? existingProducts : [];
    if (!existing.length || !incoming.length) return incoming;

    const previous = new Map();
    for (const p of existing) {
        // A Mongoose subdocument answers property access fine; no toObject() needed.
        if (p) previous.set(productKey(p), p);
    }

    for (const row of incoming) {
        const prev = previous.get(productKey(row));
        if (!prev) continue;   // new listing, or ASIN re-pointed: start clean, on purpose

        // Re-derived from scratch every CALC_REVIEW (ProductIssuesService visits every product and
        // writes `map.get(asin) || 0`), so carrying these can only shorten the blind window — it
        // can never leave a permanently wrong value behind.
        if (prev.issueCount !== undefined && prev.issueCount !== null) row.issueCount = prev.issueCount;
        if (prev.issueCountUpdatedAt) row.issueCountUpdatedAt = prev.issueCountUpdatedAt;

        // Nothing on the scheduled path writes this, so without carrying it forward it is lost for
        // good on the first scheduled run after a connect.
        if (prev.has_b2b_pricing !== undefined && prev.has_b2b_pricing !== null) {
            row.has_b2b_pricing = prev.has_b2b_pricing;
        }

        // ── `issues` is the one field that must NOT be carried unconditionally ──
        // It is only ever SET for Inactive/Incomplete products, and NOTHING ever clears it. Today
        // this wholesale replace is the only thing that does. Carry it blindly and a product that
        // gets fixed and goes Active keeps its stale strings forever — and the dashboard falls back
        // to `issues.length` when `issueCount` is 0, so that product would permanently re-appear in
        // "top products to fix". Gating on the NEW status is what keeps the clear-on-fix behaviour.
        if (Array.isArray(prev.issues) && ISSUE_BEARING_STATUSES.has(row.status)) {
            row.issues = prev.issues;
        }

        // `quantity` is deliberately NOT carried: FbaInventoryStorageService overwrites it seconds
        // later in the same phase, and the report supplies a value anyway.
    }

    return incoming;
}

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
            logger.debug(`Checking report status... (Attempt ${attempt})`);
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
            logger.debug('[GET_MERCHANT_LISTINGS_ALL_DATA] Sample record headers:', Object.keys(refinedData[0]).join(', '));
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
                    logger.debug('[GET_MERCHANT_LISTINGS_ALL_DATA] Skipping product with missing asin or sku:', {
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
                // Carry over the fields other services own BEFORE the replace, or the sub-schema
                // defaults wipe them for the whole account until CALC_REVIEW runs hours later.
                // Still a full replace, so delisted listings drop out exactly as before.
                carryForwardProductFields(getSellerDetails.sellerAccount[i].products, ProductData);
                getSellerDetails.sellerAccount[i].products=ProductData;
                getSellerDetails.sellerAccount[i].TotatProducts.push({
                    NumberOfProducts:ProductData.length
                })
                // Bound the history. Appended every run, read by nothing; production had 1,131
                // entries on one document. splice() so the Mongoose array tracks the change.
                const history = getSellerDetails.sellerAccount[i].TotatProducts;
                if (history.length > TOTAT_PRODUCTS_HISTORY_LIMIT) {
                    history.splice(0, history.length - TOTAT_PRODUCTS_HISTORY_LIMIT);
                }
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
    decompressedData = null; // free the decompressed buffer ASAP
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
// Named exports alongside the default: every caller does `require(...)` and calls the result
// directly, so the default must stay a function. These exist so the merge can be unit-tested as a
// pure function instead of mocking the whole HTTP + gunzip + TSV stack it sits behind — the same
// reason FinanceService exports parseTsv/foldSalesReportRows.
module.exports.carryForwardProductFields = carryForwardProductFields;
module.exports.productKey = productKey;
module.exports.TOTAT_PRODUCTS_HISTORY_LIMIT = TOTAT_PRODUCTS_HISTORY_LIMIT;
