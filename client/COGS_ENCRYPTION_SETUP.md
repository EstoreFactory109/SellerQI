# COGs Encryption Setup Guide

## Overview
The COGs (Cost of Goods Sold) values are encrypted before being stored in localStorage to protect sensitive pricing information. This guide explains how to set up the encryption key.

## Setup Instructions

### 1. Generate a Secure Encryption Key

Run the key generation script:
```bash
cd client
node src/utils/generateSecureKey.js
```

This will generate several secure key options. Choose one of them.

### 2. Create .env File

Create a `.env` file in the `client` directory:
```bash
touch client/.env
```

### 3. Add the Encryption Key

Add the following line to your `.env` file:
```
VITE_COGS_ENCRYPTION_KEY=your_chosen_secure_key_here
```

Example:
```
VITE_COGS_ENCRYPTION_KEY=h3K9mP2xQ7vN5bL8jR4wT6yU1aS0dF3gH5jK7lZ9xC2vB4nM6qW8eR1tY3uI5oP7aS9dF2gH4jK6lZ8xC1vB3nM5q==
```

### 4. Sample .env.example File

Create a `.env.example` file in the client directory with the following content to help other developers:
```
# Base API URL
VITE_BASE_URI=http://localhost:3000

# RapidAPI Configuration (if used)
VITE_RAPIDAPI_URI=
VITE_X_RAPIDAPI_KEY=
VITE_X_RAPIDAPI_HOST=

# COGs Encryption Key - Generate using: node src/utils/generateSecureKey.js
VITE_COGS_ENCRYPTION_KEY=REPLACE_WITH_SECURE_KEY_DO_NOT_USE_DEFAULT
```

### 5. Verify .gitignore

Make sure your `.env` file is listed in `.gitignore`:
```bash
# Check if .env is in .gitignore
grep "\.env" client/.gitignore
```

If not present, add it:
```
.env
.env.local
```

### 6. Restart Development Server

After adding the environment variable, restart your development server:
```bash
npm run dev
```

## Security Best Practices

1. **Never commit the .env file** to version control
2. **Use a unique key** for each environment (development, staging, production)
3. **Rotate keys periodically** for enhanced security
4. **Store production keys** in secure environment variable management systems
5. **Use longer keys** (64+ characters) for better security

## How It Works

1. When a user enters COGs values in the Profitability Dashboard
2. The values are encrypted using XOR cipher with the secure key
3. Encrypted data is encoded in base64 and stored in localStorage
4. On page reload, data is decrypted and loaded back into Redux
5. Data is only cleared when the user logs out

## Troubleshooting

### Warning: "Using default encryption key"
This means the `VITE_COGS_ENCRYPTION_KEY` is not set in your `.env` file. Follow the setup instructions above.

### COGs values not persisting
1. Check browser console for encryption/decryption errors
2. Verify the `.env` file is in the correct location (`client/.env`)
3. Ensure the development server was restarted after adding the env variable

### Data appears corrupted after changing the key
If you change the encryption key, previously encrypted data cannot be decrypted. Clear the localStorage:
```javascript
localStorage.removeItem('ibex_cogs_data');
```

## Manual Key Generation (Alternative)

If you prefer to generate a key manually, you can use:

### macOS/Linux:
```bash
openssl rand -base64 64
```

### Online Tool:
Use a secure password generator to create a 64+ character random string.

## Environment-Specific Keys

For different environments, use different variable names:
- Development: `VITE_COGS_ENCRYPTION_KEY`
- Production: Set via your hosting provider's environment variables

Remember: The key should be different for each environment! 