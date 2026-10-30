/**
 * Amazon's Product Type Definitions (2020-09-01): which product type fits, and
 * which fields a listing of that type needs. The schema is a JSON Schema per
 * product type (seen live: each attribute is a list of { value, language_tag?,
 * marketplace_id }, with Amazon's maxLength and enum lists).
 *
 * SellerQI turns the common shapes into simple form fields; anything else is left
 * to Amazon's own VALIDATION_PREVIEW, which the approval window shows.
 */
const axios = require('axios');

const TIMEOUT_MS = 30000;
const LANGUAGE = { US: 'en_US', CA: 'en_CA', MX: 'es_MX', UK: 'en_GB', DE: 'de_DE', FR: 'fr_FR', IT: 'it_IT', ES: 'es_ES', NL: 'nl_NL', JP: 'ja_JP', IN: 'en_IN', AU: 'en_AU', AE: 'en_AE', SA: 'ar_AE', SG: 'en_SG', BR: 'pt_BR', SE: 'sv_SE', PL: 'pl_PL' };

async function searchProductTypes({ accessToken, host, marketplaceId }, keywords) {
    const res = await axios.get(`${host}/definitions/2020-09-01/productTypes`, {
        headers: { 'x-amz-access-token': accessToken }, params: { marketplaceIds: marketplaceId, keywords }, timeout: TIMEOUT_MS
    });
    return (res.data?.productTypes || []).map((p) => ({ productType: p.name, displayName: p.displayName || p.name }));
}

/** The definition (cached 7 days). requirements: LISTING | LISTING_OFFER_ONLY. */
async function getDefinition({ accessToken, host, marketplaceId }, productType, requirements, country) {
    const Cache = require('../../models/MCP/ProductTypeDefinitionCacheModel.js');
    const cached = await Cache.findOne({ productType, marketplaceId, requirements }).lean().catch(() => null);
    if (cached?.schema) return { productType, displayName: cached.displayName, version: cached.version, schema: cached.schema };
    const res = await axios.get(`${host}/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`, {
        headers: { 'x-amz-access-token': accessToken },
        params: { marketplaceIds: marketplaceId, requirements, locale: LANGUAGE[country] || 'en_US' },
        timeout: TIMEOUT_MS
    });
    const schema = (await axios.get(res.data.schema.link.resource, { timeout: TIMEOUT_MS })).data;
    const out = { productType, displayName: res.data.displayName || productType, version: res.data.productTypeVersion?.version || '', schema };
    await Cache.updateOne({ productType, marketplaceId, requirements }, { $set: { ...out, fetchedAt: new Date() } }, { upsert: true }).catch(() => null);
    return out;
}

/** Pure: one attribute's schema -> a simple form field, or null when SellerQI cannot show it simply. */
function fieldFor(name, prop, required) {
    const item = prop?.items;
    const props = item?.properties || {};
    const value = props.value;
    if (!value) return null;
    const other = Object.keys(props).filter((k) => !['value', 'language_tag', 'marketplace_id', 'unit'].includes(k));
    if (other.length) return null; // nested shapes (several parts) are not simple
    const base = {
        name,
        title: prop.title || name,
        description: prop.description || '',
        required,
        languageTag: (item.required || []).includes('language_tag'),
        multiple: !(prop.maxItems === 1),
        maxItems: prop.maxItems || null
    };
    if (props.unit) {
        return { ...base, kind: 'measure', units: (props.unit.enum || []).map((u, i) => ({ value: u, label: props.unit.enumNames?.[i] || u })), multiple: false };
    }
    if (Array.isArray(value.enum) && value.enum.length) {
        return { ...base, kind: 'choice', options: value.enum.slice(0, 500).map((v, i) => ({ value: v, label: value.enumNames?.[i] || String(v) })), multiple: false };
    }
    if (value.type === 'boolean') return { ...base, kind: 'boolean', multiple: false };
    if (value.type === 'number' || value.type === 'integer') return { ...base, kind: 'number', multiple: false };
    if (value.type === 'string') return { ...base, kind: 'text', maxLength: value.maxLength || null };
    return null;
}

/** Pure: the fields of a schema: required first, then the rest SellerQI can show. */
function formFields(schema) {
    const required = new Set(schema?.required || []);
    const fields = [];
    const unsupportedRequired = [];
    for (const [name, prop] of Object.entries(schema?.properties || {})) {
        const field = fieldFor(name, prop, required.has(name));
        if (field) fields.push(field);
        else if (required.has(name)) unsupportedRequired.push(name);
    }
    fields.sort((a, b) => Number(b.required) - Number(a.required) || a.title.localeCompare(b.title));
    return { fields, unsupportedRequired };
}

/**
 * Pure: form values -> Amazon attributes. values: { [name]: string | string[] |
 * number | boolean | { value, unit } }. Empty values are left out.
 */
function attributesFrom(values, fields, { marketplaceId, languageTag }) {
    const byName = new Map(fields.map((f) => [f.name, f]));
    const attributes = {};
    for (const [name, raw] of Object.entries(values || {})) {
        const f = byName.get(name);
        if (!f) continue;
        const entry = (value, extra = {}) => ({ value, ...extra, ...(f.languageTag ? { language_tag: languageTag } : {}), marketplace_id: marketplaceId });
        if (f.kind === 'measure') {
            if (raw?.value === '' || raw?.value === undefined || raw?.value === null) continue;
            attributes[name] = [entry(Number(raw.value), { unit: raw.unit })];
        } else if (f.kind === 'number') {
            if (raw === '' || raw === undefined || raw === null) continue;
            attributes[name] = [entry(Number(raw))];
        } else if (f.kind === 'boolean') {
            if (raw === '' || raw === undefined || raw === null) continue;
            attributes[name] = [entry(raw === true || raw === 'true')];
        } else {
            const list = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v ?? '').trim()).filter(Boolean);
            if (!list.length) continue;
            attributes[name] = (f.multiple ? list.slice(0, f.maxItems || list.length) : list.slice(0, 1)).map((v) => entry(v));
        }
    }
    return attributes;
}

module.exports = { searchProductTypes, getDefinition, fieldFor, formFields, attributesFrom, LANGUAGE };
