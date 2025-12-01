export interface OAuthResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}
/**
 * Get a fresh access token using the refresh token
 * @returns Promise that resolves to the access token
 */
export declare function getAccessToken(): Promise<string>;
