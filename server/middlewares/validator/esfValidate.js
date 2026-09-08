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

/**
 * POST /app/esf/invites — the inviter supplies only an address and a role.
 * Everything else is filled in by the recipient when they accept.
 */
const validateEsfInvite = [
    emailRule,
    // 'owner' is intentionally not accepted - there is exactly one, and it is seeded.
    body("role")
        .optional()
        .isIn(ASSIGNABLE_ESF_ROLES).withMessage(`Role must be one of: ${ASSIGNABLE_ESF_ROLES.join(", ")}`),
    handleValidation,
];

/**
 * POST /app/esf/invites/token/:token/accept — the recipient's own details.
 * No email and no role: both come from the invitation, so accepting cannot be
 * used to claim a different address or a higher role.
 */
const validateEsfInviteAccept = [
    nameRule("firstname", "First name"),
    nameRule("lastname", "Last name"),
    phoneRule,
    passwordRule(),
    handleValidation,
];

/** PATCH /app/esf/users/:userId/role */
const validateEsfRole = [
    body("role")
        .notEmpty().withMessage("Role is required")
        .isIn(ASSIGNABLE_ESF_ROLES).withMessage(`Role must be one of: ${ASSIGNABLE_ESF_ROLES.join(", ")}`),
    handleValidation,
];

/** PUT /app/esf/profile — email is intentionally not updatable. */
const validateEsfProfile = [
    nameRule("firstName", "First name").optional(),
    nameRule("lastName", "Last name").optional(),
    body("phone").optional().trim(),
    handleValidation,
];

module.exports = {
    validateEsfLogin,
    validateEsfClient,
    validateEsfInvite,
    validateEsfInviteAccept,
    validateEsfRole,
    validateEsfProfile,
};
