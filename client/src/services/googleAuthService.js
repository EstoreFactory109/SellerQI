import axios from 'axios';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Debug logging for troubleshooting (remove after setup is working)
if (!GOOGLE_CLIENT_ID) {
  console.error('❌ VITE_GOOGLE_CLIENT_ID is not set in environment variables');
  console.log('🔍 Available env vars:', Object.keys(import.meta.env).filter(key => key.startsWith('VITE_')));
} else {
  console.log('✅ Google Client ID loaded successfully');
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
          console.log('✅ Google Identity Services loaded successfully');
          console.log('🌐 Current origin:', window.location.origin);
          console.log('🔑 Client ID:', GOOGLE_CLIENT_ID);
          this.isInitialized = true;
          resolve();
        };
        
        script.onerror = () => {
          console.error('❌ Failed to load Google Identity Services');
          reject(new Error('Failed to load Google Identity Services'));
        };
        
        document.head.appendChild(script);
      } else {
        console.log('✅ Google Identity Services already available');
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
        console.log('🚀 Initializing Google Sign-In...');
        
        // Initialize with proper callback
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            console.log('📝 Google callback response:', response);
            if (response.credential) {
              console.log('✅ Google ID token received');
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

        console.log('📋 Trying Google One Tap prompt...');
        
        // Try One Tap first
        window.google.accounts.id.prompt((notification) => {
          console.log('📢 Prompt notification:', notification);
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            console.warn('⚠️ Google One Tap not displayed:', notification.getNotDisplayedReason());
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
        console.log('🚀 Creating hidden Google button and auto-clicking...');
        
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
              console.log('✅ Google ID token received from hidden button');
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

        console.log('📋 Hidden Google button rendered, auto-clicking...');

        // Auto-click the button after a short delay
        setTimeout(() => {
          const googleButton = buttonDiv.querySelector('button') || buttonDiv.querySelector('div[role="button"]');
          if (googleButton) {
            console.log('🔄 Auto-clicking hidden Google button...');
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
      console.log(`📤 Sending to backend: ${endpoint}`);
      
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}${endpoint}`,
        { idToken,packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate },
        { withCredentials: true }
      );
      
      console.log('✅ Backend response:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Backend authentication failed:', error);
      throw error;
    }
  }

  // Method to handle complete Google sign-in flow
  async handleGoogleSignIn() {
    try {
      console.log('🔐 Starting Google Sign-In flow...');
      const idToken = await this.signIn();
      console.log('🎟️ Got ID token, authenticating with backend...');
      const result = await this.authenticateWithBackend(idToken, false);
      console.log('✅ Google Sign-In completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Google sign-in failed:', error);
      throw error;
    }
  }

  // Method to handle complete Google sign-up flow
  async handleGoogleSignUp(packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate) {
    try {
      console.log('📝 Starting Google Sign-Up flow...');
      const idToken = await this.signIn();
      console.log('🎟️ Got ID token, registering with backend...');
      const result = await this.authenticateWithBackend(idToken, true,packageType,isInTrialPeriod,subscriptionStatus,trialEndsDate);
      console.log('✅ Google Sign-Up completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Google sign-up failed:', error);
      throw error;
    }
  }
}

const googleAuthService = new GoogleAuthService();
export default googleAuthService;