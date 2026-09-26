/**
 * Origin of the web app, for links sent by email.
 *
 * Derived from RESET_LINK_BASE_URI so every emailed link points at the same app
 * the password-reset link does, without another env var to configure.
 * FRONTEND_URL is the fallback.
 */
const appBaseUrl = () => {
    const resetBase = process.env.RESET_LINK_BASE_URI || '';
    const fromReset = resetBase.replace(/\/reset-password\/?$/, '').replace(/\/$/, '');
    return fromReset || (process.env.FRONTEND_URL || '').replace(/\/$/, '');
};

/** appBaseUrl() + path, e.g. appLink('/member-login/verify', token). */
const appLink = (...segments) => [appBaseUrl(), ...segments.map((s) => String(s).replace(/^\/|\/$/g, ''))].join('/');

module.exports = { appBaseUrl, appLink };
