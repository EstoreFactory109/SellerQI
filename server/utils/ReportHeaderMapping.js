/**
 * Report Header Mapping Utility
 * 
 * Maps localized Amazon SP-API report headers to canonical English keys.
 * Amazon returns report column headers in the marketplace's local language
 * (e.g., German for DE, French for FR). This utility normalizes them.
 * 
 * Usage:
 * 1. In generateReport: Add reportOptions with preferredReportDocumentLocale for supported reports
 * 2. In convertTSVToJson: Use normalizeHeader() to map local headers to canonical keys
 */

const logger = require('./Logger');

/**
 * Report types that support preferredReportDocumentLocale option
 * These are typically TSV/flat-file reports with column headers
 * 
 * IMPORTANT: Many report types do NOT support this option and will return InvalidInput error.
 * Only add report types here after confirming they support the locale option.
 * 
 * NOT SUPPORTED (will cause InvalidInput error):
 * - GET_V1_SELLER_PERFORMANCE_REPORT (type 3004) - returns XML
 * - GET_V2_SELLER_PERFORMANCE_REPORT (type 80300) - returns JSON
 * - GET_FBA_REIMBURSEMENTS_DATA (type 2617) - does not support locale
 * - GET_LEDGER_DETAIL_VIEW_DATA (type 84700) - does not support locale
 * - GET_LEDGER_SUMMARY_VIEW_DATA (type 18200) - does not support locale
 * - GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT - does not support locale
 * - GET_STRANDED_INVENTORY_UI_DATA - does not support locale
 * - GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA - does not support locale
 * - GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA - does not support locale
 * - GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL - does not support locale
 * 
 * For unsupported reports, use the findField helper pattern in the report service
 * to handle localized headers at parse time instead.
 */
const REPORTS_SUPPORTING_LOCALE = Object.freeze([
    // Note: Most report types do NOT support preferredReportDocumentLocale
    // Amazon returns InvalidInput error (report type 19600) for these reports
    // Disabled all locale options - use findField helper pattern to handle localized headers instead
]);

/**
 * Check if a report type supports preferredReportDocumentLocale
 * @param {string} reportType - The report type name
 * @returns {boolean}
 */
function supportsLocaleOption(reportType) {
    return REPORTS_SUPPORTING_LOCALE.includes(reportType);
}

/**
 * Get reportOptions object for report creation if the report supports locale
 * @param {string} reportType - The report type name
 * @param {string} locale - The preferred locale (default: 'en_US')
 * @returns {object|null} - reportOptions object or null if not supported
 */
function getReportOptions(reportType, locale = 'en_US') {
    if (supportsLocaleOption(reportType)) {
        return {
            preferredReportDocumentLocale: locale
        };
    }
    return null;
}

/**
 * Header mappings from various languages to canonical English keys
 * Keys are lowercase for case-insensitive matching
 * 
 * Structure: { 'localized_header_lowercase': 'canonical_english_key' }
 */
