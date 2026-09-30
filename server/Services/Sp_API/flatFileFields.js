/**
 * Read an SP-API flat-file report by field meaning rather than by exact header.
 *
 * Amazon's flat files are not consistent about header spelling — the same
 * column arrives as "seller-sku", "Seller SKU" or "sku" depending on the report
 * and the marketplace — and the reports this is used for could not be checked
 * against a live response (no working SP-API credentials where they were
 * written). So each field lists the spellings it may arrive under, compared
 * with case, spaces and punctuation stripped, and whatever headers Amazon DID
 * send are returned alongside the rows, so a mismatch can be diagnosed from the
 * stored snapshot instead of being guessed at.
 */

/** "Seller-SKU" / "seller sku" / "SELLER_SKU" -> "sellersku" */
const squash = (header) => String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {Array<object>} records   parseAsync output, keyed by the raw header
 * @param {object} candidates       { field: ['spelling', ...] }
 * @returns {{ rows: Array<object>, headers: string[], missing: string[] }}
 *   `missing` names every field no header matched.
 */
const mapFlatFileRecords = (records, candidates) => {
    const headers = records.length ? Object.keys(records[0]) : [];
    const bySquashed = new Map(headers.map((header) => [squash(header), header]));

    const columnFor = {};
    const missing = [];
    for (const [field, spellings] of Object.entries(candidates)) {
        const match = spellings.map(squash).find((spelling) => bySquashed.has(spelling));
        if (match) columnFor[field] = bySquashed.get(match);
        else missing.push(field);
    }

    const rows = records.map((record) => {
        const row = {};
        for (const field of Object.keys(candidates)) {
            const column = columnFor[field];
            row[field] = column ? String(record[column] ?? '').trim() : '';
        }
        return row;
    });

    return { rows, headers, missing };
};

/** "1,234" / "" / "--" -> number, 0 for anything unreadable. */
const toCount = (value) => {
    const parsed = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

module.exports = { mapFlatFileRecords, squash, toCount };
