/**
 * Turn a one-field display name ("Priya Sharma", "J.P.") into the User's
 * firstName / lastName, so a name set by an admin or an invitation round-trips
 * through the two-field My profile form instead of losing its last part.
 *
 * Split at the first space only when both halves meet the model's two-character
 * minimum; otherwise the whole name is the first name. An empty name clears both.
 */
const splitStaffName = (name) => {
    const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!clean) return { firstName: null, lastName: null };
    const space = clean.indexOf(' ');
    if (space > 0) {
        const first = clean.slice(0, space);
        const last = clean.slice(space + 1);
        if (first.length >= 2 && last.length >= 2) return { firstName: first, lastName: last };
    }
    return { firstName: clean, lastName: null };
};

module.exports = { splitStaffName };
