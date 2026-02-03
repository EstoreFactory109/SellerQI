/**
 * Tests for ApiError class
 */

const { ApiError } = require('../../utils/ApiError.js');

describe('ApiError', () => {
  describe('constructor', () => {
    it('should create an error with status code and message', () => {
      const error = new ApiError(400, 'Bad request');
      
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Bad request');
      expect(error.errors).toEqual([]);
    });

    it('should extend Error class', () => {
      const error = new ApiError(500, 'Internal error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
    });

    it('should use default message when not provided', () => {
      const error = new ApiError(500);
      
      expect(error.message).toBe('Something went wrong');
    });

    it('should accept errors array', () => {
      const errors = [
        { field: 'email', message: 'Invalid email' },
        { field: 'password', message: 'Too short' },
      ];
      const error = new ApiError(400, 'Validation failed', errors);
      
      expect(error.errors).toEqual(errors);
      expect(error.errors).toHaveLength(2);
    });

    it('should use custom stack when provided', () => {
      const customStack = 'Custom stack trace';
      const error = new ApiError(500, 'Error', [], customStack);
      
      expect(error.stack).toBe(customStack);
    });

    it('should generate stack trace when not provided', () => {
      const error = new ApiError(500, 'Error');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });
  });

  describe('common HTTP status codes', () => {
    it('should handle 400 Bad Request', () => {
      const error = new ApiError(400, 'Bad request');
      expect(error.statusCode).toBe(400);
    });

    it('should handle 401 Unauthorized', () => {
      const error = new ApiError(401, 'Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should handle 403 Forbidden', () => {
      const error = new ApiError(403, 'Forbidden');
      expect(error.statusCode).toBe(403);
    });

    it('should handle 404 Not Found', () => {
      const error = new ApiError(404, 'Resource not found');
      expect(error.statusCode).toBe(404);
    });

    it('should handle 409 Conflict', () => {
      const error = new ApiError(409, 'Resource already exists');
      expect(error.statusCode).toBe(409);
    });

    it('should handle 422 Unprocessable Entity', () => {
      const error = new ApiError(422, 'Validation error');
      expect(error.statusCode).toBe(422);
    });

    it('should handle 500 Internal Server Error', () => {
      const error = new ApiError(500, 'Internal server error');
      expect(error.statusCode).toBe(500);
    });

    it('should handle 503 Service Unavailable', () => {
      const error = new ApiError(503, 'Service unavailable');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('error properties', () => {
    it('should have name property from Error', () => {
      const error = new ApiError(400, 'Test error');
      expect(error.name).toBe('Error');
    });

    it('should be throwable', () => {
      expect(() => {
        throw new ApiError(400, 'Test error');
      }).toThrow('Test error');
    });

    it('should be catchable as ApiError', () => {
      try {
        throw new ApiError(400, 'Test error');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
      }
    });
  });

  describe('validation errors format', () => {
    it('should handle express-validator style errors', () => {
      const errors = [
        { type: 'field', msg: 'Invalid email', path: 'email', location: 'body' },
        { type: 'field', msg: 'Password required', path: 'password', location: 'body' },
      ];
      const error = new ApiError(400, 'Validation failed', errors);
      
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0].msg).toBe('Invalid email');
    });

    it('should handle custom validation errors', () => {
      const errors = [
        { field: 'email', message: 'Email is already taken' },
      ];
      const error = new ApiError(409, 'Conflict', errors);
      
      expect(error.errors[0].field).toBe('email');
    });
  });

  describe('serialization', () => {
    it('should have serializable properties', () => {
      const error = new ApiError(400, 'Bad request', [{ field: 'test' }]);
      
      // Create a plain object from error properties
      const serialized = {
        statusCode: error.statusCode,
        message: error.message,
        errors: error.errors,
        stack: error.stack,
      };
      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);
      
      expect(parsed.statusCode).toBe(400);
      expect(parsed.message).toBe('Bad request');
      expect(parsed.errors).toEqual([{ field: 'test' }]);
    });

    it('should have accessible stack property', () => {
      const error = new ApiError(500, 'Error');
      
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });
  });
});
