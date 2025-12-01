// src/auth/amazonAuth.ts
import fetch from 'node-fetch';
/**
 * Get a fresh access token using the refresh token
 * @returns Promise that resolves to the access token
 */
export async function getAccessToken() {
    const CLIENT_ID = process.env.DATA_KIOSK_CLIENT_ID || "";
    const CLIENT_SECRET = process.env.DATA_KIOSK_CLIENT_SECRET || "";
    const REFRESH_TOKEN = process.env.DATA_KIOSK_REFRESH_TOKEN || "";
    const OAUTH_URL = process.env.DATA_KIOSK_OAUTH_URL || "https://api.amazon.com/auth/o2/token";
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
        throw new Error("Missing required environment variables for authentication");
    }
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", REFRESH_TOKEN);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    try {
        const response = await fetch(OAUTH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: params
        });
        if (!response.ok) {
            throw new Error(`OAuth error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.access_token;
    }
    catch (error) {
        console.error("Error obtaining access token:", error);
        throw error;
    }
}
