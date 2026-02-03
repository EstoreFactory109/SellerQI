/**
 * Tests for ApiResponse class
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');

describe('ApiResponse', () => {
  describe('constructor', () => {
    it('should create a response with all parameters', () => {
      const statusCode = 200;
      const data = { user: { id: 1, name: 'John' } };
      const message = 'Success';
      
      const response = new ApiResponse(statusCode, data, message);
      
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual({ user: { id: 1, name: 'John' } });
      expect(response.message).toBe('Success');
    });

    it('should handle 201 created status', () => {
      const response = new ApiResponse(201, { id: 1 }, 'Created successfully');
      
      expect(response.statusCode).toBe(201);
      expect(response.data).toEqual({ id: 1 });
      expect(response.message).toBe('Created successfully');
    });

    it('should handle null data', () => {
      const response = new ApiResponse(200, null, 'No data');
      
      expect(response.statusCode).toBe(200);
      expect(response.data).toBeNull();
      expect(response.message).toBe('No data');
    });

    it('should handle undefined data', () => {
      const response = new ApiResponse(200, undefined, 'No data');
      
      expect(response.statusCode).toBe(200);
      expect(response.data).toBeUndefined();
    });

    it('should handle array data', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const response = new ApiResponse(200, data, 'List retrieved');
      
      expect(response.data).toHaveLength(3);
      expect(response.data[0]).toEqual({ id: 1 });
    });

    it('should handle empty array data', () => {
      const response = new ApiResponse(200, [], 'Empty list');
      
      expect(response.data).toEqual([]);
    });

    it('should handle empty object data', () => {
      const response = new ApiResponse(200, {}, 'Empty object');
      
      expect(response.data).toEqual({});
    });

    it('should handle complex nested data', () => {
      const data = {
        user: {
          id: 1,
          profile: {
            name: 'John',
            addresses: [
              { city: 'New York' },
              { city: 'Los Angeles' },
            ],
          },
        },
      };
      
      const response = new ApiResponse(200, data, 'Success');
      
      expect(response.data.user.profile.addresses).toHaveLength(2);
    });
  });

  describe('common status codes', () => {
    it('should handle 200 OK', () => {
      const response = new ApiResponse(200, { success: true }, 'OK');
      expect(response.statusCode).toBe(200);
    });

    it('should handle 201 Created', () => {
      const response = new ApiResponse(201, { id: 'new-id' }, 'Resource created');
      expect(response.statusCode).toBe(201);
    });

    it('should handle 204 No Content', () => {
      const response = new ApiResponse(204, null, 'No content');
      expect(response.statusCode).toBe(204);
    });
  });

  describe('response structure', () => {
    it('should have exactly three properties', () => {
      const response = new ApiResponse(200, {}, 'test');
      const keys = Object.keys(response);
      
      expect(keys).toContain('statusCode');
      expect(keys).toContain('data');
      expect(keys).toContain('message');
    });

    it('should be serializable to JSON', () => {
      const response = new ApiResponse(200, { test: 'data' }, 'Success');
      const json = JSON.stringify(response);
      const parsed = JSON.parse(json);
      
      expect(parsed.statusCode).toBe(200);
      expect(parsed.data).toEqual({ test: 'data' });
      expect(parsed.message).toBe('Success');
    });
  });
});
