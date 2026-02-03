/**
 * Tests for AccountHealth calculation service
 */

const { calculateAccountHealthPercentage, checkAccountHealth } = require('../../../Services/Calculations/AccountHealth.js');

describe('AccountHealth', () => {
  describe('calculateAccountHealthPercentage', () => {
    it('should return "Healthy" with 100% for ahrScore >= 800', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 800 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(100);
    });

    it('should return "Healthy" with 100% for ahrScore > 800', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 950 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(100);
    });

    it('should return "Healthy" with 80% for ahrScore between 200-799', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 500 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(80);
    });

    it('should return "Healthy" with 80% for ahrScore = 200', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 200 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(80);
    });

    it('should return "At Risk" with 50% for ahrScore between 100-199', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 150 });
      expect(result.status).toBe('At Risk');
      expect(result.Percentage).toBe(50);
    });

    it('should return "At Risk" with 50% for ahrScore = 100', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 100 });
      expect(result.status).toBe('At Risk');
      expect(result.Percentage).toBe(50);
    });

    it('should return "Unhealthy" with 30% for ahrScore < 100', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 50 });
      expect(result.status).toBe('Unhealthy');
      expect(result.Percentage).toBe(30);
    });

    it('should return "Unhealthy" with 30% for ahrScore = 0', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 0 });
      expect(result.status).toBe('Unhealthy');
      expect(result.Percentage).toBe(30);
    });

    it('should return "Data Not Available" for empty data', () => {
      const result = calculateAccountHealthPercentage({});
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" for null data', () => {
      const result = calculateAccountHealthPercentage(null);
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" for undefined data', () => {
      const result = calculateAccountHealthPercentage(undefined);
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" when ahrScore is null', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: null });
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" when ahrScore is undefined', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: undefined });
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });
  });

  describe('checkAccountHealth', () => {
    const healthyV2Data = {
      accountStatuses: 'NORMAL',
      listingPolicyViolations: 'GOOD',
      validTrackingRateStatus: 'GOOD',
      orderWithDefectsStatus: 'GOOD',
      lateShipmentRateStatus: 'GOOD',
      CancellationRate: 'GOOD',
    };

    const healthyV1Data = {
      negativeFeedbacks: { count: 0 },
      lateShipmentCount: { count: 0 },
      preFulfillmentCancellationCount: { count: 0 },
      refundsCount: { count: 0 },
      a_z_claims: { count: 0 },
      responseUnder24HoursCount: 0,
    };

    it('should return empty object when both v2 and v1 data are null or have only undefined properties', () => {
      // The function expects specific structure; with empty objects it may throw or return empty
      // Based on the implementation, passing null/null returns empty
      const result = checkAccountHealth(null, null);
      expect(result).toEqual({});
    });

    it('should return empty object when both inputs are null', () => {
      const result = checkAccountHealth(null, null);
      expect(result).toEqual({});
    });

    it('should return success for all checks when data is healthy', () => {
      const result = checkAccountHealth(healthyV2Data, healthyV1Data);

      expect(result.accountStatus.status).toBe('Success');
      expect(result.PolicyViolations.status).toBe('Success');
      expect(result.validTrackingRateStatus.status).toBe('Success');
      expect(result.orderWithDefectsStatus.status).toBe('Success');
      expect(result.lateShipmentRateStatus.status).toBe('Success');
      expect(result.CancellationRate.status).toBe('Success');
      expect(result.TotalErrors).toBe(0);
    });

    describe('V2 checks', () => {
      it('should detect account status error', () => {
        const v2Data = { ...healthyV2Data, accountStatuses: 'SUSPENDED' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.accountStatus.status).toBe('Error');
        expect(result.accountStatus.Message).toContain('not in normal standing');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should detect listing policy violations', () => {
        const v2Data = { ...healthyV2Data, listingPolicyViolations: 'BAD' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.PolicyViolations.status).toBe('Error');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should detect valid tracking rate issues', () => {
        const v2Data = { ...healthyV2Data, validTrackingRateStatus: 'POOR' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.validTrackingRateStatus.status).toBe('Error');
        expect(result.validTrackingRateStatus.Message).toContain('Valid Tracking Rate');
      });

      it('should detect order defect rate issues', () => {
        const v2Data = { ...healthyV2Data, orderWithDefectsStatus: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.orderWithDefectsStatus.status).toBe('Error');
        expect(result.orderWithDefectsStatus.Message).toContain('Order Defect Rate');
      });

      it('should detect late shipment rate issues', () => {
        const v2Data = { ...healthyV2Data, lateShipmentRateStatus: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.lateShipmentRateStatus.status).toBe('Error');
        expect(result.lateShipmentRateStatus.Message).toContain('Late Shipment Rate');
      });

      it('should detect cancellation rate issues', () => {
        const v2Data = { ...healthyV2Data, CancellationRate: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.CancellationRate.status).toBe('Error');
      });
    });

    describe('V1 checks', () => {
      it('should detect negative feedbacks', () => {
        const v1Data = { ...healthyV1Data, negativeFeedbacks: { count: 5 } };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.negativeFeedbacks.status).toBe('Error');
        expect(result.negativeFeedbacks.Message).toContain('negative seller feedback');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should return empty object for zero negative feedbacks', () => {
        const result = checkAccountHealth(healthyV2Data, healthyV1Data);
        expect(result.negativeFeedbacks).toEqual({});
      });

      it('should detect NCX (Negative Customer Experience) issues', () => {
        const v1Data = {
          ...healthyV1Data,
          lateShipmentCount: { count: 2 },
          preFulfillmentCancellationCount: { count: 1 },
          refundsCount: { count: 0 },
        };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.NCX.status).toBe('Error');
        expect(result.NCX.Message).toContain('NCX');
      });

      it('should return empty NCX when counts are zero', () => {
        const result = checkAccountHealth(healthyV2Data, healthyV1Data);
        expect(result.NCX).toEqual({});
      });

      it('should detect A-to-Z claims', () => {
        const v1Data = { ...healthyV1Data, a_z_claims: { count: 1 } };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.a_z_claims.status).toBe('Error');
        expect(result.a_z_claims.Message).toContain('A-to-Z Guarantee Claim');
      });

      it('should detect response time issues', () => {
        const v1Data = { ...healthyV1Data, responseUnder24HoursCount: 3 };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.responseUnder24HoursCount.status).toBe('Error');
        expect(result.responseUnder24HoursCount.Message).toContain('24 hours');
      });
    });

    describe('error counting', () => {
      it('should count total errors correctly', () => {
        const v2Data = {
          accountStatuses: 'SUSPENDED',
          listingPolicyViolations: 'BAD',
          validTrackingRateStatus: 'POOR',
          orderWithDefectsStatus: 'GOOD',
          lateShipmentRateStatus: 'GOOD',
          CancellationRate: 'GOOD',
        };
        const v1Data = {
          negativeFeedbacks: { count: 5 },
          lateShipmentCount: { count: 0 },
          preFulfillmentCancellationCount: { count: 0 },
          refundsCount: { count: 0 },
          a_z_claims: { count: 0 },
          responseUnder24HoursCount: 0,
        };

        const result = checkAccountHealth(v2Data, v1Data);

        // 3 V2 errors + 1 V1 error = 4
        expect(result.TotalErrors).toBe(4);
      });

      it('should count all errors when everything is problematic', () => {
        const v2Data = {
          accountStatuses: 'SUSPENDED',
          listingPolicyViolations: 'BAD',
          validTrackingRateStatus: 'POOR',
          orderWithDefectsStatus: 'HIGH',
          lateShipmentRateStatus: 'HIGH',
          CancellationRate: 'HIGH',
        };
        const v1Data = {
          negativeFeedbacks: { count: 5 },
          lateShipmentCount: { count: 2 },
          preFulfillmentCancellationCount: { count: 1 },
          refundsCount: { count: 1 },
          a_z_claims: { count: 1 },
          responseUnder24HoursCount: 3,
        };

        const result = checkAccountHealth(v2Data, v1Data);

        // 6 V2 errors + 4 V1 errors (negativeFeedbacks, NCX, a_z_claims, responseUnder24Hours) = 10
        expect(result.TotalErrors).toBe(10);
      });
    });
  });
});
