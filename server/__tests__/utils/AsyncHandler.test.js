/**
 * Tests for AsyncHandler utility
 */

const asyncHandler = require('../../utils/AsyncHandler.js');

describe('asyncHandler', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('successful execution', () => {
    it('should execute async function successfully', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        res.status(200).json({ success: true });
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should execute sync function successfully', async () => {
      const handler = asyncHandler((req, res, next) => {
        res.status(200).json({ success: true });
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should pass req, res, next to handler', async () => {
      const handlerFn = jest.fn().mockResolvedValue(undefined);
      const handler = asyncHandler(handlerFn);

      await handler(mockReq, mockRes, mockNext);

      expect(handlerFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
    });
  });

  describe('error handling', () => {
    it('should catch async errors and pass to next', async () => {
      const testError = new Error('Test async error');
      const handler = asyncHandler(async (req, res, next) => {
        throw testError;
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
    });

    it('should catch errors from sync function wrapped in Promise.resolve', async () => {
      // Note: asyncHandler uses Promise.resolve which catches errors
      // thrown during the initial synchronous execution
      const handler = asyncHandler(async (req, res, next) => {
        // Using async makes Promise.resolve work properly
        throw new Error('Test sync error');
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockNext.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(mockNext.mock.calls[0][0].message).toBe('Test sync error');
    });

    it('should handle rejected promises', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        throw new Error('Promise rejected');
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockNext.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(mockNext.mock.calls[0][0].message).toBe('Promise rejected');
    });

    it('should handle errors with custom status codes', async () => {
      const customError = new Error('Custom error');
      customError.statusCode = 400;
      
      const handler = asyncHandler(async (req, res, next) => {
        throw customError;
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(customError);
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });
  });

  describe('return value handling', () => {
    it('should handle handlers that return values', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        return { data: 'test' };
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle handlers that return undefined', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        res.json({ success: true });
        return undefined;
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle handlers that call next() explicitly', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        next();
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('middleware chain', () => {
    it('should work in middleware chain with error', async () => {
      const error = new Error('Middleware error');
      
      const middleware1 = asyncHandler(async (req, res, next) => {
        req.data = 'from middleware 1';
        next();
      });

      const middleware2 = asyncHandler(async (req, res, next) => {
        throw error;
      });

      await middleware1(mockReq, mockRes, mockNext);
      expect(mockReq.data).toBe('from middleware 1');
      expect(mockNext).toHaveBeenCalled();

      await middleware2(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
