/**
 * Who can open the ESF client pages.
 *
 * These routes were reachable from ANY account by typing the URL. The sidebar link
 * was hidden, which is why nobody noticed, and EsfPageAccessGuard reads as though it
 * covers this but only acts on a restricted session (ESF staff, or a limited member)
 * and no-ops for an ordinary client. ClientDashboard checked for itself; the six
 * estore-factory pages checked nothing, so they rendered, fired their requests, took
 * a 403 and sat there blank.
 *
 * The server was never fooled - esfClientOnly refused the data throughout. What these
 * pin is that a denied account is redirected instead of being shown the empty shell.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';

import EsfClientOnlyRoute from '../../Layout/EsfClientOnlyRoute.jsx';

const storeWith = (user) => configureStore({
    reducer: { Auth: (state = { user }) => state },
});

/** The seven paths that sit behind the guard in App.jsx. */
const ESF_PATHS = [
    '/seller-central-checker/client-dashboard',
    '/seller-central-checker/estore-factory/status',
    '/seller-central-checker/estore-factory/untapped',
    '/seller-central-checker/estore-factory/reports',
    '/seller-central-checker/estore-factory/report-history',
    '/seller-central-checker/estore-factory/messages',
    '/seller-central-checker/estore-factory/billing',
];

const renderAt = (path, user) => render(
    <Provider store={storeWith(user)}>
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route element={<EsfClientOnlyRoute />}>
                    {ESF_PATHS.map((p) => (
                        <Route key={p} path={p} element={<div>ESF PAGE</div>} />
                    ))}
                </Route>
                <Route path="/seller-central-checker/dashboard" element={<div>ORDINARY DASHBOARD</div>} />
            </Routes>
        </MemoryRouter>
    </Provider>,
);

describe('an account that is not an ESF client', () => {
    it.each(ESF_PATHS)('is redirected away from %s', (path) => {
        renderAt(path, { isEsfClient: false, accessType: 'user' });

        expect(screen.getByText('ORDINARY DASHBOARD')).toBeInTheDocument();
        expect(screen.queryByText('ESF PAGE')).not.toBeInTheDocument();
    });

    it('is redirected when isEsfClient is absent entirely', () => {
        // The field defaults to false on the model and is simply missing on older
        // accounts. Absent must deny, exactly as `!== true` does on the server.
        renderAt(ESF_PATHS[0], { accessType: 'user' });

        expect(screen.getByText('ORDINARY DASHBOARD')).toBeInTheDocument();
    });

    it('is not fooled by a truthy-but-wrong value', () => {
        renderAt(ESF_PATHS[0], { isEsfClient: 'yes', accessType: 'user' });

        expect(screen.getByText('ORDINARY DASHBOARD')).toBeInTheDocument();
    });
});

describe('accounts that are allowed through', () => {
    it.each(ESF_PATHS)('lets a real ESF client open %s', (path) => {
        renderAt(path, { isEsfClient: true, accessType: 'user' });

        expect(screen.getByText('ESF PAGE')).toBeInTheDocument();
    });

    it('lets a superAdmin service the account', () => {
        // Matches esfClientOnly, which allows superAdmin through so platform admins
        // can support the page.
        renderAt(ESF_PATHS[0], { isEsfClient: false, accessType: 'superAdmin' });

        expect(screen.getByText('ESF PAGE')).toBeInTheDocument();
    });
});

describe('before the user has loaded', () => {
    it('does NOT redirect on a null user', () => {
        /**
         * The trap this avoids: `user` is null for an instant on first paint, before
         * ProtectedRouteWrapper fills it in. Treating that as denied would bounce a
         * real ESF client off their own dashboard on every hard refresh. The server
         * is the backstop for that moment.
         */
        renderAt(ESF_PATHS[0], null);

        expect(screen.getByText('ESF PAGE')).toBeInTheDocument();
        expect(screen.queryByText('ORDINARY DASHBOARD')).not.toBeInTheDocument();
    });
});
