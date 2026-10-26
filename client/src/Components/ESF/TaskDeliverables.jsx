import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, FileArchive, FileImage, FileVideo, FileSpreadsheet, Link2, X as XIcon, Eye, EyeOff, RotateCcw, Loader2, Package } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import downloadFile from '../../utils/downloadFile.js';

/**
 * The work the Estore Factory team delivered on a task — files and links from Zoho — on the
 * client's Status page. The server sends only the deliverables (judged by AI, corrected by
 * staff); ESF staff logged in as the client also get the hidden ones, greyed, with the AI's
 * reason and Show / Hide controls. Files come through our own endpoint (Zoho needs our
 * token); links are the team's share links and open directly.
 */

const BASE = '/api/pagewise/esf/project-status';
const fileUrl = (key, preview = false) => `${BASE}/files/${encodeURIComponent(key)}${preview ? '?preview=1' : ''}`;
export const zipUrl = (taskId) => `${BASE}/tasks/${encodeURIComponent(taskId)}/files.zip`;

/** Same label the server's day-by-day summary uses ("3 Feb", "1 Sept"), so files sit under their day. */
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayLabelOf = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : DAY_LABEL.format(d);
};

const isImage = (d) => d.kind === 'file' && /^image\/(png|jpe?g|gif|webp)$/i.test(d.mimeType || '');

const iconFor = (d) => {
  if (d.kind === 'link') return Link2;
  const t = String(d.mimeType || '');
  if (t.startsWith('image/')) return FileImage;
  if (t.startsWith('video/')) return FileVideo;
  if (/zip|compressed|archive/.test(t)) return FileArchive;
  if (/sheet|excel|csv/.test(t)) return FileSpreadsheet;
  return FileText;
};

const sizeLabel = (bytes) => {
  const b = Number(bytes) || 0;
  if (!b) return null;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const errorText = (err) => (err?.response?.status === 503
  ? "Files can't be downloaded yet — your team is finishing the setup."
  : 'Could not download this file. Please try again.');

/** An image thumbnail fetched through our server (cookies), shown from a blob URL. */
const Thumb = ({ item, onOpen }) => {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = null;
    let cancelled = false;
    axiosInstance.get(fileUrl(item.key, true), { responseType: 'blob' })
      .then((res) => { if (!cancelled) { url = URL.createObjectURL(res.data); setSrc(url); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [item.key]);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={item.name}
      className="relative h-[72px] w-[72px] flex-none overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] hover:border-blue-400/50"
    >
      {src ? <img src={src} alt={item.name} className="h-full w-full object-cover" />
        : failed ? <FileImage className="m-auto h-6 w-6 text-gray-500" />
          : <Loader2 className="m-auto h-4 w-4 animate-spin text-gray-500" />}
    </button>
  );
};

/** Full-size image preview. */
const Lightbox = ({ item, onClose, onDownload }) => {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let url = null;
    axiosInstance.get(fileUrl(item.key), { responseType: 'blob' })
      .then((res) => { url = URL.createObjectURL(res.data); setSrc(url); })
      .catch((err) => setError(errorText(err)));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item.key]);
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-3 text-sm text-gray-200">
          <span className="truncate">{item.name}</span>
          <button type="button" onClick={() => onDownload(item)} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-white/10"><XIcon className="h-4 w-4" /></button>
        </div>
        {src ? <img src={src} alt={item.name} className="max-h-[80vh] rounded-lg object-contain" />
          : error ? <div className="rounded-lg bg-white/5 p-8 text-sm text-gray-300">{error}</div>
            : <Loader2 className="m-8 h-6 w-6 animate-spin text-gray-400" />}
      </div>
    </div>,
    document.body
  );
};

