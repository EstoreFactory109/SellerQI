/**
 * What the Estore Factory team delivered on a task: files and links, from Zoho.
 *
 * Shapes probed against the live portal on 2026-10-27 (server/scripts/probeZohoDeliverables.js):
 * the team's files are WorkDrive attachments on task COMMENTS — the task-level attachments list
 * is empty even when `has_attachments` is true — each carrying attachment_id, name, type (mime),
 * size, download_url, preview_url, permanent_url and third_party_file_id. Comment authors carry
 * `is_client_user`, which is how the client's own uploads are left out.
 *
 * Pure functions only: the sync stores the candidates, the AI decides which are deliverables
 * (Services/AI/ZohoDeliverableClassifier.js), and the Status page shows those.
 */
const crypto = require('crypto');

/**
 * File-sharing hosts. A link to anywhere else (the client's own shop, Amazon listings, docs)
 * is conversation, not a delivery, and is never offered as one.
 */
const SHARE_HOSTS = [
    'drive.google.com', 'docs.google.com', 'dropbox.com', 'dl.dropboxusercontent.com',
    'wetransfer.com', 'we.tl', 'onedrive.live.com', '1drv.ms', 'sharepoint.com',
    'box.com', 'workdrive.zoho.com', 'canva.com', 'figma.com', 'frame.io', 'vimeo.com',
    'youtube.com', 'youtu.be', 'loom.com',
];

const isShareHost = (hostname) => {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return SHARE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};

const MAX_NAME = 200;

const shortHash = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);

/** Stable key for a file or a link, used by the AI cache, staff overrides and downloads. */
const fileKey = (fileId) => `f_${String(fileId).replace(/[^A-Za-z0-9]/g, '')}`;
const linkKey = (commentId, url) => `l_${String(commentId).replace(/[^A-Za-z0-9]/g, '')}_${shortHash(url)}`;

const toDate = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    const d = Number.isFinite(n) && String(value).trim() !== '' ? new Date(n) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** One attachment from a comment's `attachments[]`, or null when it is trashed or unusable. */
const normaliseAttachment = (a = {}) => {
    if (!a || String(a.trashed) === 'true') return null;
    const fileId = a.attachment_id || a.third_party_file_id || a.id;
    if (!fileId || !a.name) return null;
    return {
        fileId: String(fileId),
        name: String(a.name).slice(0, MAX_NAME),
        mimeType: a.type || null,
        size: Number(a.size) || 0,
        downloadUrl: a.download_url || null,
        previewUrl: a.preview_url || null,
        permanentUrl: a.permanent_url || null,
        thirdPartyFileId: a.third_party_file_id || null,
        addedAt: toDate(a.associated_time_long || a.created_time),
        addedByName: a.associated_by_name || null,
    };
};

/** Share links in a comment's raw HTML (hrefs and bare URLs), de-duplicated. */
const extractShareLinks = (html = '') => {
    const found = new Set();
    const text = String(html || '');
    for (const m of text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.add(m[1]);
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) found.add(m[0]);
    const links = [];
    for (const raw of found) {
        const url = raw.replace(/&amp;/g, '&').replace(/[).,;]+$/, '');
        try {
            const u = new URL(url);
            if (!/^https?:$/.test(u.protocol) || !isShareHost(u.hostname)) continue;
            if (!links.includes(u.toString())) links.push(u.toString());
        } catch { /* not a URL */ }
    }
    return links.slice(0, 20);
};

/** Readable name for a link: the host's service, e.g. "Google Drive link". */
const linkLabel = (url) => {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const names = {
        'drive.google.com': 'Google Drive', 'docs.google.com': 'Google Docs', 'dropbox.com': 'Dropbox',
        'wetransfer.com': 'WeTransfer', 'we.tl': 'WeTransfer', 'onedrive.live.com': 'OneDrive', '1drv.ms': 'OneDrive',
        'workdrive.zoho.com': 'Zoho WorkDrive', 'canva.com': 'Canva', 'figma.com': 'Figma', 'loom.com': 'Loom',
        'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'vimeo.com': 'Vimeo', 'box.com': 'Box', 'frame.io': 'Frame.io',
    };
    const match = Object.keys(names).find((h) => host === h || host.endsWith(`.${h}`));
    return `${match ? names[match] : host} link`;
};

/**
 * Every possible deliverable on a task: the team's comment files and share links. The
 * client's own comments (their replies and uploads) are never candidates.
 *
 * @param {{ comments: Array<{ commentId, content, createdAt, authorIsClient, attachments, links }> }} task
 */
const candidatesForTask = (task = {}) => {
    const out = [];
    for (const c of task.comments || []) {
        if (c.authorIsClient) continue;
        for (const f of c.attachments || []) {
            out.push({
                key: fileKey(f.fileId),
                kind: 'file',
                name: f.name,
                mimeType: f.mimeType,
                size: f.size,
                addedAt: f.addedAt || c.createdAt || null,
                commentId: c.commentId,
                context: c.content || '',
            });
        }
        for (const url of c.links || []) {
            out.push({
                key: linkKey(c.commentId, url),
                kind: 'link',
                name: linkLabel(url),
                url,
                addedAt: c.createdAt || null,
                commentId: c.commentId,
                context: c.content || '',
            });
        }
    }
    return out;
};

/** Hash of what the AI judged a candidate on — same hash, same decision, no new AI call. */
const contextHash = (task, candidate) => shortHash([
    task.name, task.status, candidate.key, candidate.name, candidate.mimeType, (candidate.context || '').slice(0, 600),
].join('\x00'));

/**
 * Whether a candidate is shown to the client: a staff override wins; otherwise only a firm
 * "yes" from the AI. Unsure, "no" and not-yet-decided are all hidden.
 */
const isShown = (decision, override) => {
    if (override === 'show') return true;
    if (override === 'hide') return false;
    return decision === 'yes';
};

module.exports = {
    SHARE_HOSTS,
    isShareHost,
    fileKey,
    linkKey,
    normaliseAttachment,
    extractShareLinks,
    linkLabel,
    candidatesForTask,
    contextHash,
    isShown,
};
