/**
 * Validates a GraphQL query string
 * @param query The GraphQL query string to validate
 * @returns True if the query is valid, false otherwise
 */
export declare function validateGraphQLQuery(query: string): boolean;
/**
 * Checks if a GraphQL query targets a specific schema
 * @param query The GraphQL query string
 * @param schemaName The schema name to check for
 * @returns True if the query targets the schema, false otherwise
 */
export declare function queryTargetsSchema(query: string, schemaName: string): boolean;
/**
 * Identifies which schema a GraphQL query is targeting
 * @param query The GraphQL query string
 * @returns The schema name or null if not identified
 */
export declare function identifyQuerySchema(query: string): string | null;
/**
 * Extracts query parameters from a GraphQL query
 * @param query The GraphQL query string
 * @returns Object containing the extracted parameters
 */
export declare function extractQueryParameters(query: string): Record<string, any>;
