/**
 * Fulfillment Inbound API v2024-03-20: send stock to Amazon's warehouses.
 *
 * A plan goes: create -> packing options -> confirm packing + box contents ->
 * placement options (fees) -> confirm placement -> per shipment, delivery window
 * (when the transport needs one) and transportation -> tracking / labels.
 * Each generate / confirm call returns an operationId; Amazon finishes it later
 * (getInboundOperationStatus). Seen live: Amazon Warehousing and Distribution
 * plans refuse these operations (400), and are left out.
 *
 * "generate" calls only prepare options (nothing is committed or charged);
 * every "confirm", the plan itself and its cancellation are changes the seller
 * approves (Services/Actions/handlers/inbound.js).
 */
const axios = require('axios');

const TIMEOUT_MS = 60000;
const base = (host) => `${host}/inbound/fba/2024-03-20`;
const H = (accessToken, json = false) => ({ 'x-amz-access-token': accessToken, ...(json ? { 'Content-Type': 'application/json' } : {}) });

async function get(creds, path, params = {}) {
    const res = await axios.get(`${base(creds.host)}${path}`, { headers: H(creds.accessToken), params, timeout: TIMEOUT_MS });
    return res.data || {};
}
async function post(creds, path, body = {}) {
    const res = await axios.post(`${base(creds.host)}${path}`, body, { headers: H(creds.accessToken, true), timeout: TIMEOUT_MS });
    return res.data || {};
}
async function put(creds, path, body = {}) {
    const res = await axios.put(`${base(creds.host)}${path}`, body, { headers: H(creds.accessToken, true), timeout: TIMEOUT_MS });
    return res.data || {};
}

/** Every page of a list call. */
async function all(creds, path, key, params = {}, maxPages = 10) {
    const out = [];
    let paginationToken = null;
    let pages = 0;
    do {
        const data = await get(creds, path, { pageSize: 20, ...params, ...(paginationToken ? { paginationToken } : {}) });
        out.push(...(data[key] || []));
        paginationToken = data.pagination?.nextToken || null;
        pages += 1;
    } while (paginationToken && pages < maxPages);
    return out;
}

const id = (v) => encodeURIComponent(String(v));

module.exports = {
    // ---- reads ----
    listPlans: (creds) => get(creds, '/inboundPlans', { pageSize: 30, sortBy: 'CREATION_TIME', sortOrder: 'DESC' }).then((d) => d.inboundPlans || []),
    getPlan: (creds, planId) => get(creds, `/inboundPlans/${id(planId)}`),
    listPlanItems: (creds, planId) => all(creds, `/inboundPlans/${id(planId)}/items`, 'items'),
    listPackingOptions: (creds, planId) => all(creds, `/inboundPlans/${id(planId)}/packingOptions`, 'packingOptions'),
    listPackingGroupItems: (creds, planId, groupId) => all(creds, `/inboundPlans/${id(planId)}/packingGroups/${id(groupId)}/items`, 'items'),
    listPlacementOptions: (creds, planId) => all(creds, `/inboundPlans/${id(planId)}/placementOptions`, 'placementOptions'),
    getShipment: (creds, planId, shipmentId) => get(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}`),
    listTransportationOptions: (creds, planId, shipmentId) => all(creds, `/inboundPlans/${id(planId)}/transportationOptions`, 'transportationOptions', { shipmentId }),
    listShipmentBoxes: (creds, planId, shipmentId) => all(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/boxes`, 'boxes'),
    listDeliveryWindowOptions: (creds, planId, shipmentId) => all(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/deliveryWindowOptions`, 'deliveryWindowOptions'),
    getOperation: (creds, operationId) => get(creds, `/operations/${id(operationId)}`),
    /** Labels for a confirmed shipment (Fulfillment Inbound v0, still current for labels). */
    async getLabels(creds, shipmentConfirmationId, { pageType = 'PackageLabel_Letter_2', labelType = 'UNIQUE', numberOfPackages = 1 } = {}) {
        const res = await axios.get(`${creds.host}/fba/inbound/v0/shipments/${id(shipmentConfirmationId)}/labels`, {
            headers: H(creds.accessToken), params: { PageType: pageType, LabelType: labelType, NumberOfPackages: numberOfPackages }, timeout: TIMEOUT_MS
        });
        return res.data?.payload?.DownloadURL || null;
    },

    // ---- preparation (no commitment, nothing charged) ----
    generatePackingOptions: (creds, planId) => post(creds, `/inboundPlans/${id(planId)}/packingOptions`),
    generatePlacementOptions: (creds, planId) => post(creds, `/inboundPlans/${id(planId)}/placementOptions`, {}),
    generateTransportationOptions: (creds, planId, body) => post(creds, `/inboundPlans/${id(planId)}/transportationOptions`, body),
    generateDeliveryWindowOptions: (creds, planId, shipmentId) => post(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/deliveryWindowOptions`),
    generateShipmentContentUpdatePreviews: (creds, planId, shipmentId, body) => post(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/contentUpdatePreviews`, body),
    listShipmentContentUpdatePreviews: (creds, planId, shipmentId) => all(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/contentUpdatePreviews`, 'contentUpdatePreviews'),

    // ---- changes (each one approved by the seller) ----
    createPlan: (creds, body) => post(creds, '/inboundPlans', body),
    confirmPackingOption: (creds, planId, packingOptionId) => post(creds, `/inboundPlans/${id(planId)}/packingOptions/${id(packingOptionId)}/confirmation`),
    setPackingInformation: (creds, planId, body) => post(creds, `/inboundPlans/${id(planId)}/packingInformation`, body),
    confirmPlacementOption: (creds, planId, placementOptionId) => post(creds, `/inboundPlans/${id(planId)}/placementOptions/${id(placementOptionId)}/confirmation`),
    confirmDeliveryWindowOptions: (creds, planId, shipmentId, deliveryWindowOptionId) => post(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/deliveryWindowOptions/${id(deliveryWindowOptionId)}/confirmation`),
    confirmTransportationOptions: (creds, planId, body) => post(creds, `/inboundPlans/${id(planId)}/transportationOptions/confirmation`, body),
    updateShipmentTrackingDetails: (creds, planId, shipmentId, body) => put(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/trackingDetails`, body),
    confirmShipmentContentUpdatePreview: (creds, planId, shipmentId, previewId) => post(creds, `/inboundPlans/${id(planId)}/shipments/${id(shipmentId)}/contentUpdatePreviews/${id(previewId)}/confirmation`),
    cancelPlan: (creds, planId) => put(creds, `/inboundPlans/${id(planId)}/cancellation`)
};
