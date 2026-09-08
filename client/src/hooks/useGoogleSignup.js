import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import googleAuthService from '../services/googleAuthService.js';
import { loginSuccess } from '../redux/slices/authSlice.js';
import { clearAuthCache } from '../utils/authCoordinator.js';

// Payment is disabled, so every new account is created as PRO with immediate
// access. Mirrors what SignUp.jsx sends on the password path.
const FREE_PRO = {
  packageType: 'PRO',
  isInTrialPeriod: false,
  subscriptionStatus: 'active',
  trialEndsDate: null,
};

/**
 * The Google sign-up half of both auth pages.
 *
 * Google never gives us a phone number, so `pendingSignup` holds the routing
 * while the phone-collection modal is open.
 */
export const useGoogleSignup = ({ onError } = {}) => {
  const [pendingSignup, setPendingSignup] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const finishSignup = useCallback(() => {
    setPendingSignup(null);
    navigate('/connect-to-amazon');
  }, [navigate]);

  /**
   * Creates the account and takes over routing.
   * Pass `idToken` to reuse a token from a failed sign-in; omit it to prompt Google.
   * `packageType` is only meaningful for AGENCY, which also needs `agencyName`.
   */
  const registerWithGoogle = useCallback(
    async ({ idToken, packageType, agencyName } = {}) => {
      const registration = {
        ...FREE_PRO,
        allTermsAndConditionsAgreed: true,
        ...(packageType ? { packageType } : {}),
        ...(agencyName ? { agencyName } : {}),
      };

      const response = idToken
        ? await googleAuthService.registerWithToken(idToken, registration)
        : await googleAuthService.handleGoogleSignUp(registration);

      if (response.statusCode !== 201) {
        onError?.(response.message || 'Google sign-up failed. Please try again.');
        return response;
      }

      clearAuthCache();
      localStorage.setItem('isAuth', 'true');
      dispatch(loginSuccess(response.data || response));

      // Only wait on the modal when the server actually flagged the account,
      // otherwise it renders nothing and strands the user here.
      if ((response.data || response)?.needsPhoneUpdate === true) {
        setPendingSignup(true);
      } else {
        finishSignup();
      }
      return response;
    },
    [dispatch, finishSignup, onError]
  );

  return { pendingSignup, registerWithGoogle, finishSignup };
};
