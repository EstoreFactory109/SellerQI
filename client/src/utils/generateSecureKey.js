// Utility to generate a secure random key for encryption
// This is a browser-compatible version

// Generate a secure random key using Web Crypto API
function generateSecureKey(length = 64) {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array));
  } else {
    // Fallback for environments without Web Crypto API
    console.warn('Web Crypto API not available, using fallback');
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Generate multiple key options
console.log('🔐 Secure Encryption Keys for VITE_COGS_ENCRYPTION_KEY:\n');
console.log('Option 1 (64 bytes, base64):');
console.log(generateSecureKey(64));
console.log('\nOption 2 (32 bytes, base64):');
console.log(generateSecureKey(32));
console.log('\nOption 3 (128 bytes, base64):');
console.log(generateSecureKey(128));

console.log('\n📝 Instructions:');
console.log('1. Choose one of the keys above');
console.log('2. Create a .env file in the client directory');
console.log('3. Add the following line to your .env file:');
console.log('   VITE_COGS_ENCRYPTION_KEY=your_chosen_key_here');
console.log('4. Make sure .env is in your .gitignore file');
console.log('\n⚠️  IMPORTANT: Never commit the .env file to version control!'); 