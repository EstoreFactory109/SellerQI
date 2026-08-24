import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { motion } from 'framer-motion';
import { countryCodesData } from '../../utils/countryCodesData.js';

// Flag image for an ISO code, falling back to a neutral emoji for unknown codes.
export const getCountryFlag = (isoCode) => {
  if (!isoCode || isoCode === 'XX') return '🏳️';
  return `https://flagsapi.com/${isoCode}/flat/32.png`;
};

// Used when the typed country code is not in countryCodesData - the user can
// still continue, we just cannot validate the length against a known country.
export const defaultCountryData = {
  iso: 'XX',
  name: 'Unknown Country',
  pattern: /^\d{7,15}$/,
  placeholder: 'Enter phone number',
  minLength: 7,
  maxLength: 15
};

export const getCountryForCode = (countryCode) =>
  countryCodesData[countryCode] || { ...defaultCountryData, code: countryCode };

/**
 * Validate a country code + local number pair.
 * Returns { countryCode?, phone? } - empty object means valid.
 */
export const validatePhoneParts = (countryCode, phone) => {
  const errors = {};
  const country = getCountryForCode(countryCode);

  if (!countryCode || countryCode === '+' || countryCode.length < 2) {
    errors.countryCode = 'Country code is required';
  }

  const cleanPhone = String(phone || '').replace(/\s+/g, '');
  if (!cleanPhone) {
    errors.phone = 'Phone number is required';
  } else if (!country.pattern.test(cleanPhone)) {
    const range = country.minLength !== country.maxLength ? `${country.minLength}-${country.maxLength}` : `${country.minLength}`;
    errors.phone = `Enter a valid phone number for ${country.name} (${range} digits)`;
  }

  return errors;
};

/** Join the two parts into the format the API expects: "+91 9876543210". */
export const buildPhoneValue = (countryCode, phone) => `${countryCode} ${String(phone || '').trim()}`.trim();

/**
 * Controlled country-code + phone number field.
 *
 * Extracted from the signup form so the phone-collection modal and the agency
 * "add client" form collect the country code the same way instead of each
 * re-implementing it (which is how the client form ended up trimming it).
 */
const PhoneNumberInput = ({
  countryCode,
  phone,
  onCountryCodeChange,
  onPhoneChange,
  errors = {},
  label = 'Phone Number',
  autoFocus = false,
  disabled = false
}) => {
  const [countryFlag, setCountryFlag] = useState(() => getCountryFlag(getCountryForCode(countryCode).iso));
  const selectedCountry = getCountryForCode(countryCode);

  useEffect(() => {
    setCountryFlag(getCountryFlag(getCountryForCode(countryCode).iso));
  }, [countryCode]);

  const handleCountryCodeChange = (e) => {
    const value = e.target.value;
    // Only allow + and digits, max 4 characters (+XXX)
    if (value.match(/^\+?\d{0,3}$/) || value === '+') {
      const formattedValue = value.startsWith('+') ? value : '+' + value.replace(/[^\d]/g, '');
      onCountryCodeChange(formattedValue);
    }
  };

  const handlePhoneChange = (e) => {
    // Only allow digits and spaces, and enforce the selected country's max length
    const cleanValue = e.target.value.replace(/[^\d\s]/g, '');
    if (cleanValue.replace(/\s+/g, '').length <= selectedCountry.maxLength) {
      onPhoneChange(cleanValue);
    }
  };

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      )}
      <div className="flex">
        {/* Country Code Input */}
        <div className="relative">
          <div className={`flex items-center gap-2 px-3 py-2.5 h-11 border rounded-l-lg bg-[#21262d] ${
            errors.countryCode ? 'border-red-500 bg-red-500/10' : 'border-[#30363d]'
          }`}>
            <div className="w-5 h-4 flex items-center justify-center">
              {countryFlag.startsWith('http') ? (
                <img
                  src={countryFlag}
                  alt={`${selectedCountry.name} flag`}
                  className="w-5 h-4 object-cover rounded-sm"
                  onError={(e) => {
                    e.target.outerHTML = '<span class="text-sm">🏳️</span>';
                  }}
                />
              ) : (
                <span className="text-sm">{countryFlag}</span>
              )}
            </div>
            <input
              type="text"
              value={countryCode}
              onChange={handleCountryCodeChange}
              disabled={disabled}
              className={`w-16 text-sm font-medium text-gray-100 bg-transparent border-none outline-none focus:ring-0 disabled:opacity-60 ${
                errors.phone || errors.countryCode ? 'text-red-400' : ''
              }`}
              placeholder="+1"
              maxLength={4}
            />
          </div>
        </div>

        {/* Phone Number Input */}
        <div className="relative flex-1">
          <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            name="phone"
            value={phone}
            onChange={handlePhoneChange}
            autoFocus={autoFocus}
            disabled={disabled}
            className={`w-full pl-10 pr-4 py-2.5 h-11 border-t border-r border-b rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 disabled:opacity-60 ${
              errors.phone ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
            }`}
            placeholder={selectedCountry.placeholder}
            maxLength={selectedCountry.maxLength + Math.floor(selectedCountry.maxLength / 3)} // Extra space for formatting
          />
        </div>
      </div>

      {errors.countryCode && (
        <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">
          {errors.countryCode}
        </motion.p>
      )}
      {errors.phone && (
        <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">
          {errors.phone}
        </motion.p>
      )}
      <p className="text-xs text-gray-500 mt-1">
        Enter {selectedCountry.minLength}
        {selectedCountry.minLength !== selectedCountry.maxLength ? `-${selectedCountry.maxLength}` : ''} digits for {selectedCountry.name}
      </p>
    </div>
  );
};

export default PhoneNumberInput;
