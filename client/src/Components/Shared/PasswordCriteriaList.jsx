import { Check, X } from 'lucide-react';
import { PASSWORD_CRITERIA } from '../../utils/passwordCriteria.js';

/**
 * Live password rules: each stays red until it is satisfied, so nobody has to
 * submit the form to find out what is missing.
 *
 * With an empty field there is nothing to check yet, so it falls back to the
 * one-line hint (or to `error`, when the form has flagged the field as required).
 */
const PasswordCriteriaList = ({ value, error, className = '' }) => {
  if (value) {
    return (
      <ul className={`mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 ${className}`}>
        {PASSWORD_CRITERIA.map(({ label, test }) => {
          const met = test(value);
          return (
            <li
              key={label}
              className={`flex items-center gap-1.5 text-xs transition-colors duration-200 ${
                met ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {met ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0" />}
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (error) {
    return <p className={`text-red-400 text-xs mt-1 ${className}`}>{error}</p>;
  }

  return (
    <p className={`text-xs text-gray-500 mt-0.5 ${className}`}>
      Min 8 chars with 1 uppercase, 1 lowercase, a number &amp; a symbol
    </p>
  );
};

export default PasswordCriteriaList;
