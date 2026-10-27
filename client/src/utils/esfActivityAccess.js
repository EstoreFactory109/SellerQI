/**
 * Mirrors server/Services/User/esfRoles.js canViewClientActivity, only to decide what to SHOW;
 * the server is the one that enforces it.
 */
export const canViewClientActivity = (esfUser) =>
  Boolean(esfUser) && (esfUser.isOwner || esfUser.esfRole === 'owner' || esfUser.esfRole === 'admin' || esfUser.accessType === 'superAdmin');

/** Mirrors esfRoles.js canManageBilling (same people): who may link a client's Zoho Billing customer. */
export const canManageClientBilling = canViewClientActivity;
