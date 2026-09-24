import LoginPageGuard from './LoginPageGuard.jsx';

/**
 * Seller login / sign-up pages. Previously trusted the localStorage "isAuth" flag,
 * which knew nothing about an admin or ESF session in the same browser; the shared
 * guard asks the server instead (see LoginPageGuard).
 */
const ProtectedAuthRouteWrapper = ({ children }) => <LoginPageGuard>{children}</LoginPageGuard>;

export default ProtectedAuthRouteWrapper;
