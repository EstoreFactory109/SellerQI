/**
 * Formats a query status response into human-readable text
 * @param result The query status API response
 * @returns Formatted status message
 */
export declare function formatQueryStatus(result: any): string;
/**
 * Formats document content from JSONL to a more readable format
 * @param content The document content in JSONL format
 * @returns Formatted content
 */
export declare function formatDocumentContent(content: string): string;
/**
 * Creates a user-friendly error message based on the error
 * @param error The error object or message
 * @param context Additional context information
 * @returns Formatted error message
 */
export declare function formatErrorMessage(error: any, context?: string): string;
