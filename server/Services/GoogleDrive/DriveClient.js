/**
 * DriveClient.js — the few Drive v3 calls the report archive needs.
 *
 * Raw axios, like GmailClient: googleapis would be a large dependency for six requests.
 * Every call uses the shared access token from DriveAuth and replays once on a 401 with a
 * freshly minted one (a token revoked or expired early).
 */

const axios = require('axios');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError.js');
const DriveAuth = require('./DriveAuth.js');
const {
    API_BASE, UPLOAD_BASE, FOLDER_MIME, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS,
} = require('./config.js');

/** Drive's error message, which says what is wrong ("File not found", "Insufficient permissions"). */
const toApiError = (error, context) => {
    const status = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;
    const apiError = new ApiError(status || 502, `${context}: ${message}`);
    apiError.driveStatus = status || null;
    return apiError;
};

const request = async (config, context) => {
    const send = async (token) => axios({
        timeout: REQUEST_TIMEOUT_MS,
        ...config,
        headers: { ...(config.headers || {}), Authorization: `Bearer ${token}` },
    });

    try {
        return (await send(await DriveAuth.getAccessToken())).data;
    } catch (error) {
        if (error.response?.status !== 401) throw toApiError(error, context);
    }
    await DriveAuth.invalidateAccessToken();
    try {
        return (await send(await DriveAuth.getAccessToken({ forceRefresh: true }))).data;
    } catch (error) {
        throw toApiError(error, context);
    }
};

/** A value inside a Drive query string: backslash and single quote are escaped. */
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const listFiles = async (q, context) => {
    const data = await request({
        method: 'get',
        url: `${API_BASE}/files`,
        params: { q, fields: 'files(id,name)', spaces: 'drive', pageSize: 10 },
    }, context);
    return data?.files || [];
};

/** The folder named `name` directly under `parentId` ('root' for My Drive), or null. */
const findChildFolder = async (parentId, name) => {
    const files = await listFiles(
        `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = ${quote(FOLDER_MIME)} and trashed = false`,
        `Drive folder lookup "${name}"`
    );
    return files[0] || null;
};

const createFolder = async (parentId, name) => request({
    method: 'post',
    url: `${API_BASE}/files`,
    params: { fields: 'id,name' },
    data: { name, mimeType: FOLDER_MIME, parents: [parentId] },
}, `Drive folder create "${name}"`);

/** The folder, or null when it was deleted or is in the trash. */
const getFolder = async (id) => {
    try {
        const file = await request({
            method: 'get',
            url: `${API_BASE}/files/${encodeURIComponent(id)}`,
            params: { fields: 'id,name,trashed' },
        }, 'Drive folder read');
        return file && !file.trashed ? file : null;
    } catch (error) {
        if (error.driveStatus === 404) return null;
        throw error;
    }
};

const renameFolder = async (id, name) => request({
    method: 'patch',
    url: `${API_BASE}/files/${encodeURIComponent(id)}`,
    params: { fields: 'id,name' },
    data: { name },
}, `Drive folder rename "${name}"`);

/** A file (not a folder) named `name` in `folderId`, or null. */
const findFileByName = async (folderId, name) => {
    const files = await listFiles(
        `${quote(folderId)} in parents and name = ${quote(name)} and mimeType != ${quote(FOLDER_MIME)} and trashed = false`,
        `Drive file lookup "${name}"`
    );
    return files[0] || null;
};

/** Multipart upload: metadata and the PDF in one request. */
const uploadPdf = async ({ folderId, name, buffer }) => {
    const boundary = `sqi${crypto.randomBytes(12).toString('hex')}`;
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
            + `${JSON.stringify({ name, parents: [folderId], mimeType: 'application/pdf' })}\r\n`
            + `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
        ),
        Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
        Buffer.from(`\r\n--${boundary}--`),
    ]);
    return request({
        method: 'post',
        url: `${UPLOAD_BASE}/files`,
        params: { uploadType: 'multipart', fields: 'id,name,webViewLink' },
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        data: body,
        timeout: UPLOAD_TIMEOUT_MS,
        maxBodyLength: Infinity,
    }, `Drive upload "${name}"`);
};

/** Replace an existing file's content; the id, name and folder stay. */
const updatePdf = async (fileId, buffer) => request({
    method: 'patch',
    url: `${UPLOAD_BASE}/files/${encodeURIComponent(fileId)}`,
    params: { uploadType: 'media', fields: 'id,name,webViewLink' },
    headers: { 'Content-Type': 'application/pdf' },
    data: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    timeout: UPLOAD_TIMEOUT_MS,
    maxBodyLength: Infinity,
}, 'Drive file update');

/** The connected account's address, with a token from the consent callback. */
const getAboutWithToken = async (accessToken) => {
    const res = await axios.get(`${API_BASE}/about`, {
        params: { fields: 'user(emailAddress)' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: REQUEST_TIMEOUT_MS,
    });
    return { emailAddress: res.data?.user?.emailAddress || null };
};

module.exports = {
    findChildFolder,
    createFolder,
    getFolder,
    renameFolder,
    findFileByName,
    uploadPdf,
    updatePdf,
    getAboutWithToken,
    quote,
};
