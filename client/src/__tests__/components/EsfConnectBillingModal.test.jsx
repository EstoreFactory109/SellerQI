/**
 * Linking a client to their Zoho Billing customer by hand (ESF portal and super admin).
 *
 * Pinned: suggestions show with nothing typed and search is debounced; a customer another
 * account uses cannot be picked; a first link needs no confirm, but switching or unlinking
 * (which removes invoices from the client's page) asks first; both portals use their own URL;
 * the ESF Clients menu offers it to owner/admins only.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EsfConnectBillingModal from '../../Components/ESF/EsfConnectBillingModal.jsx';
import EsfClients from '../../Pages/ESF/EsfClients.jsx';
import axiosInstance from '../../config/axios.config.js';
import { useEsfUser } from '../../contexts/EsfUserContext.js';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../contexts/EsfUserContext.js', () => ({ useEsfUser: vi.fn() }));

const BASE = '/app/esf/clients/c1';
const client = { _id: 'c1', firstName: 'Ann', lastName: 'Lee', email: 'ann@acme.com' };
const acme = { customerId: '1001', displayName: 'Acme Goods', companyName: 'Acme Goods Ltd', email: 'accounts@acme.com', currencyCode: 'GBP', linkedTo: null };
const bravo = { customerId: '1002', displayName: 'Bravo', companyName: 'Bravo', email: 'b@bravo.io', currencyCode: 'USD', linkedTo: { userId: 'u2', name: 'Bob K' } };
const options = (overrides = {}) => ({ data: { data: { linked: null, autoMatchDisabled: false, query: '', results: [acme, bravo], totalCustomers: 120, ...overrides } } });
const linkedTo = (customer, extra = {}) => ({ customerId: customer.customerId, customerName: customer.companyName, email: customer.email, linkSource: 'manual', linkedBy: 'Olive', linkedAt: '2026-10-27T09:00:00Z', ...extra });

beforeEach(() => {
  axiosInstance.get.mockResolvedValue(options());
});
afterEach(() => vi.clearAllMocks());

const open = (props = {}) => render(<EsfConnectBillingModal client={client} baseUrl={BASE} onClose={vi.fn()} {...props} />);

describe('EsfConnectBillingModal', () => {
  it('suggests customers straight away and marks ones another account uses', async () => {
    open();
    expect(await screen.findByText('Acme Goods')).toBeInTheDocument();
    expect(axiosInstance.get).toHaveBeenCalledWith(`${BASE}/billing-options`, { params: { search: '' } });
    expect(screen.getByText('Suggested for this client')).toBeInTheDocument();
    expect(screen.getByText('Already linked to Bob K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Bravo' })).toBeDisabled();
    expect(screen.getByText('120 customers in Zoho Billing')).toBeInTheDocument();
  });

  it('searches as you type', async () => {
    open();
    await screen.findByText('Acme Goods');
    axiosInstance.get.mockResolvedValue(options({ query: 'zzz', results: [] }));
    await userEvent.type(screen.getByPlaceholderText(/Search by name/), 'zzz');
    await waitFor(() => expect(axiosInstance.get).toHaveBeenLastCalledWith(`${BASE}/billing-options`, { params: { search: 'zzz' } }));
    expect(await screen.findByText('No customers match “zzz”.')).toBeInTheDocument();
  });

  it('links an unlinked client in one click and says who linked it', async () => {
    const onChanged = vi.fn();
    axiosInstance.post.mockResolvedValue(options({ linked: linkedTo(acme) }));
    open({ onChanged });
    await userEvent.click(await screen.findByRole('button', { name: 'Link Acme Goods' }));
    expect(axiosInstance.post).toHaveBeenCalledWith(`${BASE}/billing`, { customerId: '1001' });
    expect(await screen.findByText(/Linked by hand by Olive on/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('asks before switching to another customer', async () => {
    axiosInstance.get.mockResolvedValue(options({ linked: linkedTo(bravo, { linkSource: 'email', linkedBy: null }), results: [acme] }));
    axiosInstance.post.mockResolvedValue(options({ linked: linkedTo(acme) }));
    open();
    expect(await screen.findByText(/Linked automatically by email/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link Acme Goods' }));
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Switch to Acme Goods\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch customer' }));
    expect(axiosInstance.post).toHaveBeenCalledWith(`${BASE}/billing`, { customerId: '1001' });
  });

  it('asks before unlinking, then says the email match will leave it alone', async () => {
    axiosInstance.get.mockResolvedValue(options({ linked: linkedTo(acme) }));
    axiosInstance.delete.mockResolvedValue(options({ linked: null, autoMatchDisabled: true }));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    expect(axiosInstance.delete).not.toHaveBeenCalled();
    const confirmBox = screen.getByText(/Unlink this customer\?/).parentElement;
    await userEvent.click(within(confirmBox).getByRole('button', { name: 'Unlink' }));
    expect(axiosInstance.delete).toHaveBeenCalledWith(`${BASE}/billing`);
    expect(await screen.findByText(/nightly email match will leave it alone/)).toBeInTheDocument();
  });

  it('shows the server\'s refusal', async () => {
    axiosInstance.post.mockRejectedValue({ response: { data: { message: 'This Zoho Billing customer is already linked to Bob K.' } } });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Link Acme Goods' }));
    expect(await screen.findByText(/already linked to Bob K\./)).toBeInTheDocument();
  });

  it('the super admin uses their own endpoints', async () => {
    open({ baseUrl: '/app/auth/admin/accounts/c1' });
    await screen.findByText('Acme Goods');
    expect(axiosInstance.get).toHaveBeenCalledWith('/app/auth/admin/accounts/c1/billing-options', { params: { search: '' } });
  });
});

describe('ESF Clients menu', () => {
  const row = { _id: 'c1', firstName: 'Ann', lastName: 'Lee', email: 'ann@acme.com', billing: { linked: false } };
  const renderClients = async (esfUser, clients) => {
    useEsfUser.mockReturnValue(esfUser);
    axiosInstance.get.mockImplementation(async (url) => (url === '/app/esf/clients'
      ? { data: { statusCode: 200, data: clients } }
      : options()));
    render(<MemoryRouter><EsfClients /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions' }));
  };

  it('offers Link billing to the owner and admins', async () => {
    await renderClients({ esfRole: 'admin' }, [row]);
    await userEvent.click(screen.getByRole('button', { name: 'Link billing' }));
    expect(await screen.findByRole('dialog', { name: 'Link Zoho Billing' })).toBeInTheDocument();
    expect(axiosInstance.get).toHaveBeenCalledWith('/app/esf/clients/c1/billing-options', { params: { search: '' } });
  });

  it('says Change billing when already linked', async () => {
    await renderClients({ esfRole: 'owner' }, [{ ...row, billing: { linked: true, customerName: 'Acme Goods Ltd' } }]);
    expect(screen.getByRole('button', { name: 'Change billing' })).toBeInTheDocument();
    expect(screen.getByText('Acme Goods Ltd')).toBeInTheDocument();
  });

  it('members never see it', async () => {
    const { billing, ...memberRow } = row;
    await renderClients({ esfRole: 'member' }, [memberRow]);
    expect(screen.queryByRole('button', { name: /billing/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
  });
});
