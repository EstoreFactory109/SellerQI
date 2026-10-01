/**
 * Attachment downloads, which were bare <a href="/api/..."> links.
 *
 * The API lives on a different origin from the app (VITE_BASE_URI), so those resolved
 * against the FRONTEND origin — 404ing, or arriving without the cookies the endpoint
 * authenticates on. Billing.jsx already had this right and said why; these tests exist so
 * the three ESF links that did not cannot quietly regress to a plain href.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../config/axios.config.js', () => ({ default: { get: (...a) => mockGet(...a) } }));

const { default: downloadFile } = await import('../../utils/downloadFile.js');

let createdUrls;
let revokedUrls;
let clicked;

beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    clicked = [];
    mockGet.mockResolvedValue({ data: new Blob(['file contents']) });

    window.URL.createObjectURL = vi.fn(() => {
        const url = `blob:mock/${createdUrls.length}`;
        createdUrls.push(url);
        return url;
    });
    window.URL.revokeObjectURL = vi.fn((url) => revokedUrls.push(url));

    // Capture the throwaway anchor rather than letting jsdom try to navigate.
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function capture() {
        clicked.push({ href: this.href, download: this.download });
    };
    return () => { HTMLAnchorElement.prototype.click = realClick; };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('downloadFile', () => {
    test('fetches through axios as a blob, not as a link', () => {
        // The whole point: axios carries the cookies a bare href would not.
        return downloadFile('/api/pagewise/esf/messages/t1/attachments/m1/0', 'quote.pdf').then(() => {
            expect(mockGet).toHaveBeenCalledWith(
                '/api/pagewise/esf/messages/t1/attachments/m1/0',
                { responseType: 'blob' },
            );
        });
    });

    test('saves under the name the caller asked for', async () => {
        await downloadFile('/api/x', 'Statement March.pdf');

        expect(clicked).toHaveLength(1);
        expect(clicked[0].download).toBe('Statement March.pdf');
    });

    test('falls back to a name rather than saving an unnamed file', async () => {
        await downloadFile('/api/x', undefined);

        expect(clicked[0].download).toBe('attachment');
    });

    test('revokes the object URL, so a large attachment is not pinned for the tab', async () => {
        await downloadFile('/api/x', 'big.zip');

        expect(createdUrls).toHaveLength(1);
        expect(revokedUrls).toEqual(createdUrls);
    });

    test('leaves no anchor behind in the document', async () => {
        await downloadFile('/api/x', 'a.pdf');

        expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    });

    test('rejects on failure so the caller can say something', async () => {
        // Swallowing here would give the user a button that silently does nothing.
        mockGet.mockRejectedValue(new Error('403'));

        await expect(downloadFile('/api/x', 'a.pdf')).rejects.toThrow('403');
        expect(clicked).toHaveLength(0);
    });
});
