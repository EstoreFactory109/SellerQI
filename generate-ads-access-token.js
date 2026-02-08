/**
 * Script to generate a fresh Amazon Ads access token from refresh token
 * Usage: node generate-ads-access-token.js <refresh_token>
 */

const axios = require('axios');
require('dotenv').config();

const refreshToken = process.argv[2];

if (!refreshToken) {
  console.error('❌ Error: Refresh token is required');
  console.log('Usage: node generate-ads-access-token.js <refresh_token>');
  process.exit(1);
}

const clientId = process.env.AMAZON_ADS_CLIENT_ID;
const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ Error: AMAZON_ADS_CLIENT_ID and AMAZON_ADS_CLIENT_SECRET must be set in .env file');
  process.exit(1);
}

console.log('🔄 Generating fresh access token...');

axios.post('https://api.amazon.com/auth/o2/token', 
  new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  }),
  { 
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000
  }
)
.then(response => {
  if (response.data.access_token) {
    console.log('✅ Success! Fresh access token generated:');
    console.log('\n' + response.data.access_token + '\n');
    console.log('📋 Copy this token and update the Authorization header in ~/.cursor/mcp.json');
    console.log('   Format: "Authorization": "Bearer ' + response.data.access_token + '"');
    
    if (response.data.expires_in) {
      const expiresInHours = Math.floor(response.data.expires_in / 3600);
      const expiresInMinutes = Math.floor((response.data.expires_in % 3600) / 60);
      console.log(`\n⏰ Token expires in: ${expiresInHours}h ${expiresInMinutes}m`);
      console.log('   You\'ll need to regenerate and update the token when it expires.');
    }
  } else {
    console.error('❌ Error: No access token in response');
    console.log(JSON.stringify(response.data, null, 2));
    process.exit(1);
  }
})
.catch(error => {
  console.error('❌ Error generating access token:');
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Error:', error.response.data.error);
    console.error('Description:', error.response.data.error_description);
    
    if (error.response.data.error === 'invalid_grant') {
      console.error('\n💡 The refresh token may be expired or invalid.');
      console.error('   You may need to reconnect your Amazon Ads account to get a new refresh token.');
    }
  } else {
    console.error(error.message);
  }
  process.exit(1);
});
