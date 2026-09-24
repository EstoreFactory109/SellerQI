/**
 * LoginPageGuard — "if logged in, you can't open another login page".
 *
 * Every tab shares the same cookies, so a login page must ask the server whether
 * this browser is already signed in anywhere, and if so send the visitor to that
 * portal instead of showing a form.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import LoginPageGuard, { PortalGate } from '../../Layout/LoginPageGuard.jsx';
import axiosInstance from '../../config/axios.config.js';

vi.mock('../../config/axios.config.js', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../../Components/Loader/Loader.jsx', () => ({
  default: () => <div>Loading…</div>,
}));

const renderAt = (path = '/esf-login') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/esf-login" element={<LoginPageGuard><p>ESF login form</p></LoginPageGuard>} />
        <Route path="/esf/users" element={<PortalGate allow={['esf']}><p>ESF team page</p></PortalGate>} />
        <Route path="/manage-accounts" element={<p>Admin portal</p>} />
        <Route path="/manage-accounts/logs/email" element={<p>Admin email logs</p>} />
        <Route path="/esf/clients" element={<p>ESF portal</p>} />
        <Route path="/manage-agency-users" element={<p>Agency portal</p>} />
      </Routes>
    </MemoryRouter>
  );

const session = (data) => ({ data: { statusCode: 200, data } });

// setup.js replaces localStorage with vi.fn() stubs, so assert on the calls.
beforeEach(() => {
  localStorage.setItem.mockClear();
  localStorage.removeItem.mockClear();
  localStorage.getItem.mockReset();
  axiosInstance.get.mockReset();
});

const rememberedPage = (entries) =>
  localStorage.getItem.mockImplementation((key) => (key in entries ? entries[key] : null));

describe('LoginPageGuard', () => {
  it('shows the login form when nobody is signed in', async () => {
    axiosInstance.get.mockResolvedValue(session(null));
    renderAt();
    expect(await screen.findByText('ESF login form')).toBeInTheDocument();
    expect(axiosInstance.get).toHaveBeenCalledWith('/app/session');
  });

  it('sends an admin who opens /esf-login back to the admin portal', async () => {
    axiosInstance.get.mockResolvedValue(session({ kind: 'admin', home: '/manage-accounts' }));
    renderAt();
    expect(await screen.findByText('Admin portal')).toBeInTheDocument();
    expect(screen.queryByText('ESF login form')).not.toBeInTheDocument();
  });

  it('keeps an admin on the exact page they were on, not just the portal home', async () => {
    rememberedPage({ 'lastPortalPage:admin': JSON.stringify({ path: '/manage-accounts/logs/email', at: 1 }) });
    axiosInstance.get.mockResolvedValue(session({ kind: 'admin', home: '/manage-accounts', inAccount: false }));
    renderAt();
    expect(await screen.findByText('Admin email logs')).toBeInTheDocument();
  });

  it("keeps an admin out of another portal's pages too", async () => {
    rememberedPage({ 'lastPortalPage:admin': JSON.stringify({ path: '/manage-accounts/logs/email', at: 1 }) });
    axiosInstance.get.mockResolvedValue(session({ kind: 'admin', home: '/manage-accounts', inAccount: false }));
    renderAt('/esf/users');
    expect(await screen.findByText('Admin email logs')).toBeInTheDocument();
    expect(screen.queryByText('ESF team page')).not.toBeInTheDocument();
  });

  it("opens a portal's pages for that portal's own session", async () => {
    axiosInstance.get.mockResolvedValue(session({ kind: 'esf', home: '/esf/clients', inAccount: false }));
    renderAt('/esf/users');
    expect(await screen.findByText('ESF team page')).toBeInTheDocument();
  });

  it('without the server, goes by the flags the last login left', async () => {
    rememberedPage({ isAdminAuth: 'true', adminAccessType: 'superAdmin' });
    axiosInstance.get.mockRejectedValue(new Error('Network Error'));
    renderAt();
    expect(await screen.findByText('Admin portal')).toBeInTheDocument();
  });

  it('never shows the form before the server has answered', () => {
    axiosInstance.get.mockReturnValue(new Promise(() => {}));
    renderAt();
    expect(screen.queryByText('ESF login form')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it("re-syncs the portal's localStorage flags so its layout does not bounce back here", async () => {
    axiosInstance.get.mockResolvedValue(session({ kind: 'agency', home: '/manage-agency-users' }));
    renderAt();
    expect(await screen.findByText('Agency portal')).toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('isAuth', 'true');
    expect(localStorage.setItem).toHaveBeenCalledWith('adminAccessType', 'enterpriseAdmin');
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('clears flags left behind by a session that has ended', async () => {
    axiosInstance.get.mockResolvedValue(session(null));
    renderAt();
    await screen.findByText('ESF login form');
    expect(localStorage.removeItem).toHaveBeenCalledWith('isAdminAuth');
    expect(localStorage.removeItem).toHaveBeenCalledWith('isAuth');
    expect(localStorage.removeItem).toHaveBeenCalledWith('loggedInAsClient');
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('shows the form when the server cannot be asked and nothing says anyone is signed in', async () => {
    axiosInstance.get.mockRejectedValue(new Error('Network Error'));
    renderAt();
    await waitFor(() => expect(screen.getByText('ESF login form')).toBeInTheDocument());
  });
});