const HEADER_MAPPINGS = Object.freeze({
    // German (DE) mappings
    'datum': 'date',
    'produktname': 'product_name',
    'produktbezeichnung': 'product_name',
    'titel': 'title',
    'marke': 'brand',
    'preis': 'price',
    'menge': 'quantity',
    'bestand': 'quantity',
    'verfügbar': 'available',
    'verfügbare_einheiten': 'available_units',
    'verfügbare einheiten': 'available_units',
    'sku': 'sku',
    'fnsku': 'fnsku',
    'asin': 'asin',
    'zustand': 'condition',
    'lieferant': 'supplier',
    'verkäufe letzte 30 tage': 'sales_last_30_days',
    'verkäufe_letzte_30_tage': 'sales_last_30_days',
    'verkaufte einheiten letzte 30 tage': 'units_sold_last_30_days',
    'verkaufte_einheiten_letzte_30_tage': 'units_sold_last_30_days',
    'währung': 'currency',
    'währungscode': 'currency_code',
    'gesamteinheiten': 'total_units',
    'gesamt_einheiten': 'total_units',
    'eingehend': 'inbound',
    'nicht erfüllbar': 'unfulfillable',
    'nicht_erfüllbar': 'unfulfillable',
    'grund': 'reason',
    'referenz_id': 'reference_id',
    'referenz-id': 'reference_id',
    'transaktionstyp': 'transaction_type',
    'transaktions_typ': 'transaction_type',
    'betrag': 'amount',
    'beschreibung': 'description',
    'erstattungsbetrag': 'reimbursement_amount',
    'erstattete_menge': 'quantity_reimbursed',
    'artikelbezeichnung': 'item_name',
    
    // French (FR) mappings
    'nom du produit': 'product_name',
    'nom_du_produit': 'product_name',
    'titre': 'title',
    'marque': 'brand',
    'prix': 'price',
    'quantité': 'quantity',
    'quantite': 'quantity',
    'disponible': 'available',
    'unités disponibles': 'available_units',
    'unités_disponibles': 'available_units',
    'unites_disponibles': 'available_units',
    'état': 'condition',
    'etat': 'condition',
    'fournisseur': 'supplier',
    'ventes derniers 30 jours': 'sales_last_30_days',
    'ventes_derniers_30_jours': 'sales_last_30_days',
    'unités vendues derniers 30 jours': 'units_sold_last_30_days',
    'unités_vendues_derniers_30_jours': 'units_sold_last_30_days',
    'unites_vendues_derniers_30_jours': 'units_sold_last_30_days',
    'devise': 'currency',
    'code devise': 'currency_code',
    'code_devise': 'currency_code',
    'unités totales': 'total_units',
    'unités_totales': 'total_units',
    'unites_totales': 'total_units',
    'entrant': 'inbound',
    'non exécutable': 'unfulfillable',
    'non_executable': 'unfulfillable',
    'raison': 'reason',
    'id de référence': 'reference_id',
    'id_de_référence': 'reference_id',
    'id_de_reference': 'reference_id',
    'type de transaction': 'transaction_type',
    'type_de_transaction': 'transaction_type',
    'montant': 'amount',
    'montant du remboursement': 'reimbursement_amount',
    'montant_du_remboursement': 'reimbursement_amount',
    'quantité remboursée': 'quantity_reimbursed',
    'quantité_remboursée': 'quantity_reimbursed',
    'quantite_remboursee': 'quantity_reimbursed',
    'nom de l\'article': 'item_name',
    'nom_de_l\'article': 'item_name',
    
    // Italian (IT) mappings
    'nome prodotto': 'product_name',
    'nome_prodotto': 'product_name',
    'titolo': 'title',
    'marca': 'brand',
    'prezzo': 'price',
    'quantità': 'quantity',
    'quantita': 'quantity',
    'condizione': 'condition',
    'fornitore': 'supplier',
    'vendite ultimi 30 giorni': 'sales_last_30_days',
    'vendite_ultimi_30_giorni': 'sales_last_30_days',
    'unità vendute ultimi 30 giorni': 'units_sold_last_30_days',
    'unita_vendute_ultimi_30_giorni': 'units_sold_last_30_days',
    'valuta': 'currency',
    'codice valuta': 'currency_code',
    'codice_valuta': 'currency_code',
    'unità totali': 'total_units',
    'unita_totali': 'total_units',
    'in entrata': 'inbound',
    'in_entrata': 'inbound',
    'non eseguibile': 'unfulfillable',
    'non_eseguibile': 'unfulfillable',
    'motivo': 'reason',
    'id riferimento': 'reference_id',
    'id_riferimento': 'reference_id',
    'tipo transazione': 'transaction_type',
    'tipo_transazione': 'transaction_type',
    'importo': 'amount',
    'importo rimborso': 'reimbursement_amount',
    'importo_rimborso': 'reimbursement_amount',
    'quantità rimborsata': 'quantity_reimbursed',
    'quantita_rimborsata': 'quantity_reimbursed',
    'nome articolo': 'item_name',
    'nome_articolo': 'item_name',
    
    // Spanish (ES) mappings
    'nombre del producto': 'product_name',
    'nombre_del_producto': 'product_name',
    'título': 'title',
    'titulo': 'title',
    'precio': 'price',
    'cantidad': 'quantity',
    'disponibles': 'available',
    'unidades disponibles': 'available_units',
    'unidades_disponibles': 'available_units',
    'condición': 'condition',
    'condicion': 'condition',
    'proveedor': 'supplier',
    'ventas últimos 30 días': 'sales_last_30_days',
    'ventas_ultimos_30_dias': 'sales_last_30_days',
    'unidades vendidas últimos 30 días': 'units_sold_last_30_days',
    'unidades_vendidas_ultimos_30_dias': 'units_sold_last_30_days',
    'moneda': 'currency',
    'código de moneda': 'currency_code',
    'codigo_de_moneda': 'currency_code',
    'unidades totales': 'total_units',
    'unidades_totales': 'total_units',
    'entrante': 'inbound',
    'no cumplible': 'unfulfillable',
    'no_cumplible': 'unfulfillable',
    'razón': 'reason',
    'razon': 'reason',
    'id de referencia': 'reference_id',
    'id_de_referencia': 'reference_id',
    'tipo de transacción': 'transaction_type',
    'tipo_de_transaccion': 'transaction_type',
    'importe': 'amount',
    'importe de reembolso': 'reimbursement_amount',
    'importe_de_reembolso': 'reimbursement_amount',
    'cantidad reembolsada': 'quantity_reimbursed',
    'cantidad_reembolsada': 'quantity_reimbursed',
    'nombre del artículo': 'item_name',
    'nombre_del_articulo': 'item_name',
    
    // Common English variations (normalize to consistent format)
    'product name': 'product_name',
    'product-name': 'product_name',
    'item name': 'item_name',
    'item-name': 'item_name',
    'sales last 30 days': 'sales_last_30_days',
    'sales-last-30-days': 'sales_last_30_days',
    'units sold last 30 days': 'units_sold_last_30_days',
    'units-sold-last-30-days': 'units_sold_last_30_days',
    'merchant sku': 'merchant_sku',
    'merchant-sku': 'merchant_sku',
    'seller sku': 'seller_sku',
    'seller-sku': 'seller_sku',
    'currency code': 'currency_code',
    'currency-code': 'currency_code',
    'total units': 'total_units',
    'total-units': 'total_units',
    'available units': 'available_units',
    'available-units': 'available_units',
    'fc transfer': 'fc_transfer',
    'fc-transfer': 'fc_transfer',
    'fc processing': 'fc_processing',
    'fc-processing': 'fc_processing',
    'customer order': 'customer_order',
    'customer-order': 'customer_order',
    'reference id': 'reference_id',
    'reference-id': 'reference_id',
    'transaction type': 'transaction_type',
    'transaction-type': 'transaction_type',
    'reimbursement amount': 'reimbursement_amount',
    'reimbursement-amount': 'reimbursement_amount',
    'quantity reimbursed': 'quantity_reimbursed',
    'quantity-reimbursed': 'quantity_reimbursed',
    'quantity reimbursed total': 'quantity_reimbursed_total',
    'quantity-reimbursed-total': 'quantity_reimbursed_total',
    'supplier part no': 'supplier_part_no',
    'supplier-part-no': 'supplier_part_no',
    'supplier part no.': 'supplier_part_no',
});

