/**
 * The one definition of what makes a password acceptable.
 *
 * These mirror the server exactly — registerValidate.js and passwordResetValidate.js
 * both require min 8 chars plus an uppercase, a lowercase, a number and a special
 * character. Every form that collects a password reads from here.
 *
 * This lives in one file on purpose. The three forms used to carry their own regex
 * asking only for "a letter", so passwords like "password1!" passed client-side and
 * came back as a bare 400. Their regex also pinned the allowed characters to
 * [A-Za-z\d@$!%*?&], rejecting symbols the server accepts (e.g. "Abcdefg1#").
 */
export const PASSWORD_CRITERIA = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: '1 uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: '1 lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: '1 number', test: (v) => /[0-9]/.test(v) },
  { label: '1 special character', test: (v) => /[!@#$%^&*(),.?":{}|<>]/.test(v) },
];

/** The rules a value does not satisfy yet. Empty array means it is valid. */
export const unmetPasswordCriteria = (value) =>
  PASSWORD_CRITERIA.filter((c) => !c.test(value || ''));

export const isPasswordValid = (value) => unmetPasswordCriteria(value).length === 0;

/** Submit-time message naming only what is still missing. */
export const passwordErrorMessage = (value) => {
  const unmet = unmetPasswordCriteria(value);
  if (!unmet.length) return '';
  return `Password still needs: ${unmet.map((c) => c.label.toLowerCase()).join(', ')}`;
};

/**
 * Pull something readable out of a failed request.
 *
 * The API returns two different error shapes: controllers send `{ message }`, while
 * express-validator rejections send `{ errors: [{ msg }] }` with no `message` at all.
 * Reading only `.message` left the banner empty on every validation rejection — the
 * request failed and the form said nothing.
 */
export const extractServerError = (error, fallback = 'Something went wrong. Please try again.') => {
  const data = error?.response?.data;
  if (data?.message) return data.message;
  if (Array.isArray(data?.errors) && data.errors.length) {
    return data.errors.map((e) => e.msg).filter(Boolean).join('. ');
  }
  return fallback;
};
