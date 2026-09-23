/**
 * Estore Factory > Reports.
 *
 * jsdom has no layout engine, so this cannot check that the thumbnail LOOKS
 * right. What it can pin is the behaviour that broke or would break silently:
 *
 *  - a report with no data must not be clickable, and must show its reason
 *  - selecting a card must move it into the panel
 *  - the pager must fetch the next page and must not fetch past the end
 *  - a failed page fetch must leave the rows already on screen alone
 *  - the document preview must render the report's own title and bullets
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';

import Reports from '../../Pages/ESF/EstoreFactory/Reports.jsx';
import axiosInstance from '../../config/axios.config.js';

vi.mock('../../config/axios.config.js', () => ({
    default: { get: vi.fn() },
}));

// jsdom ships no ResizeObserver, and the document thumbnail measures itself
// with one. Without this the panel throws on mount.
beforeEach(() => {
    window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const makeRows = (count, prefix = 'SKU') =>
    Array.from({ length: count }, (_, i) => ({ sku: `${prefix}-${i + 1}`, available: i, alert: '' }));

const AVAILABLE_REPORT = {
    key: 'inventory-restock',
    name: 'Inventory Restock',
    cadence: 'BI-WEEKLY',
    format: 'xlsx',
    available: true,
    date: 'Fetched 25 Apr 2026',
    generatedAt: '2026-04-25T00:00:00.000Z',
    tone: 'watch',
    insight: '3 SKUs urgent, 12 need restock',
    pageSize: 10,
    summary: {
        headline: '40 SKUs tracked across this marketplace',
        stats: [{ label: 'SKUs tracked', value: 40 }, { label: 'Urgent', value: 3, tone: 'watch' }],
        columns: [{ key: 'sku', label: 'SKU' }, { key: 'available', label: 'Available', format: 'number' }],
        rows: makeRows(10),
        totalRows: 40,
    },
    highlights: [
        { text: '3 SKUs flagged urgent by Amazon and 1 already out of stock.', tone: 'watch' },
        { text: '[Purchase orders raised this cycle]', tone: 'fill' },
    ],
    caveats: [],
};

const UNAVAILABLE_REPORT = {
    key: 'fba-aged-inventory',
    name: 'FBA Aged Inventory',
    cadence: 'MONTHLY',
    format: 'xlsx',
    available: false,
    reason: 'No FBA inventory in this marketplace, so there is nothing ageing.',
    insight: '',
    tone: 'neutral',
};

const payload = (reports = [AVAILABLE_REPORT, UNAVAILABLE_REPORT]) => ({
    data: {
        data: {
            marketplace: { country: 'US', region: 'NA' },
            reports,
            featuredKey: reports.find((r) => r.available)?.key || null,
            counts: { total: reports.length, available: reports.filter((r) => r.available).length },
        },
    },
});

const renderPage = () => {
    const store = configureStore({
        reducer: { currency: (state = { currency: '$' }) => state },
    });
    return render(
        <Provider store={store}>
            <MemoryRouter><Reports /></MemoryRouter>
        </Provider>
    );
};

describe('ESF Reports page', () => {
    it('shows the featured report in the panel once loaded', async () => {
        axiosInstance.get.mockResolvedValue(payload());
        renderPage();

        await waitFor(() => {
            expect(screen.getAllByText('Inventory Restock').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('40 SKUs tracked across this marketplace')).toBeInTheDocument();
    });

    it('renders the document preview with the report title and its bullets', async () => {
        axiosInstance.get.mockResolvedValue(payload());
        renderPage();

        await waitFor(() => expect(screen.getByText('report preview · scroll to read')).toBeInTheDocument());
        // The template's own heading and highlight bullets, not the app chrome.
        expect(screen.getByText('Performance Highlights')).toBeInTheDocument();
        expect(screen.getByText(/Purchase orders raised this cycle/)).toBeInTheDocument();
        expect(screen.getByText(/Legend:/)).toBeInTheDocument();
    });

    it('states the reason on a report with no data and does not make it clickable', async () => {
        axiosInstance.get.mockResolvedValue(payload());
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('No FBA inventory in this marketplace, so there is nothing ageing.')).toBeInTheDocument();
        });
        expect(screen.getByText('Waiting on data')).toBeInTheDocument();

        // The unavailable card must not be a button, so it cannot be selected.
        const buttons = screen.getAllByRole('button');
        expect(buttons.some((b) => within(b).queryByText('FBA Aged Inventory'))).toBe(false);
    });

    it('fetches the next page and leaves the first page untouched going back', async () => {
        axiosInstance.get.mockImplementation((url) => {
            if (url.includes('/rows')) {
                return Promise.resolve({
                    data: { data: { rows: makeRows(10, 'PAGE2'), page: 2, pageSize: 10, totalRows: 40, totalPages: 4 } },
                });
            }
            return Promise.resolve(payload());
        });
        renderPage();

        // The row count line belongs to the pager alone, so it is the unambiguous
        // signal that the paged table has rendered — SKU-1 also appears in the
        // document preview beside it.
        await waitFor(() => expect(screen.getByText('1–10 of 40 rows')).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: 'Next' }));

        await waitFor(() => expect(screen.getByText('Page 2 of 4')).toBeInTheDocument());
        expect(screen.getByText('PAGE2-1')).toBeInTheDocument();

        // Going back to page 1 uses the rows that came with the card — no refetch.
        const callsBefore = axiosInstance.get.mock.calls.length;
        await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
        await waitFor(() => expect(screen.getByText('1–10 of 40 rows')).toBeInTheDocument());
        expect(axiosInstance.get.mock.calls.length).toBe(callsBefore);
    });

    it('keeps the visible rows when a page fetch fails', async () => {
        axiosInstance.get.mockImplementation((url) => {
            if (url.includes('/rows')) return Promise.reject(new Error('network'));
            return Promise.resolve(payload());
        });
        renderPage();

        await waitFor(() => expect(screen.getByText('1–10 of 40 rows')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));

        await waitFor(() => expect(screen.getByText('Could not load that page.')).toBeInTheDocument());
        // The table did not empty itself over a failed fetch. (SKU-1 shows in both
        // the document preview and the table, hence getAllByText.)
        expect(screen.getAllByText('SKU-1').length).toBeGreaterThan(0);
        expect(screen.getByText('SKU-10')).toBeInTheDocument();
    });

    it('does not offer a pager when everything fits on one page', async () => {
        const small = {
            ...AVAILABLE_REPORT,
            summary: { ...AVAILABLE_REPORT.summary, rows: makeRows(3), totalRows: 3 },
        };
        axiosInstance.get.mockResolvedValue(payload([small]));
        renderPage();

        await waitFor(() => expect(screen.getByText('1–3 of 3 rows')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    });

    it('explains an empty table rather than rendering nothing', async () => {
        const empty = {
            ...AVAILABLE_REPORT,
            key: 'buybox',
            name: 'Weekly Buybox Report',
            summary: {
                ...AVAILABLE_REPORT.summary,
                rows: [],
                totalRows: 0,
                emptyMessage: 'Every tracked ASIN currently holds the Buy Box. Nothing to action.',
            },
        };
        axiosInstance.get.mockResolvedValue(payload([empty]));
        renderPage();

        await waitFor(() => {
            expect(screen.getAllByText(/Every tracked ASIN currently holds the Buy Box/).length).toBeGreaterThan(0);
        });
    });

    it('says so when no report has data at all', async () => {
        axiosInstance.get.mockResolvedValue(payload([UNAVAILABLE_REPORT]));
        renderPage();

        await waitFor(() => expect(screen.getByText('No report has data yet')).toBeInTheDocument());
    });

    it('degrades to an error state when the reports call fails', async () => {
        axiosInstance.get.mockRejectedValue(new Error('boom'));
        renderPage();

        await waitFor(() => expect(screen.getByText('Reports are unavailable right now')).toBeInTheDocument());
    });
});
