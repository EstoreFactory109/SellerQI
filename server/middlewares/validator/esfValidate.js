const { body, validationResult } = require("express-validator");
const { ASSIGNABLE_ESF_ROLES } = require("../../Services/User/esfRoles.js");
const { applyPasswordRules } = require("../../utils/passwordPolicy.js");

const EMAIL_NORMALIZE_OPTS = {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false,
};

/** Shared terminal handler — same response shape as the other validators. */
const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            statusCode: 400,
            message: "Validation failed",
            errors: errors.array(),
        });
    }
    next();
};

const nameRule = (field, label) =>
    body(field)
        .trim()
        .notEmpty().withMessage(`${label} is required`)
        .isAlpha().withMessage(`${label} must contain only letters`)
        .isLength({ min: 2, max: 50 }).withMessage(`${label} must be between 2 to 50 characters`);

const emailRule = body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Invalid email format")
    .normalizeEmail(EMAIL_NORMALIZE_OPTS);

// Same rules as registerValidate.js / agencyClientValidate.js — keeps the
// leading "+" so the country code survives sanitisation.
const phoneRule = body("phone")
    .trim()
    .notEmpty().withMessage("Phone number is required")
    .custom((value) => {
        const cleaned = value.replace(/[\s\-\(\)]/g, '');
        const digitsOnly = cleaned.replace(/^\+/, '');
        if (!/^\d+$/.test(digitsOnly)) {
            throw new Error('Phone number must contain only numbers');
        }
        if (digitsOnly.length < 10 || digitsOnly.length > 15) {
            throw new Error('Phone number must be between 10 and 15 digits');
        }
        return true;
    })
    .customSanitizer((value) => value.replace(/[\s\-\(\)]/g, ''));

// Same strength the normal signup page enforces - one definition, applied to
// both ESF clients and ESF staff. A factory so each chain is its own instance.
const passwordRule = () =>
    applyPasswordRules(body("password").notEmpty().withMessage("Password is required"));

/** POST /app/esf/login */
const validateEsfLogin = [
    emailRule,
    body("password").trim().notEmpty().withMessage("Password is required"),
    handleValidation,
];

/** POST /app/esf/clients — ESF clients get a password so they can sign in. */
const validateEsfClient = [
    nameRule("firstname", "First name"),
    nameRule("lastname", "Last name"),
    phoneRule,
    emailRule,
    passwordRule(),
    body("allTermsAndConditionsAgreed")
        .optional()
        .isBoolean().withMessage("Terms agreement must be a boolean"),
    handleValidation,
];

// Optional display name ("nickname") an owner/admin gives a staff member. Looser
// than nameRule on purpose: one field, and spaces, dots and hyphens are fine.
const nicknameRule = (field) =>
    body(field)
        .optional({ values: "falsy" })
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage("Name must be between 2 and 50 characters")
        .matches(/^[\p{L}][\p{L} .'-]*$/u).withMessage("Name may contain letters, spaces, dots, hyphens and apostrophes");

/**
 * POST /app/esf/invites — the inviter supplies an address, a role and optionally
 * a nickname. The recipient fills in nothing: accepting signs them straight in.
 */
const validateEsfInvite = [
    emailRule,
    nicknameRule("name"),
    // 'owner' is intentionally not accepted - there is exactly one, and it is seeded.
    body("role")
        .optional()
        .isIn(ASSIGNABLE_ESF_ROLES).withMessage(`Role must be one of: ${ASSIGNABLE_ESF_ROLES.join(", ")}`),
    handleValidation,
];

/** PATCH /app/esf/users/:userId/name — set or clear a staff member's nickname. */
const validateEsfNickname = [
    nicknameRule("name"),
    handleValidation,
];

/** POST /app/esf/login-link — "Log in as a member" on /esf-login. */
const validateEsfLoginLink = [
    emailRule,
    handleValidation,
];

/** PATCH /app/esf/users/:userId/role */
const validateEsfRole = [
    body("role")
        .notEmpty().withMessage("Role is required")
        .isIn(ASSIGNABLE_ESF_ROLES).withMessage(`Role must be one of: ${ASSIGNABLE_ESF_ROLES.join(", ")}`),
    handleValidation,
];

/**
 * PUT /app/esf/profile — email is intentionally not updatable. Same name rule as
 * the nickname an admin sets, so a name given at invitation can be saved back.
 */
const validateEsfProfile = [
    nicknameRule("firstName"),
    nicknameRule("lastName"),
    body("phone").optional().trim(),
    handleValidation,
];

/**
 * POST /app/esf/clients/:clientId/project
 * Only the id is accepted — the project's name is resolved from Zoho at link
 * time (Services/Zoho/ZohoProjectLinks.js), never taken from the request, so a
 * stale or spoofed label can't be stored.
 */
const validateLinkProject = [
    body("projectId")
        .trim()
        .notEmpty().withMessage("A project must be selected")
        .isLength({ max: 64 }).withMessage("Invalid project id"),
    handleValidation,
];

module.exports = {
    validateLinkProject,
    validateEsfLogin,
    validateEsfClient,
    validateEsfInvite,
    validateEsfNickname,
    validateEsfLoginLink,
    validateEsfRole,
    validateEsfProfile,
};
