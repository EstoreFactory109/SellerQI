import { useEffect, useState } from 'react';

/**
 * Choosing files, with visible proof that they were chosen.
 *
 * ── WHY THIS EXISTS AS ONE COMPONENT ──
 * The same picker was written four times by hand — both Messages composers, the ticket
 * modal and the task request form — and all four carried the identical bug: they read
 * `e.target.files` INSIDE a setState updater and cleared `e.target.value` on the next
 * line. React runs that updater later, during render, by which point the input has been
 * cleared and `files` is empty. Nothing was ever attached, and because clearing the
 * input also wipes the native "1 file selected" text, there was no feedback of any kind
 * to suggest otherwise.
 *
 * Fixed structurally rather than four times over: this component owns the input and
 * hands the caller an already-resolved array, so there is no updater for anyone to read
 * a cleared FileList inside.
 *
 * The previews are the other half, and not decoration. Clearing the input also wipes the
 * native "1 file selected" text, so the broken version gave no feedback of any kind —
 * which is exactly why it shipped. A thumbnail is the difference between a failed upload
 * you notice and one you do not.
 */

const formatBytes = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
};

/** A glyph for things that cannot be shown as a picture. */
const iconFor = (type = '') => {
    if (type.startsWith('image/')) return '🖼';
    if (type === 'application/pdf') return '📄';
    if (type.includes('sheet') || type.includes('excel') || type === 'text/csv') return '📊';
    if (type.includes('word') || type.includes('document')) return '📝';
    return '📎';
};

const TONES = {
    /** Staff portal — Tailwind utilities on the app's dark surfaces. */
    dark: {
        wrap: 'border-white/10 bg-white/[0.04]',
        name: 'text-gray-200',
        meta: 'text-gray-500',
        remove: 'text-gray-500 hover:text-gray-200',
        trigger: 'border-white/15 text-gray-300 hover:bg-white/5',
    },
    /** Client ESF pages — same shapes, softer contrast to match that section. */
    client: {
        wrap: 'border-white/10 bg-white/[0.05]',
        name: 'text-gray-200',
        meta: 'text-gray-400',
        remove: 'text-gray-400 hover:text-gray-100',
        trigger: 'border-white/20 text-gray-300 hover:bg-white/5',
    },
};

const AttachmentPicker = ({
    files = [],
    onChange,
    disabled = false,
    max = 5,
    tone = 'dark',
    label = 'Attach files',
}) => {
    const styles = TONES[tone] || TONES.dark;
    const [previews, setPreviews] = useState([]);

    /**
     * Object URLs must be revoked, or every image a client previews stays in memory for
     * the lifetime of the page — and on a form people retry, that adds up quickly.
     * Rebuilt whenever the list changes, and torn down on unmount.
     */
    useEffect(() => {
        const urls = files.map((file) => (
            file?.type?.startsWith('image/') ? URL.createObjectURL(file) : null
        ));
        setPreviews(urls);
        return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
    }, [files]);

    const pick = (event) => {
        /**
         * Resolved to a concrete array HERE, and handed to the caller already resolved.
         *
         * That is what actually fixes the original bug rather than the line order below.
         * Every call site used to do `setFiles(prev => [...prev, ...Array.from(
         * e.target.files)])` and clear the input on the next line — and React runs an
         * updater during a later render, by which point the input had been cleared and
         * `files` was empty. Owning the input here means no caller gets the chance to
         * defer that read.
         */
        const picked = Array.from(event.target.files || []);
        // Cleared so choosing the SAME file twice still fires a change event.
        event.target.value = '';
        if (picked.length === 0) return;
        onChange([...files, ...picked].slice(0, max));
    };

    const removeAt = (index) => onChange(files.filter((_, i) => i !== index));
    const atLimit = files.length >= max;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <label
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${styles.trigger} ${
                        disabled || atLimit ? 'pointer-events-none opacity-40' : ''
                    }`}
                >
                    📎 {label}
                    <input type="file" multiple hidden disabled={disabled || atLimit} onChange={pick} />
                </label>
                {/* Said plainly so the limit is known before it is hit, not after. */}
                <span className={`text-[11.5px] ${styles.meta}`}>
                    {files.length > 0 ? `${files.length} of ${max}` : `Up to ${max} files`}
                </span>
            </div>

            {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {files.map((file, i) => (
                        <div
                            key={`${file.name}-${file.size}-${i}`}
                            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${styles.wrap}`}
                        >
                            {previews[i] ? (
                                // The actual picture. The point of the whole component:
                                // seeing the file is what proves it was attached.
                                <img
                                    src={previews[i]}
                                    alt=""
                                    className="h-9 w-9 shrink-0 rounded object-cover"
                                />
                            ) : (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-black/25 text-[15px]">
                                    {iconFor(file.type)}
                                </span>
                            )}

                            <span className="flex min-w-0 flex-col">
                                <span className={`max-w-[170px] truncate text-[12px] ${styles.name}`} title={file.name}>
                                    {file.name}
                                </span>
                                <span className={`text-[10.5px] ${styles.meta}`}>{formatBytes(file.size)}</span>
                            </span>

                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => removeAt(i)}
                                title="Remove"
                                className={`shrink-0 px-1 text-[15px] leading-none transition-colors ${styles.remove} disabled:opacity-40`}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AttachmentPicker;
