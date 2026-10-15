import axiosInstance from '../config/axios.config.js';

/**
 * Download a cookie-authenticated file from the API.
 *
 * ── WHY NOT JUST AN <a href> ──
 * Because the API is on a different origin from the app. `VITE_BASE_URI` points at the
 * server; a bare `href="/api/..."` resolves against the FRONTEND origin, so it either 404s
 * or, where a proxy happens to forward it, arrives without the cookies the endpoint
 * authenticates on. The three ESF attachment links were all written that way, including the
 * client-facing one on the Messages page.
 *
 * Billing.jsx already had this right and said why, which is the whole reason this is a
 * shared helper rather than a fourth copy of the same twelve lines: "the endpoint is
 * cookie-authenticated and a bare link would not reliably carry credentials cross-origin."
 *
 * The object URL is revoked immediately. Browsers hold the blob alive until the click is
 * processed, and leaving it attached pins the whole file in memory for the life of the tab —
 * which matters on a thread with several large attachments.
 *
 * @param {string} url       API path, as axiosInstance expects it
 * @param {string} filename  what the browser should call the saved file
 * @returns {Promise<void>}  rejects on failure, so callers can show their own message
 */
const downloadFile = async (url, filename) => {
    const res = await axiosInstance.get(url, { responseType: 'blob' });

    const objectUrl = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename || 'attachment';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
};

export default downloadFile;
