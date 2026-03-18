import axios from 'axios';
import { devLog, devWarn } from '../utils/devLogger.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Debug logging for troubleshooting (remove after setup is working)
if (!GOOGLE_CLIENT_ID) {
  console.error('❌ VITE_GOOGLE_CLIENT_ID is not set in environment variables');
  devLog('🔍 Available env vars:', Object.keys(import.meta.env).filter(key => key.startsWith('VITE_')));
} else {
  devLog('✅ Google Client ID loaded successfully');
}

class GoogleAuthService {
  constructor() {
    this.isInitialized = false;
    this.initPromise = null;
  }

  async initialize() {
    if (this.isInitialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      // Load Google Identity Services script
      if (!window.google) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        
        script.onload = () => {
          devLog('✅ Google Identity Services loaded successfully');
          devLog('🌐 Current origin:', window.location.origin);
          this.isInitialized = true;
          resolve();
        };
        
        script.onerror = () => {
          console.error('❌ Failed to load Google Identity Services');
          reject(new Error('Failed to load Google Identity Services'));
        };
        
        document.head.appendChild(script);
      } else {
        devLog('✅ Google Identity Services already available');
        this.isInitialized = true;
        resolve();
      }
    });

    return this.initPromise;
  }

  async signIn() {
    await this.initialize();
    
    return new Promise((resolve, reject) => {
      try {
        devLog('🚀 Initializing Google Sign-In...');
        
        // Initialize with proper callback
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            devLog('📝 Google callback received');
            if (response.credential) {
              devLog('✅ Google ID token received');
              resolve(response.credential);
            } else if (response.error) {
              console.error('🚫 Google Sign-In Error:', response.error);
              reject(new Error(`Google Sign-In Error: ${response.error}`));
            } else {
              console.error('❌ No credential received from Google');
              reject(new Error('No credential received'));
            }
          },
          error_callback: (error) => {
            console.error('🚫 Google Identity Services Error:', error);
            reject(new Error(`Google Identity Services Error: ${error.type || error}`));
          },
          auto_select: false,
          cancel_on_tap_outside: false
        });

        devLog('📋 Trying Google One Tap prompt...');
        
        // Try One Tap first
        window.google.accounts.id.prompt((notification) => {
          devLog('📢 Prompt notification received');
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            devWarn('⚠️ Google One Tap not displayed:', notification.getNotDisplayedReason());
            // Fallback to hidden button that auto-clicks
            this.createHiddenButtonAndAutoClick().then(resolve).catch(reject);
          }
        });
      } catch (error) {
        console.error('💥 Error in signIn:', error);
        reject(error);
      }
    });
  }

  async createHiddenButtonAndAutoClick() {
    return new Promise((resolve, reject) => {
      try {
        devLog('🚀 Creating hidden Google button and auto-clicking...');
        
        // Create a hidden container for the button
        const hiddenContainer = document.createElement('div');
        hiddenContainer.id = 'hidden-google-signin';
        hiddenContainer.style.position = 'absolute';
        hiddenContainer.style.top = '-9999px';
        hiddenContainer.style.left = '-9999px';
        hiddenContainer.style.visibility = 'hidden';
        hiddenContainer.style.opacity = '0';
        hiddenContainer.style.pointerEvents = 'none';
        document.body.appendChild(hiddenContainer);

        // Create button div inside hidden container
        const buttonDiv = document.createElement('div');
        buttonDiv.id = 'hidden-google-button';
        hiddenContainer.appendChild(buttonDiv);

        // Reinitialize with callback that will handle the token
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            // Clean up the hidden container
            if (document.getElementById('hidden-google-signin')) {
              document.body.removeChild(hiddenContainer);
            }
            
            if (response.credential) {
              devLog('✅ Google ID token received from hidden button');
              resolve(response.credential);
            } else {
              console.error('❌ No credential received from hidden button');
              reject(new Error('No credential received from hidden button'));
            }
          }
        });

        // Render the hidden button
        window.google.accounts.id.renderButton(buttonDiv, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          width: 300,
          text: 'signin_with'
        });

        devLog('📋 Hidden Google button rendered, auto-clicking...');

        // Auto-click the button after a short delay
        setTimeout(() => {
          const googleButton = buttonDiv.querySelector('button') || buttonDiv.querySelector('div[role="button"]');
          if (googleButton) {
            devLog('🔄 Auto-clicking hidden Google button...');
            googleButton.click();
          } else {
            console.error('❌ Could not find Google button to auto-click');
            reject(new Error('Could not find Google button to auto-click'));
          }
        }, 500);

      } catch (error) {
        console.error('💥 Error in createHiddenButtonAndAutoClick:', error);
        reject(error);
      }
    });
  }

  async authenticateWithBackend(idToken, isSignUp = false,packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate) {
    try {
      const endpoint = isSignUp ? '/app/google-register' : '/app/google-login';
      devLog(`📤 Sending to backend: ${endpoint}`);
      
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}${endpoint}`,
        { idToken,packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate },
        { withCredentials: true }
      );
      
      devLog('✅ Backend authentication succeeded');
      return response.data;
    } catch (error) {
      console.error('❌ Backend authentication failed:', error);
      throw error;
    }
  }

  // Method to handle complete Google sign-in flow
  async handleGoogleSignIn() {
    try {
      devLog('🔐 Starting Google Sign-In flow...');
      const idToken = await this.signIn();
      devLog('🎟️ Got ID token, authenticating with backend...');
      const result = await this.authenticateWithBackend(idToken, false);
      devLog('✅ Google Sign-In completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Google sign-in failed:', error);
      throw error;
    }
  }

  // Method to handle complete Google sign-up flow
  async handleGoogleSignUp(packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate) {
    try {
      devLog('📝 Starting Google Sign-Up flow...');
      const idToken = await this.signIn();
      devLog('🎟️ Got ID token, registering with backend...');
      const result = await this.authenticateWithBackend(idToken, true,packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate);
      devLog('✅ Google Sign-Up completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Google sign-up failed:', error);
      throw error;
    }
  }
}

const googleAuthService = new GoogleAuthService();
export default googleAuthService;