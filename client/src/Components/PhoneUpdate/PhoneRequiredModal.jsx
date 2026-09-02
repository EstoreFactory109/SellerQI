import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, ShieldCheck, X } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { clearAuthCache } from '../../utils/authCoordinator.js';
import { detectCountry } from '../../utils/countryDetection.js';
import { countryCodesData } from '../../utils/countryCodesData.js';
import { phoneCollected } from '../../redux/slices/authSlice.js';
import PhoneNumberInput, { validatePhoneParts, buildPhoneValue } from '../Shared/PhoneNumberInput.jsx';

// Dismissing with "Later" only lasts for the current browser session - the modal
// comes back the next time the app is opened.
const DISMISS_KEY = 'sellerqi_phone_prompt_dismissed';

// This component is mounted globally, outside any error boundary, so storage
// access is guarded - some browsers throw on it in private mode.
const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
};

const writeDismissed = () => {
  try {
    sessionStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    /* dismissal just will not survive this page, which is acceptable */
  }
};

// Routes where the modal must never appear: public/auth pages and the demo app.
const EXCLUDED_PREFIXES = [
  '/sign-up',
  '/agency-sign-up',
  '/agency-login',
  '/admin-login',
  '/verify-email',
  '/reset-password',
  '/pricing',
  '/manage-accounts',
  '/seller-central-checker-demo',
  '/demo'
];

const isExcludedPath = (pathname) =>
  pathname === '/' || EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// A country code lookup keyed by ISO, so IP-detected countries can prefill the field.
const codeForIso = (iso) => {
  if (!iso) return null;
  const entry = Object.entries(countryCodesData).find(([, data]) => data.iso === iso);
  return entry ? entry[0] : null;
};

/**
 * Asks for a phone number when the stored one cannot be trusted.
 *
 * Shown when the logged-in user has needsPhoneUpdate set, which covers two cases
 * (see the model): Google signups that never collected a phone at all, and
 * accounts whose real number was saved without its country code.
 */
const PhoneRequiredModal = ({ forceShow = false, onDone }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const user = useSelector((state) => state.Auth?.user);

  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [dismissed, setDismissed] = useState(readDismissed);

  const reason = user?.phoneUpdateReason;
  const isMissing = reason !== 'country_code'; // default to the stricter "no number at all" copy

  // A super admin inspecting someone else's account must not be asked for a
  // phone number - it would be saved onto the account they are viewing.
  const isSuperAdminViewing = user?.isSuperAdminSession === true || user?.accessType === 'superAdmin';

  // forceShow is used right after Google signup, where the caller waits on the
  // modal before moving on (that flow can leave for Stripe checkout, so there
  // would be no later chance to ask). It bypasses the route and dismiss checks.
  const shouldShow = forceShow
    ? !!user && user.needsPhoneUpdate === true
    : !!user &&
      user.needsPhoneUpdate === true &&
      !isSuperAdminViewing &&
      !dismissed &&
      !isExcludedPath(location.pathname);

  // Prefill: for a number that only lacks its country code, keep the digits the
  // user already gave us. For a placeholder, start empty - it is not a real number.
  useEffect(() => {
    if (!shouldShow) return;
    if (!isMissing && user?.phone && !String(user.phone).startsWith('+')) {
      setPhone(String(user.phone));
    }
  }, [shouldShow, isMissing, user?.phone]);

  // Guess the country code from the user's IP so most people do not have to change it.
  useEffect(() => {
    if (!shouldShow) return;
    let cancelled = false;
    detectCountry()
      .then((iso) => {
        const code = codeForIso(iso);
        if (code && !cancelled) setCountryCode(code);
      })
      .catch(() => {
        /* keep the default - detection is a convenience, not a requirement */
      });
    return () => {
      cancelled = true;
    };
  }, [shouldShow]);

  const handleLater = () => {
    writeDismissed();
    setDismissed(true);
    if (onDone) onDone();
  };

  const handleSave = async () => {
    const validationErrors = validatePhoneParts(countryCode, phone);
    setErrors(validationErrors);
    setServerError('');
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      const response = await axiosInstance.put('/app/update-phone', {
        phone: buildPhoneValue(countryCode, phone)
      });

      if (response?.status === 200) {
        const saved = response.data?.data || {};
        dispatch(phoneCollected({ phone: saved.phone, whatsapp: saved.whatsapp }));
        // The cached /app/profile result still says needsPhoneUpdate, and the next
        // ProtectedRouteWrapper mount would replay it and re-open this modal.
        clearAuthCache();
        if (onDone) onDone();
      }
    } catch (error) {
      // 409 means the number is already on another account (phone still has a
      // unique index in the DB) - let them try a different one.
      setServerError(
        error?.response?.data?.message || 'Could not save your phone number. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {shouldShow && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-[#111827]/60 backdrop-blur-[2px]"
            aria-hidden
          />
          <div className="fixed inset-0 z-[201] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="phone-modal-title"
              className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-6 sm:p-8 max-w-md w-full relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#60a5fa] via-[#a78bfa] to-[#22d3ee]" />

              <button
                type="button"
                onClick={handleLater}
                aria-label="Close"
                className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-14 h-14 bg-[#21262d] border border-[#30363d] rounded-full flex items-center justify-center mb-5">
                <Phone className="w-7 h-7 text-[#60a5fa]" />
              </div>

              <h2 id="phone-modal-title" className="text-xl font-bold text-[#e6edf3] mb-2">
                {isMissing ? 'Add your phone number' : 'Confirm your country code'}
              </h2>
              <p className="text-sm text-[#9ca3af] leading-relaxed mb-6">
                {isMissing
                  ? 'You signed up with Google, so we never got your phone number. Add it so we can reach you about your account and your Amazon data.'
                  : 'Your number is saved without a country code. Pick your country so we can reach you on the right number.'}
              </p>

              <PhoneNumberInput
                countryCode={countryCode}
                phone={phone}
                onCountryCodeChange={(code) => {
                  setCountryCode(code);
                  setErrors((prev) => ({ ...prev, countryCode: '', phone: '' }));
                  setServerError('');
                }}
                onPhoneChange={(value) => {
                  setPhone(value);
                  setErrors((prev) => ({ ...prev, phone: '' }));
                  setServerError('');
                }}
                errors={errors}
                label="Phone Number"
                autoFocus
                disabled={saving}
              />

              {serverError && (
                <motion.p
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-xs mt-3"
                >
                  {serverError}
                </motion.p>
              )}

              <div className="flex items-center gap-2 mt-5 text-xs text-gray-500">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>We only use this to contact you about your account. No marketing calls.</span>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleLater}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[#30363d] text-sm font-medium text-[#9ca3af] hover:text-[#e6edf3] hover:border-gray-500 transition-colors disabled:opacity-50"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[#60a5fa] text-sm font-semibold text-[#0d1117] hover:bg-[#7cb6fb] transition-colors disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save number'}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PhoneRequiredModal;
