/**
 * Tests for HashPassword utility
 */

const { hashPassword, verifyPassword } = require('../../utils/HashPassword.js');

describe('HashPassword', () => {
  describe('hashPassword', () => {
    it('should hash a password successfully', async () => {
      const password = 'TestPassword123!';
      const hashedPassword = await hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(0);
    });

    it('should generate different hashes for the same password', async () => {
      const password = 'TestPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      // Due to salt, same password should produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should hash empty string', async () => {
      const password = '';
      const hashedPassword = await hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });

    it('should hash special characters', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hashedPassword = await hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });

    it('should hash unicode characters', async () => {
      const password = '密码测试🔐';
      const hashedPassword = await hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });

    it('should hash very long passwords', async () => {
      const password = 'a'.repeat(1000);
      const hashedPassword = await hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const password = 'TestPassword123!';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword(password, hashedPassword);
      
      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'TestPassword123!';
      const wrongPassword = 'WrongPassword456!';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword(wrongPassword, hashedPassword);
      
      expect(isValid).toBe(false);
    });

    it('should return false for empty password when original was not empty', async () => {
      const password = 'TestPassword123!';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword('', hashedPassword);
      
      expect(isValid).toBe(false);
    });

    it('should return true for empty password when original was empty', async () => {
      const password = '';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword('', hashedPassword);
      
      expect(isValid).toBe(true);
    });

    it('should be case sensitive', async () => {
      const password = 'TestPassword123!';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword('testpassword123!', hashedPassword);
      
      expect(isValid).toBe(false);
    });

    it('should handle special characters correctly', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword(password, hashedPassword);
      
      expect(isValid).toBe(true);
    });

    it('should handle unicode characters correctly', async () => {
      const password = '密码测试🔐';
      const hashedPassword = await hashPassword(password);
      
      const isValid = await verifyPassword(password, hashedPassword);
      
      expect(isValid).toBe(true);
    });
  });
});
