/**
 * The server-side definition of an acceptable password.
 *
 * Mirrors client/src/utils/passwordCriteria.js exactly: min 8 characters plus an
 * uppercase, a lowercase, a number and a special character — the same rules
 * registerValidate.js and passwordResetValidate.js already enforce for signup
 * and password reset.
 *
 * Exists so every other place that accepts a password (ESF add-client, ESF
 * add-member, set/reset password) applies the identical rule instead of its own
 * weaker `length >= 8` check, which would otherwise be a way straight past the
 * signup requirements.
 */

/** Each rule, in the order they are reported to the user. */
const PASSWORD_RULES = [
    { label: 'at least 8 characters', test: (v) => typeof v === 'string' && v.length >= 8 },
    { label: 'one uppercase letter', test: (v) => /[A-Z]/.test(v || '') },
    { label: 'one lowercase letter', test: (v) => /[a-z]/.test(v || '') },
    { label: 'one number', test: (v) => /[0-9]/.test(v || '') },
    { label: 'one special character', test: (v) => /[!@#$%^&*(),.?":{}|<>]/.test(v || '') },
];

/** The rules a value does not satisfy. Empty array means it is acceptable. */
const unmetPasswordRules = (value) => PASSWORD_RULES.filter((rule) => !rule.test(value));

const isStrongPassword = (value) => unmetPasswordRules(value).length === 0;

/** Message naming only what is still missing, for inline (non-validator) checks. */
const passwordPolicyMessage = (value) => {
    const unmet = unmetPasswordRules(value);
    if (!unmet.length) return '';
    return `Password must contain ${unmet.map((r) => r.label).join(', ')}`;
};

/**
 * express-validator chain for a password field.
 *
 * Message wording matches registerValidate.js so a rejection reads the same
 * wherever a password is set.
 *
 * @param {import('express-validator').ValidationChain} chain a `body("field")`
 */
const applyPasswordRules = (chain) =>
    chain
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/).withMessage('Password must contain at least one number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character');

module.exports = {
    PASSWORD_RULES,
    unmetPasswordRules,
    isStrongPassword,
    passwordPolicyMessage,
    applyPasswordRules,
};
