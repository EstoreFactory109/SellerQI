/**
 * Tests for OTP Generator utility
 */

const { generateOTP } = require('../../utils/OTPGenerator.js');

describe('generateOTP', () => {
  describe('OTP format', () => {
    it('should generate a 5-digit OTP', () => {
      const otp = generateOTP();
      
      expect(otp).toHaveLength(5);
    });

    it('should return a string', () => {
      const otp = generateOTP();
      
      expect(typeof otp).toBe('string');
    });

    it('should contain only numeric characters', () => {
      const otp = generateOTP();
      
      expect(/^\d+$/.test(otp)).toBe(true);
    });

    it('should generate OTP in range 10000-99999', () => {
      const otp = generateOTP();
      const numericOtp = parseInt(otp, 10);
      
      expect(numericOtp).toBeGreaterThanOrEqual(10000);
      expect(numericOtp).toBeLessThan(100000);
    });
  });

  describe('randomness', () => {
    it('should generate different OTPs on multiple calls', () => {
      const otps = new Set();
      
      // Generate 100 OTPs and check uniqueness
      for (let i = 0; i < 100; i++) {
        otps.add(generateOTP());
      }
      
      // With 100 calls, we should have mostly unique OTPs
      // (statistically very unlikely to have many duplicates)
      expect(otps.size).toBeGreaterThan(90);
    });

    it('should have good distribution across range', () => {
      const otps = [];
      
      for (let i = 0; i < 1000; i++) {
        otps.push(parseInt(generateOTP(), 10));
      }
      
      // Check that we have OTPs from different ranges
      const hasLow = otps.some(otp => otp < 30000);
      const hasMid = otps.some(otp => otp >= 40000 && otp < 60000);
      const hasHigh = otps.some(otp => otp >= 70000);
      
      expect(hasLow).toBe(true);
      expect(hasMid).toBe(true);
      expect(hasHigh).toBe(true);
    });
  });

  describe('consistency', () => {
    it('should always generate valid OTPs', () => {
      for (let i = 0; i < 100; i++) {
        const otp = generateOTP();
        
        expect(otp).toHaveLength(5);
        expect(/^\d{5}$/.test(otp)).toBe(true);
      }
    });

    it('should never generate OTPs with leading zeros', () => {
      // Run many times to ensure no leading zeros
      for (let i = 0; i < 100; i++) {
        const otp = generateOTP();
        
        expect(otp[0]).not.toBe('0');
      }
    });
  });
});