/**
 * Normalize a single header to canonical English key
 * @param {string} header - The original header from the report
 * @returns {string} - Normalized canonical key
 */
function normalizeHeader(header) {
    if (!header || typeof header !== 'string') {
        return header;
    }
    
    // Clean up the header
    let cleanHeader = header.trim();
    if (cleanHeader.startsWith('"') && cleanHeader.endsWith('"')) {
        cleanHeader = cleanHeader.slice(1, -1);
    }
    
    // Check if we have a direct mapping for this header
    const lowerHeader = cleanHeader.toLowerCase();
    if (HEADER_MAPPINGS[lowerHeader]) {
        return HEADER_MAPPINGS[lowerHeader];
    }
    
    // If no mapping found, normalize to lowercase with underscores (standard format)
    return lowerHeader.replace(/-/g, '_').replace(/\s+/g, '_');
}

/**
 * Normalize all headers in an array
 * @param {string[]} headers - Array of original headers
 * @returns {string[]} - Array of normalized headers
 */
function normalizeHeaders(headers) {
    if (!Array.isArray(headers)) {
        return headers;
    }
    
    const normalized = headers.map(normalizeHeader);
    
    // Log if any headers were mapped
    const mappedHeaders = headers.filter((h, i) => {
        const orig = h.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
        return normalized[i] !== orig;
    });
    
    if (mappedHeaders.length > 0) {
        logger.info('[ReportHeaderMapping] Mapped localized headers:', {
            mapped: mappedHeaders.map((h, i) => `"${h}" -> "${normalized[headers.indexOf(h)]}"`)
        });
    }
    
    return normalized;
}

/**
 * Create a columns transformation function for csv-parse
 * that normalizes headers to canonical English keys
 * @returns {function} - Column transformation function
 */
function createColumnTransformer() {
    return (headers) => normalizeHeaders(headers);
}

module.exports = {
    REPORTS_SUPPORTING_LOCALE,
    HEADER_MAPPINGS,
    supportsLocaleOption,
    getReportOptions,
    normalizeHeader,
    normalizeHeaders,
    createColumnTransformer,
};
