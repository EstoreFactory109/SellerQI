// Simple encryption/decryption utility for localStorage
// Note: This is basic encryption. For production, consider using a more robust solution

// Get encryption key from environment variable or use a default (not recommended for production)
const ENCRYPTION_KEY = import.meta.env.VITE_COGS_ENCRYPTION_KEY || 'ibex-cogs-default-key-2024-please-change-this';

// Validate encryption key
if (!import.meta.env.VITE_COGS_ENCRYPTION_KEY) {
  console.warn('⚠️ Warning: Using default encryption key. Please set VITE_COGS_ENCRYPTION_KEY in your .env file for better security.');
}

// Simple XOR encryption
export const encrypt = (text) => {
  if (!text) return '';
  
  let encrypted = '';
  for (let i = 0; i < text.length; i++) {
    encrypted += String.fromCharCode(
      text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length)
    );
  }
  // Convert to base64 for safe storage
  return btoa(encrypted);
};

// Simple XOR decryption
export const decrypt = (encryptedText) => {
  if (!encryptedText) return '';
  
  try {
    // Decode from base64
    const decoded = atob(encryptedText);
    let decrypted = '';
    
    for (let i = 0; i < decoded.length; i++) {
      decrypted += String.fromCharCode(
        decoded.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length)
      );
    }
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return '';
  }
};

// Encrypt object
export const encryptObject = (obj) => {
  try {
    const jsonString = JSON.stringify(obj);
    return encrypt(jsonString);
  } catch (error) {
    console.error('Encryption error:', error);
    return '';
  }
};

// Decrypt object
export const decryptObject = (encryptedString) => {
  try {
    const decryptedString = decrypt(encryptedString);
    return JSON.parse(decryptedString);
  } catch (error) {
    console.error('Decryption error:', error);
    return {};
  }
}; 