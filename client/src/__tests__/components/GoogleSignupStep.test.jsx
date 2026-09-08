/**
 * Tests for GoogleSignupStep — shown when someone signs in with Google and has
 * no account yet. Google has already verified them and every new account gets
 * the same plan, so consent is the only gate, and it has to actually hold.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GoogleSignupStep from '../../Components/Auth/GoogleSignupStep.jsx';

const setup = (props = {}) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <MemoryRouter>
      <GoogleSignupStep
        profile={{ email: 'new.user@gmail.com', firstName: 'Ada', lastName: 'Lovelace' }}
        onSubmit={onSubmit}
        onCancel={onCancel}
        loading={false}
        error={null}
        {...props}
      />
    </MemoryRouter>
  );
  return { onSubmit, onCancel };
};

describe('GoogleSignupStep', () => {
  it('greets the Google-verified user and shows the address it will use', () => {
    setup();
    expect(screen.getByText(/Welcome, Ada/)).toBeInTheDocument();
    expect(screen.getByText('new.user@gmail.com')).toBeInTheDocument();
  });

  it('asks nothing beyond consent — no plan, password or phone fields', () => {
    setup();
    const inputs = screen.getAllByRole('checkbox');
    expect(inputs).toHaveLength(1);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByText(/Start free|7 days|per month/i)).toBeNull();
  });

  it('will not create an account until terms are accepted', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('button', { name: /Create my account/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/must agree to the Terms/i)).toBeInTheDocument();
  });

  it('creates the account once terms are accepted', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Create my account/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('clears the consent error once the box is ticked', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /Create my account/i }));
    expect(screen.getByText(/must agree to the Terms/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    expect(screen.queryByText(/must agree to the Terms/i)).toBeNull();
  });

  it('can be dismissed without creating anything', async () => {
    const user = userEvent.setup();
    const { onCancel, onSubmit } = setup();

    await user.click(screen.getByLabelText('Close'));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the actions while the account is being created', () => {
    setup({ loading: true });
    expect(screen.getByRole('button', { name: /Creating your account/i })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('shows a server error when one comes back', () => {
    setup({ error: 'Something went wrong' });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders without a profile, since the payload could be sparse', () => {
    setup({ profile: {} });
    expect(screen.getByText(/Welcome/)).toBeInTheDocument();
  });

  it('points agency owners at their own sign-up', () => {
    setup();
    expect(screen.getByRole('link', { name: /agency sign-up/i })).toHaveAttribute('href', '/agency-sign-up');
  });
});
