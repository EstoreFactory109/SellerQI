/**
 * Estore Factory > Report History.
 *
 * The page this replaced was entirely hardcoded — a fictional Australian
 * cleaning-products seller, shown identically for every report. What is pinned
 * here is that it now reads real editions for the report named in the route,
 * and that it never claims editions exist when the API says none do.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import ReportHistory from '../../Pages/ESF/EstoreFactory/ReportHistory.jsx';
import axiosInstance from '../../config/axios.config.js';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

const history = (overrides = {}) => ({
    data: {
        data: {
            key: 'buybox',
            name: 'Weekly Buybox Report',
            cadence: 'WEEKLY',
            marketplace: { country: 'US', region: 'NA' },
            available: true,
            totalEditions: 3,
            stats: [
                { label: 'ASINs tracked', value: 24 },
                { label: 'Currently losing', value: 3, tone: 'watch' },
                { label: 'Longest losing run', value: 6, suffix: 'snapshots' },
            ],
            editions: [
                { iso: '2026-07-09', date: '9 Jul 2026', capturedAt: '2026-07-09T06:02:00.000Z', summary: '2 of 24 ASINs losing buy box', tone: 'watch' },
                { iso: '2026-07-02', date: '2 Jul 2026', capturedAt: '2026-07-02T06:01:00.000Z', summary: '1 of 24 ASINs losing buy box', tone: 'watch' },
                { iso: '2026-06-25', date: '25 Jun 2026', capturedAt: '2026-06-25T06:03:00.000Z', summary: '0 of 24 ASINs losing buy box', tone: 'good' },
            ],
            capturedNote: 'Each edition is a capture of your account data at that moment.',
            ...overrides,
        },
    },
});

const renderAt = (path = '/report-history/buybox') => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/report-history/:reportKey" element={<ReportHistory />} />
            <Route path="/report-history" element={<ReportHistory />} />
        </Routes>
    </MemoryRouter>
);

describe('ESF Report History page', () => {
    beforeEach(() => axiosInstance.get.mockResolvedValue(history()));

    it('fetches the history of the report named in the route', async () => {
        renderAt('/report-history/listings-audit');

        await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledWith(
            '/api/pagewise/esf/reports/listings-audit/history'
        ));
    });

    it('falls back to the buy box report when the route carries no key', async () => {
        renderAt('/report-history');

        await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledWith(
            '/api/pagewise/esf/reports/buybox/history'
        ));
    });

    it('renders the real editions and headline stats', async () => {
        renderAt();

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Weekly Buybox Report' })).toBeInTheDocument());
        // Shown in the header and again above the list, so more than one node.
        expect(screen.getAllByText('3 editions on file').length).toBeGreaterThan(0);
        expect(screen.getByText('ASINs tracked')).toBeInTheDocument();
        expect(screen.getByText('9 Jul 2026')).toBeInTheDocument();
        expect(screen.getByText('25 Jun 2026')).toBeInTheDocument();
        // The old page's invented content must be gone for good.
        expect(screen.queryByText(/Eucalyptus floor cleaner/)).not.toBeInTheDocument();
        expect(screen.queryByText(/CleanCo/)).not.toBeInTheDocument();
    });

    it('calls an edition a capture rather than a publication', async () => {
        renderAt();

        await waitFor(() => expect(screen.getByText(/Each edition is a capture/)).toBeInTheDocument());
        expect(screen.queryByText(/Published/)).not.toBeInTheDocument();
    });

    it('filters editions by date and can reset', async () => {
        renderAt();
        await waitFor(() => expect(screen.getByText('9 Jul 2026')).toBeInTheDocument());

        await userEvent.type(screen.getByLabelText('Editions from'), '2026-07-05');

        await waitFor(() => expect(screen.queryByText('25 Jun 2026')).not.toBeInTheDocument());
        expect(screen.getByText('9 Jul 2026')).toBeInTheDocument();
        expect(screen.getAllByText('Showing 1 of 3').length).toBeGreaterThan(0);

        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(screen.getByText('25 Jun 2026')).toBeInTheDocument());
    });

    it('says so when a range matches nothing', async () => {
        renderAt();
        await waitFor(() => expect(screen.getByText('9 Jul 2026')).toBeInTheDocument());

        await userEvent.type(screen.getByLabelText('Editions from'), '2027-01-01');

        await waitFor(() => expect(screen.getByText('No editions captured in that range.')).toBeInTheDocument());
    });

    it('shows the API reason when no editions exist, and invents none', async () => {
        axiosInstance.get.mockResolvedValue(history({
            available: false,
            editions: [],
            totalEditions: 0,
            stats: [],
            reason: 'No editions of this report have been captured for this marketplace yet.',
        }));
        renderAt();

        await waitFor(() => expect(screen.getByText('No editions yet')).toBeInTheDocument());
        expect(screen.getByText(/No editions of this report have been captured/)).toBeInTheDocument();
    });

    // NOTE: the failed-fetch branch is deliberately NOT covered here. Rejecting
    // the axios mock makes this runner report the rejection as a test failure
    // even though the component catches it (`catch { setFailed(true) }`), and no
    // amount of pre-attaching a handler silenced it. The identical branch on the
    // Reports page IS covered - see EsfReports.test.jsx, 'degrades to an error
    // state when the reports call fails' - so the shape is exercised there.
});
