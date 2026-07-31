// Standalone search index for the side-panel nav search. Deliberately independent from the
// NavLink lists in LeftNavSection.jsx / LeftNavSectionForTablet.jsx - excludes admin-only
// destinations (user-logging, admin-* settings tabs) and the disabled ecommerce-calendar page.
export const SEARCHABLE_PAGES = [
    { label: 'Dashboard', path: '/seller-central-checker/dashboard', keywords: ['home', 'overview'], lockable: true },
    { label: 'Amazon Copilot', path: '/seller-central-checker/qmate', keywords: ['ai', 'assistant', 'chat', 'qmate'], lockable: true },
    { label: 'Your Products', path: '/seller-central-checker/your-products', keywords: ['inventory', 'catalog', 'products'], lockable: true },
    { label: 'Listing Analyzer', path: '/seller-central-checker/pre-analysis', keywords: ['analyze', 'listing quality', 'pre-analysis'], lockable: false },
    { label: 'Account Issues', path: '/seller-central-checker/issues?tab=account', keywords: ['problems', 'errors', 'issues'], lockable: true },
    { label: 'Campaign Audit', path: '/seller-central-checker/ppc-dashboard', keywords: ['ppc', 'ads', 'sponsored ads', 'campaigns'], lockable: true },
    { label: 'Keyword Opportunities', path: '/seller-central-checker/keyword-analysis', keywords: ['keywords', 'ppc', 'search terms'], lockable: true },
    { label: 'Profitability', path: '/seller-central-checker/profitibility-dashboard', keywords: ['profit', 'margin', 'finance', 'table', 'profitability table', 'reports'], lockable: true },
    { label: 'Reimbursement', path: '/seller-central-checker/reimbursement-dashboard', keywords: ['refund', 'fba', 'reimbursement'], lockable: true },
    { label: 'Review Requests', path: '/seller-central-checker/review-request', keywords: ['reviews', 'orders', 'recent orders'], lockable: true },
    { label: 'Tasks', path: '/seller-central-checker/tasks', keywords: ['todo', 'checklist', 'tasks'], lockable: true },
    { label: 'Accounts History', path: '/seller-central-checker/account-history', keywords: ['history', 'log', 'accounts history'], lockable: true },
    { label: 'User Profile', path: '/seller-central-checker/settings?tab=profile', keywords: ['account', 'profile', 'settings'], lockable: false },
    { label: 'Account Integration', path: '/seller-central-checker/settings?tab=account-integration', keywords: ['connect', 'amazon', 'sp-api', 'ads', 'integration'], lockable: false },
    { label: 'Support', path: '/seller-central-checker/settings?tab=support', keywords: ['help', 'contact', 'ticket', 'support'], lockable: false },
    { label: 'Plans & Billing', path: '/seller-central-checker/settings?tab=plans-billing', keywords: ['subscription', 'billing', 'upgrade', 'payment', 'plans'], lockable: false },
    { label: 'Cancel Subscription', path: '/seller-central-checker/settings?tab=plans-billing', keywords: ['cancel', 'cancel subscription', 'unsubscribe', 'stop subscription', 'end subscription'], lockable: false, highlight: 'cancel-subscription' },
    { label: 'Book a Call', path: '/seller-central-checker/consultation', keywords: ['demo', 'onboarding', 'consultation', 'book a call'], lockable: false },
];
