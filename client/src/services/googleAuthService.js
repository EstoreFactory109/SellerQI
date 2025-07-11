import axios from 'axios';

const GOOGLE_CLIENT_ID = '113167162939-ucumckjf0vlngbb790md23vd8puck4ll.apps.googleusercontent.com';

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
        
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            console.log('📝 Google callback response:', response);
            if (response.credential) {
              console.log('✅ Google ID token received');
              resolve(response.credential);
            } else {
              console.error('❌ No credential received from Google');
              reject(new Error('No credential received'));
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          context: 'signin'
        });

        console.log('📋 Showing Google One Tap prompt...');
        
        // Add error handler for initialization
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response.credential) {
              resolve(response.credential);
            } else if (response.error) {
              console.error('🚫 Google Sign-In Error:', response.error);
              reject(new Error(`Google Sign-In Error: ${response.error}`));
            } else {
              reject(new Error('No credential received'));
            }
          },
          error_callback: (error) => {
            console.error('🚫 Google Identity Services Error:', error);
            reject(new Error(`Google Identity Services Error: ${error.type || error}`));
          }
        });

        // Trigger the sign-in prompt
        window.google.accounts.id.prompt((notification) => {
          console.log('📢 Prompt notification:', notification);
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            console.warn('⚠️ Google One Tap not displayed:', notification.getNotDisplayedReason());
            // Fallback to renderButton approach
            this.showSignInButton().then(resolve).catch(reject);
          }
        });
      } catch (error) {
        console.error('💥 Error in signIn:', error);
        reject(error);
      }
    });
  }

  async showSignInButton() {
    return new Promise((resolve, reject) => {
      try {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.position = 'fixed';
        buttonContainer.style.top = '50%';
        buttonContainer.style.left = '50%';
        buttonContainer.style.transform = 'translate(-50%, -50%)';
        buttonContainer.style.zIndex = '10000';
        buttonContainer.style.background = 'white';
        buttonContainer.style.padding = '20px';
        buttonContainer.style.borderRadius = '8px';
        buttonContainer.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        document.body.appendChild(buttonContainer);

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '5px';
        closeButton.style.right = '10px';
        closeButton.style.border = 'none';
        closeButton.style.background = 'none';
        closeButton.style.fontSize = '20px';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = () => {
          document.body.removeChild(buttonContainer);
          reject(new Error('User cancelled Google sign-in'));
        };
        buttonContainer.appendChild(closeButton);

        window.google.accounts.id.renderButton(buttonContainer, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          width: 300
        });

        // Override the callback for this specific button
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            document.body.removeChild(buttonContainer);
            if (response.credential) {
              resolve(response.credential);
            } else {
              reject(new Error('No credential received from button'));
            }
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  async signInWithPopup() {
    await this.initialize();
    
    return new Promise((resolve, reject) => {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response.credential) {
              resolve(response.credential);
            } else {
              reject(new Error('No credential received'));
            }
          }
        });

        // Use renderButton for popup experience
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'none';
        document.body.appendChild(buttonContainer);

        window.google.accounts.id.renderButton(buttonContainer, {
          theme: 'outline',
          size: 'large',
          type: 'standard'
        });

        // Trigger click programmatically
        setTimeout(() => {
          const button = buttonContainer.querySelector('iframe');
          if (button) {
            button.click();
          } else {
            // Fallback to prompt
            window.google.accounts.id.prompt();
          }
          document.body.removeChild(buttonContainer);
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  async authenticateWithBackend(idToken, isSignUp = false) {
    try {
      const endpoint = isSignUp ? '/app/google-register' : '/app/google-login';
      console.log(`📤 Sending to backend: ${endpoint}`);
      
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}${endpoint}`,
        { idToken },
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
  async handleGoogleSignUp() {
    try {
      console.log('📝 Starting Google Sign-Up flow...');
      const idToken = await this.signIn();
      console.log('🎟️ Got ID token, registering with backend...');
      const result = await this.authenticateWithBackend(idToken, true);
      console.log('✅ Google Sign-Up completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Google sign-up failed:', error);
      throw error;
    }
  }

  // Alternative popup-based methods
  async handleGoogleSignInPopup() {
    try {
      const idToken = await this.signInWithPopup();
      const result = await this.authenticateWithBackend(idToken, false);
      return result;
    } catch (error) {
      console.error('Google sign-in with popup failed:', error);
      throw error;
    }
  }

  async handleGoogleSignUpPopup() {
    try {
      const idToken = await this.signInWithPopup();
      const result = await this.authenticateWithBackend(idToken, true);
      return result;
    } catch (error) {
      console.error('Google sign-up with popup failed:', error);
      throw error;
    }
  }
}

const googleAuthService = new GoogleAuthService();
export default googleAuthService; 