/** One file or link. Staff see hidden items greyed with the AI's reason and the controls. */
const Chip = ({ item, canManage, onDownload, onVisibility, busy }) => {
  const Icon = iconFor(item);
  const hidden = canManage && item.shown === false;
  const meta = [sizeLabel(item.size)].filter(Boolean).join(' · ');
  const body = (
    <>
      <Icon className="h-4 w-4 flex-none" />
      <span className="min-w-0 truncate">{item.name}</span>
      {meta && <span className="flex-none text-[11px] text-gray-500">{meta}</span>}
    </>
  );
  return (
    <div className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${hidden ? 'border-dashed border-white/10 text-gray-500' : 'border-white/10 bg-white/[0.03] text-gray-200'}`}>
      {item.kind === 'link'
        ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 hover:text-blue-300">{body}</a>
        : <button type="button" onClick={() => onDownload(item)} className="flex min-w-0 items-center gap-2 text-left hover:text-blue-300">{body}<Download className="h-3.5 w-3.5 flex-none opacity-60" /></button>}
      {canManage && (
        <span className="ml-1 flex flex-none items-center gap-1 border-l border-white/10 pl-2">
          {hidden && item.aiReason && <span className="max-w-[180px] truncate text-[11px] italic text-gray-500" title={item.aiReason}>{item.aiReason}</span>}
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (
            <>
              <button type="button" title={hidden ? 'Show to client' : 'Hide from client'} aria-label={hidden ? `Show ${item.name} to client` : `Hide ${item.name} from client`}
                onClick={() => onVisibility(item, hidden ? 'show' : 'hide')} className="rounded p-0.5 hover:bg-white/10">
                {hidden ? <Eye className="h-3.5 w-3.5 text-blue-300" /> : <EyeOff className="h-3.5 w-3.5 text-gray-400" />}
              </button>
              {item.override && (
                <button type="button" title="Let the AI decide" aria-label={`Let the AI decide for ${item.name}`} onClick={() => onVisibility(item, 'auto')} className="rounded p-0.5 hover:bg-white/10">
                  <RotateCcw className="h-3.5 w-3.5 text-gray-400" />
                </button>
              )}
            </>
          )}
        </span>
      )}
    </div>
  );
};

/** Shared actions (download, preview, staff visibility) for a task's deliverables. */
export const useDeliverableActions = ({ onChanged }) => {
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);

  const download = async (item) => {
    setError('');
    try { await downloadFile(fileUrl(item.key), item.name); } catch (err) { setError(errorText(err)); }
  };
  const open = (item) => (isImage(item) ? setLightbox(item) : download(item));
  const setVisibility = async (item, visibility) => {
    setBusyKey(item.key);
    setError('');
    try {
      await axiosInstance.post(`${fileUrl(item.key)}/visibility`, { visibility });
      onChanged?.(item.key, visibility);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that change.');
    } finally {
      setBusyKey(null);
    }
  };
  const overlay = lightbox ? <Lightbox item={lightbox} onClose={() => setLightbox(null)} onDownload={download} /> : null;
  return { download, open, setVisibility, busyKey, error, setError, overlay };
};

/** A list of deliverables: image thumbnails first, then file and link chips. */
export const DeliverableList = ({ items, canManage, actions, compact = false }) => {
  if (!items.length) return null;
  const images = items.filter((i) => isImage(i) && (!canManage || i.shown !== false));
  const others = items.filter((i) => !images.includes(i));
  return (
    <div className={`flex flex-col ${compact ? 'gap-2 mt-2' : 'gap-2.5'}`}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((i) => <Thumb key={i.key} item={i} onOpen={actions.open} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((i) => (
            <Chip key={i.key} item={i} canManage={canManage} onDownload={actions.open} onVisibility={actions.setVisibility} busy={actions.busyKey === i.key} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Header line for a task's deliverables: count and "Download all". */
export const DeliverablesBar = ({ task, items, actions }) => {
  const [zipping, setZipping] = useState(false);
  const files = items.filter((i) => i.kind === 'file' && i.shown !== false);
  if (!items.length) return null;
  const downloadAll = async () => {
    setZipping(true);
    actions.setError('');
    try { await downloadFile(zipUrl(task.id), `${task.name || 'deliverables'}.zip`); } catch (err) { actions.setError(errorText(err)); } finally { setZipping(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-400">
        <Package className="h-3.5 w-3.5" /> Delivered
      </span>
      {files.length > 1 && (
        <button type="button" onClick={downloadAll} disabled={zipping} className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-gray-200 hover:bg-white/[0.06] disabled:opacity-50">
          {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download all ({files.length})
        </button>
      )}
      {actions.error && <span className="text-xs text-amber-300">{actions.error}</span>}
    </div>
  );
};

/** Small "📎 3" count for a collapsed task row. */
export const DeliverableCount = ({ items }) => {
  const shown = items.filter((i) => i.shown !== false).length;
  if (!shown) return null;
  return (
    <span className="inline-flex flex-none items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-300" title={`${shown} delivered file${shown === 1 ? '' : 's'}`}>
      <Package className="h-3 w-3" /> {shown}
    </span>
  );
};
