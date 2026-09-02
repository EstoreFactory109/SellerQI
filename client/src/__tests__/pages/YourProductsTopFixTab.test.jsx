/**
 * Verifies the "Top Products to Fix" tab on the Your Products page.
 *
 * The risk being covered is structural: the tab must SWAP the content, not render
 * the ranked list alongside the full product table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';

// The page fetches V3 product data on mount; stub the thunks so only the tab
// behaviour is under test.
vi.mock('../../redux/slices/PageDataSlice.js', async () => {
    const actual = await vi.importActual('../../redux/slices/PageDataSlice.js');
    return new Proxy(actual, {
        get(target, prop) {
            const real = target[prop];
            if (typeof real === 'function' && /^fetch/.test(String(prop))) {
                return () => ({ type: `stub/${String(prop)}` });
            }
            return real;
        }
    });
});

const TOP_PRODUCTS = [
    {
        asin: 'B08138LS42', rank: 1, productName: 'Corner Protectors',
        profitImpact: 127.75, profitGap: 127.75, adWasteComponent: 9.92, capitalTiedUp: 0,
        amountIsEstimated: true, taskCount: 5, adsTaskCount: 18,
        categories: ['ranking', 'profitability'], why: 'Losing money per sale.', action: 'Reprice it.'
    },
    {
        asin: 'B07HP4V8NK', rank: 2, productName: 'Derma Roller',
        profitImpact: 122.29, profitGap: 122.29, adWasteComponent: 24.28, capitalTiedUp: 0,
        amountIsEstimated: true, taskCount: 3, adsTaskCount: 12,
        categories: ['profitability'], why: 'Ad spend is heavy.', action: 'Cut bids.'
    }
];

vi.mock('../../hooks/useTopProducts.js', () => ({
    useTopProducts: () => ({
        products: TOP_PRODUCTS,
        loading: false,
        currencyCode: 'AUD',
        totalRecoverableAmount: 250.04,
        potentialProfitImpact: 691.08,
        capitalTiedUp: 118.67,
        unattributedAmount: 34.69,
        usedFallback: false
    })
}));

import YourProducts from '../../Pages/Products/YourProducts.jsx';

const makeStore = () => configureStore({
    reducer: {
        currency: () => ({ currency: 'A$', country: 'AU', region: 'FE' }),
        Auth: () => ({ user: { _id: 'u1' } }),
        pageData: () => ({
            yourProductsV3: {
                summary: { data: { activeProducts: 11, productsWithoutAPlus: 2, productsNotTargetedInAds: 3, inactiveProducts: 54, incompleteProducts: 10, zeroAvailabilityProducts: 0 } },
                active: { data: { products: [] }, loading: false },
                nonSellable: { data: { products: [] } },
                withoutAPlus: { data: { products: [] } },
                notTargetedInAds: { data: { products: [] } },
                optimization: { data: { products: [] }, loading: false }
            }
        }),
        Dashboard: () => ({ DashBoardInfo: {} })
    }
});

const renderPage = () => render(
    <Provider store={makeStore()}>
        <MemoryRouter><YourProducts /></MemoryRouter>
    </Provider>
);

describe('Your Products — Top Products to Fix tab', () => {
    beforeEach(() => vi.clearAllMocks());

    it('offers the tab', () => {
        renderPage();
        expect(screen.getByRole('button', { name: /Top Products to Fix/i })).toBeInTheDocument();
    });

    it('is the FIRST tab', () => {
        renderPage();
        const labels = screen.getAllByRole('button')
            .map(b => b.textContent.trim())
            .filter(t => /Products to Fix|Sellable Products|Optimization|Without A\+|Not Targeted/.test(t));
        expect(labels[0]).toMatch(/Top Products to Fix/);
    });

    it('is the tab the page opens on, with no click required', () => {
        renderPage();
        expect(screen.getByText(/Corner Protectors/)).toBeInTheDocument();
        expect(screen.getByText('A$127.75*')).toBeInTheDocument();
        expect(screen.getByText(/Ranked by the profit you would gain/)).toBeInTheDocument();
    });

    // The whole point of making it a tab rather than a banner above the table.
    it('replaces the product table instead of appearing alongside it', () => {
        renderPage();
        expect(screen.queryByText(/Click a column header to re-sort/)).not.toBeInTheDocument();
    });

    it('hides the search box, which cannot filter this list', () => {
        renderPage();
        expect(screen.queryByPlaceholderText(/Search by ASIN/)).not.toBeInTheDocument();
    });

    it('reports capital tied up separately, not as profit', () => {
        renderPage();
        expect(screen.getByText(/A\$118\.67 is capital locked/)).toBeInTheDocument();
        expect(screen.getByText(/not counted as profit/)).toBeInTheDocument();
    });

    it('still lets the seller reach the product table, with its search box back', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /^Sellable Products/i }));

        expect(screen.getByText(/Click a column header to re-sort/)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Search by ASIN/)).toBeInTheDocument();
        expect(screen.queryByText(/Corner Protectors/)).not.toBeInTheDocument();
    });
});
