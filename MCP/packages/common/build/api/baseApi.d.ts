export declare const BASE_URL: string;
/**
 * Make an authenticated API request to the Amazon Data Kiosk API
 * @param path - API path relative to the base URL
 * @param method - HTTP method
 * @param body - Optional request body
 * @returns Promise that resolves to the API response
 */
export declare function makeApiRequest(path: string, method: string, body?: any): Promise<any>;
/**
 * Download document content and save to local filesystem
 * @param url - Document download URL
 * @returns Promise that resolves to metadata about the saved content
 */
export declare function downloadDocument(url: string): Promise<{
    savedPath: string;
    size: number;
    timestamp: string;
    contentPreview: string;
}>;
/**
 * Read content from a file with pagination support
 * @param filePath - Path to the file to read
 * @param maxLines - Maximum number of lines to read
 * @param startLine - Line number to start reading from
 * @returns Object containing file information and content
 */
export declare function readFileContent(filePath: string, maxLines?: number, startLine?: number): Promise<{
    fileInfo: {
        path: string;
        size: string;
        created: string;
        modified: string;
        extension: string;
        totalLines: number;
    };
    content: string;
    startLine: number;
    endLine: number;
    hasMoreLines: boolean;
}>;
